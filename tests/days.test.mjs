import test from 'node:test'; import assert from 'node:assert/strict';
import { dayStart, dayEnd, forecastDays } from '../js/engine/days.js';
import { windRelation } from '../js/engine/score.js';

test('days are Delaware calendar days, DST-safe', () => {
  assert.equal(dayStart(new Date('2026-11-22T03:00Z')).toISOString(), '2026-11-21T05:00:00.000Z'); // 10 PM ET Nov 21
  assert.equal((dayEnd(dayStart(new Date('2026-03-08T12:00Z'))) - dayStart(new Date('2026-03-08T12:00Z'))) / 36e5, 23);
  assert.equal((dayEnd(dayStart(new Date('2026-11-01T12:00Z'))) - dayStart(new Date('2026-11-01T12:00Z'))) / 36e5, 25);
});

test('forecastDays: honest availability per day', () => {
  const now = new Date('2026-11-21T20:00Z');
  const tl = [];
  for (let t = now.getTime(); t < now.getTime() + 30 * 36e5; t += 9e5) tl.push({ t: new Date(t), score: 5 });
  const d = forecastDays(tl, now);
  assert.equal(d.length, 7);
  assert.deepEqual(d.map(x => x.label), ['Today', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  assert.equal(d[1].long, 'Tomorrow');
  assert.deepEqual(d.map(x => x.hasScores), [true, true, false, false, false, false, false]); // no invented days
});

test('wind relation uses FROM direction against the beach orientation', () => {
  // beach faces 100° (ESE) → offshore wind comes FROM 280°
  assert.equal(windRelation(100, { mph: 10, fromDeg: 280 }), 'offshore');
  assert.equal(windRelation(100, { mph: 10, fromDeg: 100 }), 'onshore');
  assert.equal(windRelation(100, { mph: 10, fromDeg: 190 }), 'cross-shore');
  assert.equal(windRelation(100, { mph: 2, fromDeg: 100 }), 'calm');
  assert.equal(windRelation(null, { mph: 10, fromDeg: 100 }), null); // Conquest: not configured
});
