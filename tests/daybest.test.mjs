// DAY'S BEST vs Best Next Window (two separate questions, two separate results).
import test from 'node:test'; import assert from 'node:assert/strict';
import { bestWindow, dayBestWindow } from '../js/engine/score.js';

const t0 = Date.parse('2026-11-23T12:00Z'), Q = 15 * 60e3;
// Bethany-Monday-like day: an earlier hump peaking 8.2 (9 AM), a later one peaking 8.9 (2:15 PM)
const scores = [6.0, 7.5, 8.2, 8.0, 7.6, 6.0, 5.0, 4.5, 5.0, 6.5, 7.8, 8.4, 8.9, 8.6, 7.9, 6.0];
const day = scores.map((score, i) => ({ t: new Date(t0 + i * Q), score, daylight: true }));

test("day's best: centred on the single highest daylight moment", () => {
  const w = dayBestWindow(day);
  assert.equal(w.bestScore, 8.9); assert.equal(w.bestT.getTime(), day[12].t.getTime());
  assert.ok(w.start <= w.bestT && w.bestT < w.end, 'the peak lies inside its own window');
  assert.equal(w.peak, day[12], 'button score, tap target and BEST band share this exact sample');
});

test('best next window is unchanged: earliest good-enough opportunity', () => {
  const w = bestWindow(day);
  assert.equal(w.bestScore, 8.2); assert.equal(w.bestT.getTime(), day[2].t.getTime());
});

test("day's best: ties go to the earlier moment; night and unscored samples are ignored", () => {
  const s = [3.1, 2.0, 2.5, 3.1, 2.0].map((score, i) => ({ t: new Date(t0 + i * Q), score, daylight: true }));
  assert.equal(dayBestWindow(s).bestT.getTime(), s[0].t.getTime());
  const n = [{ t: new Date(t0), score: 9.9, daylight: false }, { t: new Date(t0 + Q), score: null, daylight: true }, { t: new Date(t0 + 2 * Q), score: 4, daylight: true }];
  assert.equal(dayBestWindow(n).bestScore, 4);
  assert.equal(dayBestWindow([{ t: new Date(t0), score: 5, daylight: false }]).state, 'unknown');
});
