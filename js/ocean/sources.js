// Ocean-map data sources → ONE normalized frame shape. The UI never needs to know which model a
// frame came from; a better source (e.g. NOAA NWPS nearshore) can be added here later.
//
//   frame = { kind, validTime, runTime, source: { name, role, run }, grid: { ni, nj, lat0, lon0, dlat, dlon },
//             fields: { <name>: Float32Array, … }, filled: Uint8Array }
//
// Grids are row-major, south→north rows, west→east columns, NaN = no data (land / outside).
// `filled` marks cells that were land in the model but sit right next to the sea: they get the
// mean of their sea neighbours so the colour reaches the coastline (marked so the inspector can
// say "nearest model cell"). Never more than one cell — bays and inland water are NOT invented.
//
// Units are converted here once: wave height m→ft, wind m/s→mph, SST °C→°F.
// Directions are METEOROLOGICAL/NAUTICAL "coming FROM" (NOAA convention); u/v are the TRAVEL
// direction (east/north), used only for the motion layer.

import { parseGrib2, pick } from './grib2.js';

const M_FT = 3.28084, MS_MPH = 2.236936;
export const BBOX = { south: 35.8, west: -77.4, north: 41.4, east: -71.4 };

export const SOURCES = {
  wave: { name: 'NOAA GFS-Wave (WAVEWATCH III)', role: 'Regional wave model', short: 'GFS-Wave', res: '0.167° (~15–18 km)' },
  wind: { name: 'NOAA GFS', role: 'Regional weather model', short: 'GFS', res: '0.25° (~25 km)' },
  sst: { name: 'MUR SST (NASA JPL) via NOAA CoastWatch', role: 'Daily satellite analysis', short: 'MUR SST', res: '0.05°' },
};

/** Forecast hours a run offers for the map: hourly to 120 h, then every 3 h to 168 h (7 days). */
export function forecastHours() {
  const h = [];
  for (let i = 0; i <= 120; i++) h.push(i);
  for (let i = 123; i <= 168; i += 3) h.push(i);
  return h;
}

/** "2026112318" → ms */
export const runTime = run => Date.UTC(+run.slice(0, 4), +run.slice(4, 6) - 1, +run.slice(6, 8), +run.slice(8, 10));

/** Frames for a run, starting at the last hour at or before `now` (so "now" always has a frame).
 *  `hours` = the hours NOMADS actually lists for the run; without it, the published schedule. */
export function frameList(run, now = Date.now(), hours = null) {
  const t0 = runTime(run);
  const sched = new Set(forecastHours());
  const list = Array.isArray(hours) && hours.length ? hours.filter(h => sched.has(h)) : [...sched];
  const all = list.sort((a, b) => a - b).map(fh => ({ fh, t: t0 + fh * 3600e3 }));
  let start = 0;
  for (let i = 0; i < all.length; i++) if (all[i].t <= now) start = i;
  return all.slice(start);
}

/** Nearest frame index to time t (ms). */
export function nearestFrame(frames, t) {
  let best = 0, d = Infinity;
  frames.forEach((f, i) => { const x = Math.abs(f.t - t); if (x < d) { d = x; best = i; } });
  return best;
}

// ---------- grid helpers ----------

export function fillCoast(grid, fields, dirKeys = []) {
  const { ni, nj } = grid, n = ni * nj;
  const key = Object.keys(fields)[0];
  const base = fields[key];
  const filled = new Uint8Array(n);
  const todo = [];
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
    const c = j * ni + i;
    if (!Number.isNaN(base[c])) continue;
    const nb = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const jj = j + dj, ii = i + di;
      if (jj < 0 || jj >= nj || ii < 0 || ii >= ni) continue;
      const q = jj * ni + ii;
      if (!Number.isNaN(base[q])) nb.push(q);
    }
    if (nb.length) todo.push([c, nb]);
  }
  for (const [c, nb] of todo) {
    for (const [k, arr] of Object.entries(fields)) {
      if (dirKeys.includes(k)) { // average directions as unit vectors
        let x = 0, y = 0;
        for (const q of nb) { const a = arr[q] * Math.PI / 180; x += Math.sin(a); y += Math.cos(a); }
        arr[c] = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
      } else {
        let s = 0; for (const q of nb) s += arr[q]; arr[c] = s / nb.length;
      }
    }
    filled[c] = 1;
  }
  return filled;
}

/** Bilinear sample of one field at lat/lon; corners without data are left out (weights
 *  renormalised). Returns NaN when no corner has data or the point is outside the grid. */
export function sampleField(grid, arr, lat, lon) {
  const x = (lon - grid.lon0) / grid.dlon, y = (lat - grid.lat0) / grid.dlat;
  if (x < 0 || y < 0 || x > grid.ni - 1 || y > grid.nj - 1) return NaN;
  const i = Math.min(grid.ni - 2, Math.floor(x)), j = Math.min(grid.nj - 2, Math.floor(y));
  const fx = x - i, fy = y - j;
  const c = [[j, i, (1 - fx) * (1 - fy)], [j, i + 1, fx * (1 - fy)], [j + 1, i, (1 - fx) * fy], [j + 1, i + 1, fx * fy]];
  let s = 0, w = 0;
  for (const [jj, ii, ww] of c) { const v = arr[jj * grid.ni + ii]; if (!Number.isNaN(v) && ww > 0) { s += v * ww; w += ww; } }
  return w > 1e-6 ? s / w : NaN;
}

/** Direction (FROM, degrees) sampled through unit vectors so 350°/10° average to 0°, not 180°. */
export function sampleDir(grid, arr, lat, lon) {
  const x = (lon - grid.lon0) / grid.dlon, y = (lat - grid.lat0) / grid.dlat;
  if (x < 0 || y < 0 || x > grid.ni - 1 || y > grid.nj - 1) return NaN;
  const i = Math.min(grid.ni - 2, Math.floor(x)), j = Math.min(grid.nj - 2, Math.floor(y));
  const fx = x - i, fy = y - j;
  let sx = 0, sy = 0, w = 0;
  for (const [jj, ii, ww] of [[j, i, (1 - fx) * (1 - fy)], [j, i + 1, fx * (1 - fy)], [j + 1, i, (1 - fx) * fy], [j + 1, i + 1, fx * fy]]) {
    const v = arr[jj * grid.ni + ii];
    if (Number.isNaN(v) || ww <= 0) continue;
    sx += Math.sin(v * Math.PI / 180) * ww; sy += Math.cos(v * Math.PI / 180) * ww; w += ww;
  }
  if (w < 1e-6) return NaN;
  return (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
}

/** Was the nearest model cell to this point a coast-filled one? */
export function nearestFilled(frame, lat, lon) {
  const g = frame.grid;
  const i = Math.round((lon - g.lon0) / g.dlon), j = Math.round((lat - g.lat0) / g.dlat);
  if (i < 0 || j < 0 || i >= g.ni || j >= g.nj) return false;
  return !!frame.filled[j * g.ni + i];
}

// ---------- decoders: raw source → frame ----------

export function waveFrame(buf, run) {
  const msgs = parseGrib2(buf);
  const hs = pick(msgs, 10, 0, 3), tp = pick(msgs, 10, 0, 11), dp = pick(msgs, 10, 0, 10);
  if (!hs || !tp || !dp) throw new Error('wave fields missing');
  const grid = hs.grid;
  const height = hs.values.map(v => v * M_FT);
  const fields = { height, period: Float32Array.from(tp.values), dir: Float32Array.from(dp.values) };
  const filled = fillCoast(grid, fields, ['dir']);
  return {
    kind: 'wave', validTime: hs.refTime + hs.fh * 3600e3, runTime: hs.refTime,
    source: { ...SOURCES.wave, run }, grid, fields, filled,
  };
}

export function windFrame(buf, run) {
  const msgs = parseGrib2(buf);
  const u = pick(msgs, 0, 2, 2), v = pick(msgs, 0, 2, 3), g = pick(msgs, 0, 2, 22);
  if (!u || !v) throw new Error('wind fields missing');
  const grid = u.grid, n = grid.ni * grid.nj;
  const speed = new Float32Array(n), dir = new Float32Array(n), uu = new Float32Array(n), vv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = u.values[i], b = v.values[i];
    speed[i] = Math.hypot(a, b) * MS_MPH;
    uu[i] = a * MS_MPH; vv[i] = b * MS_MPH;                       // travel vector (toward)
    dir[i] = (Math.atan2(-a, -b) * 180 / Math.PI + 360) % 360;    // FROM direction
  }
  const fields = { speed, dir, u: uu, v: vv };
  if (g && g.grid.ni === grid.ni && g.grid.nj === grid.nj) fields.gust = g.values.map(x => x * MS_MPH);
  return {
    kind: 'wind', validTime: u.refTime + u.fh * 3600e3, runTime: u.refTime,
    source: { ...SOURCES.wind, run }, grid, fields, filled: new Uint8Array(n),
  };
}

export function sstFrame(json) {
  const { ni, nj, lat0, lon0, step, v, time } = json;
  const grid = { ni, nj, lat0, lon0, dlat: step, dlon: step };
  const temp = Float32Array.from(v, x => (x == null ? NaN : x * 9 / 5 + 32));
  const fields = { temp };
  const filled = fillCoast(grid, fields);
  const t = Date.parse(time);
  return { kind: 'sst', validTime: t, runTime: t, source: { ...SOURCES.sst, run: time.slice(0, 10) }, grid, fields, filled };
}

// ---------- loading with cache + prefetch ----------

export function createSources({ fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  const cache = new Map();   // key → Promise<frame>
  let runs = null, runsAt = 0;

  // If the run check fails later on, the last good answer is kept (marked stale) so the map
  // can keep showing that run, clearly labelled, instead of going blank.
  async function getRuns() {
    if (runs && now() - runsAt < 10 * 60e3) return runs;
    try {
      const r = await fetchImpl('/api/ocean?kind=runs');
      if (!r.ok) throw new Error('runs ' + r.status);
      runs = { ...(await r.json()), stale: false }; runsAt = now();
      return runs;
    } catch (e) {
      if (runs) return { ...runs, stale: true };
      throw e;
    }
  }

  function load(kind, run, fh) {
    const key = `${kind}|${run}|${fh}`;
    if (!cache.has(key)) {
      const p = (async () => {
        const r = await fetchImpl(kind === 'sst' ? '/api/ocean?kind=sst' : `/api/ocean?kind=${kind}&run=${run}&fh=${fh}`);
        if (!r.ok) throw new Error(`${kind} ${r.status}`);
        if (kind === 'sst') return sstFrame(await r.json());
        const buf = await r.arrayBuffer();
        return kind === 'wave' ? waveFrame(buf, run) : windFrame(buf, run);
      })();
      p.catch(() => cache.delete(key)); // a failed frame can be retried later
      cache.set(key, p);
      if (cache.size > 120) cache.delete(cache.keys().next().value); // keep memory bounded
    }
    return cache.get(key);
  }

  /** Current frame first; then the next 3 and the previous one, quietly. */
  function prefetch(kind, run, frames, idx, ahead = 3) {
    const want = [idx + 1, idx + 2, idx + 3, idx - 1].slice(0, ahead + 1).filter(i => i >= 0 && i < frames.length);
    for (const i of want) load(kind, run, frames[i].fh).catch(() => {});
  }

  return { getRuns, load, prefetch, has: (kind, run, fh) => cache.has(`${kind}|${run}|${fh}`), get size() { return cache.size; } };
}
