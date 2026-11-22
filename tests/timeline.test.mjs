// Shared selected-time state + wind-direction maths + recommendation wording.
import test from 'node:test'; import assert from 'node:assert/strict';
import { resolveSelection, lerpAngle, windBetweenHours, confidenceOf, daySummary } from '../js/engine/timeline.js';
import { recommendFor } from '../js/engine/recommend.js';
import { toVector } from '../js/map/model.js';

const now = new Date('2026-11-22T15:07Z'), end = new Date('2026-11-29T05:00Z');
const H = 3600e3, near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

test('selection: one shared value — null means live now', () => {
  assert.equal(resolveSelection({ t: null, now, end }), null);
  assert.equal(resolveSelection({ t: new Date(+now + 5 * 60e3), now, end }), null, 'within 8 min snaps to now');
  assert.equal(resolveSelection({ t: new Date(+now + 3 * H), now, end }).getTime(), +now + 3 * H);
  assert.equal(resolveSelection({ t: new Date(+end + 9 * H), now, end }).getTime(), +end, 'clamped to data end');
  assert.equal(resolveSelection({ t: new Date(+now - 2 * H), now, end }), null, 'past → now');
  const a = resolveSelection({ step: H, current: null, now, end });
  assert.equal(a.getTime(), +now + H, 'keyboard step from now');
  assert.equal(resolveSelection({ step: -H, current: a, now, end }), null, 'stepping back to now');
});

test('wind direction interpolates the short way round (355° → 5° passes north)', () => {
  assert.ok(near(lerpAngle(355, 5, 0.5), 0));
  assert.ok(near(lerpAngle(355, 5, 0.25), 357.5));
  assert.ok(near(lerpAngle(10, 350, 0.5), 0));
  assert.ok(near(lerpAngle(90, 270, 0), 90) && near(lerpAngle(90, 270, 1), 270));
  assert.ok(near(lerpAngle(80, 100, 0.5), 90));
  // never through 180 for a 10° change across north
  for (let f = 0; f <= 1; f += 0.1) { const v = lerpAngle(355, 5, f); assert.ok(v >= 355 - 1e-9 || v <= 5 + 1e-9, `${v}`); }
});

test('wind between two real hourly values only — no extrapolation', () => {
  const h0 = new Date('2026-11-22T18:00Z');
  const table = { [+h0]: { windMph: 10, gustMph: 14, windFromDeg: 350 }, [+h0 + H]: { windMph: 6, gustMph: 8, windFromDeg: 20 } };
  const at = t => table[Math.floor(t / H) * H] || { windMph: null, gustMph: null, windFromDeg: null };
  const w = windBetweenHours(at, new Date(+h0 + 0.5 * H));
  assert.ok(near(w.mph, 8) && near(w.gustMph, 11) && near(w.fromDeg, 5));
  const last = windBetweenHours(at, new Date(+h0 + 1.5 * H)); // next hour missing → value in force, not invented
  assert.equal(last.mph, 6); assert.equal(last.fromDeg, 20);
});

test('arrow points where the wind travels TO (from + 180)', () => {
  const v = toVector(10, 0); assert.ok(near(v.u, 0, 1e-6) && v.v < 0); // N wind blows south
});

test('confidence levels', () => {
  const base = { score: 6, coverage: 1 };
  assert.equal(confidenceOf({ ...base, t: now, wind: { source: 'obs' }, waves: { source: 'obs' } }, now), 'high');
  assert.equal(confidenceOf({ ...base, t: new Date(+now + 5 * H), wind: { source: 'fcst' } }, now), 'medium');
  assert.equal(confidenceOf({ ...base, t: new Date(+now + 60 * H) }, now), 'low');
  assert.equal(confidenceOf({ ...base, coverage: 0.65, t: new Date(+now + 2 * H) }, now), 'low');
  assert.equal(confidenceOf({ score: null, t: now }, now), null);
});

test('day preview uses the best daylight score only', () => {
  const d = { start: new Date('2026-11-23T05:00Z'), end: new Date('2026-11-24T05:00Z') };
  const tl = [{ t: new Date('2026-11-23T08:00Z'), daylight: false, score: 9, tone: 'firing' }, { t: new Date('2026-11-23T17:00Z'), daylight: true, score: 6.4, tone: 'ok' }];
  assert.deepEqual(daySummary(tl, d).best, 6.4);
  assert.equal(daySummary([], d).best, null);
});

test('recommendation wording depends on now vs the selected forecast time', () => {
  const w = { start: new Date('2026-11-22T20:40Z'), end: new Date('2026-11-22T23:10Z'), bestT: new Date('2026-11-22T21:00Z'), state: 'next' };
  const cond = { now, window: w, score: { reason: null } };
  const s = { score: 6, label: 'DECENT', daylight: true };
  assert.equal(recommendFor(cond, s, null, w).kind, 'wait');
  assert.equal(recommendFor({ ...cond, window: { ...w, state: 'now' } }, s, null, w).kind, 'go');
  assert.equal(recommendFor(cond, s, new Date('2026-11-22T18:00Z'), w).kind, 'later');
  const prime = recommendFor(cond, s, new Date('2026-11-22T21:30Z'), w);
  assert.equal(prime.head, 'Prime skim window'); assert.match(prime.sub, /weaken after 6:10 PM/);
  assert.equal(recommendFor(cond, s, new Date('2026-11-22T23:30Z'), w).kind, 'weaken');
  assert.notEqual(recommendFor(cond, s, new Date('2026-11-22T21:30Z'), w).head, 'Go now', 'future time never says GO NOW');
  assert.equal(recommendFor(cond, { score: null }, new Date('2026-11-22T21:30Z'), w).head, 'Not enough data');
  assert.equal(recommendFor({ ...cond, score: { reason: 'not-configured' } }, { score: null }, null, w).head, 'Not rated yet');
});
