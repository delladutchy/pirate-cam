// WEEKLY SKIM OUTLOOK — "Where and when should I skim that day?" across every RATED spot.
// Three different questions, three different answers (none of them changes how a score is made):
//   Best Next Window — earliest good-enough opportunity for one spot (score.js bestWindow)
//   Day's Best       — highest skim-hours score of one day at one spot (spotDayBest)
//   Best This Week   — highest Day's Best across all rated spots and days (weekOutlook().top)
// NOT RATED spots (no skim profile) and spots whose data failed never compete. Pure.
import { dayBestWindow } from './score.js';
import { forecastDays } from './days.js';

/** A loaded result for a spot with a skim profile. */
export const isRated = r => !!r && r !== 'error' && r.score?.reason !== 'not-configured';

/** One spot's DAY'S BEST for `day`: the window around its highest skim-hours score from now on,
 *  or null (no skim hours left, or no scores). The same window drives PirateCast's BEST band. */
export function spotDayBest(cond, day) {
  const ds = cond.timeline.filter(s => s.t >= day.start && s.t < day.end && s.t >= cond.now);
  if (ds.length < 3) return null;
  const w = dayBestWindow(ds);
  return w.state === 'unknown' ? null : w;
}

/**
 * results: { [spotId]: conditions | 'error' }, spots: config order (breaks ties).
 * Returns { days: [{ day, best: { spot, w, sample } | null }], top: { dayIndex, spot, w, sample } | null, rated }
 * or null when no rated spot has loaded. Ties: higher score, then earlier time, then spot order.
 */
export function weekOutlook(results, spots, count = 7) {
  const rated = spots.filter(s => isRated(results[s.id]));
  if (!rated.length) return null;
  const ref = results[rated[0].id];
  const days = forecastDays(ref.timeline, ref.now, count);
  const better = (a, b) => !b || a.w.bestScore > b.w.bestScore || (a.w.bestScore === b.w.bestScore && a.w.bestT < b.w.bestT);
  const out = days.map(day => {
    let best = null;
    for (const spot of rated) {
      const w = spotDayBest(results[spot.id], day);
      if (!w) continue;
      const c = { spot, w, sample: w.peak };
      if (better(c, best)) best = c;
    }
    return { day, best };
  });
  let top = null;
  out.forEach((d, i) => { if (d.best && better(d.best, top)) top = { dayIndex: i, ...d.best }; });
  return { days: out, top, rated: rated.map(s => s.id) };
}
