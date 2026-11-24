// NOAA NWPS nearshore wave forecast: server extraction, run selection, caching, browser wrapper,
// explicit fallback, horizon, and how it feeds Pirate Score.
import test from 'node:test'; import assert from 'node:assert/strict';
import { grib2Message, concat } from './helpers/grib2enc.mjs';
import { sampleGrib2, cellOf, normalizeRun, findRuns, runUrl, parseCycles, validRun, runTime, M_TO_FT, STALE_RUN_H } from '../api/nwps.js';
import { wrapRun, nwpsForecast } from '../js/data/nwps.js';
import { scoreSample } from '../js/engine/score.js';
import { buildConditions } from '../js/engine/conditions.js';
import { weekOutlook, spotDayBest } from '../js/engine/week.js';
import { recommendFor } from '../js/engine/recommend.js';
import { forecastDays } from '../js/engine/days.js';
import { spots, spotById } from '../js/config/spots.js';

const H = 3600e3;
// the real PHI CG2 grid definition (read from the 2026112406 file)
const CG2 = { ni: 92, nj: 151, lat0: 38.5, lon0: -75.7, dlat: 0.009001, dlon: 0.011539 };
const REF = Date.UTC(2026, 10, 24, 6);

// a small synthetic grid for decoding tests: 6 x 5, row-major south→north
const G = { ni: 6, nj: 5, lat0: 38.5, lon0: -75.1, dlat: 0.01, dlon: 0.01 };
const field = fn => { const v = []; for (let j = 0; j < G.nj; j++) for (let i = 0; i < G.ni; i++) v.push(fn(i, j)); return v; };
const land = (i, j) => i < 2; // two western columns are land (masked)
const hsF = (i, j, fh) => (land(i, j) ? NaN : 0.5 + i * 0.25 + j * 0.01 + fh * 0.1);
const tpF = (i, j, fh) => (land(i, j) ? NaN : 8 + fh * 0.5);
const dpF = (i, j, fh) => (land(i, j) ? NaN : (350 + fh * 10) % 360);
function file({ hours = [0, 1, 2], scan = 0x40, extra = true, ref = REF, template5 = 0 } = {}) {
  const parts = [];
  const order = v => (scan & 0x40 ? v : (() => { const o = []; for (let j = G.nj - 1; j >= 0; j--) o.push(...v.slice(j * G.ni, (j + 1) * G.ni)); return o; })());
  for (const [num, f, D] of [[3, hsF, 2], [10, dpF, 0], [11, tpF, 1]]) for (const fh of hours) parts.push(grib2Message({ num, fh, ref, grid: G, values: order(field((i, j) => f(i, j, fh))), D, scan, template5 }));
  if (extra) { // other NWPS variables the sampler must skip: swell height, currents, wind (discipline 0)
    parts.push(grib2Message({ num: 8, fh: 0, ref, grid: G, values: field(() => 9.99) }));
    parts.push(grib2Message({ cat: 1, num: 1, fh: 0, ref, grid: G, values: field(() => 1) }));
    parts.push(grib2Message({ discipline: 0, cat: 2, num: 1, fh: 0, ref, grid: G, values: field(() => 7) }));
  }
  return concat(parts);
}
const PTS = [{ id: 'a', lat: 38.52, lon: -75.07 }, { id: 'b', lat: 38.54, lon: -75.05 }, { id: 'dry', lat: 38.51, lon: -75.09 }];

// ---------- decoding ----------
test('NWPS decode: height, period, direction read exactly at the points, straight from the packed bits', () => {
  const s = sampleGrib2(file(), PTS);
  assert.equal(s.refTime, REF); assert.equal(s.maxFh, 2);
  assert.deepEqual([s.cells.a.i, s.cells.a.j], [3, 2]);
  for (const fh of [0, 1, 2]) {
    assert.ok(Math.abs(s.values.a.hs[fh] - hsF(3, 2, fh)) < 0.006, `hs fh${fh}`);
    assert.ok(Math.abs(s.values.b.hs[fh] - hsF(5, 4, fh)) < 0.006);
    assert.ok(Math.abs(s.values.a.tp[fh] - tpF(3, 2, fh)) < 0.06);
    assert.equal(Math.round(s.values.a.dp[fh]), dpF(3, 2, fh), 'direction (deg, from) unchanged');
  }
  assert.ok(s.values.dry.hs.every(v => Number.isNaN(v)), 'a masked (land) cell is NaN, never 0');
  const north = sampleGrib2(file({ scan: 0 }), PTS);
  assert.deepEqual(north.values.a.hs, s.values.a.hs, 'north→south row order gives the same values');
});

test('NWPS decode: refuses what it cannot read exactly', () => {
  assert.throws(() => sampleGrib2(file({ template5: 3 }), PTS), /packing/);
  const f = file(); assert.throws(() => sampleGrib2(f.subarray(0, f.length - 50), PTS), /truncated/);
  const mixed = concat([grib2Message({ num: 3, fh: 0, ref: REF, grid: G, values: field(() => 1) }), grib2Message({ num: 3, fh: 1, ref: REF + H, grid: G, values: field(() => 1) })]);
  assert.throws(() => sampleGrib2(mixed, PTS), /changes/);
  assert.throws(() => sampleGrib2(grib2Message({ discipline: 0, cat: 2, num: 1, grid: G, values: field(() => 1) }), PTS), /no NWPS wave/);
});

test('normalize: metres/seconds/degrees, an hour is served only when height, period AND direction exist', () => {
  const s = sampleGrib2(file(), PTS);
  s.values.b.tp[1] = NaN; // period missing for one hour
  const j = normalizeRun('2026112406', s, PTS);
  assert.equal(j.units.hs, 'm'); assert.equal(j.maxFh, 2); assert.equal(j.runTime, '2026-11-24T06:00:00.000Z');
  assert.deepEqual(j.points.b.hs.map(x => x === null), [false, true, false]);
  assert.equal(j.points.b.hours, 2);
  assert.equal(j.points.dry.hours, 0);
  assert.ok(JSON.stringify(j).length < 4000);
});

// ---------- spot sampling points on the real PHI CG2 grid ----------
test('each rated spot reads a fixed cell ~1 km straight offshore — not the nearest wet cell (bay / inlet)', () => {
  const want = { // grid cell centre chosen for each spot (verified wet ocean cells in run 2026112406)
    dewey: [55, 21], bethany: [57, 4], southside: [56, 11], northside: [56, 13], conquest: [56, 16],
  };
  for (const s of spots.slice(0, 5)) {
    const c = cellOf(CG2, s.sources.nwps.lat, s.sources.nwps.lon);
    assert.deepEqual([c.i, c.j], want[s.id], s.id);
    const km = Math.hypot((c.lat - s.lat) * 111, (c.lon - s.lon) * 111 * Math.cos(s.lat * Math.PI / 180));
    assert.ok(c.lon > s.lon && km > 0.6 && km < 1.7, `${s.id}: cell ${km.toFixed(2)} km east of the beach point`);
  }
  // Southside and Northside are different cells (the old NWS grid gave both the same inlet cell)
  const ss = cellOf(CG2, spotById('southside').sources.nwps.lat, spotById('southside').sources.nwps.lon);
  const ns = cellOf(CG2, spotById('northside').sources.nwps.lat, spotById('northside').sources.nwps.lon);
  assert.notDeepEqual([ss.i, ss.j], [ns.i, ns.j]);
  // Ocean City is south of the CG2 grid → no NWPS point (keeps the NWS grid, unrated)
  assert.equal(cellOf(CG2, 38.3441, -75.07), null);
});

// ---------- run selection ----------
const listing = cycles => cycles.map(c => `<a href="${c}/">${c}/</a>`).join('\n');
function fakeFetch({ days = {}, files = {} }) {
  const calls = [];
  const f = async (url, opt = {}) => {
    calls.push((opt.method || 'GET') + ' ' + url);
    const day = /er\.(\d{8})\/phi\/$/.exec(url);
    if (day) return days[day[1]] ? { ok: true, text: async () => listing(days[day[1]]) } : { ok: false, status: 404 };
    const run = Object.keys(files).find(r => url === runUrl(r));
    if (run) return { ok: true, headers: { get: k => (k === 'content-length' ? String(files[run]) : null) } };
    return { ok: false, status: 404, headers: { get: () => null } };
  };
  return { f, calls };
}

test('run selection: newest complete run + previous; skips unposted/partial files and future cycles', async () => {
  const now = Date.UTC(2026, 10, 24, 14, 0);
  const { f } = fakeFetch({ days: { 20261124: ['00', '06', '12'], 20261123: ['00', '06', '12', '18'] },
    files: { 2026112406: 19e6, 2026112400: 19e6, 2026112318: 19e6, 2026112412: 2e6 } });
  assert.deepEqual(await findRuns(now, f), { latest: '2026112406', previous: '2026112400' }, '12Z: still posting (2 MB)');
  const early = await findRuns(Date.UTC(2026, 10, 24, 3), fakeFetch({ days: { 20261124: [], 20261123: ['12', '18'] }, files: { 2026112318: 19e6, 2026112312: 19e6 } }).f);
  assert.deepEqual(early, { latest: '2026112318', previous: '2026112312' }, 'just after midnight: yesterday\'s runs');
  assert.deepEqual(await findRuns(now, fakeFetch({}).f), { latest: null, previous: null }, 'NOMADS down → nothing');
  assert.deepEqual(parseCycles('<a href="06/">06/</a><a href="99/">x</a><a href="06/">'), ['06']);
  assert.ok(validRun('2026112406') && !validRun('2026112405') && !validRun('../etc'));
  assert.match(runUrl('2026112406'), /\/er\.20261124\/phi\/06\/CG2\/nwps\.t06z\.cg2\.phi\.grib2$/);
});

// ---------- the API handler: caching + failures ----------
test('API: run list cached 10 min; run data immutable for a week; failures 502 for 60 s; one decode per run', async () => {
  const { default: handler, POINTS } = await import('../api/nwps.js');
  assert.deepEqual(POINTS.map(p => p.id), ['dewey', 'bethany', 'southside', 'northside', 'conquest']);
  const res = () => { const r = { h: {}, code: 0, body: null }; r.setHeader = (k, v) => { r.h[k] = v; }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
  const real = globalThis.fetch;
  const run = new Date(Date.now() - 6 * H); run.setUTCMinutes(0, 0, 0); run.setUTCHours(Math.floor(run.getUTCHours() / 6) * 6);
  const id = run.toISOString().slice(0, 13).replace(/[-T]/g, '');
  // a fake CG2 file on the real grid: 3 hours, every value finite (no land)
  const cg2 = concat([3, 10, 11].flatMap(num => [0, 1, 2].map(fh => grib2Message({ num, fh, ref: run.getTime(), grid: CG2, values: new Array(CG2.ni * CG2.nj).fill(num === 3 ? 1.2 : num === 10 ? 100 : 9), D: num === 3 ? 2 : 0 }))));
  const pad = concat([cg2, new Uint8Array(6e6)]); // trailing bytes after the last message are ignored; > MIN_FILE_BYTES
  let downloads = 0;
  globalThis.fetch = async url => {
    if (url === runUrl(id)) { downloads++; await new Promise(r => setTimeout(r, 20)); return { ok: true, headers: { get: k => (k === 'content-length' ? String(pad.length) : null) }, arrayBuffer: async () => pad.buffer }; }
    return { ok: false, status: 404, headers: { get: () => null } };
  };
  try {
    const [a, b] = [res(), res()];
    await Promise.all([handler({ query: { run: id } }, a), handler({ query: { run: id } }, b)]);
    assert.equal(a.code, 200); assert.equal(downloads, 1, 'simultaneous requests share one download + decode');
    assert.match(a.h['Cache-Control'], /s-maxage=604800, immutable/);
    assert.equal(a.body.run, id); assert.equal(a.body.points.dewey.hs[0], 1.2); assert.equal(a.body.points.dewey.dp[0], 100);
    assert.equal(a.body.points.dewey.cell.i, 55);
    const bad = res(); await handler({ query: { run: '2020010100' } }, bad); assert.equal(bad.code, 400, 'old runs are not served');
    const evil = res(); await handler({ query: { run: 'x/../y' } }, evil); assert.equal(evil.code, 400);
    globalThis.fetch = async () => { throw new Error('down'); };
    const down = res(); await handler({ query: {} }, down);
    assert.equal(down.code, 502); assert.equal(down.h['Cache-Control'], 'public, s-maxage=60');
  } finally { globalThis.fetch = real; }
});

// ---------- browser wrapper: interpolation, horizon, staleness, fallback ----------
const RUN_JSON = (over = {}) => ({
  run: '2026112406', runTime: '2026-11-24T06:00:00.000Z', office: 'PHI', grid: 'CG2', maxFh: 3,
  points: { dewey: { hs: [1, 2, null, 1], tp: [8, 10, null, 9], dp: [350, 10, null, 90] } }, ...over,
});
test('wrapper: real hourly values, linear between hours, shortest-arc direction, never past the run', () => {
  const w = wrapRun(RUN_JSON(), { now: Date.UTC(2026, 10, 24, 12) });
  const at = iso => w.at('dewey', new Date(iso));
  const h0 = at('2026-11-24T06:00Z');
  assert.ok(Math.abs(h0.ft - M_TO_FT) < 1e-9, 'metres → feet'); assert.equal(h0.periodS, 8); assert.equal(h0.fromDeg, 350);
  assert.equal(h0.source, 'model'); assert.equal(h0.model, 'NWPS'); assert.equal(h0.run, '2026112406');
  const mid = at('2026-11-24T06:30Z');
  assert.ok(Math.abs(mid.ft - 1.5 * M_TO_FT) < 1e-9); assert.equal(mid.periodS, 9); assert.equal(mid.fromDeg, 0, '350° → 10° passes through north');
  assert.equal(at('2026-11-24T07:30Z'), null, 'next to a missing hour: nothing, not interpolated across');
  assert.equal(at('2026-11-24T08:00Z'), null);
  assert.ok(at('2026-11-24T09:00Z'), 'last hour exists');
  assert.equal(at('2026-11-24T09:15Z'), null, 'past the last forecast hour: nothing (no extension)');
  assert.equal(at('2026-11-24T05:00Z'), null, 'before the run: nothing');
  assert.equal(w.at('bethany', new Date('2026-11-24T06:00Z')), null, 'a spot not in the run');
  assert.equal(w.stale, false);
  assert.equal(wrapRun(RUN_JSON(), { now: Date.UTC(2026, 10, 24, 6) + (STALE_RUN_H + 1) * H }).stale, true, 'a late run is labelled stale');
});

test('fallback policy: latest run → previous run (labelled) → nothing; no other source', async () => {
  const calls = [];
  const get = (runs, failing = []) => async url => { calls.push(url); if (url === '/api/nwps') return runs; const r = url.split('=')[1]; if (failing.includes(r)) throw new Error('502'); return RUN_JSON({ run: r }); };
  const a = await nwpsForecast({ get: get({ latest: '2026112406', previous: '2026112400' }) });
  assert.equal(a.run, '2026112406'); assert.equal(a.fallback, null);
  const b = await nwpsForecast({ get: get({ latest: '2026112406', previous: '2026112400' }, ['2026112406']) });
  assert.equal(b.run, '2026112400'); assert.equal(b.fallback, 'previous-run');
  await assert.rejects(nwpsForecast({ get: get({ latest: '2026112406', previous: '2026112400' }, ['2026112406', '2026112400']) }));
  await assert.rejects(nwpsForecast({ get: get({ latest: null, previous: null }) }));
});

// ---------- Pirate Score with the nearshore model ----------
const dewey = spotById('dewey');
const ideal = { tide: { phase: 0.5, rising: true, rateFtHr: 0.5 }, wind: { mph: 4, fromDeg: 280, gustMph: 6 }, waves: { ft: 2.5, periodS: 8, fromDeg: 100, source: 'model' }, pop: 0, thunder: 0, daylight: true };

test('period and direction now apply to forecast (model) waves, not just the buoy', () => {
  const base = scoreSample(dewey.profile, ideal);
  const chop = scoreSample(dewey.profile, { ...ideal, waves: { ...ideal.waves, periodS: 3.5 } });
  const angle = scoreSample(dewey.profile, { ...ideal, waves: { ...ideal.waves, fromDeg: 10 } });
  assert.ok(chop.score < base.score && chop.reasons.some(r => r.text === 'Short, choppy waves'));
  assert.ok(angle.score < base.score && angle.reasons.some(r => r.text === 'Waves arriving at a sharp angle'));
});

test('missing waves cannot inflate a score: no score at all, instead of tide & wind at 50/50', () => {
  const full = scoreSample(dewey.profile, { ...ideal, waves: { ft: 0.9, periodS: 8, fromDeg: 100 } });
  const none = scoreSample(dewey.profile, { ...ideal, waves: null });
  assert.ok(full.score != null);
  assert.equal(none.score, null); assert.deepEqual(none.missing, ['waves']);
  const rec = recommendFor({ score: { reason: null }, now: new Date(), window: null }, { ...none, skimmable: true }, new Date(), null);
  assert.equal(rec.head, 'No wave forecast');
});

test('explanations: a "+" detail of a weak factor is not shown (e.g. "Incoming tide" with the tide far too high)', () => {
  const high = scoreSample(dewey.profile, { ...ideal, tide: { phase: 1, rising: true, rateFtHr: 0.1 } });
  const tide = high.factors.find(f => f.key === 'tide');
  assert.equal(tide.q, 0);
  assert.ok(!high.reasons.some(r => r.sign === '+' && /tide/i.test(r.text)), JSON.stringify(high.reasons));
  assert.ok(high.reasons.some(r => r.sign === '-' && /Tide too high/.test(r.text)));
  const good = scoreSample(dewey.profile, ideal);
  assert.ok(good.reasons.some(r => r.text === 'Incoming tide'), 'a strong tide still lists its plus');
});

// ---------- conditions: the same model now and later; buoy stays an observation ----------
function cond(spotId, { nwps, buoy = null, now = new Date('2026-11-24T15:07Z') } = {}) {
  const spot = spotById(spotId);
  const ev = []; let t = Date.parse('2026-11-22T03:00Z'), hi = true;
  while (t < Date.parse('2026-12-03T00:00Z')) { ev.push({ t: new Date(t), v: hi ? 4.2 : 0.2, type: hi ? 'H' : 'L' }); t += 6.2 * H; hi = !hi; }
  const grid = { at: () => ({ windMph: 6, gustMph: 9, windFromDeg: 280, pop: 0, thunder: 0, tempF: 50, waveFt: 1 }) };
  return buildConditions(spot, { tideEvents: ev, grid, nwps, buoy, obsWind: null, status: {} }, now);
}
const hourly = (fn, maxFh = 144) => { const p = { hs: [], tp: [], dp: [] }; for (let h = 0; h <= maxFh; h++) { const [a, b, c] = fn(h); p.hs.push(a); p.tp.push(b); p.dp.push(c); } return p; };
const runJSON = (pts, maxFh = 144) => ({ run: '2026112406', runTime: '2026-11-24T06:00:00.000Z', office: 'PHI', grid: 'CG2', maxFh, points: pts });

test('now uses the same nearshore model as the forecast (no jump); the buoy stays a labelled observation', () => {
  const p = hourly(h => [1 + 0.02 * h, 9, 100]);
  const nwps = wrapRun(runJSON({ dewey: p }), { now: Date.parse('2026-11-24T15:07Z') });
  const buoy = { waveHeightFt: 6.5, dominantPeriodS: 11, waveFromDeg: 90, observedAt: new Date('2026-11-24T14:56Z') };
  const c = cond('dewey', { nwps, buoy });
  const [n0, n1] = c.timeline;
  assert.equal(n0.waves.source, 'model'); assert.equal(n1.waves.source, 'model');
  assert.ok(Math.abs(n1.waves.ft - n0.waves.ft) < 0.05, 'continuous from now into the forecast');
  assert.equal(c.current.waves.source, 'obs'); assert.equal(c.current.waves.ft, 6.5, 'observed buoy kept for display');
  assert.equal(c.current.waveModel.source, 'model');
  assert.ok(c.timeline.filter(s => s.waves).every(s => s.waves.source === 'model'), 'no NWS waves for an NWPS spot');
});

test('horizon: no Pirate Scores past the model\'s last hour — no invented seventh day', () => {
  const p = hourly(() => [0.6, 9, 100]);
  const nwps = wrapRun(runJSON({ dewey: p }), { now: Date.parse('2026-11-24T15:07Z') });
  const c = cond('dewey', { nwps });
  const end = Date.parse('2026-11-30T06:00Z');
  assert.ok(c.timeline.some(s => s.t.getTime() <= end && s.score != null));
  const after = c.timeline.filter(s => s.t.getTime() > end);
  assert.ok(after.length > 20 && after.every(s => s.score == null && s.waves == null && s.missing.includes('waves')));
  const days = forecastDays(c.timeline, c.now);
  assert.equal(spotDayBest(c, days.at(-1)), null, 'the last day (beyond NWPS) has no day best');
});

test('no model at all (NOAA down): rated spots show waves "not available" and no scores; nothing else steps in', () => {
  const c = cond('dewey', { nwps: null });
  assert.ok(c.timeline.every(s => s.waves == null && s.score == null));
  assert.equal(c.current.waveModel, null);
  assert.equal(c.window.state, 'unknown');
  assert.equal(weekOutlook({ dewey: c }, spots).top, null);
});

test('spot-specific nearshore differences reach the score (Southside sheltered vs Northside)', () => {
  const p = (hs, tp, dp) => hourly(() => [hs, tp, dp]);
  const nwps = wrapRun(runJSON({ southside: p(0.9, 9, 100), northside: p(2.4, 9, 100) }), { now: Date.parse('2026-11-24T15:07Z') });
  const s = cond('southside', { nwps }), n = cond('northside', { nwps });
  const at = (c, iso) => c.timeline.find(x => x.t.toISOString() === iso);
  const ss = at(s, '2026-11-25T16:00:00.000Z'), ns = at(n, '2026-11-25T16:00:00.000Z');
  assert.ok(Math.abs(ss.waves.ft - 0.9 * M_TO_FT) < 0.01 && Math.abs(ns.waves.ft - 2.4 * M_TO_FT) < 0.01);
  assert.notEqual(ss.factors.find(f => f.key === 'waves').q, ns.factors.find(f => f.key === 'waves').q);
});

test('validation foundation: each scored sample carries its inputs, factors and model run', () => {
  const nwps = wrapRun(runJSON({ bethany: hourly(() => [0.8, 9, 100]) }), { now: Date.parse('2026-11-24T15:07Z') });
  const c = cond('bethany', { nwps });
  const s = c.timeline.find(x => x.score != null);
  assert.ok(s.tide && s.wind && s.waves.run === '2026112406' && s.factors.length === 3 && s.factors.every(f => Number.isFinite(f.q)));
});

test('runTime helper', () => { assert.equal(runTime('2026112418'), Date.UTC(2026, 10, 24, 18)); });

test('validation record: spot, time, model run, waves, tide, wind, score, factors, human rating', async () => {
  const { validationRecord, RATINGS } = await import('../js/engine/validation.js');
  const nwps = wrapRun(runJSON({ bethany: hourly(() => [0.8, 9, 100]) }), { now: Date.parse('2026-11-24T15:07Z') });
  const c = cond('bethany', { nwps });
  const s = c.timeline.find(x => x.score != null);
  const rec = validationRecord(c, s, 'GOOD');
  assert.equal(rec.spot, 'bethany'); assert.equal(rec.waves.run, '2026112406'); assert.equal(rec.waves.source, 'model');
  assert.ok(Number.isFinite(rec.factors.tide) && Number.isFinite(rec.factors.wind) && Number.isFinite(rec.factors.waves));
  assert.equal(rec.score, s.score); assert.equal(rec.rating, 'GOOD');
  assert.deepEqual(RATINGS, ['FIRING', 'GOOD', 'MEH', 'BAD']);
  assert.throws(() => validationRecord(c, s, 'AMAZING'));
});

test('the API reads exactly the points configured for the spots', async () => {
  const { POINTS } = await import('../api/nwps.js');
  assert.deepEqual(POINTS, spots.filter(s => s.sources.nwps).map(s => ({ id: s.id, ...s.sources.nwps })));
});
