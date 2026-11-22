// NOAA data access, normalised. Each loader resolves to data or null — one
// failing source never blocks the others.
import { getJSON } from './http.js';

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

function series(prop, conv = v => v) {
  if (!prop || !Array.isArray(prop.values)) return [];
  return prop.values.filter(x => x.value != null).map(x => {
    const [start, dur] = x.validTime.split('/');
    const s = new Date(start).getTime();
    return { s, e: s + parseDuration(dur), v: conv(x.value) };
  });
}

const pick = (ser, t) => { const x = ser.find(r => t >= r.s && t < r.e); return x ? x.v : null; };

export async function nwsForecast(lat, lon) {
  const pt = await getJSON(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { ttlMs: 7 * 24 * HOUR });
  const gridUrl = pt.properties && pt.properties.forecastGridData;
  if (!gridUrl) throw new Error('no grid');
  // Keep only the fields we use so the cached copy stays small.
  const g = await getJSON(gridUrl, {
    ttlMs: 20 * MIN,
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
      };
    },
  });
  return {
    updated: g.updated ? new Date(g.updated) : null,
    at(t) {
      const ms = t.getTime();
      return {
        windMph: pick(g.windMph, ms), gustMph: pick(g.gustMph, ms), windFromDeg: pick(g.windFromDeg, ms),
        pop: pick(g.pop, ms), thunder: pick(g.thunder, ms), tempF: pick(g.tempF, ms), waveFt: pick(g.waveFt, ms),
      };
    },
  };
}
