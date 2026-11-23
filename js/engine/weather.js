// Weather wording for the time-aligned weather row and the weekly outlook — straight from the
// NWS gridpoint forecast already loaded for each spot (skyCover % and the coded `weather`
// field). Nothing is guessed: a missing value stays missing. Pure.

// NWS `weather` codes → short words (daytime wording; skim hours are always daylight).
const WX = {
  thunderstorms: 'T-storms', rain_showers: 'Showers', rain: 'Rain', drizzle: 'Drizzle',
  snow_showers: 'Snow showers', snow: 'Snow', freezing_rain: 'Freezing rain', freezing_drizzle: 'Freezing drizzle',
  sleet: 'Sleet', fog: 'Fog', freezing_fog: 'Freezing fog', haze: 'Haze', smoke: 'Smoke', blowing_snow: 'Blowing snow',
  dust: 'Dust', blowing_dust: 'Blowing dust', ice_fog: 'Ice fog', frost: 'Frost', hail: 'Hail', spray: 'Spray',
};
// Precipitation outranks obstructions (fog, haze): it's what decides a session.
const RANK = ['thunderstorms', 'freezing_rain', 'sleet', 'snow', 'snow_showers', 'rain', 'rain_showers', 'freezing_drizzle', 'drizzle', 'hail', 'fog', 'freezing_fog', 'ice_fog', 'haze', 'smoke', 'blowing_snow', 'dust', 'blowing_dust', 'frost', 'spray'];
// Coverage words that mean "probably not": they don't replace the sky wording on their own.
const UNLIKELY = new Set(['slight_chance', 'isolated', 'chance', 'scattered']);

/** Compress an NWS `weather` value (array of {coverage, weather}) to "weather:coverage" — the
 *  most significant entry — or '' for none. Small and JSON-safe for the forecast cache. */
export function wxCode(items) {
  const xs = (Array.isArray(items) ? items : []).filter(x => x && x.weather);
  if (!xs.length) return '';
  const r = w => { const i = RANK.indexOf(w); return i < 0 ? RANK.length : i; };
  const top = xs.reduce((a, b) => (r(b.weather) < r(a.weather) ? b : a));
  return `${top.weather}:${top.coverage || ''}`;
}

/** NWS sky-cover wording by eighths (okta): 0 Sunny, 1–2 Mostly sunny, 3–5 Partly sunny,
 *  6–7 Mostly cloudy, 8 Cloudy. */
export function skyText(pct) {
  if (!Number.isFinite(pct)) return null;
  const okta = Math.round(pct / 12.5);
  return okta <= 0 ? 'Sunny' : okta <= 2 ? 'Mostly sunny' : okta <= 5 ? 'Partly sunny' : okta <= 7 ? 'Mostly cloudy' : 'Cloudy';
}

/** One short condition for a forecast hour: a likely weather type, else the sky. null if
 *  neither is available. ("Chance of showers" stays with the sky words; the precipitation
 *  probability is shown next to it as a number.) */
export function conditionText(sky, code) {
  const [w, cov] = (code || '').split(':');
  if (w && WX[w] && !UNLIKELY.has(cov)) return WX[w];
  return skyText(sky) || (w && WX[w]) || null;
}
