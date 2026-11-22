// Wind map section: Leaflet map + satellite imagery + spot markers + wind particles.
// Holds NO app state of its own: the app passes in spots, loaded results, the current
// spot and the ONE shared selected time; marker taps call back into the app's select().
// Leaflet is lazy-loaded when the section approaches the viewport.
import { BASE, DETAIL, VIEW } from './provider.js';
import { mapMarkers, windPoints } from './model.js';
import { createSpotField } from './windfield.js';
import { createParticles } from './particles.js';
import { reducedMotion } from '../ui/motion.js';
import { compass, esc } from '../ui/format.js';

let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletLoading) {
    leafletLoading = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script'); s.src = '/vendor/leaflet/leaflet.js';
      s.onload = () => resolve(window.L); s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return leafletLoading;
}

export function createWindMap(section, { onSelectSpot }) {
  const mapEl = section.querySelector('.wm-map');
  const timeEl = section.querySelector('.wm-time');
  const infoEl = section.querySelector('.wm-info');
  let L = null, map = null, particles = null, markers = {}, latest = null, onScreen = false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;

  // lazy init
  const near = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) { near.disconnect(); init(); }
  }, { rootMargin: '400px 0px' });
  near.observe(section);

  async function init() {
    try { L = await loadLeaflet(); } catch { mapEl.innerHTML = '<p class="na">Map temporarily unavailable</p>'; return; }
    map = L.map(mapEl, {
      center: VIEW.center, zoom: VIEW.zoom, minZoom: VIEW.minZoom, maxZoom: VIEW.maxZoom,
      zoomControl: false, scrollWheelZoom: false, // never hijack page scrolling
      dragging: !coarse, touchZoom: !coarse, tap: false, attributionControl: true,
    });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer(BASE.url, BASE.options).addTo(map);
    L.tileLayer(DETAIL.url, DETAIL.options).addTo(map);
    particles = createParticles(map, L, { reduced: reducedMotion });

    if (coarse) setupTouchLock();
    // desktop: Ctrl/⌘ + wheel zooms (plain wheel keeps scrolling the page)
    mapEl.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); map.setZoom(map.getZoom() + (e.deltaY < 0 ? 1 : -1)); } }, { passive: false });

    new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); particles.setActive(onScreen); }, { threshold: 0.05 }).observe(mapEl);
    if (latest) apply(false);
  }

  // Phones: the map starts "locked" so a swipe over it scrolls the page. Tap to pan & pinch.
  function setupTouchLock() {
    const btn = L.DomUtil.create('button', 'wm-lock', mapEl);
    btn.type = 'button';
    const set = on => {
      if (on) { map.dragging.enable(); map.touchZoom.enable(); mapEl.classList.add('unlocked'); btn.textContent = 'Done'; }
      else { map.dragging.disable(); map.touchZoom.disable(); mapEl.classList.remove('unlocked'); btn.textContent = 'Tap to pan & zoom'; }
    };
    L.DomEvent.disableClickPropagation(btn);
    btn.addEventListener('click', () => set(!mapEl.classList.contains('unlocked')));
    set(false);
  }

  function apply(animate = true) {
    if (!map || !latest) return;
    const { spots, results, spotId, t, label } = latest;
    // markers
    const ms = mapMarkers(spots, results, t);
    for (const m of ms) {
      const near = ms.find(o => o !== m && Math.abs(o.lat - m.lat) < 0.02 && Math.abs(o.lon - m.lon) < 0.02);
      const place = near ? (m.lat < near.lat ? 'below' : 'above') : 'right';
      const html = `<div class="wm-spot ${m.id === spotId ? 'active' : ''} ${m.tone ? 'tone-' + m.tone : ''} lbl-${place}"><i></i><span class="wm-lbl"><b>${esc(m.name.toUpperCase())}</b>${m.score != null ? ` ${m.score.toFixed(1)}` : ''}</span></div>`;
      if (!markers[m.id]) {
        markers[m.id] = L.marker([m.lat, m.lon], { icon: L.divIcon({ className: 'wm-icon', html, iconSize: [0, 0] }), keyboard: true, title: m.fullName, riseOnHover: true })
          .on('click', () => onSelectSpot(m.id)).addTo(map);
      } else markers[m.id].setIcon(L.divIcon({ className: 'wm-icon', html, iconSize: [0, 0] }));
      markers[m.id].setZIndexOffset(m.id === spotId ? 1000 : 0);
    }
    // wind
    const pts = windPoints(spots, results, t);
    particles.setField(createSpotField(pts), animate);
    // captions
    const sel = pts.find(p => p.id === spotId);
    const src = pts.length ? (pts.every(p => p.source === 'obs') ? 'NOAA observed' : pts.every(p => p.source === 'fcst') ? 'NWS forecast' : 'NOAA observed + NWS forecast') : '';
    timeEl.textContent = label;
    const spot = spots.find(s => s.id === spotId);
    infoEl.innerHTML = pts.length
      ? `${sel ? `<b>${esc(spot.name)}</b> ${compass(sel.fromDeg)} ${Math.round(sel.mph)} mph · ` : ''}${src} wind at ${pts.length} Pirate View spot${pts.length > 1 ? 's' : ''}`
      : 'Wind data temporarily unavailable';
  }

  return {
    update(data) { latest = data; apply(true); },
    get ready() { return !!map; },
    get particles() { return particles; },
    get map() { return map; },
  };
}
