// Tide curve from NOAA high/low predictions.
// Between consecutive high/low events the height follows a half-cosine, the
// standard way to draw a tide curve from hi/lo predictions (NOAA subordinate
// stations only publish hi/lo times). Accurate to a few hundredths of a foot
// for shape; the hi/lo values themselves are NOAA's.

const HOUR = 3600e3;

/** events: [{ t: Date, v: number(ft), type: 'H'|'L' }] sorted by time */
export function makeTide(events) {
  const ev = (events || []).filter(e => e && e.t instanceof Date && Number.isFinite(e.v)).sort((a, b) => a.t - b.t);

  function bracket(t) {
    for (let i = 0; i < ev.length - 1; i++) if (ev[i].t <= t && t <= ev[i + 1].t) return [ev[i], ev[i + 1]];
    return null;
  }

  function at(t) {
    const b = bracket(t);
    if (!b) return null;
    const [e0, e1] = b;
    const span = e1.t - e0.t;
    const x = Math.PI * (t - e0.t) / span;
    const height = (e0.v + e1.v) / 2 + (e0.v - e1.v) / 2 * Math.cos(x);
    const rateFtHr = (e1.v - e0.v) / 2 * Math.sin(x) * Math.PI / (span / HOUR);
    const lo = Math.min(e0.v, e1.v), hi = Math.max(e0.v, e1.v);
    const phase = hi > lo ? (height - lo) / (hi - lo) : 0.5; // 0 = low, 1 = high
    return { height, rateFtHr, rising: e1.type === 'H', phase, prev: e0, next: e1 };
  }

  const nextOf = (t, type) => ev.find(e => e.t > t && e.type === type) || null;

  return { events: ev, at, nextHigh: t => nextOf(t, 'H'), nextLow: t => nextOf(t, 'L'), covers: t => !!bracket(t) };
}

/** The tide curve as drawn and read out (chart, tide reading, dock). Where NOAA publishes 6-minute
 *  predictions for the station they are used directly; elsewhere (subordinate stations, which only
 *  have hi/lo predictions) the curve is the hi/lo interpolation above. Display only: the Pirate
 *  Score keeps using `makeTide`. The highs and lows listed are always NOAA's hi/lo predictions.
 *  Returns { source: 'noaa6'|'hilo', start, end, at(t) → { height, rising, rateFtHr } | null, events }. */
export function makeTideCurve(series, tide) {
  if (!tide) return null;
  const ok = series && series.v && series.v.length > 1 && series.step > 0;
  if (!ok) {
    const ev = tide.events;
    if (ev.length < 2) return null;
    return { source: 'hilo', start: ev[0].t.getTime(), end: ev.at(-1).t.getTime(), events: ev,
      at(t) { const s = tide.at(t instanceof Date ? t : new Date(t)); return s && { height: s.height, rising: s.rising, rateFtHr: s.rateFtHr }; } };
  }
  const { t0, step, v } = series, n = v.length, end = t0 + step * (n - 1);
  return { source: 'noaa6', start: t0, end, events: tide.events,
    at(t) {
      const ms = +t; if (!(ms >= t0 && ms <= end)) return null;
      const x = (ms - t0) / step, i = Math.min(n - 2, Math.floor(x)), f = x - i;
      const height = v[i] + (v[i + 1] - v[i]) * f;
      // slope over ±12 min, so the arrow and rate don't flicker on a flat crest
      const a = v[Math.max(0, i - 1)], b = v[Math.min(n - 1, i + 2)];
      const rate = (b - a) / ((Math.min(n - 1, i + 2) - Math.max(0, i - 1)) * step / HOUR);
      return { height, rising: rate > 0, rateFtHr: rate };
    } };
}
