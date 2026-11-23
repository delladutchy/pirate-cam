// Skim spot configuration.
//
// Each spot has:
//  - cams:        camera slugs from cameras.js shown for this spot (first = default)
//  - nearbyCams:  shown when the spot has no camera of its own (clearly labelled "nearby")
//  - sources:     the NOAA stations used for this spot
//  - profile:     what this spot likes for skimboarding. Any section left `null`
//                 is treated as "not configured": that factor is skipped, never guessed.
//
// PROFILE VALUES ARE STARTING ESTIMATES based on general skimboarding principles
// (mid tide + light offshore wind + 1–4 ft shorebreak), not verified local knowledge.
// Tune them here as local experience comes in.
//
// Profile fields:
//  shoreFacingDeg   compass direction the beach faces (toward the water). Offshore wind
//                   blows FROM shoreFacingDeg + 180.
//  tide.idealPhase  [lo, hi] as a fraction of the current tide cycle: 0 = low, 1 = high.
//                   Fractions (not feet) so stations with different ranges compare fairly.
//  tide.preferRising  true = incoming tide preferred, false = outgoing, null = no preference
//  tide.maxRateFtHr   above this rate of change the tidal flow is penalised (inlet currents); null = ignore
//  wind.maxGoodMph    wind speed where conditions start to fall apart
//  wind.shelteredFrom [fromDeg, toDeg] directions the spot is protected from (e.g. by a jetty); null = none
//  waves.ft           { min, idealMin, idealMax, max } breaking wave height preference (ft)
//  waves.periodS      { idealMin, idealMax } wave period preference (s)
//  weights            relative importance of each factor; renormalised over the factors available

export const DEFAULT_WEIGHTS = { tide: 0.35, wind: 0.35, waves: 0.30 };

export const spots = [
  {
    id: 'dewey', name: 'Dewey', fullName: 'Dewey Beach',
    lat: 38.6915, lon: -75.0745,
    cams: ['dewey-beach'],
    sources: { tide: '8557863', tideName: 'Rehoboth Beach', obs: '8557380', obsName: 'Lewes', buoy: '44084', buoyName: 'Bethany Beach buoy' },
    profile: {
      shoreFacingDeg: 100,
      tide: { idealPhase: [0.3, 0.7], preferRising: true, maxRateFtHr: null },
      wind: { maxGoodMph: 12, shelteredFrom: null },
      waves: { ft: { min: 0.8, idealMin: 1.5, idealMax: 3.5, max: 5.5 }, periodS: { idealMin: 6, idealMax: 11 } },
      weights: DEFAULT_WEIGHTS,
    },
  },
  {
    id: 'bethany', name: 'Bethany', fullName: 'Bethany Beach',
    lat: 38.5395, lon: -75.0545,
    cams: ['bethany-ocean', 'bethany-north', 'bethany-south'],
    sources: { tide: '8557863', tideName: 'Rehoboth Beach', obs: '8570283', obsName: 'Ocean City Inlet', buoy: '44084', buoyName: 'Bethany Beach buoy' },
    profile: {
      shoreFacingDeg: 100,
      tide: { idealPhase: [0.2, 0.6], preferRising: true, maxRateFtHr: null },
      wind: { maxGoodMph: 12, shelteredFrom: null },
      waves: { ft: { min: 0.8, idealMin: 1.2, idealMax: 3, max: 5 }, periodS: { idealMin: 6, idealMax: 11 } },
      weights: DEFAULT_WEIGHTS,
    },
  },
  {
    id: 'southside', name: 'Southside', fullName: 'Southside / Indian River Inlet',
    lat: 38.6050, lon: -75.0605,
    cams: ['inlet-overview', 'inlet-north'],
    sources: { tide: '8558690', tideName: 'Indian River Inlet', obs: '8557380', obsName: 'Lewes', buoy: '44084', buoyName: 'Bethany Beach buoy' },
    profile: {
      shoreFacingDeg: 95,
      tide: { idealPhase: [0.35, 0.8], preferRising: true, maxRateFtHr: 0.9 },
      wind: { maxGoodMph: 13, shelteredFrom: null },
      waves: { ft: { min: 1, idealMin: 2, idealMax: 4, max: 6 }, periodS: { idealMin: 7, idealMax: 12 } },
      weights: DEFAULT_WEIGHTS,
    },
  },
  {
    id: 'northside', name: 'Northside', fullName: 'Naval Jetty / Northside',
    lat: 38.6125, lon: -75.0650,
    cams: ['inlet-north', 'inlet-overview'],
    sources: { tide: '8558690', tideName: 'Indian River Inlet', obs: '8557380', obsName: 'Lewes', buoy: '44084', buoyName: 'Bethany Beach buoy' },
    profile: {
      shoreFacingDeg: 85,
      tide: { idealPhase: [0.35, 0.75], preferRising: true, maxRateFtHr: 0.9 },
      wind: { maxGoodMph: 13, shelteredFrom: [150, 210] },
      waves: { ft: { min: 1, idealMin: 1.5, idealMax: 4, max: 6 }, periodS: { idealMin: 6, idealMax: 12 } },
      weights: DEFAULT_WEIGHTS,
    },
  },
  {
    // Conquest Road Beach, Delaware Seashore State Park, DE (not Conquest Beach, MD).
    // No skim-specific local information yet: every preference is intentionally null,
    // so Pirate View shows Conquest's conditions but does not rate it until these are set.
    id: 'conquest', name: 'Conquest', fullName: 'Conquest Road Beach',
    lat: 38.6500, lon: -75.0700,
    cams: [],
    nearbyCams: ['dewey-beach', 'inlet-north'],
    sources: { tide: '8557863', tideName: 'Rehoboth Beach', obs: '8557380', obsName: 'Lewes', buoy: '44084', buoyName: 'Bethany Beach buoy' },
    profile: {
      shoreFacingDeg: null,
      tide: null,
      wind: null,
      waves: null,
      weights: DEFAULT_WEIGHTS,
    },
  },

  // ---- Ocean City, Maryland ----
  // NOT RATED until Ocean City has its own skim calibration: every profile value is null
  // (same as Conquest), nothing copied from the Delaware spots. Conditions still show.
  // Sources (verified 2026-11-22):
  //  tide  8570280 OCEAN CITY (FISHING PIER) — harmonic reference station on the ocean side
  //        of the inlet (4.3 ft high); the Inlet gauge 8570283 sits in the inlet channel and
  //        reads a damped tide (2.6 ft), so it is NOT used for tides.
  //  obs   8570283 Ocean City Inlet — live wind, air and water temperature.
  //  buoy  44084 Bethany Beach (nearshore, 10.6 m) ~22 km N: the nearest wave buoy reporting
  //        (44089 Wallops has no realtime data; 44009 is offshore and reports no waves).
  //  forecast  NWS Wakefield (AKQ) gridpoint at the spot. That beach cell carries no wave
  //        forecast (only a multi-day 0 ft placeholder), so waves come from the adjacent
  //        ocean cell (waveForecast point: AKQ 124,124 Downtown, AKQ 124,125 Midtown).
  {
    id: 'oc-downtown', name: 'OC Downtown', fullName: 'Ocean City Downtown · 14th St',
    lat: 38.3441, lon: -75.0811,
    cams: ['commander-hotel-14th-st'],
    sources: {
      tide: '8570280', tideName: 'Ocean City (Fishing Pier)', obs: '8570283', obsName: 'Ocean City Inlet',
      buoy: '44084', buoyName: 'Bethany Beach buoy (22 km N)',
      waveForecast: { lat: 38.3441, lon: -75.0650, name: 'NWS Wakefield ocean cell' },
    },
    profile: { shoreFacingDeg: null, tide: null, wind: null, waves: null, weights: DEFAULT_WEIGHTS },
  },
  {
    id: 'oc-midtown', name: 'OC Midtown', fullName: 'Ocean City Midtown · 29th St',
    lat: 38.3579, lon: -75.0733,
    cams: ['econo-lodge-29th-st'],
    sources: {
      tide: '8570280', tideName: 'Ocean City (Fishing Pier)', obs: '8570283', obsName: 'Ocean City Inlet',
      buoy: '44084', buoyName: 'Bethany Beach buoy (21 km N)',
      waveForecast: { lat: 38.3579, lon: -75.0600, name: 'NWS Wakefield ocean cell' },
    },
    profile: { shoreFacingDeg: null, tide: null, wind: null, waves: null, weights: DEFAULT_WEIGHTS },
  },
];

export const spotById = id => spots.find(s => s.id === id);

// Direct links: spot ids (#dewey, #conquest …) and the original camera slugs (#inlet-north …).
export function resolveHash(hash, camSlugs) {
  const h = (hash || '').replace(/^#/, '').toLowerCase();
  if (!h) return null;
  const spot = spotById(h);
  if (spot) return { spotId: spot.id, cam: spot.cams[0] || spot.nearbyCams?.[0] || null };
  if (camSlugs.includes(h)) {
    const owner = spots.find(s => s.cams[0] === h) || spots.find(s => s.cams.includes(h));
    if (owner) return { spotId: owner.id, cam: h };
  }
  return null;
}
