// Gathers every source for one spot in parallel. Each source settles to a value
// or null; `status` records which ones failed so the UI can say so quietly.
import { tideEvents, tideSeries, observedWind, observedTemp, buoy, nwsForecast } from './noaa.js';
import { nwpsForecast } from './nwps.js';

const settle = p => p.then(v => v ?? null, () => null);

export async function loadSpotData(spot) {
  const s = spot.sources;
  // Optional `waveForecast`: waves from a separate NWS ocean gridpoint (used where the spot's
  // own beach cell has no wave forecast, e.g. Ocean City). Wind/temps stay from the spot's cell.
  // `nwps`: the NOAA NWPS nearshore wave forecast (one shared download for every spot) — the wave
  // input for spots that have an NWPS point. Spots without one (Ocean City) keep the NWS wave grid.
  const [tide, wind, air, coopsWater, buoyObs, grid, marine, nwps, tide6] = await Promise.all([
    settle(tideEvents(s.tide)),
    settle(observedWind(s.obs)),
    settle(observedTemp(s.obs, 'air_temperature')),
    settle(observedTemp(s.obs, 'water_temperature')),
    settle(buoy(s.buoy)),
    settle(nwsForecast(spot.lat, spot.lon)),
    s.waveForecast ? settle(nwsForecast(s.waveForecast.lat, s.waveForecast.lon)) : null,
    s.nwps ? settle(nwpsForecast()) : null,
    settle(tideSeries(s.tide)), // display curve only; the score keeps using the hi/lo events
  ]);
  const forecast = grid && marine ? withWaves(grid, marine) : grid;
  return {
    spotId: spot.id,
    loadedAt: new Date(),
    tideEvents: tide && tide.length ? tide : null,
    tideSeries: tide6,
    obsWind: wind, obsAir: air, coopsWater, buoy: buoyObs, grid: forecast,
    nwps: nwps && nwps.has(spot.id) ? nwps : null,
    status: { tide: !!(tide && tide.length), wind: !!wind, buoy: !!buoyObs, forecast: !!grid, nwps: s.nwps ? !!(nwps && nwps.has(spot.id)) : null },
  };
}

/** The spot's own forecast, with wave height taken from another gridpoint. */
export function withWaves(grid, marine) {
  return { updated: grid.updated, at(t) { return { ...grid.at(t), waveFt: marine.at(t).waveFt }; } };
}
