// What to say for the SELECTED time — wording depends on whether it's now or a future forecast.
// Uses the real scored timeline and best windows only.
import { time, hour } from '../ui/format.js';

const hourWord = d => hour(d).replace('a', ' AM').replace('p', ' PM');

/**
 * cond: built conditions; s: the selected sample; t: selected time (null = now);
 * w: the best window for the selected day (from bestWindow), or null.
 * Returns { kind: 'go'|'wait'|'prime'|'later'|'weaken'|'none'|'dark'|'nodata', head, sub }.
 */
export function recommendFor(cond, s, t, w) {
  const isNow = !t;
  if (s.score == null) {
    return cond.score.reason === 'not-configured'
      ? { kind: 'none', head: 'Not rated yet', sub: 'This spot has no skim profile yet.' }
      : { kind: 'nodata', head: 'Not enough data', sub: 'The forecast is missing inputs needed for a score at this time.' };
  }
  const at = t || cond.now;
  if (isNow) {
    const g = cond.window;
    if (!g || g.state === 'unknown') return { kind: 'none', head: s.label, sub: '' };
    if (g.state === 'now') return { kind: 'go', head: 'Go now', sub: `Prime skim window until ${time(g.end)}.` };
    return { kind: 'wait', head: 'Wait', sub: `Better conditions expected around ${hourWord(g.bestT)}.` };
  }
  if (!s.daylight) return { kind: 'dark', head: 'After dark', sub: w && w.start > at ? `Best window starts ${time(w.start)}.` : '' };
  if (!w || !w.start) return { kind: 'none', head: s.label, sub: '' };
  if (at >= w.start && at < w.end) return { kind: 'prime', head: 'Prime skim window', sub: `Conditions weaken after ${time(w.end)}.` };
  if (at < w.start) return { kind: 'later', head: 'Better later', sub: `Better conditions expected around ${hourWord(w.bestT)}.` };
  return { kind: 'weaken', head: 'Past the best', sub: `Best was ${time(w.start)} – ${time(w.end)}; conditions weaken after ${time(w.end)}.` };
}
