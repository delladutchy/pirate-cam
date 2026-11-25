// Map data model: turns the conditions the app has ALREADY loaded into what the map needs.
// Pure functions — no I/O, no map library. Uses the same selected time as PirateCast.
//
// WIND DIRECTION SEMANTICS (verified against the sources):
//   NOAA CO-OPS `wind.d` and NWS gridpoint `windDirection` are METEOROLOGICAL directions:
//   the compass bearing the wind blows FROM (a "W wind" comes from 270° and moves east).
//   Particles must move the OTHER way, so:   travelBearing = (fromDeg + 180) mod 360
//   As a vector (east = +u, north = +v):      u = mph · sin(travel),  v = mph · cos(travel)
//   e.g. from 270° (W wind) → travel 90° → u = +mph (eastward), v = 0.   ✔

/** Nearest timeline sample (timeline[0] is "now"; the rest are 15-min forecast steps). */
export function sampleAt(timeline, t) {
  if (!t) return timeline[0];
  let best = timeline[0], d = Infinity;
  for (const s of timeline) { const x = Math.abs(s.t - t); if (x < d) { d = x; best = s; } }
  return best;
}

export function toVector(mph, fromDeg) {
  const travel = ((fromDeg + 180) % 360) * Math.PI / 180;
  return { u: mph * Math.sin(travel), v: mph * Math.cos(travel) };
}

/** One marker per configured spot, using the project's own coordinates. At night a marker keeps
 *  its score and is flagged `night` (drawn muted with a moon). */
export function mapMarkers(spots, results, t = null) {
  return spots.map(spot => {
    const r = results[spot.id];
    const base = { id: spot.id, name: spot.name, fullName: spot.fullName, lat: spot.lat, lon: spot.lon };
    if (!r || r === 'error') return { ...base, score: null };
    const s = sampleAt(r.timeline, t);
    return { ...base, score: s.score, label: s.label ?? null, tone: s.tone ?? null, night: s.skimmable === false, windMph: s.wind?.mph ?? null, windFromDeg: s.wind?.fromDeg ?? null };
  });
}

/**
 * Real wind points for the field at time t: each spot's wind exactly as the app shows it
 * (now = NOAA CO-OPS observation, else NWS forecast for that spot's grid cell).
 * Spots without wind data are skipped — never filled in.
 */
export function windPoints(spots, results, t = null) {
  const pts = [];
  for (const spot of spots) {
    const r = results[spot.id];
    if (!r || r === 'error') continue;
    const s = sampleAt(r.timeline, t);
    const w = s.wind;
    if (!w || !Number.isFinite(w.mph) || !Number.isFinite(w.fromDeg)) continue;
    pts.push({ id: spot.id, lat: spot.lat, lon: spot.lon, mph: w.mph, fromDeg: w.fromDeg, source: s === r.timeline[0] ? (w.source || 'obs') : 'fcst', ...toVector(w.mph, w.fromDeg) });
  }
  return pts;
}
