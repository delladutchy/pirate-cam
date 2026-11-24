// Regression tests for the four production issues found on 2026-11-22 (after c19f3fe):
// 1. score card vs dock disagreed (count-up tween lagged / froze when frames were delayed)
// 2. NWS multi-day 0 ft wave placeholder treated as real flat water
// 3. "Prime skim window" on days whose best was POOR/MAYBE
// 4. PirateCast highlight stuck on its last hour past its horizon
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ---- browser stubs for motion.js: animation frames are under the test's control ----
let frames = [];
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { visibilityState: 'visible' };
globalThis.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
globalThis.cancelAnimationFrame = id => { if (frames[id - 1]) frames[id - 1] = null; };
const runFrames = () => { const f = frames; frames = []; for (const cb of f) cb && cb(performance.now()); };
const el = () => ({ dataset: {}, textContent: '' });
const wait = ms => new Promise(r => setTimeout(r, ms));

const { setNumbers, countUp, numberTweenActive } = await import('../js/ui/motion.js');
const { series, dropWavePlaceholders } = await import('../js/data/noaa.js');
const { buildConditions } = await import('../js/engine/conditions.js');
const { spotById } = await import('../js/config/spots.js');
const { recommendFor, windowQuality } = await import('../js/engine/recommend.js');

const fmt = v => (Number.isFinite(v) ? v.toFixed(1) : '–');
const lowFmt = v => '≈' + v.toFixed(1);

// ---------------- 1. one authoritative score, card and dock never disagree ----------------
test('1: scrubbing writes the score to card and dock synchronously (no animation frames needed)', () => {
  const card = el(), dock = el();
  frames = [];
  for (const v of [2.0, 4.9, 8.3, 3.5]) {
    setNumbers([{ el: card, format: fmt }, { el: dock, format: fmt }], v);
    assert.equal(card.textContent, v.toFixed(1)); assert.equal(dock.textContent, card.textContent);
  }
  assert.equal(frames.length, 0, 'setting the score never waits on requestAnimationFrame');
});

test('1: a scrub during a spot-switch count-up cancels it; stale frames cannot overwrite the new value', () => {
  const card = el(), dock = el();
  setNumbers([{ el: card, format: fmt }, { el: dock, format: fmt }], 8.3);
  countUp([{ el: card, format: fmt }, { el: dock, format: fmt }], 2.0, 8.3);
  assert.equal(numberTweenActive(), true);
  setNumbers([{ el: card, format: fmt }, { el: dock, format: fmt }], 4.9); // user scrubs
  runFrames(); runFrames();                                               // late frames arrive
  assert.equal(card.textContent, '4.9'); assert.equal(dock.textContent, '4.9');
  assert.equal(numberTweenActive(), false);
});

test('1: count-up lands on the final value by its deadline even when frames never arrive (background tab)', async () => {
  const card = el(), dock = el();
  frames = [];
  setNumbers([{ el: card, format: fmt }, { el: dock, format: lowFmt }], 6.4);
  countUp([{ el: card, format: fmt }, { el: dock, format: lowFmt }], 2.0, 6.4, { duration: 30, deadline: 60 });
  assert.equal(card.textContent, '2.0'); assert.equal(dock.textContent, '≈2.0', 'both start together');
  // no runFrames(): animation frames are suspended
  await wait(90);
  assert.equal(card.textContent, '6.4'); assert.equal(dock.textContent, '≈6.4');
  assert.equal(numberTweenActive(), false);
});

test('1: every frame of a count-up shows the same number on card and dock', async () => {
  const card = el(), dock = el();
  countUp([{ el: card, format: fmt }, { el: dock, format: fmt }], 2.0, 9.4, { duration: 40, deadline: 400 });
  for (let i = 0; i < 6; i++) { await wait(10); runFrames(); assert.equal(card.textContent, dock.textContent); }
});

test('1: hidden page or reduced motion → no count-up at all', () => {
  const card = el();
  document.visibilityState = 'hidden';
  setNumbers([{ el: card, format: fmt }], 7.7);
  countUp([{ el: card, format: fmt }], 2.0, 7.7);
  assert.equal(card.textContent, '7.7'); assert.equal(numberTweenActive(), false);
  document.visibilityState = 'visible';
});

// ---------------- 2. NWS multi-day 0 ft placeholder ----------------
const fixture = JSON.parse(readFileSync(new URL('./fixtures/nws-waveheight-2026-11-22.json', import.meta.url)));
const M_TO_FT = 3.28084;

test('2: real production response — the P4DT19H 0 ft placeholder is dropped, real values kept', () => {
  for (const [grid, prop] of Object.entries(fixture.grids)) {
    const raw = series(prop, m => m * M_TO_FT), kept = dropWavePlaceholders(raw);
    const dropped = raw.filter(r => !kept.includes(r));
    for (const r of dropped) { assert.equal(r.v, 0, grid); assert.ok(r.e - r.s >= 24 * 3600e3, grid); }
    // every non-zero value survives, including long real stretches (e.g. 2 ft for P1DT1H)
    assert.equal(kept.filter(r => r.v > 0).length, raw.filter(r => r.v > 0).length, grid);
  }
  const dewey = series(fixture.grids['PHI/61,23'], m => m * M_TO_FT);
  const kept = dropWavePlaceholders(dewey);
  assert.equal(dewey.length - kept.length, 1, 'only the multi-day zero goes');
  assert.ok(!kept.some(r => r.s === Date.parse('2026-11-24T00:00:00+00:00')), 'Nov 24 → Nov 28 placeholder removed');
  // grid 62,21 has a genuine multi-day forecast and no placeholder: nothing removed
  const g = series(fixture.grids['PHI/62,21'], m => m * M_TO_FT);
  assert.equal(dropWavePlaceholders(g).length, g.length);
});

test('2: a legitimate zero / near-zero wave forecast over a normal block is kept', () => {
  const s = Date.parse('2026-11-22T15:00Z'), H = 3600e3;
  const ser = [{ s, e: s + 3 * H, v: 0 }, { s: s + 3 * H, e: s + 9 * H, v: 0.3 }, { s: s + 9 * H, e: s + 21 * H, v: 0 }];
  assert.deepEqual(dropWavePlaceholders(ser), ser);
  assert.equal(dropWavePlaceholders([{ s, e: s + 30 * H, v: 1.2 }]).length, 1, 'long non-zero values are real data');
});

test('2: timeline with the production NWS waves (display-only spots) — placeholder hours read Not available, never 0 ft; a rated spot is not scored from them', () => {
  const now = new Date('2026-11-22T22:24:24Z');
  const ser = dropWavePlaceholders(series(fixture.grids['PHI/61,23'], m => m * M_TO_FT));
  const pick = t => { const x = ser.find(r => t >= r.s && t < r.e); return x ? x.v : null; };
  const H = 3600e3;
  const wind = t => ({ windMph: 6, gustMph: 9, windFromDeg: 280, pop: 0, thunder: 0, tempF: 55, waveFt: pick(t.getTime()) });
  const grid = { at: wind };
  const ev = []; for (let k = -2; k < 20; k++) ev.push({ t: new Date(now.getTime() + k * 6.2 * H), type: k % 2 ? 'L' : 'H', v: k % 2 ? 0 : 4.5 });
  // Ocean City still shows the NWS wave grid (outside the NWPS model's area; NOT RATED)
  const c = buildConditions(spotById('oc-downtown'), { grid, tideEvents: ev, status: {} }, now);
  const at = iso => c.timeline.find(x => x.t.getTime() === Date.parse(iso));
  const mon = at('2026-11-23T15:00:00Z'), wed = at('2026-11-25T17:00:00Z');
  assert.ok(Math.abs(mon.waves.ft - 1) < 0.01, 'Monday keeps the real 1 ft forecast');
  assert.equal(mon.waves.source, 'fcst');
  assert.equal(wed.waves, null, 'Wednesday: no wave data, not 0 ft');
  // Dewey (rated) does not take its waves from the NWS grid at all: with no NWPS model loaded
  // the hours have no waves and therefore no score — tide + wind alone are never a Pirate Score
  const d = buildConditions(spotById('dewey'), { grid, tideEvents: ev, status: {} }, now);
  const dm = d.timeline.find(x => x.t.getTime() === Date.parse('2026-11-23T15:00:00Z'));
  assert.equal(dm.waves, null); assert.equal(dm.score, null); assert.deepEqual(dm.missing, ['waves']);
  assert.ok(!dm.reasons.some(r => /flat|small|wave/i.test(r.text)), 'no wave reasons invented from missing data');
});

// ---------------- 3. recommendation wording respects the thresholds ----------------
test('3: "Prime skim window" only for windows that reach GOOD; POOR/MAYBE/DECENT say what they are', () => {
  const now = new Date('2026-11-22T22:00Z');
  const mk = best => ({ start: new Date('2026-11-24T20:30Z'), end: new Date('2026-11-24T21:00Z'), bestT: new Date('2026-11-24T20:45Z'), state: 'next', bestScore: best });
  const cond = { now, window: mk(8), score: { reason: null } };
  const inWin = new Date('2026-11-24T20:40Z'), before = new Date('2026-11-24T15:00Z'), after = new Date('2026-11-24T21:30Z');
  const s = sc => ({ score: sc, label: 'X', daylight: true });
  // production case: Tue best 3.5 POOR, Wed 2.0, Thu 0.2, Fri 2.1
  for (const best of [3.5, 2.0, 0.2, 2.1]) {
    const r = recommendFor(cond, s(best), inWin, mk(best));
    assert.notEqual(r.head, 'Prime skim window', `best ${best}`); assert.equal(r.head, 'Poor conditions'); assert.equal(r.kind, 'poor');
    assert.equal(recommendFor(cond, s(best - 0.5), before, mk(best)).head, 'Poor conditions');
    assert.equal(recommendFor(cond, s(best - 0.5), after, mk(best)).head, 'Poor conditions');
  }
  assert.equal(recommendFor(cond, s(5.4), inWin, mk(5.4)).head, 'Best available window');   // MAYBE
  assert.match(recommendFor(cond, s(5.4), inWin, mk(5.4)).sub, /Marginal/);
  assert.equal(recommendFor(cond, s(6.8), inWin, mk(6.8)).head, 'Best available window');   // DECENT
  assert.equal(recommendFor(cond, s(7.0), inWin, mk(7.0)).head, 'Prime skim window');       // GOOD threshold
  assert.equal(recommendFor(cond, s(8.3), inWin, mk(8.3)).head, 'Prime skim window');
  assert.deepEqual([4.9, 5, 6, 7].map(x => windowQuality({ bestScore: x })), ['poor', 'maybe', 'decent', 'good']);
});

test('3: NOW wording — no "Go now"/"Prime" for a poor or marginal best window', () => {
  const now = new Date('2026-11-22T15:00Z');
  const w = (best, state) => ({ start: now, end: new Date(now.getTime() + 3600e3), bestT: now, state, bestScore: best });
  const s = { score: 3, label: 'POOR', daylight: true };
  assert.equal(recommendFor({ now, window: w(3, 'now'), score: {} }, s, null, null).head, 'Poor conditions');
  assert.equal(recommendFor({ now, window: w(5.5, 'now'), score: {} }, s, null, null).head, 'Best available window');
  assert.equal(recommendFor({ now, window: w(3, 'next'), score: {} }, s, null, null).head, 'Poor conditions');
  assert.equal(recommendFor({ now, window: w(8, 'now'), score: {} }, s, null, null).head, 'Go now');
  assert.match(recommendFor({ now, window: w(8, 'now'), score: {} }, s, null, null).sub, /Prime skim window/);
});


test('3: a GOOD best window scored without waves (placeholder removed) is not called prime', () => {
  const now = new Date('2026-11-22T22:00Z');
  const w = { start: new Date('2026-11-24T21:00Z'), end: new Date('2026-11-24T21:30Z'), bestT: new Date('2026-11-24T21:15Z'), state: 'next', bestScore: 7.1,
    peak: { coverage: 0.7, waves: null } };
  const r = recommendFor({ now, window: w, score: {} }, { score: 7.1, label: 'GOOD', daylight: true }, new Date('2026-11-24T21:10Z'), w);
  assert.equal(r.head, 'Best available window'); assert.match(r.sub, /no wave forecast yet/);
  const full = { ...w, peak: { coverage: 1, waves: { ft: 2 } } };
  assert.equal(recommendFor({ now, window: full, score: {} }, { score: 7.1, daylight: true }, new Date('2026-11-24T21:10Z'), full).head, 'Prime skim window');
});
