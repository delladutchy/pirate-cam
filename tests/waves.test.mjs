// Short isolated 0 ft wave forecasts (whole-foot rounding near the inlet) are MISSING, not flat water.
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { series, dropWavePlaceholders, dropIsolatedWaveZeros, WAVE_ZERO_GAP_MS } from '../js/data/noaa.js';
import { buildConditions } from '../js/engine/conditions.js';
import { spotById } from '../js/config/spots.js';

const H = 3600e3, FT = 3.28084;
const real = JSON.parse(readFileSync(new URL('./fixtures/nws-waveheight-PHI-62-19-2026-11-23.json', import.meta.url)));
const raw = series(real.waveHeight, m => m * FT);
const at = (ser, iso) => { const t = Date.parse(iso); const r = ser.find(x => t >= x.s && t < x.e); return r ? Math.round(r.v * 10) / 10 : null; };

test('real Southside/Northside cell: the four short zeros between 1–2 ft values become missing', () => {
  const kept = dropWavePlaceholders(raw);
  const gone = raw.filter(r => !kept.includes(r));
  assert.deepEqual(gone.map(r => [new Date(r.s).toISOString().slice(0, 13), (r.e - r.s) / H]),
    [['2026-11-24T00', 4], ['2026-11-24T21', 3], ['2026-11-25T04', 1], ['2026-11-25T09', 2]]);
  for (const iso of ['2026-11-24T02:00Z', '2026-11-24T22:00Z', '2026-11-25T04:30Z', '2026-11-25T10:00Z']) assert.equal(at(kept, iso), null, `${iso} reads Not available`);
  assert.equal(at(kept, '2026-11-22T17:30Z'), 0, 'a leading zero (no value before it) is left as forecast');
  assert.equal(at(kept, '2026-11-24T05:00Z'), 2, 'neighbouring real values are untouched');
  assert.equal(kept.filter(r => r.v > 0).length, raw.filter(r => r.v > 0).length, 'every non-zero value survives');
});

test('only SHORT zero runs SURROUNDED by real waves are dropped; nothing is interpolated', () => {
  const s0 = Date.parse('2026-11-24T00:00Z');
  const mk = (...parts) => { let s = s0; return parts.map(([h, v]) => { const r = { s, e: s + h * H, v }; s += h * H; return r; }); };
  // short gap of two zero entries (2 h + 3 h = 5 h) → dropped, and nothing new is added
  const a = mk([3, 2], [2, 0], [3, 0], [4, 1]);
  assert.deepEqual(dropIsolatedWaveZeros(a), [a[0], a[3]]);
  // exactly the limit (6 h) → dropped; one hour longer → kept as a real calm
  assert.equal(dropIsolatedWaveZeros(mk([3, 2], [6, 0], [3, 2])).length, 2);
  assert.equal(WAVE_ZERO_GAP_MS, 6 * H);
  const longCalm = mk([3, 2], [7, 0], [3, 2]);
  assert.deepEqual(dropIsolatedWaveZeros(longCalm), longCalm, 'a 7 h calm is a forecast, kept');
  // sustained zeros, zeros at either end, or zeros next to a gap in the series stay
  const sustained = mk([3, 1], [18, 0], [3, 1]);
  assert.deepEqual(dropIsolatedWaveZeros(sustained), sustained);
  const ends = mk([2, 0], [3, 2], [2, 0]);
  assert.deepEqual(dropIsolatedWaveZeros(ends), ends);
  const gap = [{ s: s0, e: s0 + 3 * H, v: 2 }, { s: s0 + 4 * H, e: s0 + 6 * H, v: 0 }, { s: s0 + 6 * H, e: s0 + 9 * H, v: 2 }];
  assert.deepEqual(dropIsolatedWaveZeros(gap), gap, 'not directly preceded by a value → not provably isolated, kept');
  // the earlier test's legitimate zeros (start / end of series) are unchanged
  const legit = [{ s: s0, e: s0 + 3 * H, v: 0 }, { s: s0 + 3 * H, e: s0 + 9 * H, v: 0.3 }, { s: s0 + 9 * H, e: s0 + 21 * H, v: 0 }];
  assert.deepEqual(dropWavePlaceholders(legit), legit);
});

test('in the timeline those hours have no wave value: scored on tide & wind, low confidence, never 0 ft', () => {
  const spot = spotById('southside');
  const kept = dropWavePlaceholders(raw);
  const pick = (ser, t) => { const x = ser.find(r => t >= r.s && t < r.e); return x ? x.v : null; };
  const grid = { at: t => ({ windMph: 6, gustMph: 9, windFromDeg: 280, pop: 0, thunder: 0, tempF: 50, waveFt: pick(kept, t.getTime()) }) };
  const ev = []; let t = Date.parse('2026-11-21T03:00Z'), hi = true;
  while (t < Date.parse('2026-12-01T00:00Z')) { ev.push({ t: new Date(t), v: hi ? 4 : 0.3, type: hi ? 'H' : 'L' }); t += 6.2 * H; hi = !hi; }
  const c = buildConditions(spot, { tideEvents: ev, grid, status: { tide: true, wind: false, buoy: false, forecast: true } }, new Date('2026-11-23T04:40Z'));
  const s = c.timeline.find(x => x.t.toISOString() === '2026-11-24T02:00:00.000Z');
  assert.equal(s.waves, null, 'no 0 ft wave value');
  assert.ok(s.score != null && s.coverage < 1 && s.confidence === 'low');
  assert.ok(c.timeline.every(x => !x.waves || x.waves.ft > 0 || x.t < new Date('2026-11-22T18:00Z')), 'no remaining 0 ft after the leading hour');
});
