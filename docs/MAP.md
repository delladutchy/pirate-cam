# Wind map

## What it is
A real geographic map (Leaflet 1.9.4, vendored, lazy-loaded) with:
- **Imagery** (`js/map/provider.js`), no API keys, no cost:
  - EOX Sentinel-2 cloudless **2016** — CC BY 4.0 (commercial use OK with attribution). Covers ocean + land.
    Later EOX years are CC BY-NC-SA (non-commercial) — check the license before switching.
  - USGS The National Map orthoimagery — US public domain; crisp beach detail from zoom 13 (its ocean is empty, so Sentinel shows through).
  - No label overlay: EOX's OSM-based overlay has unclear reuse terms. Spot markers act as labels.
- **Spot markers** at the coordinates in `js/config/spots.js`; tapping one calls the app's `select()`.
- **Animated wind particles** (`js/map/particles.js`) driven by the shared selected time.

## Data flow (no duplicated state)
app `state.results` + `state.selT` → `model.windPoints()` → `windfield.createSpotField()` → `particles.setField()`.

## Direction semantics
NOAA CO-OPS `wind.d` and NWS `windDirection` give the direction wind blows **from**.
Particles travel toward `from + 180°` (`model.toVector`). Unit-tested in `tests/map.test.mjs`.

## Honest limitation: spot-based field
Pirate View loads wind per spot (NWS 2.5 km gridpoint forecast; NOAA CO-OPS observation for "now"),
not a regional wind grid. `createSpotField` blends those real points with inverse-distance weighting.
The UI says so under the map.

## Upgrading to a gridded field
Implement any object with `sample(lat, lon) → { u, v, mph }` (mph, u east, v north, travel direction) and
pass it to `particles.setField()`. Options: sample a lattice of NWS gridpoints along the coast
(cache via `data/http.js`), or a NOAA model grid served by a serverless function.

## Performance
Field sampled to a 22 px screen grid only on map move/zoom or time change; particles do lookups.
Particle count scales with map area and device (≈150 phone, ≈600+ desktop).
Paused when the map is off-screen, the tab is hidden, or during pan/zoom.
Reduced motion: static arrow grid, no animation.
