// Map data model (no map UI yet — see docs/MAP.md).
// Turns loaded conditions into what a real geographic map needs: one marker per
// skim spot with its Pirate Score and wind at a chosen forecast time, synced with
// PirateCast's selected time. Pure function; no I/O, no map library.

/** results: { [spotId]: conditions | 'error' }; t: Date (null = now) */
export function mapMarkers(spots, results, t = null) {
  return spots.map(spot => {
    const r = results[spot.id];
    if (!r || r === 'error') return { id: spot.id, name: spot.name, lat: spot.lat, lon: spot.lon, score: null };
    const s = t ? nearest(r.timeline, t) : r.timeline[0];
    return {
      id: spot.id, name: spot.name, lat: spot.lat, lon: spot.lon,
      score: s.score, label: s.label ?? null, tone: s.tone ?? null,
      windMph: s.wind?.mph ?? null, windFromDeg: s.wind?.fromDeg ?? null, t: s.t,
    };
  });
}

/** Wind vectors for a particle/flow layer: u/v in mph, "to" direction (meteorological from + 180). */
export function windVectors(markers) {
  return markers.filter(m => Number.isFinite(m.windMph) && Number.isFinite(m.windFromDeg)).map(m => {
    const to = (m.windFromDeg + 180) * Math.PI / 180;
    return { lat: m.lat, lon: m.lon, u: m.windMph * Math.sin(to), v: m.windMph * Math.cos(to) };
  });
}

function nearest(timeline, t) {
  let best = timeline[0], d = Infinity;
  for (const s of timeline) { const x = Math.abs(s.t - t); if (x < d) { d = x; best = s; } }
  return best;
}
