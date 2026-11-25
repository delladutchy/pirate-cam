// WIND MAP — the original simple wind view (restored from a3d4a29, refined): satellite imagery,
// animated wind particles, wind direction and speed, and the Pirate View beaches.
// It shares the map area with the Ocean map (Ocean | Wind) and uses only data the app already
// has: each beach's own wind (NOAA CO-OPS observation now, NWS forecast for later), blended
// between beaches (windfield.js). No extra forecast requests; the imagery tiles are the same
// as the Ocean map's satellite basemap, so the browser reuses them.
// Holds no app state: it follows the app's selected time and beach; tapping a beach selects it.
import { BASE, DETAIL } from './provider.js';
import { mapMarkers, windPoints } from './model.js';
import { createSpotField } from './windfield.js';
import { createParticles } from './particles.js';
import { mapOptions, setupGestures, isCoarse } from './gestures.js';
import { reducedMotion } from '../ui/motion.js';
import { compass, esc, MOON } from '../ui/format.js';

// Delaware beaches to Ocean City, with ocean to the east
const HOME = [[38.27, -75.32], [38.82, -74.86]];
const SVG = d => `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  locate: SVG('<circle cx="10" cy="10" r="5.6"/><path d="M10 1.8v3.4M10 14.8v3.4M1.8 10h3.4M14.8 10h3.4"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/>'),
  plus: SVG('<path d="M10 4.5v11M4.5 10h11"/>'), minus: SVG('<path d="M4.5 10h11"/>'),
};

export function createWindMap(box, { onSelectSpot, loadLeaflet }) {
  box.innerHTML = `<div class="wm-map" role="region" aria-label="Wind map: wind at each Pirate View beach for the selected time"></div>
    <div class="om-top wm-top"><div class="om-right"><button type="button" class="om-sq wm-locate" aria-label="Back to the beaches">${ICON.locate}</button>${isCoarse() ? '' : `<div class="om-zoom"><button type="button" class="om-sq wm-zin" aria-label="Zoom in">${ICON.plus}</button><button type="button" class="om-sq wm-zout" aria-label="Zoom out">${ICON.minus}</button></div>`}</div></div>
    <div class="wm-chips"><span class="wm-when"></span><span class="wm-wind"></span></div>`;
  const mapEl = box.querySelector('.wm-map'), whenEl = box.querySelector('.wm-when'), windEl = box.querySelector('.wm-wind');
  let L = null, map = null, particles = null, markers = {}, icons = {}, latest = null, shown = false, onScreen = false, lastSpot = null, starting = null;

  box.querySelector('.wm-locate').addEventListener('click', () => map?.fitBounds(HOME));
  box.querySelector('.wm-zin')?.addEventListener('click', () => map?.zoomIn());
  box.querySelector('.wm-zout')?.addEventListener('click', () => map?.zoomOut());
  for (const el of box.querySelectorAll('.om-top, .wm-chips')) for (const ev of ['pointerdown', 'dblclick', 'wheel', 'touchstart']) el.addEventListener(ev, e => e.stopPropagation(), { passive: true });

  async function init() {
    try { L = await loadLeaflet(); } catch { mapEl.innerHTML = '<p class="na">Map unavailable</p>'; return; }
    map = L.map(mapEl, mapOptions({ minZoom: 7, maxZoom: 16, zoomSnap: 0.5 }));
    map.fitBounds(HOME);
    L.tileLayer(BASE.url, { ...BASE.options, className: 'wm-sat' }).addTo(map);
    L.tileLayer(DETAIL.url, { ...DETAIL.options, className: 'wm-sat' }).addTo(map);
    particles = createParticles(map, L, { reduced: reducedMotion });
    setupGestures(map, mapEl, { host: box.querySelector('.wm-top') });
    new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); particles.setActive(shown && onScreen); }, { threshold: 0.05 }).observe(mapEl);
    apply(false);
  }

  function apply(animate = true) {
    if (!latest) return;
    const { spots, results, spotId, t, label } = latest;
    const pts = windPoints(spots, results, t);
    const sel = pts.find(p => p.id === spotId), spot = spots.find(s => s.id === spotId);
    whenEl.textContent = label || 'Now';
    windEl.innerHTML = sel ? `<b>${esc(spot.name)}</b> ${compass(sel.fromDeg)} ${Math.round(sel.mph)} mph` : pts.length ? '' : 'Wind unavailable';
    if (!map) return;
    const ms = mapMarkers(spots, results, t);
    for (const m of ms) {
      const near = ms.find(o => o.id !== m.id && Math.abs(o.lat - m.lat) < 0.02 && Math.abs(o.lon - m.lon) < 0.02);
      const place = near ? (m.lat < near.lat ? 'below' : 'above') : 'right';
      const html = `<div class="wm-spot ${m.id === spotId ? 'active' : ''} ${m.tone ? 'tone-' + m.tone : ''}${m.night ? ' night' : ''} lbl-${place}"><i></i><span class="wm-lbl"><b>${esc(m.name.toUpperCase())}</b>${m.score != null ? ` ${m.night ? MOON : ''}${m.score.toFixed(1)}` : ''}</span></div>`;
      if (!markers[m.id]) {
        markers[m.id] = L.marker([m.lat, m.lon], { icon: L.divIcon({ className: 'wm-icon', html, iconSize: [0, 0] }), keyboard: true, title: m.fullName, riseOnHover: true }).on('click', () => onSelectSpot(m.id)).addTo(map);
      } else if (icons[m.id] !== html) markers[m.id].setIcon(L.divIcon({ className: 'wm-icon', html, iconSize: [0, 0] })); // only when it changed: no marker flicker while scrubbing
      icons[m.id] = html;
      markers[m.id].setZIndexOffset(m.id === spotId ? 1000 : 0);
    }
    particles.setField(createSpotField(pts), animate);
    if (spotId !== lastSpot) {
      lastSpot = spotId;
      const sp = spots.find(s => s.id === spotId);
      if (sp && !map.getBounds().pad(-0.08).contains([sp.lat, sp.lon])) map.setView([sp.lat, sp.lon], Math.max(map.getZoom(), 10), { animate: !reducedMotion() });
    }
  }

  return {
    update(data) { latest = { ...data }; apply(true); },
    /** shown: the Wind view is the one on screen (the map is created the first time). */
    setShown(on) {
      shown = on;
      box.hidden = !on;
      if (on && !map && !starting) starting = init();
      if (map) { map.invalidateSize(); particles.setActive(on && onScreen); if (on) apply(false); }
    },
    get map() { return map; },
    get particles() { return particles; },
  };
}
