// Skimmable daylight window, Weekly Skim Outlook and the weather row — engine-level tests.
import test from 'node:test'; import assert from 'node:assert/strict';
import { skimRanges, isSkimmable, skimRangeFor, snapToSkim, nextSkimRange } from '../js/engine/skim.js';
import { sunTimes, daylightRanges } from '../js/engine/sun.js';
import { bestWindow, dayBestWindow, scoreSample } from '../js/engine/score.js';
import { forecastDays } from '../js/engine/days.js';
import { resolveSelection } from '../js/engine/timeline.js';
import { buildConditions } from '../js/engine/conditions.js';
import { weekOutlook, spotDayBest, isRated } from '../js/engine/week.js';
import { recommendFor } from '../js/engine/recommend.js';
import { conditionText, skyText, wxCode } from '../js/engine/weather.js';
import { spots, spotById } from '../js/config/spots.js';
import { sampleAt, mapMarkers } from '../js/map/model.js';

const H = 3600e3, Q = 15 * 60e3;
const up = d => Math.ceil(d / Q) * Q, down = d => Math.floor(d / Q) * Q; // snaps land on the 15-min forecast grid, inside the window
const NOW = new Date('2026-11-22T23:49:00Z'); // Sun 6:49 PM ET (after dark), like the production capture

// ---------- daylight usable-window calculation ----------
test('skim window = 1 h after sunrise → 1 h before sunset, per spot and day', () => {
  const dewey = spotById('dewey'), oc = spotById('oc-downtown');
  const day = new Date('2026-11-23T17:00Z');
  for (const sp of [dewey, oc]) {
    const s = sunTimes(day, sp.lat, sp.lon);
    const [r] = skimRanges([s]);
    assert.equal(r.start - s.sunrise, H); assert.equal(s.sunset - r.end, H);
  }
  // independent per spot: OC (further south and west) has its own sun times
  const a = skimRanges([sunTimes(day, dewey.lat, dewey.lon)])[0], b = skimRanges([sunTimes(day, oc.lat, oc.lon)])[0];
  assert.notEqual(a.start.getTime(), b.start.getTime());
  // the example from the brief: sunrise 6:50, sunset 4:45 → 7:50 → 3:45
  const ex = skimRanges([{ sunrise: new Date('2026-11-23T11:50Z'), sunset: new Date('2026-11-23T21:45Z') }])[0];
  assert.equal(ex.start.toISOString(), '2026-11-23T12:50:00.000Z'); assert.equal(ex.end.toISOString(), '2026-11-23T20:45:00.000Z');
  assert.ok(isSkimmable(new Date('2026-11-23T12:50Z'), [ex]) && isSkimmable(new Date('2026-11-23T20:45Z'), [ex]));
  assert.ok(!isSkimmable(new Date('2026-11-23T12:35Z'), [ex]) && !isSkimmable(new Date('2026-11-23T21:00Z'), [ex]));
  assert.ok(!isSkimmable(new Date('2026-11-23T05:00Z'), [ex]), 'midnight is never a skim time');
});

test('snapToSkim: inside stays, outside moves to the window edge (on the 15-min grid), never before now', () => {
  const rs = skimRanges(daylightRanges(new Date('2026-11-23T00:00Z'), new Date('2026-11-26T00:00Z'), 38.69, -75.07));
  const mon = rs.find(r => r.start.toISOString().startsWith('2026-11-23')), tue = rs.find(r => r.start.toISOString().startsWith('2026-11-24'));
  const midnight = new Date('2026-11-24T05:00Z'); // Mon→Tue midnight ET
  assert.equal(snapToSkim(new Date(mon.start.getTime() + H), rs).getTime(), mon.start.getTime() + H);
  assert.equal(snapToSkim(midnight, rs, { dir: 1 }).getTime(), up(tue.start));
  assert.equal(snapToSkim(midnight, rs, { dir: -1 }).getTime(), down(mon.end));
  assert.ok(isSkimmable(snapToSkim(midnight, rs, { dir: 1 }), rs) && isSkimmable(snapToSkim(midnight, rs, { dir: -1 }), rs));
  const evening = new Date(mon.end.getTime() + 2 * H); // nearest edge is Monday's end…
  assert.equal(snapToSkim(evening, rs).getTime(), down(mon.end));
  assert.equal(snapToSkim(evening, rs, { min: new Date(mon.end.getTime() + H) }).getTime(), up(tue.start), '…unless that is already past');
  assert.equal(snapToSkim(evening, rs, { dir: -1, min: new Date(mon.end.getTime() + H) }).getTime(), mon.end.getTime() + H, 'stepping back with nothing left → now');
  assert.equal(nextSkimRange(evening, rs), tue);
  assert.equal(skimRangeFor({ start: new Date('2026-11-24T05:00Z'), end: new Date('2026-11-25T05:00Z') }, rs), tue);
});

// ---------- a conditions object from synthetic but realistic inputs ----------
function makeCond(spotId, { now = NOW, wave = 2, windMph = 6, windFrom = 290, tideShift = 0 } = {}) {
  const spot = spotById(spotId);
  const ev = []; let t = Date.parse('2026-11-21T03:00Z') + tideShift, hi = true;
  while (t < Date.parse('2026-12-02T00:00Z')) { ev.push({ t: new Date(t), v: hi ? 4.2 : 0.2, type: hi ? 'H' : 'L' }); t += 6.2 * H; hi = !hi; }
  const grid = { at: tt => { const h = (tt - Date.parse('2026-11-22T00:00Z')) / H; return { windMph: windMph + 3 * Math.sin(h / 7), gustMph: windMph + 6, windFromDeg: windFrom, pop: 10, thunder: 0, tempF: 50 + 8 * Math.sin((h - 14) / 24 * 2 * Math.PI), waveFt: wave, sky: 30, wx: '' }; } };
  return buildConditions(spot, { tideEvents: ev, obsWind: null, obsAir: null, coopsWater: null, buoy: null, grid, status: { tide: true, wind: false, buoy: false, forecast: true } }, now);
}

test('no night-time Pirate Score selection: every window and DAY\'S BEST lies inside skim hours', () => {
  const r = makeCond('dewey');
  assert.ok(r.skim.length >= 7, 'a skim window for each forecast day');
  assert.equal(r.timeline[0].skimmable, false, 'now (6:49 PM) is outside skim hours');
  assert.ok(r.timeline.some(s => !s.daylight && s.score != null), 'night forecast data is kept, not destroyed');
  const inSkim = t => r.skim.some(x => t >= x.start && t <= x.end);
  assert.ok(inSkim(r.window.bestT) && inSkim(r.window.start), 'best next window inside skim hours');
  for (const d of forecastDays(r.timeline, r.now)) {
    const w = spotDayBest(r, d);
    if (!w) continue;
    assert.ok(inSkim(w.bestT) && inSkim(w.start) && inSkim(new Date(w.end.getTime() - Q)), `${d.label} window in skim hours`);
  }
  // selection: a midnight pick, a step from Now, and a step past a day's end all land in skim hours
  const snap = (x, dir) => snapToSkim(x, r.skim, { dir, min: r.now }) || x;
  const end = r.timeline.at(-1).t;
  const mid = resolveSelection({ t: new Date('2026-11-24T05:00Z'), now: r.now, end, snap });
  assert.ok(inSkim(mid), 'tapping midnight snaps into skim hours');
  const step = resolveSelection({ step: Q, current: null, now: r.now, end, snap });
  assert.equal(step.getTime(), up(r.skim.find(x => x.start > r.now).start), '→ from Now at night goes to the first skim step');
  assert.equal(sampleAt(r.timeline, step).skimmable, true, 'and that step is a real skim-hours forecast sample');
  const lastMon = new Date(down(r.skim.find(x => x.start.toISOString().startsWith('2026-11-23')).end));
  const over = resolveSelection({ step: Q, current: lastMon, now: r.now, end, snap });
  assert.equal(over.getTime(), up(r.skim.find(x => x.start > lastMon).start), '→ past 1 h before sunset jumps to the next day');
  assert.equal(resolveSelection({ step: -Q, current: new Date(up(r.skim.find(x => x.start > r.now).start)), now: r.now, end, snap }), null, '← before the first skim time returns to Now');
});

test("Day's Best only considers usable skim hours (a better first-light score is ignored)", () => {
  const sr = new Date('2026-11-23T11:50Z');
  const mk = (min, score) => ({ t: new Date(sr.getTime() + min * 60e3), score, daylight: true, skimmable: min >= 60 });
  const day = [mk(0, 9.5), mk(15, 9.4), mk(30, 9.2), mk(60, 6.0), mk(75, 7.1), mk(90, 6.8)];
  assert.equal(dayBestWindow(day).bestScore, 7.1);
  assert.equal(bestWindow(day).bestScore, 7.1, 'best next window too');
});

test('darkness is outside the skim window — never called POOR', () => {
  const r = makeCond('dewey');
  const rec = recommendFor(r, r.timeline[0], null, null);
  assert.equal(rec.kind, 'dark'); assert.equal(rec.head, 'After dark'); assert.doesNotMatch(rec.head + rec.sub, /POOR|Poor conditions/);
  assert.match(rec.sub, /Next best|Skim hours start/);
  const m = mapMarkers([spotById('dewey')], { dewey: r }, null)[0];
  assert.equal(m.score, null); assert.equal(m.outside, true);
  assert.equal(scoreSample(spotById('dewey').profile, { ...r.timeline[0] }).label, r.timeline[0].label, 'scoring itself is unchanged (the cap still exists internally)');
});

// ---------- weekly outlook ----------
test('Best Spot compares all rated spots per day; Best This Week across spots and days; ties earlier', () => {
  const results = {
    dewey: makeCond('dewey', { wave: 2.2 }),
    bethany: makeCond('bethany', { wave: 2.2, tideShift: 2 * H }),
    southside: makeCond('southside', { wave: 0.3, windMph: 20, windFrom: 90 }),
    northside: makeCond('northside', { wave: 0.3, windMph: 20, windFrom: 90 }),
    conquest: makeCond('conquest'), 'oc-downtown': makeCond('oc-downtown'), 'oc-midtown': 'error',
  };
  const o = weekOutlook(results, spots);
  assert.deepEqual(o.rated, ['dewey', 'bethany', 'southside', 'northside'], 'Conquest, OC (NOT RATED) and failed spots never compete');
  for (const d of o.days) {
    if (!d.best) continue;
    const all = o.rated.map(id => spotDayBest(results[id], d.day)).filter(Boolean);
    const max = Math.max(...all.map(w => w.bestScore));
    assert.equal(d.best.w.bestScore, max, `${d.day.label}: winner has the day's highest rated score`);
    assert.ok(o.rated.includes(d.best.spot.id));
    assert.equal(d.best.sample, d.best.w.peak, 'weather/temperature shown is the winning moment');
  }
  const top = o.top, all = o.days.filter(d => d.best).map(d => d.best.w.bestScore);
  assert.equal(top.w.bestScore, Math.max(...all));
  assert.equal(o.days[top.dayIndex].best.w.bestT.getTime(), top.w.bestT.getTime());
  // ties: equal scores → earlier time, then config order
  const same = { dewey: results.dewey, bethany: { ...results.dewey, spot: spotById('bethany') } };
  const t2 = weekOutlook(same, spots);
  for (const d of t2.days) if (d.best) assert.equal(d.best.spot.id, 'dewey', 'identical scores: earlier spot in config order wins');
});

test('NOT RATED spots cannot win even with no rated competition; nothing rated → no outlook', () => {
  assert.equal(isRated(makeCond('oc-downtown')), false);
  assert.equal(isRated(makeCond('conquest')), false);
  assert.equal(weekOutlook({ conquest: makeCond('conquest'), 'oc-downtown': makeCond('oc-downtown') }, spots), null);
  const o = weekOutlook({ dewey: makeCond('dewey'), 'oc-downtown': makeCond('oc-downtown') }, spots);
  assert.ok(o.days.every(d => !d.best || d.best.spot.id === 'dewey'));
});

test('today after skim hours has no weekly pick; a weekly day maps to exactly that day\'s best time', () => {
  const r = makeCond('dewey');
  const o = weekOutlook({ dewey: r }, spots);
  assert.equal(o.days[0].best, null, 'Sunday 6:49 PM: no skim hours left today');
  const d1 = o.days[1];
  assert.equal(d1.best.w.bestT.getTime(), spotDayBest(r, d1.day).bestT.getTime(), 'tap target = PirateCast BEST band');
  assert.ok(d1.best.w.bestT >= d1.day.start && d1.best.w.bestT < d1.day.end);
  const day = makeCond('dewey', { now: new Date('2026-11-23T15:00Z') }); // Mon 10 AM: today counts only what's left
  const od = weekOutlook({ dewey: day }, spots);
  assert.ok(od.days[0].best.w.bestT >= day.now);
});

// ---------- weather wording ----------
test('weather row wording comes from NWS sky cover / weather codes, missing stays missing', () => {
  assert.equal(skyText(0), 'Sunny'); assert.equal(skyText(20), 'Mostly sunny'); assert.equal(skyText(50), 'Partly sunny');
  assert.equal(skyText(80), 'Mostly cloudy'); assert.equal(skyText(100), 'Cloudy'); assert.equal(skyText(null), null);
  assert.equal(wxCode([{ coverage: 'patchy', weather: 'fog' }, { coverage: 'likely', weather: 'rain' }]), 'rain:likely', 'precipitation outranks fog');
  assert.equal(wxCode([{ coverage: null, weather: null }]), '');
  assert.equal(conditionText(30, 'rain:likely'), 'Rain');
  assert.equal(conditionText(30, 'rain:chance'), 'Mostly sunny', 'a mere chance keeps the sky wording (rain % is shown separately)');
  assert.equal(conditionText(null, 'rain:chance'), 'Rain', 'without sky data the weather type is all there is');
  assert.equal(conditionText(null, null), null);
  const r = makeCond('dewey');
  const s = sampleAt(r.timeline, new Date('2026-11-23T17:00Z'));
  assert.equal(s.sky, 30); assert.equal(s.wx, null, "'' weather code → none");
});

// ---------- removed UI stays removed ----------
import { readFileSync, existsSync } from 'node:fs';
test('hourly score carousel and the controller\'s day row are gone; weekly outlook replaces the Best Next Window card', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const dock = readFileSync(new URL('../js/ui/timedock.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(!existsSync(new URL('../js/ui/piratecast.js', import.meta.url)));
  assert.doesNotMatch(html, /id="piratecast"|id="window"/);
  assert.match(html, /id="weekPanel"/);
  assert.doesNotMatch(dock, /td-days|data-day|onDay/);
  assert.match(dock, /td-now/); assert.match(dock, /td-bubble/);
  assert.doesNotMatch(app, /renderWindow|createPirateCast/);
});

// ---------- complete-data ranking ----------
import { isComplete } from '../js/engine/week.js';
test('an incomplete forecast (waves missing) cannot beat a complete one; PirateCast BEST prefers complete', () => {
  // Bethany: waves only on Tuesday morning → Tuesday afternoon is incomplete
  const full = makeCond('dewey', { wave: 0.6 });                // complete all week, modest scores
  const spot = spotById('bethany');
  const ev = []; let t = Date.parse('2026-11-21T03:00Z'), hi = true;
  while (t < Date.parse('2026-12-02T00:00Z')) { ev.push({ t: new Date(t), v: hi ? 4.2 : 0.2, type: hi ? 'H' : 'L' }); t += 6.2 * H; hi = !hi; }
  const grid = { at: tt => ({ windMph: 4, gustMph: 6, windFromDeg: 280, pop: 0, thunder: 0, tempF: 50, waveFt: tt < Date.parse('2026-11-24T16:00Z') ? 0.5 : null }) };
  const part = buildConditions(spot, { tideEvents: ev, grid, status: { tide: true, wind: false, buoy: false, forecast: true } }, NOW);
  const days = forecastDays(part.timeline, part.now);
  const tue = days.find(d => d.label === 'Tue');
  const tl = part.timeline.filter(s => s.t >= tue.start && s.t < tue.end && s.skimmable);
  const incBest = Math.max(...tl.filter(s => s.skimmable && s.score != null && !isComplete(s)).map(s => s.score));
  const cmpBest = Math.max(...tl.filter(s => s.skimmable && isComplete(s)).map(s => s.score));
  assert.ok(incBest > cmpBest, `fixture: the incomplete afternoon (${incBest}) out-scores the complete morning (${cmpBest})`);
  const w = spotDayBest(part, tue);
  assert.equal(w.complete, true); assert.equal(w.bestScore, cmpBest, 'BEST band = best COMPLETE time, not the higher incomplete one');
  assert.ok(isComplete(w.peak));
  // a later day with no waves at all: the spot still shows its incomplete best (≈), but cannot win
  const fri = days.find(d => d.label === 'Fri');
  const wf = spotDayBest(part, fri);
  assert.equal(wf.complete, false); assert.equal(wf.peak.confidence, 'low');
  const o = weekOutlook({ dewey: full, bethany: part }, spots);
  const ofri = o.days.find(d => d.day.label === 'Fri');
  assert.equal(ofri.best.spot.id, 'dewey', `complete Dewey ${ofri.best.w.bestScore} beats incomplete Bethany ${wf.bestScore}`);
  assert.ok(wf.bestScore > ofri.best.w.bestScore, 'even though the incomplete score is higher');
  for (const d of o.days) if (d.best) assert.ok(isComplete(d.best.sample), `${d.day.label}: winner is complete`);
  assert.ok(isComplete(o.top.sample), 'Best This Week is complete');
});

test('a day where no rated spot has a complete forecast shows "–" (no winner)', () => {
  const spot = spotById('dewey');
  const ev = []; let t = Date.parse('2026-11-21T03:00Z'), hi = true;
  while (t < Date.parse('2026-12-02T00:00Z')) { ev.push({ t: new Date(t), v: hi ? 4.2 : 0.2, type: hi ? 'H' : 'L' }); t += 6.2 * H; hi = !hi; }
  const noWaves = buildConditions(spot, { tideEvents: ev, grid: { at: () => ({ windMph: 4, gustMph: 6, windFromDeg: 280, pop: 0, thunder: 0, tempF: 50, waveFt: null }) }, status: { tide: true, wind: false, buoy: false, forecast: true } }, NOW);
  const o = weekOutlook({ dewey: noWaves }, spots);
  assert.ok(o.days.every(d => d.best === null), 'every day: no complete forecast → no winner');
  assert.equal(o.top, null);
  assert.ok(o.days.slice(1).every(d => spotDayBest(noWaves, d.day)?.complete === false), 'the spot itself still has an (incomplete) day best to show');
});
