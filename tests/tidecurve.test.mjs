import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTide, makeTideCurve } from '../js/engine/tide.js';

const H = 3600e3, T0 = Date.UTC(2026, 10, 24, 0);
const ev = [{ t: new Date(T0), v: 0.2, type: 'L' }, { t: new Date(T0 + 6.2 * H), v: 4.6, type: 'H' }, { t: new Date(T0 + 12.5 * H), v: -0.3, type: 'L' }, { t: new Date(T0 + 18.6 * H), v: 3.7, type: 'H' }];

test('without 6-min data the curve is the hi/lo interpolation, through NOAA highs and lows', () => {
  const tide = makeTide(ev), c = makeTideCurve(null, tide);
  assert.equal(c.source, 'hilo');
  for (const e of ev) assert.ok(Math.abs(c.at(e.t).height - e.v) < 1e-9);
  assert.equal(c.at(T0 + 3 * H).rising, true); assert.equal(c.at(T0 + 9 * H).rising, false);
  assert.equal(c.at(T0 - H), null);
});

test('with NOAA 6-min predictions the curve is those values, linearly between samples', () => {
  const v = Array.from({ length: 241 }, (_, i) => +(2 + 2 * Math.sin(i / 20) + (i > 120 ? 0.3 : 0)).toFixed(3));
  const c = makeTideCurve({ t0: T0, step: 360e3, v }, makeTide(ev));
  assert.equal(c.source, 'noaa6');
  for (const i of [0, 17, 120, 121, 240]) assert.equal(c.at(T0 + i * 360e3).height, v[i]);
  assert.ok(Math.abs(c.at(T0 + 5.5 * 360e3).height - (v[5] + v[6]) / 2) < 1e-9);
  assert.equal(c.at(T0 + 10 * 360e3).rising, true); assert.equal(c.at(T0 + 80 * 360e3).rising, false);
  assert.equal(c.at(T0 + 241 * 360e3), null);
  assert.equal(c.events, makeTide(ev).events.length ? c.events : null); // hi/lo events still NOAA's
});

test('no tide events → no curve', () => assert.equal(makeTideCurve({ t0: T0, step: 360e3, v: [1, 2] }, null), null));
