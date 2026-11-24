// Test stand-in for the NWPS nearshore wave model (js/data/nwps.js wrapRun shape): waves for any
// spot from a function of time. `null` from ftAt = that hour has no model value.
export function fakeNwps(ftAt, { periodS = 8, fromDeg = 100, run = '2026112212', fallback = null, stale = false } = {}) {
  return {
    model: 'NWPS', run, fallback, stale, runTime: new Date('2026-11-22T12:00Z'), end: new Date('2026-11-28T12:00Z'),
    has: () => true,
    at: (id, t) => {
      const ft = ftAt(t, id);
      return Number.isFinite(ft) ? { ft, periodS, fromDeg, source: 'model', model: 'NWPS', run, fallback, stale } : null;
    },
  };
}
