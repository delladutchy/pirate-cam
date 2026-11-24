import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGrib2, pick } from '../js/ocean/grib2.js';
import { waveFrame, windFrame, sstFrame, frameList, forecastHours, nearestFrame, sampleField, sampleDir, fillCoast, runTime, createSources } from '../js/ocean/sources.js';
import { SCALES, colorAt, lut } from '../js/ocean/scales.js';
import { allowedHour, waveUrl, windUrl, parseSstCsv, latestRun, lastFileUrl, listingUrl, parseListingHours } from '../api/ocean.js';
import { freshness, delayedLabel, ageText, STALE_MS } from '../js/ocean/freshness.js';
import { chipLabel, clockET, tzName } from '../js/ocean/timeline.js';
import { readdirSync } from 'node:fs';

const fx = f => readFileSync(new URL(`./fixtures/ocean/${f}`, import.meta.url));
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const WAVE = fx('wave-2026112318-f006.grib2'), WIND = fx('wind-2026112318-f006.grib2');

// Reference values come from an independent decoder (pv-test/grib_py.py) of the same real NOAA
// files, and match the values decoded live from NOMADS in the browser for this run (38.5 N
// 74.83 W, valid 00Z Nov 24: 1.32 m, 8.98 s, from 124.9°; NDBC 44084 that evening: 3.9 ft, 11 s, 110°).
test('GRIB2: real NOAA GFS-Wave subset decodes exactly', () => {
  const m = parseGrib2(WAVE);
  assert.equal(m.length, 3);
  const hs = pick(m, 10, 0, 3), tp = pick(m, 10, 0, 11), dp = pick(m, 10, 0, 10);
  assert.ok(hs && tp && dp);
  assert.deepEqual([hs.grid.ni, hs.grid.nj], [36, 34]);
  assert.ok(near(hs.grid.lat0, 35.833333, 1e-6) && near(hs.grid.lon0, -77.333334, 1e-5) && near(hs.grid.dlat, 0.166667, 1e-6));
  assert.equal(new Date(hs.refTime).toISOString(), '2026-11-23T18:00:00.000Z'); assert.equal(hs.fh, 6);
  const at = (msg, j, i) => msg.values[j * msg.grid.ni + i];
  assert.ok(near(at(hs, 16, 15), 1.32, 1e-4) && near(at(tp, 16, 15), 8.98, 1e-4) && near(at(dp, 16, 15), 124.9, 1e-3));
  assert.ok(near(at(hs, 10, 26), 1.79, 1e-4) && near(at(dp, 25, 32), 144.61, 1e-3));
  assert.ok(Number.isNaN(at(hs, 20, 0)), 'land (bitmap off) stays NaN — not zero');
});

test('GRIB2: real NOAA GFS 10 m wind + gust decode exactly; other packings are refused', () => {
  const m = parseGrib2(WIND);
  const u = pick(m, 0, 2, 2), v = pick(m, 0, 2, 3), g = pick(m, 0, 2, 22);
  assert.deepEqual([u.grid.ni, u.grid.nj, u.grid.lat0, u.grid.lon0], [24, 22, 36, -77.25]);
  const at = (msg, j, i) => msg.values[j * msg.grid.ni + i];
  assert.ok(near(at(u, 10, 9), 1.8498046875, 1e-6) && near(at(v, 10, 9), -7.31657958984375, 1e-6) && near(at(g, 10, 9), 11.703683, 1e-5));
  const bad = new Uint8Array(WIND); bad[7] = 1; assert.throws(() => parseGrib2(bad), /edition 2/);
  assert.throws(() => parseGrib2(new Uint8Array(40)), /no GRIB2/);
});

test('frames: units, FROM directions and the travel vector', () => {
  const w = waveFrame(WAVE, '2026112318');
  const g = w.grid, c = 16 * g.ni + 15;
  assert.ok(near(w.fields.height[c], 1.32 * 3.28084, 1e-3), 'm → ft');
  assert.equal(w.validTime, Date.UTC(2026, 10, 24, 0));
  assert.equal(w.source.role, 'Regional wave model');
  const a = windFrame(WIND, '2026112318'), q = 10 * a.grid.ni + 9;
  const uu = 1.8498046875, vv = -7.31657958984375;
  assert.ok(near(a.fields.speed[q], Math.hypot(uu, vv) * 2.236936, 1e-3), 'm/s → mph');
  // u > 0 (toward east), v < 0 (toward south): the wind blows FROM the north-north-west
  assert.ok(near(a.fields.dir[q], (Math.atan2(-uu, -vv) * 180 / Math.PI + 360) % 360, 1e-3) && a.fields.dir[q] > 330);
  assert.ok(a.fields.u[q] > 0 && a.fields.v[q] < 0, 'travel vector points the way the air moves');
  assert.ok(near(a.fields.gust[q], 11.703683 * 2.236936, 1e-3));
});

test('coast fill: one cell only, marked, directions averaged as vectors', () => {
  const grid = { ni: 4, nj: 3, lat0: 0, lon0: 0, dlat: 1, dlon: 1 };
  const N = NaN;
  const h = Float32Array.from([N, N, 2, 4, N, N, 2, 4, N, N, N, N]);
  const d = Float32Array.from([N, N, 350, 10, N, N, 350, 10, N, N, N, N]);
  const filled = fillCoast(grid, { h, d }, ['d']);
  assert.ok(Number.isNaN(h[0]) && Number.isNaN(h[4]), 'two cells inland: not invented');
  assert.equal(filled[1], 1); assert.ok(near(h[1], 2), 'land cell next to the sea gets its sea neighbours');
  assert.ok(near(h[9], 2, 1e-5) && filled[9] === 1, 'row below: only its sea neighbour (2)');
  assert.ok(near(h[10], 3, 1e-5) && filled[10] === 1, 'mean of the sea neighbours (2, 4)');
  assert.ok(d[10] < 5 || d[10] > 355, `350° and 10° average to ~0°, not 180° (got ${d[10]})`);
});

test('sampling: bilinear inside, NaN outside or with no data', () => {
  const grid = { ni: 2, nj: 2, lat0: 0, lon0: 0, dlat: 1, dlon: 1 };
  const v = Float32Array.from([0, 10, 20, 30]);
  assert.ok(near(sampleField(grid, v, 0.5, 0.5), 15));
  assert.ok(near(sampleField(grid, v, 0, 1), 10));
  assert.ok(Number.isNaN(sampleField(grid, v, 2, 0)) && Number.isNaN(sampleField(grid, v, -0.1, 0)), 'no extrapolation outside the grid');
  const holes = Float32Array.from([NaN, NaN, NaN, 8]);
  assert.ok(near(sampleField(grid, holes, 0.9, 0.9), 8), 'only cells with data contribute');
  assert.ok(Number.isNaN(sampleField(grid, Float32Array.from([NaN, NaN, NaN, NaN]), 0.5, 0.5)));
  const dirs = Float32Array.from([350, 10, 350, 10]);
  const m = sampleDir(grid, dirs, 0.5, 0.5); assert.ok(m < 1 || m > 359, `direction across north: ${m}`);
});

test('timeline frames: real model steps only, starting at the hour on/before now', () => {
  const h = forecastHours();
  assert.equal(h.length, 137); assert.equal(h[120], 120); assert.equal(h[121], 123); assert.equal(h.at(-1), 168);
  const run = '2026112318', t0 = runTime(run);
  const f = frameList(run, t0 + 5.5 * 3600e3);
  assert.equal(f[0].fh, 5, 'first frame = last model hour not after now');
  assert.ok(f.every((x, i) => i === 0 || x.t > f[i - 1].t));
  assert.equal(frameList(run, t0 - 3600e3)[0].fh, 0, 'run newer than now: start at its first hour');
  assert.equal(nearestFrame(f, t0 + 9.4 * 3600e3), 4); // 9 h
  assert.equal(nearestFrame(f, t0 + 1e12), f.length - 1);
});

test('scales: continuous colours, clamped ends, every legend step inside the scale', () => {
  for (const [k, s] of Object.entries(SCALES)) {
    const lo = s.stops[0][0], hi = s.stops.at(-1)[0];
    assert.deepEqual(colorAt(s, lo - 100), colorAt(s, lo), k); assert.deepEqual(colorAt(s, hi + 100), colorAt(s, hi), k);
    for (const v of s.legend) assert.ok(v >= lo && v <= hi, `${k} legend ${v}`);
    assert.equal(lut(s).t.length, 768);
  }
  const a = colorAt(SCALES.waves, 2), b = colorAt(SCALES.waves, 2.5), c = colorAt(SCALES.waves, 3);
  assert.ok(b.every((x, i) => x >= Math.min(a[i], c[i]) && x <= Math.max(a[i], c[i])), 'waves blend smoothly between stops');
});

test('sources: cache, one request per frame, failed frames can be retried', async () => {
  const calls = [];
  let fail = true;
  const fake = async url => {
    calls.push(url);
    if (url.includes('kind=runs')) return { ok: true, json: async () => ({ wave: '2026112318', wind: '2026112318' }) };
    if (url.includes('fh=7') && fail) return { ok: false, status: 502 };
    return { ok: true, arrayBuffer: async () => WAVE.buffer.slice(WAVE.byteOffset, WAVE.byteOffset + WAVE.byteLength) };
  };
  const src = createSources({ fetchImpl: fake });
  assert.equal((await src.getRuns()).wave, '2026112318'); await src.getRuns();
  assert.equal(calls.filter(u => u.includes('runs')).length, 1, 'run lookup cached');
  const a = await src.load('wave', '2026112318', 6), b = await src.load('wave', '2026112318', 6);
  assert.equal(a, b); assert.equal(calls.filter(u => u.includes('fh=6')).length, 1);
  await assert.rejects(src.load('wave', '2026112318', 7));
  fail = false; await src.load('wave', '2026112318', 7);
  assert.equal(calls.filter(u => u.includes('fh=7')).length, 2, 'a missing frame is fetched again later');
});

test('/api/ocean: only whitelisted runs, hours, variables and the fixed box', () => {
  assert.ok(allowedHour(0) && allowedHour(120) && allowedHour(123) && allowedHour(168));
  assert.ok(!allowedHour(121) && !allowedHour(169) && !allowedHour(-1) && !allowedHour(1.5) && !allowedHour(NaN));
  const w = waveUrl('2026112318', 7);
  assert.match(w, /^https:\/\/nomads\.ncep\.noaa\.gov\/cgi-bin\/filter_gfswave\.pl\?dir=%2Fgfs\.20261123%2F18%2Fwave%2Fgridded&file=gfswave\.t18z\.atlocn\.0p16\.f007\.grib2/);
  assert.match(w, /var_HTSGW=on&var_PERPW=on&var_DIRPW=on&subregion=&toplat=41\.4&leftlon=-77\.4&rightlon=-71\.4&bottomlat=35\.8$/);
  assert.match(windUrl('2026112400', 120), /filter_gfs_0p25_1hr\.pl\?dir=%2Fgfs\.20261124%2F00%2Fatmos&file=gfs\.t00z\.pgrb2\.0p25\.f120&var_UGRD=on&var_VGRD=on&var_GUST=on&lev_10_m_above_ground=on&lev_surface=on/);
  assert.match(lastFileUrl('wave', '2026112318'), /gfswave\.t18z\.atlocn\.0p16\.f168\.grib2\.idx$/);
});

test('/api/ocean: latest complete run, newest first, never in the future', async () => {
  const now = Date.UTC(2026, 10, 24, 2, 30);
  const have = new Set(['2026112318', '2026112312']);
  const seen = [];
  const f = async url => { const run = url.match(/gfs\.(\d{8})\/(\d\d)/); const r = run[1] + run[2]; seen.push(r); return { ok: have.has(r) }; };
  // listing unreadable (500) → the f168 HEAD check decides, hours unknown
  const f500 = async (url, o) => { const r = await f(url, o); return o?.method === 'HEAD' ? r : { ok: false, status: 500 }; };
  assert.deepEqual(await latestRun('wave', now, f500), { run: '2026112318', hours: null });
  assert.ok(!seen.includes('2026112406'), 'a cycle later than now is not even asked for');
  assert.equal(await latestRun('wave', now, async () => ({ ok: false, status: 500 })), null);
});

test('/api/ocean: runs come from the NOMADS listing — only hours really posted, f168 required', async () => {
  const now = Date.UTC(2026, 10, 24, 3, 30);
  const names = (c, hs) => hs.map(h => `<a href="gfswave.t${c}z.atlocn.0p16.f${String(h).padStart(3, '0')}.grib2.idx">x</a>`).join('\n');
  const full = [...Array(121).keys(), ...Array.from({ length: 16 }, (_, k) => 123 + 3 * k), 171, 174]; // 171+ are past the map's range
  const listings = {
    [listingUrl('wave', '2026112400')]: { ok: true, status: 200, text: async () => names('00', [0, 1, 2, 3]) }, // still posting
    [listingUrl('wave', '2026112318')]: { ok: true, status: 200, text: async () => names('18', full.filter(h => h !== 57)) }, // one hour missing
  };
  const f = async url => listings[url] || { ok: false, status: 404 };
  const r = await latestRun('wave', now, f);
  assert.equal(r.run, '2026112318', 'the partial 00Z run is skipped');
  assert.equal(r.hours.length, 136);
  assert.ok(!r.hours.includes(57) && !r.hours.includes(171) && r.hours.at(-1) === 168);
  assert.deepEqual(parseListingHours('wind', '2026112318', 'gfs.t18z.pgrb2.0p25.f005.idx gfs.t18z.pgrb2.0p25.f006 gfs.t18z.pgrb2b.0p25.f007.idx gfs.t12z.pgrb2.0p25.f008.idx gfs.t18z.pgrb2.0p25.f121.idx gfs.t18z.pgrb2.0p25.f123.idx'), [5, 123],
    'only this cycle\'s posted pgrb2 0.25° indexes at map hours');
  assert.match(listingUrl('wind', '2026112318'), /gfs\.20261123\/18\/atmos\/$/);
});

test('frames: only the hours NOMADS lists, never invented ones; schedule when the listing is unknown', () => {
  const run = '2026112318', t0 = runTime(run);
  const hours = forecastHours().filter(h => h !== 7 && h !== 126);
  const f = frameList(run, t0 + 5.5 * 3600e3, hours);
  assert.equal(f[0].fh, 5);
  assert.ok(!f.some(x => x.fh === 7 || x.fh === 126));
  assert.deepEqual(f.slice(0, 3).map(x => x.fh), [5, 6, 8]);
  assert.equal(frameList(run, t0, null).length, forecastHours().length);
  assert.equal(forecastHours().length, 137);
});

test('sources: a failed run check keeps the last good runs, marked stale', async () => {
  let t = 0, up = true;
  const src = createSources({ now: () => t, fetchImpl: async () => (up ? { ok: true, json: async () => ({ wave: '2026112318', wind: '2026112318' }) } : { ok: false, status: 502 }) });
  assert.equal((await src.getRuns()).stale, false);
  up = false; t = 11 * 60e3;
  const r = await src.getRuns();
  assert.equal(r.wave, '2026112318'); assert.equal(r.stale, true);
  const fresh = createSources({ fetchImpl: async () => ({ ok: false, status: 502 }) });
  await assert.rejects(fresh.getRuns(), 'nothing cached → unavailable');
});

test('freshness: thresholds and labels', () => {
  const now = Date.UTC(2026, 10, 24, 3, 40);
  assert.deepEqual(STALE_MS, { radar: 20 * 60e3, model: 13 * 3600e3, sst: 72 * 3600e3, buoy: 2 * 3600e3 });
  assert.equal(freshness('radar', now - 8 * 60e3, now).delayed, false);
  assert.equal(freshness('radar', now - 21 * 60e3, now).delayed, true);
  assert.equal(freshness('model', Date.UTC(2026, 10, 23, 18), now).delayed, false, '18Z run at 03:40Z is 9.7 h old');
  assert.equal(freshness('model', Date.UTC(2026, 10, 23, 12), now).delayed, true);
  const sst = freshness('sst', '2026-11-22T09:00:00Z', now);
  assert.equal(sst.age, '43h'); assert.equal(sst.delayed, false);
  assert.equal(freshness('sst', '2026-11-20T09:00:00Z', now).delayed, true);
  assert.equal(freshness('buoy', now - 150 * 60e3, now).delayed, true);
  assert.equal(delayedLabel(3 * 3600e3), 'DATA DELAYED · LAST UPDATED 3H AGO');
  assert.equal(ageText(45 * 60e3), '45 min'); assert.equal(ageText(5 * 86400e3), '5d');
  assert.equal(freshness('radar', 'nope', now).delayed, false);
});

test('time labels: Delaware local time with the right zone across DST', () => {
  // 2026 DST ends Sun Nov 1 06:00 UTC (2 AM EDT → 1 AM EST); begins Sun Mar 8 07:00 UTC
  assert.equal(chipLabel(Date.UTC(2026, 10, 24, 20)), 'Tue Nov 24, 3 PM EST');
  assert.equal(chipLabel(Date.UTC(2026, 6, 4, 16)), 'Sat Jul 4, 12 PM EDT');
  assert.equal(clockET(Date.UTC(2026, 10, 1, 5, 30)), '1:30 AM EDT');
  assert.equal(clockET(Date.UTC(2026, 10, 1, 6, 30)), '1:30 AM EST');
  assert.equal(tzName(Date.UTC(2026, 2, 8, 6, 59)), 'EST'); assert.equal(tzName(Date.UTC(2026, 2, 8, 7)), 'EDT');
  // a 00Z run valid time lands on the previous local evening
  assert.equal(chipLabel(runTime('2026112400')), 'Mon Nov 23, 7 PM EST');
});

test('isolation: no scoring / data module imports the ocean map', () => {
  const dirs = ['js/engine', 'js/data', 'js/score', 'api'].map(d => new URL(`../${d}/`, import.meta.url));
  for (const d of dirs) {
    let files; try { files = readdirSync(d); } catch { continue; }
    for (const f of files.filter(x => x.endsWith('.js'))) {
      const src = readFileSync(new URL(f, d), 'utf8');
      assert.ok(!/from\s+['"][^'"]*\/ocean\//.test(src) || f === 'ocean.js', `${d.pathname}${f} imports js/ocean`);
    }
  }
});

test('/api/ocean: ERDDAP SST CSV → compact grid (°C, south→north, land = null)', () => {
  const g = parseSstCsv(fx('sst-mur-sample.csv').toString());
  assert.deepEqual([g.ni, g.nj, g.lat0, g.lon0, g.step], [4, 3, 38.8, -74.9, 0.05]);
  assert.equal(g.time, '2026-11-22T09:00:00Z');
  assert.equal(g.v[0], 14.82);
  const f = sstFrame(g);
  assert.ok(near(f.fields.temp[0], 14.82 * 9 / 5 + 32, 1e-3), '°C → °F');
  assert.equal(f.source.run, '2026-11-22');
});
