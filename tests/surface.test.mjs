// Estimated surface quality (Clean / Fair / Choppy) — independent of the Pirate Score.
import test from 'node:test'; import assert from 'node:assert/strict';
import { surfaceQuality } from '../js/engine/surface.js';
import { scoreSample } from '../js/engine/score.js';
import { spotById } from '../js/config/spots.js';

const FACE = 100; // a Delaware ocean beach faces roughly east (offshore wind blows from the west)
const W = (mph, fromDeg) => ({ mph, fromDeg });

test('calm is clean from any direction; no wind reading → no estimate', () => {
  assert.equal(surfaceQuality(FACE, W(3, 90)).cls, 'clean');
  assert.equal(surfaceQuality(FACE, null), null);
});

test('offshore, cross-shore and onshore thresholds', () => {
  const off = 280, on = 100, cross = 10;
  assert.deepEqual([12, 18, 25].map(m => surfaceQuality(FACE, W(m, off)).cls), ['clean', 'fair', 'choppy']);
  assert.deepEqual([6, 10, 18].map(m => surfaceQuality(FACE, W(m, cross)).cls), ['clean', 'fair', 'choppy']);
  assert.deepEqual([5.5, 9, 14].map(m => surfaceQuality(FACE, W(m, on)).cls), ['clean', 'fair', 'choppy']);
  assert.equal(surfaceQuality(FACE, W(10, on)).relation, 'onshore');
});

test('a short-period wind sea makes it one step rougher; a long period does not', () => {
  assert.equal(surfaceQuality(FACE, W(12, 280), { periodS: 4 }).cls, 'fair');
  assert.equal(surfaceQuality(FACE, W(12, 280), { periodS: 11 }).cls, 'clean');
  assert.match(surfaceQuality(FACE, W(12, 280), { periodS: 4 }).why, /short-period/);
});

test('no beach orientation (unrated Ocean City spots) → no estimate unless calm', () => {
  const oc = spotById('oc-downtown');
  assert.equal(surfaceQuality(oc.profile.shoreFacingDeg, W(12, 280)), null);
  assert.equal(surfaceQuality(oc.profile.shoreFacingDeg, W(2, 280)).cls, 'clean');
});

test('surface quality never feeds the Pirate Score', () => {
  const p = spotById('dewey').profile;
  const s = { t: new Date(), tide: null, wind: W(9, 280), waves: { ft: 2, periodS: 9, fromDeg: 100, source: 'model' }, daylight: true, skimmable: true };
  const a = scoreSample(p, s), b = scoreSample(p, { ...s, surface: 'choppy' });
  assert.deepEqual(a, b);
});
