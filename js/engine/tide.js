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
