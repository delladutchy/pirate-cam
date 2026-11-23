// Wind map section: Leaflet map + satellite imagery + spot markers + wind particles.
// Holds NO app state of its own: the app passes in spots, loaded results, the current
// spot and the ONE shared selected time; marker taps call back into the app's select().
// Leaflet is lazy-loaded when the section approaches the viewport.
import { BASE, DETAIL, TOPO, VIEW } from './provider.js';
import { mapMarkers, windPoints } from './model.js';
import { createSpotField } from './windfield.js';
import { createParticles } from './particles.js';
import { createRadar } from './radar.js';
import { reducedMotion } from '../ui/motion.js';
import { prefs } from '../prefs.js';
import { compass, esc, time } from '../ui/format.js';

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
  let L = null, map = null, particles = null, markers = {}, latest = null, onScreen = false, lastSpot = null, homeBounds = null;
  let satLayers = [], topoLayer = null, mode = prefs.mapMode === 'topo' ? 'topo' : 'sat';
  // tiny two-state style control: Satellite | Topo (the choice is remembered on this device)
  const modeEl = section.querySelector('.wm-style');
  function setMode(m) {
    mode = m;
    prefs.mapMode = m === 'topo' ? 'topo' : null;
    modeEl?.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    mapEl.classList.toggle('topo', m === 'topo');
    section.querySelector('.cr-sat')?.toggleAttribute('hidden', m === 'topo');
    section.querySelector('.cr-topo')?.toggleAttribute('hidden', m !== 'topo');
    if (!map) return;
    if (m === 'topo') { satLayers.forEach(l => map.removeLayer(l)); if (!topoLayer) topoLayer = L.tileLayer(TOPO.url, TOPO.options); topoLayer.addTo(map); }
    else { if (topoLayer) map.removeLayer(topoLayer); satLayers.forEach(l => l.addTo(map)); }
  }
  modeEl?.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b && b.dataset.mode !== mode) setMode(b.dataset.mode); });
  setMode(mode);

  // WIND | RADAR. Radar is observed and recent; it never follows the forecast time. Nothing is
  // requested until Radar is chosen (and the map exists). Always starts in Wind.
  const layerEl = section.querySelector('.wm-layer');
  let layer = 'wind', radar = null, rbar = null, rstate = { status: 'off' };
  function radarLabel() {
    if (rstate.status === 'unavailable') return 'Radar unavailable';
    // a forecast time is selected elsewhere: say plainly that radar is observed, not that time
    if (rstate.t) return `RADAR · ${time(rstate.t)}${latest && latest.t ? ' · observed' : ''}`;
    return 'Radar · loading…';
  }
  function renderLayerUI() {
    mapEl.classList.toggle('radar', layer === 'radar');
    section.querySelector('.cr-radar')?.toggleAttribute('hidden', layer !== 'radar');
    section.classList.toggle('radar-on', layer === 'radar'); // wind caption keeps its space (controls stay put), just not shown
    if (layer === 'radar') {
      timeEl.textContent = radarLabel();
      timeEl.title = latest && latest.t ? `Observed radar — it does not follow the selected forecast time (${latest.label})` : 'Latest observed radar';
      timeEl.classList.toggle('na', rstate.status === 'unavailable');
    } else { timeEl.classList.remove('na'); timeEl.removeAttribute('title'); if (latest) timeEl.textContent = latest.label; }
    if (!rbar) return;
    rbar.hidden = layer !== 'radar' || rstate.status === 'unavailable' || (!rstate.t && rstate.status !== 'loading');
    const btn = rbar.querySelector('.rb-play');
    btn.textContent = rstate.playing ? 'Pause' : 'Play';
    btn.setAttribute('aria-label', rstate.playing ? 'Pause the radar loop' : 'Play the last hour of radar');
    btn.disabled = !rstate.t;
  }
  function setLayer(l) {
    layer = l;
    layerEl?.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layer === l)));
    if (map) {
      particles?.setActive(onScreen && l === 'wind');
      if (l === 'radar') { if (!radar) makeRadar(); radar.enable(); } else radar?.disable();
    }
    renderLayerUI();
  }
  function makeRadar() {
    radar = createRadar(map, L, { reduced: reducedMotion, onState: s => { rstate = s; renderLayerUI(); } });
    rbar = L.DomUtil.create('div', 'wm-radarbar', mapEl);
    rbar.innerHTML = '<button type="button" class="rb-play">Play</button>';
    L.DomEvent.disableClickPropagation(rbar);
    rbar.querySelector('.rb-play').addEventListener('click', () => (rstate.playing ? radar.pause() : radar.play()));
  }
  layerEl?.addEventListener('click', e => { const b = e.target.closest('[data-layer]'); if (b && b.dataset.layer !== layer) setLayer(b.dataset.layer); });
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
      dragging: !coarse, touchZoom: !coarse, tap: false,
      attributionControl: false, // credits are one line under the map (index.html .wm-credits), never under the dock
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    homeBounds = map.getBounds(); // the initial Delaware view
    satLayers = [L.tileLayer(BASE.url, BASE.options), L.tileLayer(DETAIL.url, DETAIL.options)];
    setMode(mode); // adds the satellite layers or the topo layer
    particles = createParticles(map, L, { reduced: reducedMotion });

    if (coarse) setupTouchLock();
    // desktop: Ctrl/⌘ + wheel zooms (plain wheel keeps scrolling the page)
    mapEl.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); map.setZoom(map.getZoom() + (e.deltaY < 0 ? 1 : -1)); } }, { passive: false });

    new IntersectionObserver(es => { onScreen = es.some(e => e.isIntersecting); particles.setActive(onScreen && layer === 'wind'); }, { threshold: 0.05 }).observe(mapEl);
    if (latest) apply(false);
    if (layer === 'radar') setLayer('radar'); // chosen before the map existed
  }

  // Phones: the map starts "locked" so a swipe over it scrolls the page. Tap to pan & pinch.
  function setupTouchLock() {
    const btn = L.DomUtil.create('button', 'wm-lock', mapEl);
    btn.type = 'button';
    const set = on => {
      if (on) { map.dragging.enable(); map.touchZoom.enable(); mapEl.classList.add('unlocked'); btn.textContent = 'Done'; btn.setAttribute('aria-label', 'Lock the map so swipes scroll the page'); }
      else { map.dragging.disable(); map.touchZoom.disable(); mapEl.classList.remove('unlocked'); btn.textContent = 'Pan'; btn.setAttribute('aria-label', 'Unlock the map to pan and pinch-zoom'); }
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
    // keep the selected spot on screen (Delaware spots all sit in the initial view, so this only
    // moves the map for a spot outside it, e.g. Ocean City, and back again)
    if (spotId !== lastSpot) {
      lastSpot = spotId;
      const sp = spots.find(s => s.id === spotId);
      if (sp && !map.getBounds().pad(-0.05).contains([sp.lat, sp.lon])) {
        const home = homeBounds && homeBounds.contains([sp.lat, sp.lon]); // visible in the original view
        if (home) map.setView(VIEW.center, VIEW.zoom, { animate: !reducedMotion() }); // back to the original Delaware view
        else map.setView([sp.lat, sp.lon], map.getZoom(), { animate: !reducedMotion() });
      }
    }
    // captions
    const sel = pts.find(p => p.id === spotId);
    if (layer === 'radar') renderLayerUI(); else timeEl.textContent = label;
    const spot = spots.find(s => s.id === spotId);
    infoEl.textContent = sel ? `${spot.name} · ${compass(sel.fromDeg)} ${Math.round(sel.mph)} mph` : pts.length ? '' : 'Wind unavailable';
  }

  return {
    update(data) { latest = data; apply(true); },
    get ready() { return !!map; },
    get particles() { return particles; },
    get map() { return map; },
    get radar() { return radar; },
    get layer() { return layer; },
  };
}
