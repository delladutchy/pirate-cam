# Pirate View

Live Delaware skim cams + skimboarding conditions. Plain HTML/CSS/ES modules, no build step,
one Vercel serverless function.

## Layout
| Path | What |
|---|---|
| `index.html`, `css/app.css` | Page and styles |
| `js/config/cameras.js` | The six verified live cams (unchanged from the original app) |
| `js/config/spots.js` | Skim spots, NOAA stations and **tunable skim profiles** |
| `js/data/` | Fetching (timeouts, caching) and NOAA normalisation |
| `js/engine/` | Tide curve, sunrise/sunset, Skim Score, best window, timeline |
| `js/ui/` | Camera player + bug, Weekly Skim Outlook, PirateCast graph + weather row, floating time controller, interactive tide graph, score card, motion helpers |
| `js/map/` | Wind map: `provider.js` (imagery), `model.js` (markers + wind points, FROM→TO conversion), `windfield.js` (spot-based field), `particles.js` (canvas renderer), `windmap.js` (Leaflet view) — see `docs/MAP.md` |
| `vendor/leaflet/` | Leaflet 1.9.4 (BSD-2), lazy-loaded |
| `api/buoy.js` | Proxies NDBC buoy 44084 (NDBC has no CORS) |
| `vendor/hls.light.min.js` | hls.js 1.7.4 (Apache-2.0) for the DelDOT inlet streams |
| `tests/` | `npm test` — engine + buoy parser tests (not deployed) |

## Data
- Tides: NOAA CO-OPS hi/lo predictions (Rehoboth Beach 8557863; Indian River Inlet 8558690)
- Observed wind/air/water: NOAA CO-OPS Lewes 8557380, Ocean City Inlet 8570283
- Forecast wind, gusts, rain, thunder, wave height: NWS gridpoints
- Waves, period, direction, water temp: NDBC 44084 Bethany Beach

Missing data is skipped, never filled in. Each value is labelled Observed / Forecast / Estimate.

## Tuning the Skim Score
Edit `profile` per spot in `js/config/spots.js`. Profiles for Dewey, Bethany, Southside and
Northside are starting estimates. **Conquest Road Beach** is intentionally unconfigured
(all `null`) — it shows live conditions but no score until its profile is filled in.

## Interaction
One selected forecast time drives everything: tap a day in the **Weekly Skim Outlook** (it switches to
that day's best rated spot and time), drag or tap **PirateCast** or the floating time controller
(← → keys too), or tap / **drag the tide graph**. The wind map, score card, wind arrow, tide playhead,
weather row and readout all follow it. Forecast times live inside **skim hours** — 1 h after sunrise to
1 h before sunset, per spot and day; night is outside the skim forecast, never "POOR". The live camera
never reloads when the forecast time changes.
Motion is limited to value changes and respects `prefers-reduced-motion`.

## Links
`#dewey #bethany #southside #northside #conquest`, plus the original camera links
`#dewey-beach #inlet-north #inlet-overview #bethany-ocean #bethany-north #bethany-south`.
