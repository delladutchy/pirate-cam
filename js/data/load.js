// Gathers every source for one spot in parallel. Each source settles to a value
// or null; `status` records which ones failed so the UI can say so quietly.
import { tideEvents, observedWind, observedTemp, buoy, nwsForecast } from './noaa.js';

const settle = p => p.then(v => v ?? null, () => null);

export async function loadSpotData(spot) {
  const s = spot.sources;
  const [tide, wind, air, coopsWater, buoyObs, grid] = await Promise.all([
    settle(tideEvents(s.tide)),
    settle(observedWind(s.obs)),
    settle(observedTemp(s.obs, 'air_temperature')),
    settle(observedTemp(s.obs, 'water_temperature')),
    settle(buoy(s.buoy)),
    settle(nwsForecast(spot.lat, spot.lon)),
  ]);
  return {
    spotId: spot.id,
    loadedAt: new Date(),
    tideEvents: tide && tide.length ? tide : null,
    obsWind: wind, obsAir: air, coopsWater, buoy: buoyObs, grid,
    status: { tide: !!(tide && tide.length), wind: !!wind, buoy: !!buoyObs, forecast: !!grid },
  };
}
