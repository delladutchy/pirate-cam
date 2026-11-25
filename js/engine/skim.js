// PIRATECAST DAY HOURS, per spot and day, from the spot's own sunrise/sunset (sun.js — computed,
// not fetched): exactly 1 h before sunrise → 1 h after sunset. Outside them is night: every hour
// is still forecast and scored (no darkness penalty), and the UI shows night as night (muted
// colours, darker ground, a moon). Best Window, Day's Best, Best Spot and the weekly outlook keep
// to daylight (sunrise → sunset).
// Pure: no DOM, no I/O.
export const SKIM_MARGIN_MS = -3600e3; // negative margin = wider than daylight: sunrise − 1 h → sunset + 1 h

/** Skim windows from daylight ranges ({ sunrise, sunset }), sorted by time. A margin of m moves
 *  the start to sunrise + m and the end to sunset − m (negative = wider). */
export function skimRanges(daylight, margin = SKIM_MARGIN_MS) {
  return daylight
    .map(r => ({ start: new Date(r.sunrise.getTime() + margin), end: new Date(r.sunset.getTime() - margin), sunrise: r.sunrise, sunset: r.sunset }))
    .filter(r => r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

export const isSkimmable = (t, ranges) => ranges.some(r => t >= r.start && t <= r.end);

/** The skim window that starts inside [day.start, day.end), or null. */
export const skimRangeFor = (day, ranges) => ranges.find(r => r.start >= day.start && r.start < day.end) || null;

/** The first skim window that hasn't ended by `t` (the current one, or the next). */
export const nextSkimRange = (t, ranges) => ranges.find(r => r.end >= t) || null;

/**
 * Move `t` into a skim window. Inside one it is returned unchanged. Outside, it goes to the
 * next window's start (dir > 0), the previous window's end (dir < 0), or whichever boundary
 * is closer (dir = 0). Boundaries before `min` (e.g. "now") are never chosen. Stepping back
 * with no earlier window left gives `min` itself (back to "now"); stepping forward past the
 * last window gives the last window's end. Edges are rounded INTO the window on the forecast's
 * 15-minute grid (7:51 → 8:00, 3:42 → 3:30), so a snapped time is always a real forecast step.
 * null when no window qualifies.
 */
export function snapToSkim(t, ranges, { dir = 0, min = null, grid = 15 * 60e3 } = {}) {
  if (!t) return t;
  if (isSkimmable(t, ranges)) return t;
  const ok = x => !min || x >= min;
  const first = r => new Date(Math.ceil(r.start / grid) * grid), last = r => new Date(Math.floor(r.end / grid) * grid);
  const inner = ranges.filter(r => first(r) <= last(r));
  const next = inner.find(r => first(r) > t && ok(first(r)));
  const prev = [...inner].reverse().find(r => last(r) < t && ok(last(r)));
  const fwd = next ? first(next) : null, back = prev ? last(prev) : null;
  if (dir > 0) return fwd || back;
  if (dir < 0) return back || min || fwd;
  if (fwd && back) return t - back <= fwd - t ? back : fwd;
  return fwd || back;
}
