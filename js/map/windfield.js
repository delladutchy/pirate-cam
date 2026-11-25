// Wind field = anything with `sample(lat, lon) → { u, v, mph }` (mph, u east / v north, travel direction).
// The particle renderer only depends on that interface, so a real gridded source
// (e.g. many NWS gridpoints, or a NOAA model grid) can replace this later.
//
// CURRENT SOURCE IS SPOT-BASED, NOT A REGIONAL MODEL:
// Pirate View loads wind for each skim spot (NWS 2.5 km gridpoint forecast / NOAA CO-OPS
// observation). This field blends those few real points by inverse-distance weighting:
// right at a spot you see that spot's wind; between spots, a distance-weighted blend; far
// away, the overall blend. It does not model coastal effects, fronts, or terrain.

const R = 6371; // km

function km(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180;
  const x = (lon2 - lon1) * toR * Math.cos((lat1 + lat2) / 2 * toR), y = (lat2 - lat1) * toR;
  return Math.hypot(x, y) * R;
}

export function createSpotField(points) {
  if (!points || !points.length) return null;
  return {
    kind: 'spot-idw',
    points,
    sample(lat, lon) {
      let wu = 0, wv = 0, ws = 0, wsum = 0;
      for (const p of points) {
        const d = km(lat, lon, p.lat, p.lon);
        if (d < 0.05) return { u: p.u, v: p.v, mph: p.mph };
        const w = 1 / (d * d);
        wu += p.u * w; wv += p.v * w; ws += p.mph * w; wsum += w;
      }
      const u = wu / wsum, v = wv / wsum;
      // Keep the blended speed as the weighted mean speed (averaging opposing vectors
      // would otherwise invent calm air between spots).
      const mag = Math.hypot(u, v) || 1, mph = ws / wsum;
      return { u: u / mag * mph, v: v / mag * mph, mph };
    },
  };
}
