import test from 'node:test'; import assert from 'node:assert/strict';
import { toVector, windPoints, sampleAt } from '../js/map/model.js';
import { createSpotField } from '../js/map/windfield.js';
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

test('meteorological FROM direction becomes particle TRAVEL direction', () => {
  // W wind (from 270°) travels EAST: +u, no v
  let w = toVector(10, 270); assert.ok(near(w.u, 10, 1e-6) && near(w.v, 0, 1e-6));
  // N wind (from 0°) travels SOUTH: -v
  w = toVector(10, 0); assert.ok(near(w.u, 0, 1e-6) && near(w.v, -10, 1e-6));
  // ESE wind (from 112.5°) travels WNW: -u, +v
  w = toVector(10, 112.5); assert.ok(w.u < 0 && w.v > 0);
  // SW wind (from 225°) travels NE: +u, +v
  w = toVector(10, 225); assert.ok(w.u > 0 && w.v > 0 && near(w.u, w.v, 1e-6));
});

test('spot field: exact at a spot, real-points-only, keeps speed between opposing spots', () => {
  const a = { lat: 38.69, lon: -75.07, mph: 10, ...toVector(10, 270) };
  const b = { lat: 38.54, lon: -75.05, mph: 6, ...toVector(6, 90) };
  const f = createSpotField([a, b]);
  const s = f.sample(38.69, -75.07); assert.ok(near(s.u, a.u) && near(s.v, a.v));
  const mid = f.sample(38.615, -75.06); assert.ok(mid.mph > 5, 'no invented calm between spots');
  assert.equal(createSpotField([]), null);
});

test('windPoints uses the same samples the app shows; skips spots without wind', () => {
  const t0 = new Date('2026-11-22T13:00Z');
  const tl = [{ t: t0, wind: { mph: 4, fromDeg: 280, source: 'obs' } }, { t: new Date(+t0 + 9e5), wind: { mph: 9, fromDeg: 90 } }];
  const spots = [{ id: 'a', lat: 1, lon: 2 }, { id: 'b', lat: 3, lon: 4 }];
  const results = { a: { timeline: tl }, b: { timeline: [{ t: t0, wind: null }] } };
  assert.deepEqual(windPoints(spots, results, null).map(p => [p.id, p.mph, p.source]), [['a', 4, 'obs']]);
  assert.deepEqual(windPoints(spots, results, new Date(+t0 + 8e5)).map(p => [p.mph, p.source]), [[9, 'fcst']]);
  assert.equal(sampleAt(tl, null), tl[0]);
});
