// GET /api/nwps            → { latest, previous, checked }  which NWPS runs are complete on NOMADS
// GET /api/nwps?run=YYYYMMDDHH → compact nearshore wave forecast for Pirate View's spots (that run)
//
// NOAA NWPS (Mount Holly / PHI, ~1 km CG2 grid): see api/_lib/nwps.js. The browser never sees the
// ~19 MB model file: this function downloads a run once, reads height / period / direction at
// the fixed spot points straight from the packed GRIB2 bits, and returns ~20 KB of JSON.
//
// Caching (Vercel CDN; nothing relies on in-memory state between invocations):
//  - the run list is cheap (one directory listing + a HEAD per candidate run) and cached 10 min;
//  - a run's data never changes, so ?run= responses are cached for a week and marked immutable:
//    each run is downloaded and decoded about once per CDN region, not once per visitor;
//  - a warm instance also shares an in-flight decode between simultaneous requests for the same
//    run (Fluid compute runs concurrent requests in one instance), and keeps the last 2 results.
// Failures return 502 with a 60 s cache so a NOAA outage is retried soon and never cached long.

// Self-contained on purpose (no imports): Vercel deploys this file as one function as-is.

/** The fixed nearshore sampling points — the same as `sources.nwps` in js/config/spots.js (a
 *  test keeps them identical). Nothing else is ever read from the model. */
export const POINTS = [
  { id: 'dewey', lat: 38.6890, lon: -75.0654, offshoreKm: 0.8 },
  { id: 'bethany', lat: 38.5360, lon: -75.0423, offshoreKm: 1.1 },
  { id: 'southside', lat: 38.5990, lon: -75.0538, offshoreKm: 0.9 },
  { id: 'northside', lat: 38.6170, lon: -75.0538, offshoreKm: 1 },
  { id: 'conquest', lat: 38.6440, lon: -75.0538, offshoreKm: 1.5 },
];

// ---------------- NWPS helpers (source, run discovery, sparse GRIB2 sampling) ----------------
// NWS WFO Mount Holly (PHI) NWPS, nested grid CG2 (~1 km, 38.5–39.85 N, 75.70–74.65 W), hourly 0–144 h,
// 4 runs a day (00/06/12/18Z) posted ~4 h after the cycle. One run = one ~19 MB GRIB2 file
// (9 variables × 145 hours, simple packing + land bitmap). Only discipline 10 / category 0
// numbers 3 (HTSGW m), 11 (PERPW s) and 10 (DIRPW ° true, FROM) are read, at the fixed points.

export const NOMADS_NWPS = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/nwps/prod';
export const OFFICE = 'phi';
export const GRID = 'CG2';
export const MIN_FILE_BYTES = 5e6;      // a complete PHI CG2 run is ~19 MB
export const MAX_RUN_AGE_H = 54;        // the data endpoint only serves recent runs
export const STALE_RUN_H = 13;          // PHI runs every 6 h and posts ~4 h later: older than this is late
const CYCLES = ['18', '12', '06', '00'];
const RUN_RE = /^\d{8}(00|06|12|18)$/;

export const VARS = { 3: 'hs', 11: 'tp', 10: 'dp' }; // discipline 10, category 0
export const M_TO_FT = 3.28084;

export const runTime = run => Date.UTC(+run.slice(0, 4), +run.slice(4, 6) - 1, +run.slice(6, 8), +run.slice(8, 10));
export const validRun = run => typeof run === 'string' && RUN_RE.test(run);
export function runUrl(run) {
  const d = run.slice(0, 8), c = run.slice(8, 10);
  return `${NOMADS_NWPS}/er.${d}/${OFFICE}/${c}/${GRID}/nwps.t${c}z.${GRID.toLowerCase()}.${OFFICE}.grib2`;
}
export const dayListUrl = day => `${NOMADS_NWPS}/er.${day}/${OFFICE}/`;

/** Cycle directories ("00/", "06/" …) in a NOMADS directory listing. */
export function parseCycles(html) {
  return [...new Set([...String(html).matchAll(/href="(\d\d)\/"/g)].map(m => m[1]).filter(c => CYCLES.includes(c)))];
}

/**
 * The two newest complete runs (CG2 file posted and plausibly whole), newest first:
 * { latest, previous } (run strings or null). Checks today and yesterday (UTC); never a run
 * from the future. `f` is fetch (injectable for tests).
 */
export async function findRuns(now = Date.now(), f = fetch) {
  const found = [];
  for (let back = 0; back < 2 && found.length < 2; back++) {
    const day = new Date(now - back * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
    let cycles = [];
    try { const r = await f(dayListUrl(day)); if (r.ok) cycles = parseCycles(await r.text()); } catch { /* day not reachable */ }
    for (const c of CYCLES) {
      if (found.length >= 2) break;
      const run = day + c;
      if (!cycles.includes(c) || runTime(run) > now) continue;
      try {
        const h = await f(runUrl(run), { method: 'HEAD' });
        const len = Number(h.headers?.get?.('content-length'));
        if (h.ok && (!Number.isFinite(len) || len >= MIN_FILE_BYTES)) found.push(run);
      } catch { /* not posted yet / unreachable */ }
    }
  }
  return { latest: found[0] || null, previous: found[1] || null };
}

// ---------------- sparse GRIB2 sampling ----------------

const POP = new Uint8Array(256).map((_, i) => { let c = 0, x = i; while (x) { c += x & 1; x >>= 1; } return c; });

/** Grid index of a point on a template-3.0 grid (south→north j, west→east i), or null if outside. */
export function cellOf(grid, lat, lon) {
  const i = Math.round((lon - grid.lon0) / grid.dlon), j = Math.round((lat - grid.lat0) / grid.dlat);
  if (i < 0 || j < 0 || i >= grid.ni || j >= grid.nj) return null;
  return { i, j, lat: +(grid.lat0 + j * grid.dlat).toFixed(5), lon: +(grid.lon0 + i * grid.dlon).toFixed(5) };
}

/**
 * Walk a GRIB2 file and read the wanted variables at fixed points, without unpacking fields.
 * points: [{ id, lat, lon }]. Returns { refTime, grid, maxFh, cells: { id: cell }, values:
 * { id: { hs: [], tp: [], dp: [] } } } — arrays indexed by forecast hour, NaN where the cell is
 * masked (land/dry) or the hour is missing. Throws on anything it cannot read exactly
 * (other grid or packing templates, truncated file, grids that change between messages).
 */
export function sampleGrib2(buf, points) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 0, grid = null, refTime = null, maxFh = -1, cells = null;
  const values = Object.fromEntries(points.map(p => [p.id, { hs: [], tp: [], dp: [] }]));
  while (off + 16 <= b.length) {
    if (b[off] !== 0x47 || b[off + 1] !== 0x52 || b[off + 2] !== 0x49 || b[off + 3] !== 0x42) break; // "GRIB"
    if (b[off + 7] !== 2) throw new Error('not GRIB edition 2');
    const discipline = b[off + 6];
    const len = Number(dv.getBigUint64(off + 8));
    if (len < 16 || off + len > b.length) throw new Error('truncated GRIB2 message');
    const end = off + len;
    let p = off + 16, cat = -1, num = -1, fh = -1, unit = -1, R = 0, E = 0, D = 0, nbits = 0, tpl5 = -1, npack = 0;
    let bitmap = null, data = null, g = null, ref = null;
    while (p + 5 <= end - 4) {
      const sl = dv.getUint32(p), sn = b[p + 4];
      if (sl < 5 || p + sl > end) throw new Error('bad GRIB2 section');
      if (sn === 1) ref = Date.UTC(dv.getUint16(p + 12), b[p + 14] - 1, b[p + 15], b[p + 16], b[p + 17], b[p + 18]);
      else if (sn === 3) {
        if (dv.getUint16(p + 12) !== 0) throw new Error('unsupported grid template');
        const ni = dv.getUint32(p + 30), nj = dv.getUint32(p + 34);
        const la1 = dv.getInt32(p + 46) / 1e6, lo1 = dv.getUint32(p + 50) / 1e6, la2 = dv.getInt32(p + 55) / 1e6;
        const di = dv.getUint32(p + 63) / 1e6, dj = dv.getUint32(p + 67) / 1e6, scan = b[p + 71];
        if (scan & 0x80) throw new Error('unsupported scan order');
        g = { ni, nj, lat0: Math.min(la1, la2), lon0: lo1 > 180 ? lo1 - 360 : lo1, dlat: dj, dlon: di, southFirst: !!(scan & 0x40) };
      } else if (sn === 4) {
        cat = b[p + 9]; num = b[p + 10]; unit = b[p + 17]; fh = dv.getUint32(p + 18);
      } else if (sn === 5) {
        npack = dv.getUint32(p + 5); tpl5 = dv.getUint16(p + 9);
        R = dv.getFloat32(p + 11);
        const e = dv.getUint16(p + 15), d = dv.getUint16(p + 17);
        E = e & 0x8000 ? -(e & 0x7fff) : e; D = d & 0x8000 ? -(d & 0x7fff) : d;
        nbits = b[p + 19];
      } else if (sn === 6) {
        const ind = b[p + 5];
        if (ind === 0) bitmap = b.subarray(p + 6, p + sl);
        else if (ind !== 255) throw new Error('unsupported bitmap');
      } else if (sn === 7) data = b.subarray(p + 5, p + sl);
      p += sl;
    }
    off = end;
    const key = discipline === 10 && cat === 0 ? VARS[num] : null;
    if (!key) continue;
    if (!g || !data) throw new Error('incomplete GRIB2 message');
    if (unit !== 1) throw new Error('forecast time not in hours');
    if (tpl5 !== 0) throw new Error('unsupported packing template');
    if (!grid) {
      grid = g; refTime = ref;
      cells = Object.fromEntries(points.map(pt => [pt.id, cellOf(grid, pt.lat, pt.lon)]));
    } else if (g.ni !== grid.ni || g.nj !== grid.nj || g.lat0 !== grid.lat0 || g.lon0 !== grid.lon0 || ref !== refTime) {
      throw new Error('grid or run changes between messages');
    }
    const s2 = Math.pow(2, E), s10 = Math.pow(10, -D);
    for (const pt of points) {
      const c = cells[pt.id];
      let v = NaN;
      if (c) {
        const row = grid.southFirst ? c.j : grid.nj - 1 - c.j;
        const k = row * grid.ni + c.i; // index in file order
        let packed = k;
        if (bitmap) {
          if (!((bitmap[k >> 3] >> (7 - (k & 7))) & 1)) packed = -1; // masked (land / dry)
          else { let n = 0; for (let q = 0; q < k >> 3; q++) n += POP[bitmap[q]]; for (let r = 0; r < (k & 7); r++) n += (bitmap[k >> 3] >> (7 - r)) & 1; packed = n; }
        }
        if (packed >= 0 && (!npack || packed < npack)) {
          let x = 0, bit = packed * nbits;
          for (let q = 0; q < nbits; q++, bit++) x = (x * 2) + ((data[bit >> 3] >> (7 - (bit & 7))) & 1);
          v = (R + x * s2) * s10;
        }
      }
      values[pt.id][key][fh] = v;
    }
    if (fh > maxFh) maxFh = fh;
  }
  if (!grid) throw new Error('no NWPS wave messages');
  delete grid.southFirst;
  return { refTime, grid, maxFh, cells, values };
}

const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r1 = x => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r0 = x => (Number.isFinite(x) ? Math.round(x) % 360 : null);

/**
 * Compact, normalized JSON for one run. Every point has the same hourly index (0 = run time).
 * Hours where any of the three values is missing for a point are null for all three (a score
 * needs height, period and direction together; partial hours are not served as complete).
 */
export function normalizeRun(run, sampled, points, meta = {}) {
  const n = sampled.maxFh + 1;
  const out = {};
  for (const pt of points) {
    const v = sampled.values[pt.id], c = sampled.cells[pt.id];
    const hs = [], tp = [], dp = [];
    let ok = 0;
    for (let h = 0; h < n; h++) {
      const a = v.hs[h], t = v.tp[h], d = v.dp[h];
      const good = Number.isFinite(a) && Number.isFinite(t) && Number.isFinite(d) && a >= 0 && t > 0;
      hs.push(good ? r2(a) : null); tp.push(good ? r1(t) : null); dp.push(good ? r0(d) : null);
      if (good) ok++;
    }
    out[pt.id] = { lat: pt.lat, lon: pt.lon, cell: c, offshoreKm: pt.offshoreKm ?? null, hours: ok, hs, tp, dp };
  }
  return {
    model: 'NOAA NWPS (SWAN)', office: 'PHI', grid: GRID, resolution: '~1 km', run,
    runTime: new Date(runTime(run)).toISOString(), file: runUrl(run), ...meta,
    grid_def: sampled.grid, stepH: 1, maxFh: sampled.maxFh,
    units: { hs: 'm', tp: 's', dp: 'deg true, from' },
    points: out,
  };
}

// ---------------- handler ----------------

const inflight = new Map(), done = new Map();

async function download(url, ms = 45000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'PirateView (skim conditions app)' } });
    if (!r.ok) throw new Error('NOMADS ' + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    const len = Number(r.headers.get('content-length'));
    if (Number.isFinite(len) && len > 0 && buf.length !== len) throw new Error('incomplete download');
    if (buf.length < MIN_FILE_BYTES) throw new Error('file too small');
    return { buf, modified: r.headers.get('last-modified') };
  } finally { clearTimeout(timer); }
}

export async function buildRun(run, { fetchImpl = null } = {}) {
  const t0 = Date.now();
  const { buf, modified } = fetchImpl ? await fetchImpl(runUrl(run)) : await download(runUrl(run));
  const t1 = Date.now();
  const sampled = sampleGrib2(buf, POINTS);
  if (sampled.refTime !== runTime(run)) throw new Error('file is not the requested run');
  return normalizeRun(run, sampled, POINTS, {
    fileModified: modified ? new Date(modified).toISOString() : null,
    bytes: buf.length, downloadMs: t1 - t0, decodeMs: Date.now() - t1, built: new Date().toISOString(),
  });
}

function getRun(run) {
  if (done.has(run)) return Promise.resolve(done.get(run));
  if (!inflight.has(run)) {
    const p = buildRun(run).then(d => {
      done.set(run, d); if (done.size > 2) done.delete(done.keys().next().value);
      return d;
    }).finally(() => inflight.delete(run));
    inflight.set(run, p);
  }
  return inflight.get(run);
}

export default async function handler(req, res) {
  const q = req.query || {};
  try {
    if (q.run == null) {
      const { latest, previous } = await findRuns();
      if (!latest) throw new Error('no NWPS run found');
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
      return res.status(200).json({ latest, previous, checked: new Date().toISOString() });
    }
    const run = String(q.run);
    if (!validRun(run)) return res.status(400).json({ error: 'bad run' });
    const age = (Date.now() - runTime(run)) / 3600e3;
    if (age < 0 || age > MAX_RUN_AGE_H) return res.status(400).json({ error: 'run out of range' });
    const data = await getRun(run);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=604800, immutable');
    return res.status(200).json(data);
  } catch {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(502).json({ error: 'nearshore wave forecast unavailable' });
  }
}
