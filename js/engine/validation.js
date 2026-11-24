// The record local validation will store (Part of the plan in the 2026-11-24 audit): what Pirate
// View predicted for a spot at a time, with its inputs, sources and factor values, plus a human
// skim rating once someone gives one. Pure: building the record stores nothing anywhere.
export const RATINGS = ['FIRING', 'GOOD', 'MEH', 'BAD'];

const r = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

export function validationRecord(cond, s, rating = null) {
  if (rating != null && !RATINGS.includes(rating)) throw new Error('unknown rating');
  const q = k => r(s.factors?.find(f => f.key === k)?.q, 3);
  return {
    spot: cond.spot.id, t: s.t.toISOString(), recordedAt: new Date().toISOString(),
    waves: s.waves ? { ft: r(s.waves.ft), periodS: r(s.waves.periodS), fromDeg: r(s.waves.fromDeg, 0), source: s.waves.source, model: s.waves.model || null, run: s.waves.run || null, fallback: s.waves.fallback || null } : null,
    wind: s.wind ? { mph: r(s.wind.mph), fromDeg: r(s.wind.fromDeg, 0), gustMph: r(s.wind.gustMph), source: s.wind.source } : null,
    tide: s.tide ? { ft: r(s.tide.height, 2), phase: r(s.tide.phase, 2), rising: s.tide.rising } : null,
    score: s.score ?? null, label: s.label ?? null, reason: s.reason ?? null, confidence: s.confidence ?? null,
    factors: { tide: q('tide'), wind: q('wind'), waves: q('waves') },
    buoy: cond.current?.waves?.source === 'obs' ? { ft: cond.current.waves.ft, periodS: cond.current.waves.periodS, fromDeg: cond.current.waves.fromDeg, t: cond.current.waves.t } : null,
    rating,
  };
}
