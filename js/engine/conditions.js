// Turns raw source data into what the screen needs: current conditions (each
// tagged obs / fcst / est), a 15-minute score timeline for the next 24 h, hourly
// cells, the best window and a notification-ready summary. Pure: no fetching.
import { makeTide } from './tide.js';
import { daylightRanges, isDaylight } from './sun.js';
import { scoreSample, bestWindow, buildSummary } from './score.js';
import { dayStart } from './days.js';

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
  // Forecast runs to the end of the day after tomorrow (Delaware time), so each day view covers whole days.
  const from = new Date(now.getTime() - 6 * HOUR), to = dayStart(now, 3);
  const daylight = daylightRanges(from, to, spot.lat, spot.lon);
  const grid = data.grid;
  const g = t => (grid ? grid.at(t) : {});
  const tideAt = t => (tide && tide.covers(t) ? tide.at(t) : null);

  // ---- current conditions, observed first, forecast as fallback ----
  const g0 = g(now);
  const ow = data.obsWind;
  const wind = ow ? { mph: ow.mph, fromDeg: num(ow.fromDeg), gustMph: num(ow.gustMph), source: 'obs', t: ow.t }
    : g0.windMph != null ? { mph: g0.windMph, fromDeg: num(g0.windFromDeg), gustMph: num(g0.gustMph), source: 'fcst' } : null;

  const b = data.buoy;
  const waves = b && b.waveHeightFt != null && fresh(b.observedAt, 3 * HOUR, now)
    ? { ft: b.waveHeightFt, periodS: num(b.dominantPeriodS), fromDeg: num(b.waveFromDeg), source: 'obs', t: b.observedAt }
    : g0.waveFt != null ? { ft: g0.waveFt, periodS: null, fromDeg: null, source: 'fcst' } : null;

  const water = b && b.waterTempF != null && fresh(b.waterObservedAt, 3 * HOUR, now)
    ? { f: b.waterTempF, source: 'obs', where: spot.sources.buoyName }
    : data.coopsWater ? { f: data.coopsWater.f, source: 'obs', where: spot.sources.obsName } : null;

  const air = data.obsAir ? { f: data.obsAir.f, source: 'obs', where: spot.sources.obsName }
    : g0.tempF != null ? { f: g0.tempF, source: 'fcst', where: 'NWS forecast' } : null;

  const tideNow = tideAt(now);
  const current = {
    wind, waves, water, air,
    tide: tideNow ? { ...tideNow, source: 'fcst', nextHigh: tide.nextHigh(now), nextLow: tide.nextLow(now) } : null,
    energy: waves && waves.source === 'obs' ? shorebreakEnergy(waves.ft, waves.periodS) : null,
    pop: num(g0.pop), daylight: isDaylight(now, daylight),
  };

  const nowSample = {
    t: now, tide: tideNow, wind, waves, pop: current.pop, thunder: num(g0.thunder), daylight: current.daylight,
    airF: air ? air.f : null,
  };
  const nowScore = scoreSample(spot.profile, nowSample);

  // ---- timeline: 15-minute steps to the end of day 3. Future steps use forecasts only. ----
  const timeline = [{ ...nowSample, ...pickScore(nowScore) }];
  const start = Math.ceil(now.getTime() / (15 * MIN)) * 15 * MIN;
  for (let ms = start; ms < to.getTime(); ms += 15 * MIN) {
    const t = new Date(ms), f = g(t);
    const s = {
      t, tide: tideAt(t),
      wind: f.windMph != null ? { mph: f.windMph, fromDeg: num(f.windFromDeg), gustMph: num(f.gustMph) } : null,
      waves: f.waveFt != null ? { ft: f.waveFt, periodS: null, fromDeg: null } : null,
      pop: num(f.pop), thunder: num(f.thunder), daylight: isDaylight(t, daylight),
      airF: num(f.tempF),
    };
    timeline.push({ ...s, ...pickScore(scoreSample(spot.profile, s)) });
  }

  // PirateCast cells: "now" + every whole hour for the next 36 h (night included, dimmed in the UI).
  const etDay = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const hourly = [timeline[0]];
  for (const s of timeline.slice(1)) {
    if (s.t.getMinutes() !== 0 || s.t - now > 36 * HOUR) continue;
    hourly.push({ ...s, newDay: etDay(s.t) !== etDay(hourly[hourly.length - 1].t) });
  }

  const window = nowScore.score == null ? { state: 'unknown' } : bestWindow(timeline);
  return {
    spot, now, current, score: nowScore, timeline, hourly, window, daylight, tide,
    range: { from, to }, status: data.status,
    summary: buildSummary(spot, nowScore, window),
  };
}

function pickScore(r) { return { score: r.score, label: r.label, tone: r.tone, reasons: r.reasons || [], reason: r.reason }; }
