// GET /api/ocean?kind=runs | wave&run=YYYYMMDDHH&fh=N | wind&run=YYYYMMDDHH&fh=N | sst
//
// NOAA NOMADS and NOAA CoastWatch ERDDAP don't allow browser (CORS) access, so this function
// relays tiny, fixed subsets for the Delmarva ocean map — nothing else:
//   wave: NOAA GFS-Wave (WAVEWATCH III) Atlantic 0.167° grid — wave height, peak period, peak direction
//   wind: NOAA GFS 0.25° — 10 m U/V wind and surface gust
//   sst:  MUR SST (NASA JPL, served by NOAA CoastWatch ERDDAP) — latest daily analysis, 0.05°
// Only whitelisted variables, the fixed bounding box and valid run/hour values are accepted.
// GRIB2 bytes are passed through unchanged (the browser decodes them); responses for a given
// model run never change, so they're cached at the edge for a day.

const NOMADS = 'https://nomads.ncep.noaa.gov';
const BOX = { toplat: 41.4, leftlon: -77.4, rightlon: -71.4, bottomlat: 35.8 }; // Delmarva + offshore, with margin
const RUN_RE = /^\d{10}$/;
const CYCLES = ['18', '12', '06', '00'];
const LAST_FH = 168;

export function allowedHour(fh) {
  return Number.isInteger(fh) && fh >= 0 && (fh <= 120 || (fh <= LAST_FH && fh % 3 === 0));
}

const pad3 = n => String(n).padStart(3, '0');
const box = () => `subregion=&toplat=${BOX.toplat}&leftlon=${BOX.leftlon}&rightlon=${BOX.rightlon}&bottomlat=${BOX.bottomlat}`;

export function waveUrl(run, fh) {
  const d = run.slice(0, 8), c = run.slice(8, 10);
  return `${NOMADS}/cgi-bin/filter_gfswave.pl?dir=%2Fgfs.${d}%2F${c}%2Fwave%2Fgridded&file=gfswave.t${c}z.atlocn.0p16.f${pad3(fh)}.grib2`
    + `&var_HTSGW=on&var_PERPW=on&var_DIRPW=on&${box()}`;
}
export function windUrl(run, fh) {
  const d = run.slice(0, 8), c = run.slice(8, 10);
  return `${NOMADS}/cgi-bin/filter_gfs_0p25_1hr.pl?dir=%2Fgfs.${d}%2F${c}%2Fatmos&file=gfs.t${c}z.pgrb2.0p25.f${pad3(fh)}`
    + `&var_UGRD=on&var_VGRD=on&var_GUST=on&lev_10_m_above_ground=on&lev_surface=on&${box()}`;
}
export const SST_URL = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.csv?analysed_sst%5B(last)%5D%5B(35.8):5:(41.4)%5D%5B(-77.4):5:(-71.4)%5D';

/** The last file of each kind for a run: a run is used only once its whole 7-day range is posted. */
export function lastFileUrl(kind, run) {
  const d = run.slice(0, 8), c = run.slice(8, 10);
  return kind === 'wave'
    ? `${NOMADS}/pub/data/nccf/com/gfs/prod/gfs.${d}/${c}/wave/gridded/gfswave.t${c}z.atlocn.0p16.f${pad3(LAST_FH)}.grib2.idx`
    : `${NOMADS}/pub/data/nccf/com/gfs/prod/gfs.${d}/${c}/atmos/gfs.t${c}z.pgrb2.0p25.f${pad3(LAST_FH)}.idx`;
}

/** The NOMADS directory that holds a run's files. */
export function listingUrl(kind, run) {
  const d = run.slice(0, 8), c = run.slice(8, 10);
  return kind === 'wave'
    ? `${NOMADS}/pub/data/nccf/com/gfs/prod/gfs.${d}/${c}/wave/gridded/`
    : `${NOMADS}/pub/data/nccf/com/gfs/prod/gfs.${d}/${c}/atmos/`;
}

/** Forecast hours actually posted for a run (from its directory listing), limited to the hours the
 *  map uses. A file counts once its .idx is posted — NOMADS writes the index after the GRIB. */
export function parseListingHours(kind, run, html) {
  const c = run.slice(8, 10);
  const re = kind === 'wave'
    ? new RegExp(`gfswave\\.t${c}z\\.atlocn\\.0p16\\.f(\\d{3})\\.grib2\\.idx`, 'g')
    : new RegExp(`gfs\\.t${c}z\\.pgrb2\\.0p25\\.f(\\d{3})\\.idx`, 'g');
  const hours = new Set();
  for (const m of String(html).matchAll(re)) { const fh = +m[1]; if (allowedHour(fh)) hours.add(fh); }
  return [...hours].sort((a, b) => a - b);
}

/** Newest complete run, checking today and yesterday (UTC): { run, hours }.
 *  A run counts only once f168 is posted. `hours` are the real hours from the listing; if the
 *  listing can't be read the f168 HEAD check decides and `hours` is null (the client then uses
 *  the published schedule). */
export async function latestRun(kind, now = Date.now(), f = fetch) {
  for (let back = 0; back < 2; back++) {
    const day = new Date(now - back * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
    for (const c of CYCLES) {
      const run = day + c;
      if (Date.UTC(+run.slice(0, 4), +run.slice(4, 6) - 1, +run.slice(6, 8), +c) > now) continue;
      try {
        const r = await f(listingUrl(kind, run));
        if (r.ok) {
          const hours = parseListingHours(kind, run, await r.text());
          if (hours.includes(LAST_FH)) return { run, hours };
          continue; // run still posting
        }
        if (r.status === 404) continue; // run not started
      } catch { /* listing unreadable — fall back to the last-file check */ }
      try { const r = await f(lastFileUrl(kind, run), { method: 'HEAD' }); if (r.ok) return { run, hours: null }; } catch { /* next */ }
    }
  }
  return null;
}

/** ERDDAP CSV → compact grid JSON (°C, south→north rows, west→east columns, null = land). */
export function parseSstCsv(text) {
  const rows = text.split('\n').slice(2).filter(Boolean).map(l => l.split(','));
  if (!rows.length) throw new Error('empty SST');
  const lats = [...new Set(rows.map(r => +r[1]))].sort((a, b) => a - b);
  const lons = [...new Set(rows.map(r => +r[2]))].sort((a, b) => a - b);
  const ni = lons.length, nj = lats.length, v = new Array(ni * nj).fill(null);
  for (const r of rows) {
    const j = lats.indexOf(+r[1]), i = lons.indexOf(+r[2]), x = parseFloat(r[3]);
    if (j >= 0 && i >= 0 && Number.isFinite(x)) v[j * ni + i] = Math.round(x * 100) / 100;
  }
  return { time: rows[0][0], lat0: lats[0], lon0: lons[0], step: +(lats[1] - lats[0]).toFixed(4), ni, nj, v };
}

async function get(url, ms = 9000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'PirateView (skim conditions app)' } }); }
  finally { clearTimeout(timer); }
}

export default async function handler(req, res) {
  const q = req.query || {};
  const kind = String(q.kind || '');
  try {
    if (kind === 'runs') {
      const [wave, wind] = await Promise.all([latestRun('wave'), latestRun('wind')]);
      if (!wave && !wind) throw new Error('no runs');
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
      return res.status(200).json({
        wave: wave?.run ?? null, wind: wind?.run ?? null,
        hours: { wave: wave?.hours ?? null, wind: wind?.hours ?? null },
        checked: new Date().toISOString(),
      });
    }
    if (kind === 'wave' || kind === 'wind') {
      const run = String(q.run || ''), fh = Number(q.fh);
      if (!RUN_RE.test(run) || !allowedHour(fh)) return res.status(400).json({ error: 'bad run or hour' });
      const r = await get(kind === 'wave' ? waveUrl(run, fh) : windUrl(run, fh));
      if (!r.ok) throw new Error('NOMADS ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100 || buf.subarray(0, 4).toString() !== 'GRIB') throw new Error('not GRIB');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600, immutable');
      return res.status(200).send(buf);
    }
    if (kind === 'sst') {
      const r = await get(SST_URL, 12000);
      if (!r.ok) throw new Error('ERDDAP ' + r.status);
      const data = parseSstCsv(await r.text());
      res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json(data);
    }
    return res.status(400).json({ error: 'unknown kind' });
  } catch {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(502).json({ error: 'ocean data unavailable' });
  }
}
