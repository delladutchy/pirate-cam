// Pirate View Skim Score — 0 to 10, built for skimboarding (shorebreak, tide
// position, light/offshore wind), not surfing. Pure functions, no I/O.
//
// Every factor returns quality 0..1 or null (data missing OR the spot's profile
// leaves it unconfigured). A spot is scored only when EVERY factor its profile configures has
// data: a missing input (e.g. no wave forecast) gives no score — { score: null, reason:
// 'incomplete', missing: [...] } — instead of re-weighting the others upward, which used to
// make incomplete hours look better than complete ones. Nothing is guessed or zero-filled.

export const LABELS = [
  { min: 9, label: 'FIRING', tone: 'firing' },
  { min: 8, label: 'VERY GOOD', tone: 'great' },
  { min: 7, label: 'GOOD', tone: 'good' },
  { min: 6, label: 'DECENT', tone: 'ok' },
  { min: 5, label: 'MAYBE', tone: 'maybe' },
  { min: -1, label: 'POOR', tone: 'poor' },
];
export const labelFor = s => LABELS.find(l => s >= l.min);

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; };
const inArc = (deg, [from, to]) => from <= to ? deg >= from && deg <= to : deg >= from || deg <= to;

/** Wind relative to the beach: 'offshore' | 'cross-shore' | 'onshore' | 'calm', or null when the
 *  spot's orientation isn't configured. Wind direction is meteorological (where it blows FROM). */
export function windRelation(shoreFacingDeg, wind) {
  if (!wind || !Number.isFinite(wind.mph)) return null;
  if (wind.mph < 3) return 'calm';
  if (shoreFacingDeg == null || !Number.isFinite(wind.fromDeg)) return null;
  const d = angDiff(wind.fromDeg, shoreFacingDeg + 180); // 0 = straight offshore
  return d <= 45 ? 'offshore' : d >= 135 ? 'onshore' : 'cross-shore';
}

export function tideFactor(cfg, tide) {
  if (!cfg || !tide) return null;
  const [a, b] = cfg.idealPhase, p = tide.phase;
  const off = p < a ? a - p : p > b ? p - b : 0;
  let q = clamp(1 - off / 0.3);
  const why = [];
  if (off === 0) why.push(['+', 'Tide in the sweet spot']);
  else why.push(['-', p < a ? (q > 0.5 ? 'Tide a little low' : 'Tide too low') : (q > 0.5 ? 'Tide a little high' : 'Tide too high')]);
  if (cfg.preferRising != null) {
    if (tide.rising === cfg.preferRising) why.push(['+', tide.rising ? 'Incoming tide' : 'Outgoing tide']);
    else { q *= 0.8; why.push(['-', tide.rising ? 'Incoming tide' : 'Outgoing tide']); }
  }
  if (cfg.maxRateFtHr && Math.abs(tide.rateFtHr) > cfg.maxRateFtHr) {
    q *= clamp(1 - (Math.abs(tide.rateFtHr) - cfg.maxRateFtHr) / cfg.maxRateFtHr, 0.5, 1);
    why.push(['-', 'Strong tidal current']);
  }
  return { key: 'tide', q, why };
}

export function windFactor(cfg, shoreFacingDeg, wind) {
  if (!cfg || !wind || !Number.isFinite(wind.mph)) return null;
  const { mph } = wind, max = cfg.maxGoodMph;
  let q = mph <= 5 ? 1 : mph <= max ? 1 - 0.35 * (mph - 5) / (max - 5) : clamp(0.65 - 0.65 * (mph - max) / max);
  const why = [];
  let comp = 0;
  if (shoreFacingDeg != null && Number.isFinite(wind.fromDeg) && mph > 1) {
    comp = Math.cos(angDiff(wind.fromDeg, shoreFacingDeg + 180) * Math.PI / 180); // +1 offshore, -1 onshore
    if (comp < 0 && cfg.shelteredFrom && inArc(wind.fromDeg, cfg.shelteredFrom)) comp = 0;
    if (comp < 0 && mph > 4) q *= 1 + comp * Math.min(1, mph / max) * 0.6;
  }
  if (mph > max) why.push(['-', 'Too windy']);
  else if (mph <= 5) why.push(['+', comp > 0.5 ? 'Light offshore wind' : 'Light wind']);
  else if (comp > 0.5) why.push(['+', 'Offshore wind']);
  if (comp < -0.5 && mph > 6) why.push(['-', 'Onshore wind']);
  if (Number.isFinite(wind.gustMph) && wind.gustMph - mph > 8) {
    q *= clamp(1 - (wind.gustMph - mph - 8) / 20, 0.7, 1);
    why.push(['-', 'Gusty']);
  }
  return { key: 'wind', q: clamp(q), why };
}

export function wavesFactor(cfg, shoreFacingDeg, waves) {
  if (!cfg || !waves || !Number.isFinite(waves.ft)) return null;
  const { min, idealMin, idealMax, max } = cfg.ft, ft = waves.ft;
  let q = ft < min ? clamp(ft / min * 0.4)
    : ft < idealMin ? 0.4 + 0.6 * (ft - min) / (idealMin - min)
    : ft <= idealMax ? 1
    : ft <= max ? 1 - 0.6 * (ft - idealMax) / (max - idealMax)
    : clamp(0.4 - 0.4 * (ft - max) / max);
  const why = [];
  if (ft >= idealMin && ft <= idealMax) why.push(['+', 'Good shorebreak size']);
  else why.push(['-', ft < idealMin ? 'Small shorebreak' : 'Big, heavy surf']);
  if (cfg.periodS && Number.isFinite(waves.periodS)) {
    const T = waves.periodS, { idealMin: pa, idealMax: pb } = cfg.periodS;
    if (T < pa - 2) { q *= 0.85; why.push(['-', 'Short, choppy waves']); }
    else if (T < pa) q *= 0.93;
    else if (T > pb + 3) q *= 0.95;
    else why.push(['+', 'Clean wave period']);
  }
  if (shoreFacingDeg != null && Number.isFinite(waves.fromDeg) && angDiff(waves.fromDeg, shoreFacingDeg) > 70) {
    q *= 0.85; why.push(['-', 'Waves arriving at a sharp angle']);
  }
  return { key: 'waves', q: clamp(q), why };
}

/**
 * sample: { tide, wind, waves, pop, thunder, daylight }
 * returns { score, label, tone, reasons, factors, confidence } | { score: null, reason }
 */
export function scoreSample(profile, s) {
  if (!profile || (!profile.tide && !profile.wind && !profile.waves)) return { score: null, reason: 'not-configured' };
  const w = profile.weights;
  const factors = [
    tideFactor(profile.tide, s.tide),
    windFactor(profile.wind, profile.shoreFacingDeg, s.wind),
    wavesFactor(profile.waves, profile.shoreFacingDeg, s.waves),
  ].filter(Boolean);
  const missing = ['tide', 'wind', 'waves'].filter(k => profile[k] && !factors.some(f => f.key === k));
  if (missing.length) return { score: null, reason: 'incomplete', missing };
  const wsum = factors.reduce((a, f) => a + w[f.key], 0);
  let score = 10 * factors.reduce((a, f) => a + f.q * w[f.key], 0) / wsum;
  // One bad factor (e.g. strong onshore wind) should limit the session, not be averaged away.
  score *= 0.6 + 0.4 * Math.min(...factors.map(f => f.q));

  const extra = [];
  if (Number.isFinite(s.pop) && s.pop >= 70) { score -= 1.5; extra.push(['-', 'Rain likely', 1]); }
  else if (Number.isFinite(s.pop) && s.pop >= 40) { score -= 0.6; extra.push(['-', 'Chance of rain', 0.5]); }
  if (Number.isFinite(s.thunder) && s.thunder >= 25) { score = Math.min(score, 3); extra.push(['-', 'Thunderstorms possible', 2]); }
  if (s.daylight === false) { score = Math.min(score, 2); extra.push(['-', 'After dark', 3]); }
  score = Math.round(clamp(score, 0, 10) * 10) / 10;

  // Rank reasons by how much each factor helped or hurt, keep it short. A "+" detail of a factor
  // that is itself weak (q < 0.5 — e.g. "Incoming tide" while the tide is far too high) is not
  // shown as a plus: it isn't what the score is made of.
  const ranked = [];
  for (const f of factors) for (const [sign, text] of f.why) {
    if (sign === '+' && f.q < 0.5) continue;
    ranked.push({ sign, text, weight: (sign === '+' ? f.q : 1 - f.q) * w[f.key] + (sign === '+' ? 0 : 0.01) });
  }
  for (const [sign, text, weight] of extra) ranked.push({ sign, text, weight });
  const pos = ranked.filter(r => r.sign === '+').sort((a, b) => b.weight - a.weight).slice(0, 3);
  const neg = ranked.filter(r => r.sign === '-').sort((a, b) => b.weight - a.weight).slice(0, 3);
  const L = labelFor(score);
  return { score, label: L.label, tone: L.tone, reasons: [...pos, ...neg], factors, confidence: wsum / (w.tide + w.wind + w.waves) };
}

// A sample a window may use: scored and inside the skimmable daylight window (1 h after
// sunrise → 1 h before sunset; skim.js). Samples built without that flag fall back to daylight.
const usable = x => (x.skimmable ?? x.daylight) && x.score != null;

/**
 * samples: [{ t: Date, score, daylight, skimmable }] in time order, first = now.
 * Always returns the strongest upcoming skim-hours opportunity, with its real
 * rating — a POOR best window is still shown, labelled as POOR.
 *  - Prefers the SOONEST stretch close to the best of the period, so
 *    "this afternoon" beats "slightly better tomorrow".
 *  - state: 'now' (window includes now) | 'next' | 'unknown' (no skim-hours scores)
 */
export function bestWindow(samples) {
  const ok = usable;
  const day = samples.filter(ok);
  if (!day.length) return { state: 'unknown' };
  const best = day.reduce((a, b) => (b.score > a.score ? b : a));
  const thr = best.score - 1;
  // first skim-hours stretch reaching within 1 point of the best
  let a = samples.findIndex(x => ok(x) && x.score >= thr);
  let b = a;
  while (b < samples.length - 1 && ok(samples[b + 1]) && samples[b + 1].score >= thr) b++;
  const peak = samples.slice(a, b + 1).reduce((p, x) => (x.score > p.score ? x : p));
  return windowAround(samples, peak);
}

/**
 * DAY'S BEST: the window around the single highest-scoring skim-hours moment of `samples`
 * (one day). Ties go to the earlier moment. Same tightening as bestWindow. Used for the
 * day buttons, the day graph's BEST band and day-specific wording; bestWindow (earliest
 * good-enough opportunity) stays the "Best next window" / Go-Wait logic.
 */
export function dayBestWindow(samples) {
  const ok = usable;
  const day = samples.filter(ok);
  if (!day.length) return { state: 'unknown' };
  const peak = day.reduce((a, b) => (b.score > a.score ? b : a)); // strict > keeps the earliest tie
  return windowAround(samples, peak);
}

// Tighten a window around its peak: neighbouring skim-hours samples within 0.7 of the peak.
function windowAround(samples, peak) {
  const ok = usable;
  const near = peak.score - 0.7;
  const pi = samples.indexOf(peak);
  let a = pi, b = pi;
  while (a > 0 && ok(samples[a - 1]) && samples[a - 1].score >= near) a--;
  while (b < samples.length - 1 && ok(samples[b + 1]) && samples[b + 1].score >= near) b++;
  // samples[0] is 'now' (irregular); the rest are evenly spaced
  const step = samples.length > 2 ? samples[2].t - samples[1].t : 15 * 60e3;
  const start = samples[a].t, end = new Date(samples[b].t.getTime() + step);
  const L = labelFor(peak.score);
  const nowScore = samples[0].score;
  return {
    state: a === 0 ? 'now' : 'next', start, end,
    bestScore: peak.score, bestT: peak.t, label: L.label, tone: L.tone, peak,
    trend: nowScore == null || a === 0 ? null : peak.score > nowScore + 0.2 ? 'up' : peak.score < nowScore - 0.2 ? 'down' : 'flat',
    minutesUntil: Math.round((start - samples[0].t) / 60000),
  };
}

/** Compact, UI-agnostic summary — the shape future notifications will use. */
export function buildSummary(spot, now, window) {
  if (!now || now.score == null) return { spotId: spot.id, name: spot.fullName, score: null };
  return {
    spotId: spot.id, name: spot.fullName, score: now.score, label: now.label,
    reasons: now.reasons.filter(r => r.sign === '+').map(r => r.text),
    window: window && window.start ? { start: window.start, end: window.end, state: window.state, score: window.bestScore, label: window.label } : null,
    headline: now.score >= 9 ? `${spot.name.toUpperCase()} IS ON` : `${spot.name} ${now.score.toFixed(1)} ${now.label}`,
  };
}
