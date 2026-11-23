// NOAA data access, normalised. Each loader resolves to data or null — one
// failing source never blocks the others.
import { getJSON } from './http.js';
import { wxCode } from '../engine/weather.js';

const COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=pirate_view&format=json&units=english&time_zone=gmt';
const KN_TO_MPH = 1.15078, KMH_TO_MPH = 0.621371;
const MIN = 60e3, HOUR = 3600e3;

const ymd = d => d.toISOString().slice(0, 10).replaceAll('-', '');
const coopsTime = s => new Date(s.replace(' ', 'T') + ':00Z'); // time_zone=gmt
const fresh = (t, maxAgeMs) => t && Date.now() - t.getTime() < maxAgeMs;

/** NOAA CO-OPS tide high/low predictions, yesterday → +8 days (curve needs the events either side). */
export async function tideEvents(station) {
  const begin = new Date(Date.now() - 864e5);
  // yesterday → +8 days: covers the 7-day timeline with the hi/lo events either side
  const url = `${COOPS}&product=predictions&interval=hilo&datum=MLLW&station=${station}&begin_date=${ymd(begin)}&range=216`;
  const data = await getJSON(url, { ttlMs: 6 * HOUR });
  return (data.predictions || []).map(p => ({ t: coopsTime(p.t), v: parseFloat(p.v), type: p.type }));
}

async function coopsLatest(station, product) {
  const data = await getJSON(`${COOPS}&product=${product}&date=latest&station=${station}`, { ttlMs: 6 * MIN });
  const row = data.data && data.data[0];
  if (!row) return null;
  const t = coopsTime(row.t);
  return fresh(t, 90 * MIN) ? { row, t } : null; // stale observations are treated as unavailable
}

export async function observedWind(station) {
  const r = await coopsLatest(station, 'wind');
  if (!r || !Number.isFinite(parseFloat(r.row.s))) return null;
  const g = parseFloat(r.row.g);
  return { mph: parseFloat(r.row.s) * KN_TO_MPH, fromDeg: parseFloat(r.row.d), gustMph: Number.isFinite(g) ? g * KN_TO_MPH : null, t: r.t, source: 'obs' };
}

export async function observedTemp(station, product) {
  const r = await coopsLatest(station, product);
  const v = r && parseFloat(r.row.v);
  return Number.isFinite(v) ? { f: v, t: r.t, source: 'obs' } : null;
}

/** Nearshore wave buoy via our serverless function (NDBC has no CORS). */
export async function buoy(station) {
  const d = await getJSON(`/api/buoy?station=${station}`, { ttlMs: 10 * MIN });
  return { ...d, observedAt: d.observedAt ? new Date(d.observedAt) : null, waterObservedAt: d.waterObservedAt ? new Date(d.waterObservedAt) : null };
}

// ---- NWS gridpoint forecast ----

function parseDuration(iso) { // PT1H, P1DT6H
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(iso) || [];
  return ((+m[1] || 0) * 24 + (+m[2] || 0)) * HOUR + (+m[3] || 0) * MIN;
}

export function series(prop, conv = v => v) {
  if (!prop || !Array.isArray(prop.values)) return [];
  return prop.values.filter(x => x.value != null).map(x => {
    const [start, dur] = x.validTime.split('/');
    const s = new Date(start).getTime();
    return { s, e: s + parseDuration(dur), v: conv(x.value) };
  });
}

/**
 * NWS marks hours with no wave forecast as one 0 m value stretched over days (e.g. a single
 * "0" for P4DT19H at the end of the grid). That is a placeholder, not flat water, so a zero
 * lasting a day or more is dropped and those hours read as "Not available". Genuine calm
 * forecasts (or zero values over normal few-hour blocks) are kept.
 */
export const WAVE_PLACEHOLDER_MS = 24 * 3600e3;
export function dropWavePlaceholders(ser) {
  return dropIsolatedWaveZeros((ser || []).filter(r => !(Math.abs(r.v) < 0.05 && r.e - r.s >= WAVE_PLACEHOLDER_MS)));
}

/**
 * NWS gives wave height in whole feet. Near the inlet a cell's forecast can dip to "0" for an
 * hour or a few (e.g. 2 ft · 0 for 4 h · 2 ft) — a rounding artifact, not flat water. A zero run
 * of at most WAVE_ZERO_GAP_MS that is directly preceded AND followed by non-zero values is
 * therefore treated as MISSING: those hours read "Not available" and are scored without waves
 * (low confidence). Nothing is interpolated and no other source fills the gap. Zeros at the
 * start or end of the series, or lasting longer, stay as forecast (a sustained calm is possible).
 */
export const WAVE_ZERO_GAP_MS = 6 * 3600e3;
export function dropIsolatedWaveZeros(ser) {
  const zero = r => Math.abs(r.v) < 0.05;
  const out = [];
  for (let i = 0; i < ser.length;) {
    if (!zero(ser[i])) { out.push(ser[i++]); continue; }
    let j = i; while (j + 1 < ser.length && zero(ser[j + 1]) && ser[j + 1].s === ser[j].e) j++;
    const prev = ser[i - 1], next = ser[j + 1];
    const isolated = prev && next && !zero(prev) && !zero(next) && prev.e === ser[i].s && next.s === ser[j].e
      && ser[j].e - ser[i].s <= WAVE_ZERO_GAP_MS;
    if (!isolated) for (let k = i; k <= j; k++) out.push(ser[k]);
    i = j + 1;
  }
  return out;
}

// Version of the cached forecast shape below. Bump it whenever `transform` keeps different
// fields, so copies cached by an older deploy are refetched instead of read with fields missing.
// 2 = adds sky cover + weather type (weather row).
export const FORECAST_CACHE_VERSION = 2;

const pick = (ser, t) => { const x = ser.find(r => t >= r.s && t < r.e); return x ? x.v : null; };

export async function nwsForecast(lat, lon) {
  const pt = await getJSON(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { ttlMs: 7 * 24 * HOUR });
  const gridUrl = pt.properties && pt.properties.forecastGridData;
  if (!gridUrl) throw new Error('no grid');
  // Keep only the fields we use so the cached copy stays small.
  const g = await getJSON(gridUrl, {
    ttlMs: 20 * MIN, version: FORECAST_CACHE_VERSION,
    transform: j => {
      const P = j.properties;
      return {
        updated: P.updateTime,
        windMph: series(P.windSpeed, v => Math.max(0, v * KMH_TO_MPH)),
        gustMph: series(P.windGust, v => Math.max(0, v * KMH_TO_MPH)),
        windFromDeg: series(P.windDirection),
        pop: series(P.probabilityOfPrecipitation),
        thunder: series(P.probabilityOfThunder),
        tempF: series(P.temperature, c => c * 9 / 5 + 32),
        waveFt: series(P.waveHeight, m => m * 3.28084),
        // weather row: sky cover % and the coded weather type (same response, no extra request)
        sky: series(P.skyCover),
        wx: series(P.weather, wxCode),
      };
    },
  });
  const waveFt = dropWavePlaceholders(g.waveFt); // also cleans copies cached before this fix
  return {
    updated: g.updated ? new Date(g.updated) : null,
    at(t) {
      const ms = t.getTime();
      return {
        windMph: pick(g.windMph, ms), gustMph: pick(g.gustMph, ms), windFromDeg: pick(g.windFromDeg, ms),
        pop: pick(g.pop, ms), thunder: pick(g.thunder, ms), tempF: pick(g.tempF, ms), waveFt: pick(waveFt, ms),
        sky: g.sky ? pick(g.sky, ms) : null, wx: g.wx ? pick(g.wx, ms) : null,
      };
    },
  };
}
