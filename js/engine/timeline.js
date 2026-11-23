// Pure helpers behind the ONE shared selected forecast time. No DOM, no I/O.
const MIN = 60e3, HOUR = 3600e3;

/**
 * Resolve a requested selection into the shared state value.
 *  - `step` moves relative to the current selection (keyboard).
 *  - `snap(x, dir)` (optional) moves x into an allowed range, e.g. the skim hours (skim.js).
 *  - Clamped to [now, end]; within `snapMs` of now it becomes null, which means "Now / live".
 */
export function resolveSelection({ t = null, step = 0, current = null, now, end, snapMs = 8 * MIN, snap = null }) {
  let x = step ? new Date((current || now).getTime() + step) : t;
  if (!x) return null;
  if (snap) x = snap(x, Math.sign(step));
  if (x > end) { x = new Date(end.getTime()); if (snap) x = snap(x, -1); }
  if (x - now < snapMs) return null;
  return x;
}

/** Shortest-arc interpolation between compass bearings: 355° → 5° passes through 0°, never 180°. */
export function lerpAngle(a, b, f) {
  const d = ((b - a) % 360 + 540) % 360 - 180;
  return ((a + d * f) % 360 + 360) % 360;
}

/**
 * Forecast wind at time t, smoothly between two REAL hourly forecast values (the whole hours
 * either side of t). Speed and gust are linear, direction shortest-arc. If either hour is
 * missing it falls back to the value in force at t: nothing is extrapolated or invented.
 * `at(date)` returns { windMph, gustMph, windFromDeg }.
 */
export function windBetweenHours(at, t) {
  const h0 = new Date(Math.floor(t.getTime() / HOUR) * HOUR), h1 = new Date(h0.getTime() + HOUR);
  const a = at(h0), b = at(h1), here = at(t);
  const f = (t - h0) / HOUR;
  const ok = v => Number.isFinite(v);
  if (!ok(a.windMph) || !ok(b.windMph) || f === 0) return { mph: here.windMph, fromDeg: here.windFromDeg, gustMph: here.gustMph };
  return {
    mph: a.windMph + (b.windMph - a.windMph) * f,
    fromDeg: ok(a.windFromDeg) && ok(b.windFromDeg) ? lerpAngle(a.windFromDeg, b.windFromDeg, f) : here.windFromDeg,
    gustMph: ok(a.gustMph) && ok(b.gustMph) ? a.gustMph + (b.gustMph - a.gustMph) * f : here.gustMph,
  };
}

/**
 * How much to trust a sample's score: 'high' | 'medium' | 'low' | null.
 *  high   — now, every factor present and observed (buoy period + station wind)
 *  medium — forecast within 48 h with every factor present (forecasts carry no wave period)
 *  low    — a factor missing, or more than 48 h ahead
 */
export function confidenceOf(sample, now) {
  if (sample.score == null) return null;
  const ahead = (sample.t - now) / HOUR;
  if ((sample.coverage ?? 1) < 0.999 || ahead > 48) return 'low';
  if (ahead < 0.25 && sample.wind?.source === 'obs' && sample.waves?.source === 'obs') return 'high';
  return 'medium';
}

/** Per-day preview: best skim-hours score (and its tone), or none. */
export function daySummary(timeline, day) {
  const s = timeline.filter(x => x.t >= day.start && x.t < day.end && (x.skimmable ?? x.daylight) && x.score != null);
  if (!s.length) return { best: null, tone: null };
  const b = s.reduce((p, x) => (x.score > p.score ? x : p));
  return { best: b.score, tone: b.tone, bestT: b.t, confidence: b.confidence ?? null };
}
