// NOAA NWPS nearshore wave forecast in the browser: the small per-spot JSON from /api/nwps (one
// download shared by every spot), plus the explicit fallback policy:
//   1. the newest complete run;
//   2. if that run can't be loaded, the PREVIOUS run — labelled `fallback: 'previous-run'`;
//   3. otherwise nothing: waves are "not available" and rated spots get no score.
// No other wave source is substituted, and nothing is extended past the run's last hour.
import { getJSON } from './http.js';

const MIN = 60e3, HOUR = 3600e3;
export const STALE_RUN_MS = 13 * HOUR; // PHI runs every 6 h, posted ~4 h later

/** Shortest-arc interpolation between two bearings. */
const lerpDeg = (a, b, f) => { const d = ((b - a) % 360 + 540) % 360 - 180; return ((a + d * f) % 360 + 360) % 360; };

/**
 * Wrap one run's JSON. at(spotId, t) → { ft, periodS, fromDeg, source: 'model', model, run, ... }
 * or null: between two real hourly values height/period are linear and direction turns by the
 * shortest arc; outside the run (before its start, after its last hour) or next to a missing
 * hour it is null — never extrapolated.
 */
export function wrapRun(json, { fallback = null, now = Date.now() } = {}) {
  const t0 = Date.parse(json.runTime);
  const age = now - t0;
  const meta = { model: 'NWPS', office: json.office, grid: json.grid, run: json.run, runTime: new Date(t0), fallback, stale: age > STALE_RUN_MS };
  const last = t0 + json.maxFh * HOUR;
  return {
    ...meta,
    end: new Date(last),
    has: id => !!json.points?.[id],
    point: id => json.points?.[id] || null,
    at(id, t) {
      const p = json.points?.[id];
      if (!p) return null;
      const x = (t.getTime() - t0) / HOUR;
      if (!(x >= 0) || x > json.maxFh) return null;
      const h0 = Math.floor(x), h1 = Math.min(json.maxFh, h0 + 1), f = x - h0;
      const ok = h => p.hs[h] != null && p.tp[h] != null && p.dp[h] != null;
      if (!ok(h0) || (f > 0 && !ok(h1))) return null;
      const m = (a, b) => a + (b - a) * f;
      const hsM = f > 0 ? m(p.hs[h0], p.hs[h1]) : p.hs[h0];
      return {
        ft: hsM * 3.28084,
        periodS: f > 0 ? m(p.tp[h0], p.tp[h1]) : p.tp[h0],
        fromDeg: f > 0 ? lerpDeg(p.dp[h0], p.dp[h1], f) : p.dp[h0],
        source: 'model', ...meta,
      };
    },
  };
}

/** Newest run, or the previous one as an explicit fallback. Rejects when neither loads. */
export async function nwpsForecast({ get = getJSON, now = Date.now() } = {}) {
  const list = await get('/api/nwps', { ttlMs: 10 * MIN });
  const load = run => get(`/api/nwps?run=${run}`, { ttlMs: 2 * 24 * HOUR });
  try {
    if (!list?.latest) throw new Error('no run');
    return wrapRun(await load(list.latest), { now });
  } catch (e) {
    if (list?.previous) return wrapRun(await load(list.previous), { fallback: 'previous-run', now });
    throw e;
  }
}
