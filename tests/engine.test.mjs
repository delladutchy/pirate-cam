// Engine unit tests (node --test). Inputs here are test fixtures only.
import test from 'node:test'; import assert from 'node:assert/strict';
import { makeTide } from '../js/engine/tide.js';
import { sunTimes } from '../js/engine/sun.js';
import { scoreSample, bestWindow, labelFor } from '../js/engine/score.js';
import { spotById, resolveHash } from '../js/config/spots.js';
import { cams, camSlug } from '../js/config/cameras.js';

const ev = [ // NOAA Rehoboth hilo, 2026-11-21 (converted to UTC, EST = UTC-5)
  { t: new Date('2026-11-21T09:26Z'), v: 4.423, type: 'H' }, { t: new Date('2026-11-21T15:38Z'), v: 0.438, type: 'L' },
  { t: new Date('2026-11-21T21:43Z'), v: 3.862, type: 'H' }, { t: new Date('2026-11-22T03:44Z'), v: 0.055, type: 'L' }];

test('tide curve hits NOAA hi/lo and midpoint', () => {
  const T = makeTide(ev);
  assert.equal(T.at(ev[1].t).height.toFixed(3), '0.438');
  const mid = T.at(new Date((ev[1].t.getTime() + ev[2].t.getTime()) / 2));
  assert.ok(Math.abs(mid.height - (0.438 + 3.862) / 2) < 1e-9); assert.ok(mid.rising); assert.ok(mid.rateFtHr > 0);
  assert.equal(T.at(new Date('2026-11-23T00:00Z')), null);
  assert.equal(T.nextHigh(new Date('2026-11-21T16:00Z')).v, 3.862);
});

test('sunrise/sunset Dewey 2026-11-21 ≈ 6:51 / 16:43 EST', () => {
  const s = sunTimes(new Date('2026-11-21T12:00Z'), 38.69, -75.07);
  const hm = d => d.getUTCHours() - 5 + d.getUTCMinutes() / 60;
  assert.ok(Math.abs(hm(s.sunrise) - 6.85) < 0.08, hm(s.sunrise)); assert.ok(Math.abs(hm(s.sunset) - 16.72) < 0.08, hm(s.sunset));
});

const dewey = spotById('dewey').profile;
const ideal = { tide: { phase: 0.5, rising: true, rateFtHr: 0.6 }, wind: { mph: 4, fromDeg: 280, gustMph: 6 }, waves: { ft: 2.5, periodS: 8, fromDeg: 110 }, pop: 0, daylight: true };

test('ideal conditions score FIRING with positive reasons', () => {
  const r = scoreSample(dewey, ideal); assert.ok(r.score >= 9, r.score); assert.equal(r.label, 'FIRING');
  assert.ok(r.reasons.some(x => x.text === 'Light offshore wind'));
});
test('strong onshore wind and tiny surf score POOR', () => {
  const r = scoreSample(dewey, { ...ideal, wind: { mph: 22, fromDeg: 100, gustMph: 34 }, waves: { ft: 0.3, periodS: 4 } });
  assert.ok(r.score < 5, r.score); assert.ok(r.reasons.some(x => x.text === 'Onshore wind'));
});
test('night caps score, thunder caps score', () => {
  assert.ok(scoreSample(dewey, { ...ideal, daylight: false }).score <= 2);
  assert.ok(scoreSample(dewey, { ...ideal, thunder: 40 }).score <= 3);
});
test('missing data is skipped, never guessed', () => {
  const r = scoreSample(dewey, { ...ideal, waves: null }); assert.ok(r.score != null); assert.ok(r.confidence < 1);
  assert.equal(scoreSample(dewey, { ...ideal, waves: null, wind: null }).score, null);
});
test('Conquest is not rated until its profile is configured', () => {
  assert.equal(scoreSample(spotById('conquest').profile, ideal).reason, 'not-configured');
});
test('jetty shelter neutralises southerly onshore at Northside', () => {
  const n = spotById('northside').profile, s = spotById('southside').profile;
  const w = { ...ideal, wind: { mph: 11, fromDeg: 180, gustMph: 13 } };
  assert.ok(scoreSample(n, w).score > scoreSample(s, w).score);
});
test('labels', () => { assert.equal(labelFor(8.6).label, 'VERY GOOD'); assert.equal(labelFor(4.9).label, 'POOR'); assert.equal(labelFor(9).label, 'FIRING'); });

test('best window: next, then now; poor periods still return the best stretch', () => {
  const t0 = new Date('2026-11-21T17:00Z').getTime(), q = 15 * 60e3;
  const scores = [5.5, 5.6, 6, 7, 8.4, 8.6, 8.2, 7.4, 6];
  const S = scores.map((score, i) => ({ t: new Date(t0 + i * q), score, daylight: true }));
  const w = bestWindow(S); assert.equal(w.state, 'next'); assert.equal(w.bestScore, 8.6); assert.equal(w.label, 'VERY GOOD'); assert.equal(w.trend, 'up');
  assert.equal(w.start.getTime(), t0 + 4 * q); assert.equal(w.end.getTime(), t0 + 7 * q);
  assert.equal(bestWindow(S.slice(4)).state, 'now');
  const poor = bestWindow(S.map((x, i) => ({ ...x, score: [2, 2.5, 3.1, 4.8, 4.5, 3, 2, 2, 2][i] })));
  assert.equal(poor.state, 'next'); assert.equal(poor.bestScore, 4.8); assert.equal(poor.label, 'POOR'); assert.equal(poor.start.getTime(), t0 + 3 * q);
  assert.equal(bestWindow(S.map(x => ({ ...x, daylight: false }))).state, 'unknown');
});

test('best window prefers a strong window today over a slightly better one tomorrow', () => {
  const t0 = new Date('2026-11-21T17:00Z').getTime(), q = 15 * 60e3;
  const S = [6, 7.6, 7.6, 5, 2, 2, 8.3, 8.3, 6].map((score, i) => ({ t: new Date(t0 + i * q), score, daylight: ![4, 5].includes(i) }));
  const w = bestWindow(S); assert.equal(w.start.getTime(), t0 + q); assert.equal(w.bestScore, 7.6);
});

test('direct links: spot ids and original camera slugs', () => {
  const slugs = cams.map(camSlug);
  assert.deepEqual(resolveHash('#dewey', slugs), { spotId: 'dewey', cam: 'dewey-beach' });
  assert.deepEqual(resolveHash('#inlet-north', slugs), { spotId: 'northside', cam: 'inlet-north' });
  assert.deepEqual(resolveHash('#inlet-overview', slugs), { spotId: 'southside', cam: 'inlet-overview' });
  assert.deepEqual(resolveHash('#bethany-south', slugs), { spotId: 'bethany', cam: 'bethany-south' });
  assert.deepEqual(resolveHash('#conquest', slugs), { spotId: 'conquest', cam: 'dewey-beach' });
  assert.equal(resolveHash('#nope', slugs), null);
});
