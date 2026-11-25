// Turns raw source data into what the screen needs: current conditions (each
// tagged obs / fcst / est), a 15-minute score timeline through day 7 (each step marked
// with whether it falls inside the PirateCast hours, 1 h before sunrise → 1 h after sunset), the best window and a
// notification-ready summary. Pure: no fetching.
import { makeTide } from './tide.js';
import { daylightRanges, isDaylight } from './sun.js';
import { skimRanges, isSkimmable } from './skim.js';
import { scoreSample, bestWindow, buildSummary } from './score.js';
import { dayStart } from './days.js';
import { windBetweenHours, confidenceOf } from './timeline.js';

const MIN = 60e3, HOUR = 3600e3;
const fresh = (t, ms, now) => t && now - t.getTime() < ms;
const num = v => (Number.isFinite(v) ? v : null);

/** Shorebreak energy proxy H²·T (Pirate View estimate, only from observed buoy data). */
export function shorebreakEnergy(ft, periodS) {
  if (!Number.isFinite(ft) || !Number.isFinite(periodS)) return null;
  const e = ft * ft * periodS;
  return { value: e, label: e < 12 ? 'Low' : e < 50 ? 'Moderate' : 'Strong' };
}

export function buildConditions(spot, data, now = new Date()) {
  const tide = data.tideEvents ? makeTide(data.tideEvents) : null;
  // Forecast runs through 7 Delaware-time days (today + 6) so each day tab covers whole days.
  // Farther-out hours simply lack inputs (e.g. waves) and are scored or not on what exists.
  const from = new Date(now.getTime() - 6 * HOUR), to = dayStart(now, 7);
  const daylight = daylightRanges(from, to, spot.lat, spot.lon);
  const skim = skimRanges(daylight); // PirateCast hours: 1 h before sunrise → 1 h after sunset, this spot's own sun times
  const grid = data.grid;
  const g = t => (grid ? grid.at(t) : {});
  const tideAt = t => (tide && tide.covers(t) ? tide.at(t) : null);
  // Waves for the score: the NWPS nearshore model wherever the spot has an NWPS point — the same
  // source now and in the future, so there is no jump between "now" and the next step. If the
  // model is unavailable those hours have no waves (no other source is swapped in). Spots without
  // an NWPS point (Ocean City, unrated) keep the NWS wave grid, labelled as such.
  const usesNwps = !!spot.sources?.nwps;
  const nw = usesNwps ? data.nwps : null;
  const modelWaves = t => (nw ? nw.at(spot.id, t) : null);
  const nwsWaves = f => (f.waveFt != null ? { ft: f.waveFt, periodS: null, fromDeg: null, source: 'fcst' } : null);
  const waveAt = (t, f) => (usesNwps ? modelWaves(t) : nwsWaves(f));

  // ---- current conditions, observed first, forecast as fallback ----
  const g0 = g(now);
  const ow = data.obsWind;
  const wind = ow ? { mph: ow.mph, fromDeg: num(ow.fromDeg), gustMph: num(ow.gustMph), source: 'obs', t: ow.t }
    : g0.windMph != null ? { mph: g0.windMph, fromDeg: num(g0.windFromDeg), gustMph: num(g0.gustMph), source: 'fcst' } : null;

  const b = data.buoy;
  // Observed buoy waves are shown as observations (details, shorebreak estimate); for NWPS spots
  // they are not mixed into the score, which uses the model consistently (see waveAt).
  const buoyWaves = b && b.waveHeightFt != null && fresh(b.observedAt, 3 * HOUR, now)
    ? { ft: b.waveHeightFt, periodS: num(b.dominantPeriodS), fromDeg: num(b.waveFromDeg), source: 'obs', t: b.observedAt } : null;
  const waveModelNow = modelWaves(now);
  const waves = usesNwps ? buoyWaves : buoyWaves || nwsWaves(g0); // current.waves: the observation (model is current.waveModel)
  const scoreWavesNow = usesNwps ? waveModelNow : waves;

  const water = b && b.waterTempF != null && fresh(b.waterObservedAt, 3 * HOUR, now)
    ? { f: b.waterTempF, source: 'obs', where: spot.sources.buoyName }
    : data.coopsWater ? { f: data.coopsWater.f, source: 'obs', where: spot.sources.obsName } : null;

  const air = data.obsAir ? { f: data.obsAir.f, source: 'obs', where: spot.sources.obsName }
    : g0.tempF != null ? { f: g0.tempF, source: 'fcst', where: 'NWS forecast' } : null;

  const tideNow = tideAt(now);
  const current = {
    wind, waves, water, air, waveModel: waveModelNow, waveModelInfo: nw ? { run: nw.run, runTime: nw.runTime, fallback: nw.fallback, stale: nw.stale, end: nw.end } : null, usesNwps,
    tide: tideNow ? { ...tideNow, source: 'fcst', nextHigh: tide.nextHigh(now), nextLow: tide.nextLow(now) } : null,
    energy: waves && waves.source === 'obs' ? shorebreakEnergy(waves.ft, waves.periodS) : null,
    pop: num(g0.pop), daylight: isDaylight(now, daylight),
  };
  const wxFields = f => ({ sky: num(f.sky), wx: typeof f.wx === 'string' && f.wx ? f.wx : null });

  const nowSample = {
    t: now, tide: tideNow, wind, waves: scoreWavesNow, pop: current.pop, thunder: num(g0.thunder), daylight: current.daylight,
    skimmable: isSkimmable(now, skim), airF: air ? air.f : null, ...wxFields(g0),
  };
  const nowScore = scoreSample(spot.profile, nowSample);

  // ---- timeline: 15-minute steps through day 7. Future steps use forecasts only. ----
  const timeline = [{ ...nowSample, ...pickScore(nowScore) }];
  const start = Math.ceil(now.getTime() / (15 * MIN)) * 15 * MIN;
  for (let ms = start; ms < to.getTime(); ms += 15 * MIN) {
    const t = new Date(ms), f = g(t);
    // wind turns smoothly between two real hourly NWS values (shortest arc), never extrapolated
    const w = grid && f.windMph != null ? windBetweenHours(x => grid.at(x), t) : null;
    const s = {
      t, tide: tideAt(t),
      wind: w && Number.isFinite(w.mph) ? { mph: w.mph, fromDeg: num(w.fromDeg), gustMph: num(w.gustMph), source: 'fcst' } : null,
      waves: waveAt(t, f),
      pop: num(f.pop), thunder: num(f.thunder), daylight: isDaylight(t, daylight),
      skimmable: isSkimmable(t, skim), airF: num(f.tempF), ...wxFields(f),
    };
    timeline.push({ ...s, ...pickScore(scoreSample(spot.profile, s)) });
  }


  for (const x of timeline) x.confidence = confidenceOf(x, now);

  // The main Best Window / Go-Wait call keeps its 3-day horizon; the extra days feed the
  // weekly outlook and PirateCast. Windows only ever fall inside skim hours (score.js).
  const horizon = dayStart(now, 3);
  const window = nowScore.score == null ? { state: 'unknown' } : bestWindow(timeline.filter(x => x.t < horizon));
  return {
    spot, now, current, score: nowScore, timeline, window, daylight, skim, hours: skim, tide,
    range: { from, to }, status: data.status,
    summary: buildSummary(spot, nowScore, window),
  };
}

function pickScore(r) { return { score: r.score, label: r.label, tone: r.tone, reasons: r.reasons || [], reason: r.reason, missing: r.missing || null, coverage: r.confidence, factors: r.factors || null }; }
