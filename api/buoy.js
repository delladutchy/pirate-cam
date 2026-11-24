// GET /api/buoy?station=44084
// NDBC realtime text files don't allow browser (CORS) access, so this function
// fetches, parses and returns the latest usable observation as small JSON.
// Cached at Vercel's edge for 10 minutes (NDBC updates every 30 min).

const ALLOWED = new Set(['44084', '44009', '44091', '44099']); // Pirate View spots' buoy + the ocean map's buoy overlay
const COLS = ['YY', 'MM', 'DD', 'hh', 'mm', 'WDIR', 'WSPD', 'GST', 'WVHT', 'DPD', 'APD', 'MWD', 'PRES', 'ATMP', 'WTMP'];

export function parseRealtime(text, now = Date.now()) {
  const lines = text.split('\n').filter(l => l && !l.startsWith('#'));
  const rows = lines.slice(0, 12).map(l => {
    const f = l.trim().split(/\s+/);
    const r = {}; COLS.forEach((c, i) => { r[c] = f[i]; });
    r.t = Date.UTC(+r.YY, +r.MM - 1, +r.DD, +r.hh, +r.mm);
    return r;
  }).filter(r => Number.isFinite(r.t) && now - r.t < 3 * 3600e3); // ignore anything older than 3 h

  // Latest non-missing value for each field (fields can be "MM" on a single report).
  const latest = key => {
    for (const r of rows) { const v = parseFloat(r[key]); if (r[key] !== 'MM' && Number.isFinite(v)) return { v, t: r.t }; }
    return null;
  };
  const wv = latest('WVHT'), dp = latest('DPD'), ap = latest('APD'), md = latest('MWD'), wt = latest('WTMP');
  return {
    observedAt: wv ? new Date(wv.t).toISOString() : null,
    waveHeightFt: wv ? +(wv.v * 3.28084).toFixed(1) : null,
    dominantPeriodS: dp ? dp.v : null,
    averagePeriodS: ap ? ap.v : null,
    waveFromDeg: md ? md.v : null,
    waterTempF: wt ? +(wt.v * 9 / 5 + 32).toFixed(0) : null,
    waterObservedAt: wt ? new Date(wt.t).toISOString() : null,
  };
}

export default async function handler(req, res) {
  const station = String((req.query && req.query.station) || '44084');
  if (!ALLOWED.has(station)) return res.status(400).json({ error: 'unknown station' });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/${station}.txt`, {
      signal: ctl.signal, headers: { 'User-Agent': 'PirateView (skim conditions app)' },
    });
    if (!r.ok) throw new Error(`NDBC ${r.status}`);
    const data = { station, ...parseRealtime(await r.text()) };
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
    return res.status(200).json(data);
  } catch {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(502).json({ error: 'buoy unavailable' });
  } finally {
    clearTimeout(timer);
  }
}
