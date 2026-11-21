# Pirate Cam (Skim Cams)

Static single-page viewer for Delaware coastal cameras (Dewey, Indian River Inlet, Bethany).

- `index.html` — the app (from `Skim_Cams_Pirate_View_v1_1.html`, with sharing fixes below)
- `vendor/hls.light.min.js` — hls.js 1.7.4 (Apache-2.0) so the DelDOT Inlet streams play in every browser
- `vercel.json` — tells Vercel to serve it as a static site with no build step

Pushing to `main` auto-deploys to Vercel production.

## Changes from the original file
- Inlet (DelDOT) streams play in Chrome/Firefox/Android via bundled hls.js, not just Safari
- Hotlinked stock skull image replaced with an inline SVG drawn for this project
- PIRATE VIEW badge moved to bottom-left so camera providers' logos stay visible
- Link-preview meta tags (description / og:title)
- All 6 cameras verified live on 2026-11-21; none removed
