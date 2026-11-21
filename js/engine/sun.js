// Sunrise / sunset (NOAA solar position approximation, ±2 min) — computed, not fetched.
const rad = Math.PI / 180;

export function sunTimes(date, lat, lon) {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const n = Math.ceil((day - Date.UTC(2000, 0, 1, 12)) / 864e5 + 0.0008); // Julian day number since J2000
  const Jstar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jtransit = Jstar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const decl = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  if (cosH < -1 || cosH > 1) return null;
  const H = Math.acos(cosH) / rad / 360;
  const toDate = j => new Date(Date.UTC(2000, 0, 1, 12) + j * 864e5);
  return { sunrise: toDate(Jtransit - H), sunset: toDate(Jtransit + H) };
}

/** Daylight intervals overlapping [from, to] — handles windows that span midnight. */
export function daylightRanges(from, to, lat, lon) {
  const out = [];
  for (let d = new Date(from.getTime() - 864e5); d <= new Date(to.getTime() + 864e5); d = new Date(d.getTime() + 864e5)) {
    const s = sunTimes(d, lat, lon);
    if (s && s.sunset > from && s.sunrise < to) out.push(s);
  }
  return out;
}

export const isDaylight = (t, ranges) => ranges.some(r => t >= r.sunrise && t <= r.sunset);
