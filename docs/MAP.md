# Pirate View map — status and next step

## Decision
Not built into the UI yet, on purpose. A real geographic map needs a tile provider and a
map library; doing it well (and keeping it fast on a phone at the beach) is its own piece
of work and shouldn't compromise the camera → score → best window → PirateCast flow.

## Already in place
- `js/map/model.js`
  - `mapMarkers(spots, results, t)` → per-spot `{ lat, lon, score, label, windMph, windFromDeg }`
    at any forecast time (same time model as PirateCast).
  - `windVectors(markers)` → u/v wind vectors ready for a flow/particle layer.
- `js/app.js` exports `getConditions()`; spots carry `lat/lon` in `js/config/spots.js`.
- All data is already loaded per spot (NWS gridpoints include hourly wind speed/direction for 48 h+).

## Next implementation step (no paid APIs or keys needed)
1. **Map library:** Leaflet 1.9 (~40 KB gz), vendored like hls.js, lazy-loaded when the map panel scrolls into view.
2. **Tiles:** a dark basemap. Options without keys: OpenStreetMap standard tiles (attribution required,
   light traffic only per the OSM tile policy) or self-hosted/vector tiles (Protomaps PMTiles file on Vercel — no third-party tile traffic).
   Recommended: **Protomaps PMTiles extract of Delmarva**, served from this project.
3. **Markers:** `mapMarkers()` → small score pills (`DEWEY 2.0`); tap → `select(spotId)`.
4. **Wind flow:** canvas overlay animating particles along `windVectors()`, interpolated
   (inverse-distance) between spot grid points. For a wider field, sample NWS gridpoints on a
   coarse lattice over the coast (cache in the existing `getJSON` layer). Respect `prefers-reduced-motion`
   (static arrows instead of particles).
5. **Time sync:** re-run `mapMarkers(spots, results, selectedT)` from `applySelection()` in `app.js`.
6. **Later:** swell direction from NDBC 44084 `MWD` / NWS wave grids.
