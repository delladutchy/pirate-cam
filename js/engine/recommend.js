// What to say for the SELECTED time — wording depends on whether it's now or a future forecast.
// Uses the real scored timeline and best windows only. The wording follows the existing
// Pirate Score thresholds (score.js LABELS): a day's best hour is only a "Prime skim window"
// when it actually reaches GOOD; weaker best windows are described as what they are.
import { time, hour } from '../ui/format.js';
import { LABELS, labelFor } from './score.js';
import { nextSkimRange } from './skim.js';

const hourWord = d => hour(d).replace('a', ' AM').replace('p', ' PM');
const MIN = Object.fromEntries(LABELS.map(l => [l.label, l.min]));

/** How good a best window really is, from its peak score and the existing thresholds. */
export function windowQuality(w) {
  if (!w || !Number.isFinite(w.bestScore)) return null;
  const s = w.bestScore;
  return s >= MIN.GOOD ? 'good' : s >= MIN.DECENT ? 'decent' : s >= MIN.MAYBE ? 'maybe' : 'poor';
}

const tag = w => `${w.bestScore.toFixed(1)} ${labelFor(w.bestScore).label}`;

/** A best window whose peak was scored with inputs missing (e.g. no wave forecast) can't be
 *  called prime: the score is real but only covers what was available. */
export function windowComplete(w) { return !w || !w.peak || (w.peak.coverage ?? 1) >= 0.999; }
const missingWhat = w => (w.peak && w.peak.waves == null ? 'no wave forecast yet' : 'some forecast inputs are missing');
const partialScore = w => (w.peak && w.peak.waves == null ? `Scores ${tag(w)} on tide & wind; no wave forecast yet.` : `Scores ${tag(w)}; some forecast inputs are missing.`);

/**
 * cond: built conditions; s: the selected sample; t: selected time (null = now);
 * w: the best window for the selected day (from bestWindow), or null.
 * Returns { kind: 'go'|'wait'|'prime'|'best'|'later'|'weaken'|'poor'|'none'|'dark'|'nodata', head, sub }.
 * Outside the skim window the answer is 'dark': darkness is not POOR, it's outside skim hours.
 */
export function recommendFor(cond, s, t, w) {
  const isNow = !t;
  if (cond.score.reason === 'not-configured') return { kind: 'none', head: 'Not rated yet', sub: 'This spot has no skim profile yet.' };
  if (s.skimmable === false) return outsideSkim(cond, s, t || cond.now);
  if (s.score == null) {
    return s.missing?.includes('waves')
      ? { kind: 'nodata', head: 'No wave forecast', sub: 'No nearshore wave forecast for this time, so no Pirate Score.' }
      : { kind: 'nodata', head: 'Not enough data', sub: 'The forecast is missing inputs needed for a score at this time.' };
  }
  const at = t || cond.now;
  if (isNow) {
    const g = cond.window;
    const q = windowQuality(g);
    if (!g || g.state === 'unknown' || !q) return { kind: 'none', head: s.label, sub: '' };
    if (g.state === 'now') {
      if (q === 'good' && !windowComplete(g)) return { kind: 'go', head: 'Go now', sub: `Good until ${time(g.end)}; ${missingWhat(g)}.` };
      if (q === 'good') return { kind: 'go', head: 'Go now', sub: `Prime skim window until ${time(g.end)}.` };
      if (q === 'decent') return { kind: 'go', head: 'Go now', sub: `Decent conditions until ${time(g.end)}.` };
      if (q === 'maybe') return { kind: 'best', head: 'Best available window', sub: `Marginal conditions until ${time(g.end)}.` };
      return { kind: 'poor', head: 'Poor conditions', sub: 'Nothing better is in the forecast.' };
    }
    if (q === 'good') return { kind: 'wait', head: 'Wait', sub: `Better conditions expected around ${hourWord(g.bestT)}.` };
    if (q === 'decent') return { kind: 'wait', head: 'Wait', sub: `Decent conditions expected around ${hourWord(g.bestT)}.` };
    if (q === 'maybe') return { kind: 'wait', head: 'Wait', sub: `Best available around ${hourWord(g.bestT)} (${tag(g)}).` };
    return { kind: 'poor', head: 'Poor conditions', sub: `Best available around ${hourWord(g.bestT)} (${tag(g)}).` };
  }
  const q = windowQuality(w);
  if (!w || !w.start || !q) return { kind: 'none', head: s.label, sub: '' };
  if (at >= w.start && at < w.end) {
    if (q === 'good' && !windowComplete(w)) return { kind: 'best', head: 'Best available window', sub: partialScore(w) };
    if (q === 'good') return { kind: 'prime', head: 'Prime skim window', sub: `Conditions weaken after ${time(w.end)}.` };
    if (q === 'decent') return { kind: 'best', head: 'Best available window', sub: `Decent conditions until ${time(w.end)}.` };
    if (q === 'maybe') return { kind: 'best', head: 'Best available window', sub: `Marginal conditions until ${time(w.end)}.` };
    return { kind: 'poor', head: 'Poor conditions', sub: `The best of the day is still poor (${tag(w)}).` };
  }
  if (at < w.start) {
    if (q === 'good' || q === 'decent') return { kind: 'later', head: 'Better later', sub: `Better conditions expected around ${hourWord(w.bestT)}.` };
    if (q === 'maybe') return { kind: 'later', head: 'Better later', sub: `Best available around ${hourWord(w.bestT)} (${tag(w)}).` };
    return { kind: 'poor', head: 'Poor conditions', sub: `Poor all day; best available around ${hourWord(w.bestT)} (${tag(w)}).` };
  }
  if (q === 'poor') return { kind: 'poor', head: 'Poor conditions', sub: `Poor all day; the best was ${time(w.start)} – ${time(w.end)} (${tag(w)}).` };
  return { kind: 'weaken', head: 'Past the best', sub: `Best was ${time(w.start)} – ${time(w.end)}; conditions weaken after ${time(w.end)}.` };
}

const etDay = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
const dayWord = (d, now) => (etDay(d) === etDay(now) ? 'today' : etDay(d) === etDay(new Date(now.getTime() + 864e5)) ? 'tomorrow' : d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }));

/** Wording for a time outside the PirateCast hours (night): no score, and the next best window
 *  (or when the next PirateCast hours start). */
export function lightWord() { return 'Night'; }
export function outsideSkim(cond, s, at) {
  const r = nextSkimRange(at, cond.skim || []);
  const g = cond.window;
  if (g && g.start && g.bestT > at && windowQuality(g)) return { kind: 'dark', head: 'Next best', sub: `${dayWord(g.bestT, cond.now)} ${hourWord(g.bestT)} (${tag(g)}).` };
  if (r) return { kind: 'dark', head: 'Forecast resumes', sub: `${dayWord(r.start, cond.now)} ${time(r.start)}.` };
  return { kind: 'dark', head: '', sub: '' };
}
