// Map imagery providers — free, keyless, and licensed for this use. Attribution is required
// and is rendered by Leaflet's attribution control.
//
// Base: EOX Sentinel-2 cloudless **2016** (CC BY 4.0 — commercial use allowed with attribution;
//       later years are CC BY-NC-SA, so do not switch years without checking the license).
//       Covers land AND ocean, 10 m resolution — the coast reads clearly at regional zooms.
// Detail: USGS The National Map orthoimagery (US public domain). Sharp beach detail when
//       zoomed in; its ocean is empty, so the Sentinel base shows through. Shown from zoom 13.

export const BASE = {
  url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
  options: {
    maxNativeZoom: 15, maxZoom: 16,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless - https://s2maps.eu</a> by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016 &amp; 2017)',
  },
};

export const DETAIL = {
  url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
  options: {
    minZoom: 13, maxNativeZoom: 16, maxZoom: 16,
    attribution: 'USDA, <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>: Orthoimagery',
  },
};

// Optional TOPO mode: USGS Topo base map (The National Map tile cache; USGS data is US public
// domain, credit requested — see the credits line in index.html). Same host as DETAIL, no key.
// Drawn in dark tones by a CSS filter (.wm-map.topo) so it sits in Pirate View's palette.
export const TOPO = {
  url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
  options: { maxNativeZoom: 16, maxZoom: 16 },
};

/** Initial view: the Pirate View beaches from Dewey to Bethany, with ocean to the east. */
export const VIEW = { center: [38.62, -75.04], zoom: 11, minZoom: 8, maxZoom: 16 };
