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
| `js/ui/` | Camera player, tide graph, conditions rendering |
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

## Links
`#dewey #bethany #southside #northside #conquest`, plus the original camera links
`#dewey-beach #inlet-north #inlet-overview #bethany-ocean #bethany-north #bethany-south`.
