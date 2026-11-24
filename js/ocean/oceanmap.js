// OCEAN MAP — the environmental map section. One engine for every variable:
//   basemap (Map | Satellite, Dark | Light) + scalar colour field + directional motion
//   + Pirate View spots + optional buoy observations + legend + timeline + point inspector.
// Data arrive as normalized frames (sources.js); the UI never depends on which model made them.
// Radar is NOAA/NWS MRMS (via NOAA nowCOAST) through the radar module — OBSERVED, past → now, it never
// follows a forecast time.
//
// Holds no app state: the app passes spots, results, the selected spot and the PirateCast time.
// A PirateCast selection moves the map to the nearest model frame (as the wind map did). Map
// scrubbing stays local for now (see SHARED TIME below) and is reported through `onTime`.

import { createField } from './field.js';
import { createBase } from './base.js';
import { createFlow } from './flow.js';
import { createTimeline, chipLabel, clockET } from './timeline.js';
import { freshness, delayedLabel, UNAVAILABLE, ageText } from './freshness.js';
import { SCALES, cssColor } from './scales.js';
import { createSources, frameList, nearestFrame, sampleField, sampleDir, nearestFilled, SOURCES } from './sources.js';
import { BASE, DETAIL, TOPO } from '../map/provider.js';
import { mapMarkers } from '../map/model.js';
import { createRadar } from '../map/radar.js';
import { reducedMotion } from '../ui/motion.js';
import { prefs } from '../prefs.js';
import { compass, esc } from '../ui/format.js';

// Default framing: Cape May / Delaware Bay → Delaware beaches → Ocean City → Assateague, with
// enough Atlantic to the east to see swell coming in.
export const HOME = [[37.82, -75.72], [39.05, -73.72]];

export const BUOYS = [
  { id: '44084', name: 'Bethany Beach, DE', lat: 38.537, lon: -75.044 },
  { id: '44009', name: 'Delaware Bay, 26 NM SE of Cape May', lat: 38.46, lon: -74.692 },
  { id: '44091', name: 'Barnegat, NJ', lat: 39.772, lon: -73.769 },
  { id: '44099', name: 'Cape Henry, VA', lat: 36.915, lon: -75.722 },
];

const LAYERS = {
  waves: { label: 'Waves', scale: SCALES.waves, kind: 'wave', field: 'height', water: true },
  period: { label: 'Period', scale: SCALES.period, kind: 'wave', field: 'period', water: true },
  wind: { label: 'Wind', scale: SCALES.wind, kind: 'wind', field: 'speed', water: false },
  radar: { label: 'Radar', scale: SCALES.radar, kind: 'radar' },
  sst: { label: 'Sea temp', scale: SCALES.sst, kind: 'sst', field: 'temp', water: true },
};
const ORDER = ['waves', 'period', 'wind', 'radar', 'sst'];

const SVG = (d, extra = '') => `<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
const ICONS = {
  waves: SVG('<path d="M2 8c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1"/><path d="M2 13c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1"/>'),
  period: SVG('<circle cx="10" cy="11" r="6.2"/><path d="M10 11V7.6M8.2 2.8h3.6"/>'),
  wind: SVG('<path d="M2 7.5h9.5a2.5 2.5 0 1 0-2.4-3.2"/><path d="M2 11h13a2.5 2.5 0 1 1-2.4 3.2"/><path d="M2 14.5h6"/>'),
  radar: SVG('<path d="M10 10 15.5 4.5"/><circle cx="10" cy="10" r="7.2"/><circle cx="10" cy="10" r="3.6"/>'),
  sst: SVG('<path d="M8 3.2a2 2 0 0 1 4 0v8.1a3.6 3.6 0 1 1-4 0z"/><path d="M10 7v6.2"/>'),
  buoys: SVG('<path d="M10 3v3M7 14l3-8 3 8"/><path d="M3 16.5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0"/>'),
  locate: SVG('<circle cx="10" cy="10" r="5.6"/><path d="M10 1.8v3.4M10 14.8v3.4M1.8 10h3.4M14.8 10h3.4"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/>'),
  chev: SVG('<path d="m7 5 5 5-5 5"/>'),
  updown: SVG('<path d="m6.5 8 3.5-3.5L13.5 8M6.5 12l3.5 3.5 3.5-3.5"/>'),
  plus: SVG('<path d="M10 4.5v11M4.5 10h11"/>'),
  minus: SVG('<path d="M4.5 10h11"/>'),
  close: SVG('<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>'),
};

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
let coastLoading = null;
const loadCoast = () => (coastLoading ||= fetch('/data/coast-midatlantic.json').then(r => (r.ok ? r.json() : null)).catch(() => null));

const fmtDeg = d => `${compass(d)} ${Math.round(d)}°`;
const ago = ms => { const a = ageText(ms); return a === 'just now' ? a : `${a} ago`; };
const utcDay = t => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(t);
const utcHM = t => new Date(t).toISOString().slice(11, 16) + ' UTC';
/** "Run 18Z Nov 23" — model cycles are named in UTC, as NOAA names them. */
const runLabel = ms => `Run ${new Date(ms).toISOString().slice(11, 13)}Z ${utcDay(ms)}`;

export function createOceanMap(section, { onSelectSpot, onTime = () => {}, sources: injected = null } = {}) {
  const wrap = section.querySelector('.om-wrap'), mapEl = section.querySelector('.om-map');
  const creditsEl = section.querySelector('.om-credits');
  const saved = prefs.ocean;
  const ui = {
    layer: LAYERS[saved.layer] ? saved.layer : 'waves',
    theme: saved.theme === 'light' ? 'light' : 'dark',
    base: saved.base === 'sat' ? 'sat' : 'map',
    buoys: saved.buoys !== false,
    motion: saved.motion !== false,
    legend: !!saved.legend,
  };
  const save = () => { prefs.ocean = { layer: ui.layer, theme: ui.theme, base: ui.base, buoys: ui.buoys, motion: ui.motion, legend: ui.legend }; };
  const src = injected || createSources();
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;

  let L = null, map = null, field = null, flow = null, radar = null, coast = null, base = null;
  let tiles = { map: null, sat: [] }, markers = {}, buoyMarkers = {}, pinMarker = null;
  let latest = null, lastT = undefined, lastSpot = null, onScreen = false;
  let runs = null, runsErr = false, frames = [], idx = 0, selT = Date.now(), frame = null, frameErr = false, loadingIdx = -1;
  let playing = false, playTimer = 0, pin = null, rstate = { status: 'off' }, gen = 0;

  // ---------- chrome (built once; map-independent) ----------
  wrap.insertAdjacentHTML('beforeend', `
    <div class="om-top">
      <div class="om-src" aria-live="polite"></div>
      <div class="om-right">
        <div class="om-menuwrap">
          <button type="button" class="om-pill om-layerbtn" aria-haspopup="true" aria-expanded="false"><span class="ic"></span><span class="nm"></span><span class="ud">${ICONS.updown}</span></button>
          <div class="om-menu" role="menu" hidden>
            ${ORDER.map(k => `<button type="button" role="menuitemradio" data-layer="${k}"><span class="ic">${ICONS[k]}</span>${LAYERS[k].label}</button>`).join('')}
            <div class="om-sep"></div>
            <label class="om-row"><span class="ic">${ICONS.buoys}</span>Buoys<input type="checkbox" class="om-buoys"><i class="sw" aria-hidden="true"></i></label>
            <label class="om-row"><span class="ic">${ICONS.wind}</span>Motion<input type="checkbox" class="om-motion"><i class="sw" aria-hidden="true"></i></label>
            <div class="om-seg" role="group" aria-label="Appearance"><button type="button" data-theme="dark">Dark</button><button type="button" data-theme="light">Light</button></div>
            <div class="om-seg" role="group" aria-label="Basemap"><button type="button" data-base="map">Map</button><button type="button" data-base="sat">Satellite</button></div>
          </div>
        </div>
        <button type="button" class="om-sq om-locate" aria-label="Recenter on the selected spot">${ICONS.locate}</button>
        <div class="om-zoom"><button type="button" class="om-sq om-zin" aria-label="Zoom in">${ICONS.plus}</button><button type="button" class="om-sq om-zout" aria-label="Zoom out">${ICONS.minus}</button></div>
      </div>
    </div>
    <div class="om-legend"><button type="button" class="om-legtab" aria-expanded="false"><span>Legend</span>${ICONS.chev}</button><div class="om-legbody" hidden></div></div>
    <div class="om-insp" hidden></div>
    <div class="om-time"></div>`);
  const $ = s => wrap.querySelector(s);
  const menu = $('.om-menu'), layerBtn = $('.om-layerbtn'), legend = $('.om-legend'), legTab = $('.om-legtab'), legBody = $('.om-legbody'), insp = $('.om-insp'), srcEl = $('.om-src');
  const timeline = createTimeline($('.om-time'), { onPick: (i, o) => pickIndex(i, o), onPlay: () => togglePlay(), onStep: d => step(d) });

  const openMenu = on => { menu.hidden = !on; layerBtn.setAttribute('aria-expanded', String(on)); };
  layerBtn.addEventListener('click', e => { e.stopPropagation(); openMenu(menu.hidden); });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.om-menuwrap')) openMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { openMenu(false); layerBtn.focus(); } });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-layer]'); if (b) { setLayer(b.dataset.layer); openMenu(false); return; }
    const t = e.target.closest('[data-theme]'); if (t) { ui.theme = t.dataset.theme; save(); applyLook(); return; }
    const m = e.target.closest('[data-base]'); if (m) { ui.base = m.dataset.base; save(); applyLook(); }
  });
  $('.om-buoys').addEventListener('change', e => { ui.buoys = e.target.checked; save(); drawBuoys(); });
  $('.om-motion').addEventListener('change', e => { ui.motion = e.target.checked; save(); flow?.setMotion(ui.motion); });
  legTab.addEventListener('click', () => { ui.legend = !ui.legend; save(); renderLegend(); });
  $('.om-locate').addEventListener('click', () => recenter(true));
  $('.om-zin').addEventListener('click', () => map?.zoomIn());
  $('.om-zout').addEventListener('click', () => map?.zoomOut());
  [menu, legend, insp, $('.om-top'), $('.om-time')].forEach(el => ['pointerdown', 'dblclick', 'wheel', 'touchstart'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation(), { passive: true })));

  // ---------- lazy init ----------
  // start watching only once the app has laid the page out (while it's loading the page is short
  // and everything looks "near")
  const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); init(); } }, { rootMargin: '500px 0px' });
  let watching = false;

  async function init() {
    try { [L, coast] = await Promise.all([loadLeaflet(), loadCoast()]); } catch { mapEl.innerHTML = '<p class="na">Map temporarily unavailable</p>'; return; }
    map = L.map(mapEl, {
      zoomControl: false, scrollWheelZoom: false, dragging: !coarse, touchZoom: !coarse, tap: false,
      minZoom: 6, maxZoom: 14, attributionControl: false, zoomSnap: 0.5,
    });
    map.fitBounds(HOME, { padding: [0, 0] });
    tiles.map = L.tileLayer(TOPO.url, { ...TOPO.options, className: 'om-basemap' });
    tiles.sat = [L.tileLayer(BASE.url, { ...BASE.options, className: 'om-sat' }), L.tileLayer(DETAIL.url, { ...DETAIL.options, className: 'om-sat' })];
    base = createBase(map, L, coast);
    field = createField(map, L, { coast });
    flow = createFlow(map, L, { reduced: reducedMotion, isWater: (x, y) => field.isWater(x, y) });
    flow.setMotion(ui.motion); flow.setTheme(ui.theme);
    applyLook();
    if (coarse) setupTouchLock();
    mapEl.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); map.setZoom(map.getZoom() + (e.deltaY < 0 ? 0.5 : -0.5)); } }, { passive: false });
    map.on('click', e => { if (ui.layer === 'radar') return; setPin(e.latlng); });
    map.on('zoomend', () => { mapEl.classList.toggle('om-far', map.getZoom() < 10); placeInspector(); });
    map.on('move', placeInspector);
    mapEl.classList.toggle('om-far', map.getZoom() < 10);
    new IntersectionObserver(es => {
      onScreen = es.some(e => e.isIntersecting);
      flow.setActive(onScreen && ui.layer !== 'radar' && ui.layer !== 'sst');
      if (!onScreen && playing) stopPlay();
    }, { threshold: 0.05 }).observe(mapEl);
    if (latest) applyApp();
    drawBuoys();
    setLayer(ui.layer, true);
  }

  // Phones: the map starts locked so a swipe scrolls the page. Tap "Pan" to drag & pinch.
  function setupTouchLock() {
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'om-pill om-lock';
    $('.om-top').prepend(btn);
    const set = on => {
      if (on) { map.dragging.enable(); map.touchZoom.enable(); mapEl.classList.add('unlocked'); btn.textContent = 'Done'; btn.setAttribute('aria-label', 'Lock the map so swipes scroll the page'); }
      else { map.dragging.disable(); map.touchZoom.disable(); mapEl.classList.remove('unlocked'); btn.textContent = 'Pan'; btn.setAttribute('aria-label', 'Unlock the map to pan and pinch-zoom'); }
    };
    btn.addEventListener('click', () => set(!mapEl.classList.contains('unlocked')));
    set(false);
  }

  // ---------- look: appearance + basemap ----------
  function applyLook() {
    wrap.classList.toggle('om-light', ui.theme === 'light');
    wrap.classList.toggle('om-dark', ui.theme !== 'light');
    wrap.classList.toggle('om-satmode', ui.base === 'sat');
    menu.querySelectorAll('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === ui.theme)));
    menu.querySelectorAll('[data-base]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === ui.base)));
    $('.om-buoys').checked = ui.buoys; $('.om-motion').checked = ui.motion;
    if (!map) return;
    if (ui.base === 'sat') { if (map.hasLayer(tiles.map)) map.removeLayer(tiles.map); tiles.sat.forEach(l => l.addTo(map)); base.setOn(false); }
    else { tiles.sat.forEach(l => map.hasLayer(l) && map.removeLayer(l)); tiles.map.addTo(map); base.setOn(true); base.setTheme(ui.theme); }
    flow.setTheme(ui.base === 'sat' ? 'dark' : ui.theme);
    field.setOpacity(ui.theme === 'light' && ui.base !== 'sat' ? 0.86 : 0.9);
    field.setLine(ui.theme === 'light' && ui.base !== 'sat' ? 'rgba(20,32,44,.5)' : 'rgba(235,242,250,.55)');
    renderCredits();
  }

  // ---------- layers ----------
  function setLayer(k, initial = false) {
    const prevKind = LAYERS[ui.layer]?.kind;
    ui.layer = k; save();
    const lay = LAYERS[k];
    layerBtn.querySelector('.ic').innerHTML = ICONS[k];
    layerBtn.querySelector('.nm').textContent = lay.label;
    menu.querySelectorAll('[data-layer]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.layer === k)));
    wrap.classList.toggle('om-radar', k === 'radar');
    renderLegend();
    if (!map) return;
    stopPlay();
    if (k === 'radar') {
      field.clear(); flow.set(null); flow.setActive(false); hidePin(false);
      if (!radar) radar = createRadar(map, L, { reduced: reducedMotion, onState: s => { rstate = s; renderRadarTime(); } });
      radar.enable();
      renderRadarTime();
      return;
    }
    radar?.disable();
    flow.setActive(onScreen && k !== 'sst');
    if (lay.kind !== prevKind || initial || !frames.length) { frames = []; frame = null; }
    loadLayer();
  }

  async function loadLayer() {
    const my = ++gen, lay = LAYERS[ui.layer];
    frameErr = false;
    renderTime();
    try {
      if (lay.kind === 'sst') {
        frames = [{ fh: 0, t: 0 }];
        const f = await src.load('sst', 'latest', 0);
        if (my !== gen) return;
        frames = [{ fh: 0, t: f.validTime, label: 'Daily analysis' }]; idx = 0; frame = f;
      } else {
        runs = await src.getRuns(); runsErr = false;
        if (my !== gen) return;
        const run = runs[lay.kind];
        if (!run) throw new Error('no run');
        frames = frameList(run, Date.now(), runs.hours?.[lay.kind]);
        idx = nearestFrame(frames, selT);
        await showIndex(idx, my);
        return;
      }
      showFrame();
    } catch {
      if (my !== gen) return;
      runsErr = true; frame = null; field.clear(); flow.set(null);
      renderTime();
    }
  }

  async function showIndex(i, my = gen) {
    const lay = LAYERS[ui.layer];
    if (!frames[i]) return;
    idx = i; selT = frames[i].t; loadingIdx = i;
    renderTime();
    const run = runs?.[lay.kind];
    try {
      const f = await src.load(lay.kind, run, frames[i].fh);
      if (my !== gen || loadingIdx !== i) return;
      frame = f; frameErr = false; loadingIdx = -1;
      showFrame();
      src.prefetch(lay.kind, run, frames, i, playing ? 5 : 3);
    } catch {
      if (my !== gen || loadingIdx !== i) return;
      loadingIdx = -1; frameErr = true;
      renderTime(); // keep the last good field on screen; the chip says this hour is missing
    }
  }

  function showFrame() {
    const lay = LAYERS[ui.layer];
    if (!frame || !lay.field) return;
    field.set({ frame, field: lay.field, scale: lay.scale, water: lay.water });
    flow.set(motionFor(frame, ui.layer));
    renderTime(); renderInspector(); renderSource();
  }

  function motionFor(f, k) {
    const g = f.grid;
    if (f.kind === 'wave') {
      return {
        vec: (lat, lon) => { const d = sampleDir(g, f.fields.dir, lat, lon); if (d !== d) return null; const h = sampleField(g, f.fields.height, lat, lon); const tr = (d + 180) * Math.PI / 180; return [Math.sin(tr) * h, Math.cos(tr) * h]; },
        pxPerFrame: m => 0.4 + Math.min(1.1, Math.sqrt(m) * 0.3), alpha: 0.85, width: 1.7, trail: 0.8, water: true,
      };
    }
    if (f.kind === 'wind') {
      return { vec: (lat, lon) => { const u = sampleField(g, f.fields.u, lat, lon), v = sampleField(g, f.fields.v, lat, lon); return u === u && v === v ? [u, v] : null; }, pxPerFrame: m => 0.25 + m * 0.07, alpha: 0.8, width: 1.3, trail: 0.85 };
    }
    return null; // SST: no directional motion
  }

  // ---------- time: pick / step / play ----------
  function pickIndex(i, { dragging } = {}) {
    if (ui.layer === 'radar') { radar?.goto(i); return; } // goto stops playback; the newest request wins
    if (playing) stopPlay();
    if (i === idx && frame && !dragging && loadingIdx < 0) return;
    showIndex(i);
    onTime(frames[i] ? new Date(frames[i].t) : null, { dragging, from: 'ocean' });
  }
  function step(d) {
    if (ui.layer === 'radar') { const st = rstate; if (st.frames) radar?.goto(Math.max(0, Math.min(st.frames - 1, (st.frame ?? 0) + d))); return; }
    if (playing) stopPlay();
    const n = Math.max(0, Math.min(frames.length - 1, idx + d));
    if (n !== idx) showIndex(n);
  }
  function togglePlay() {
    if (ui.layer === 'radar') { if (rstate.playing) radar?.pause(); else radar?.play(); return; }
    if (playing) stopPlay(); else startPlay();
  }
  function startPlay() {
    if (frames.length < 2 || ui.layer === 'sst') return;
    playing = true; renderTime();
    const tick = async () => {
      if (!playing) return;
      const n = idx + 1 >= frames.length ? 0 : idx + 1; // loop back to the first frame
      await showIndex(n);                                // waits for the real frame — never skips ahead
      if (!playing) return;
      playTimer = setTimeout(tick, reducedMotion() ? 1100 : n === frames.length - 1 ? 1400 : 520);
    };
    playTimer = setTimeout(tick, 150);
  }
  function stopPlay() { if (!playing) return; playing = false; clearTimeout(playTimer); playTimer = 0; renderTime(); }

  // ---------- rendering: time strip, source, legend ----------
  function renderTime() {
    if (ui.layer === 'radar') return renderRadarTime();
    const lay = LAYERS[ui.layer];
    if (runsErr && !frame) {
      timeline.set({ frames: [], index: 0, mode: 'single', chip: `${lay.label} · ${UNAVAILABLE}`, unavailable: true, disabled: true });
      renderSource();
      return;
    }
    if (!frames.length || (lay.kind !== 'sst' && !runs)) { timeline.set({ frames: [], index: 0, mode: 'single', chip: 'Loading…', loading: true, disabled: true }); return; }
    if (lay.kind === 'sst') {
      const t = frames[0].t;
      const fr = t ? freshness('sst', t) : null;
      timeline.set({
        frames, index: 0, mode: 'single', loading: !frame,
        chip: t ? `Sea temp · Analysis ${utcDay(t)} · ${fr.age} old` : 'Loading…',
        chipNote: fr?.delayed ? delayedLabel(fr.ageMs) : 'satellite analysis',
        chipTitle: t ? `MUR SST daily analysis for ${utcDay(t)} ${utcHM(t)} — not a live reading` : '',
        unavailable: !!fr?.delayed,
      });
      return;
    }
    const f = frames[idx];
    const st = modelStatus();
    timeline.set({
      frames, index: idx, mode: 'forecast', playing,
      chip: chipLabel(f.t),
      chipNote: frameErr ? 'not available' : loadingIdx === idx ? 'loading…' : st.delayed ? delayedLabel(st.ageMs) : '',
      chipTitle: `Forecast valid ${chipLabel(f.t)} · ${runLabel(f.t - f.fh * 3600e3)} (+${f.fh} h)`,
      loading: loadingIdx === idx, unavailable: frameErr || st.delayed,
    });
  }
  /** Model run age, and whether it's late (or the run check itself failed and we kept the last answer). */
  function modelStatus() {
    const run = runs?.[LAYERS[ui.layer].kind];
    if (!run) return { delayed: false, ageMs: NaN };
    const t = Date.UTC(+run.slice(0, 4), +run.slice(4, 6) - 1, +run.slice(6, 8), +run.slice(8, 10));
    const fr = freshness('model', t);
    return { delayed: fr.delayed || !!runs.stale, ageMs: fr.ageMs, stale: !!runs.stale };
  }
  function renderRadarTime() {
    if (ui.layer !== 'radar') return;
    const fr = radar?.frames || [];
    let chip, note = '', title = '';
    const obs = 'Observed radar (NOAA/NWS MRMS scan time, via NOAA nowCOAST) — it does not follow the forecast time';
    const newest = fr.length ? fr[fr.length - 1].t : null;
    const late = newest ? freshness('radar', newest) : null;
    const isLatest = rstate.t && newest && +rstate.t === +newest;
    const when = rstate.t ? (isLatest ? 'latest' : ago(Date.now() - rstate.t)) : '';
    if (rstate.status === 'unavailable') chip = `RADAR · ${UNAVAILABLE}`;
    else if (rstate.t && rstate.empty) { chip = 'RADAR · No precipitation in view'; note = `${clockET(rstate.t)} · ${when}`; title = `Radar scan ${clockET(rstate.t)}: no returns in this view. ${obs}`; }
    else if (rstate.t) { chip = `RADAR · ${clockET(rstate.t)}`; note = `observed · ${when}`; title = obs; }
    else chip = 'Radar · loading…';
    if (late?.delayed && rstate.status !== 'unavailable') note = delayedLabel(late.ageMs);
    timeline.set({
      frames: fr.length ? fr : [], index: rstate.frame ?? 0, mode: 'observed', playing: !!rstate.playing,
      chip, chipNote: note, chipTitle: title, unavailable: rstate.status === 'unavailable' || !!late?.delayed, loading: rstate.status === 'loading', disabled: rstate.status === 'unavailable' || !fr.length,
    });
    renderSource();
  }

  function renderSource() {
    let html = '', late = '';
    const kind = LAYERS[ui.layer].kind;
    if (ui.layer === 'radar') {
      html = '<b>Observed radar</b> · NOAA/NWS MRMS';
      const fr = radar?.frames || [];
      if (rstate.status === 'unavailable') late = UNAVAILABLE;
      else if (fr.length) { const f = freshness('radar', fr[fr.length - 1].t); if (f.delayed) late = delayedLabel(f.ageMs); }
    } else if (frame && kind === frame.kind) {
      const s = frame.source;
      if (frame.kind === 'sst') {
        const f = freshness('sst', frame.validTime);
        html = `<b>${esc(s.role)}</b> · ${esc(s.short)} · Analysis ${esc(utcDay(frame.validTime))} · ${esc(f.age)} old`;
        if (f.delayed) late = delayedLabel(f.ageMs);
      } else {
        html = `<b>${esc(s.role)}</b> · ${esc(s.short)} · ${esc(runLabel(frame.runTime))}`;
        const st = modelStatus();
        if (st.delayed) late = delayedLabel(st.ageMs);
      }
    } else if (runsErr) late = UNAVAILABLE;
    srcEl.innerHTML = html + (late ? ` · <em class="om-late">${esc(late)}</em>` : '');
    srcEl.classList.toggle('late', !!late);
  }

  function renderLegend() {
    const lay = LAYERS[ui.layer], sc = lay.scale;
    legend.classList.toggle('open', ui.legend);
    legTab.setAttribute('aria-expanded', String(ui.legend));
    legBody.hidden = !ui.legend;
    const steps = sc.legend;
    legBody.innerHTML = `<div class="om-legh">${esc(sc.title)} · ${esc(sc.units)}</div>`
      + steps.map((v, i) => `<div class="om-legs" style="--c:${cssColor(sc, sc.discrete ? v : (i < steps.length - 1 ? (v + steps[i + 1]) / 2 : v + 1))}"><span>${v}${i === steps.length - 1 ? '+' : ''}</span></div>`).join('');
  }

  function renderCredits() {
    const base = ui.base === 'sat'
      ? '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless – https://s2maps.eu</a> by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016 &amp; 2017) · USGS'
      : 'Map: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';
    // a short line stays visible (the imagery credit is required while Satellite is on); the full list opens
    const short = ui.base === 'sat' ? 'Imagery: Sentinel-2 cloudless by EOX · ' : '';
    creditsEl.innerHTML = `<details class="om-cred"><summary>${short}Data: NOAA · NASA JPL · USGS · Natural Earth — regional model guidance, not a surf forecast <span class="om-more">Sources</span></summary>
      <span>${base} · Coastline: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> · Waves: NOAA GFS-Wave (WAVEWATCH III) · Wind: NOAA GFS · Sea temp: MUR SST (NASA JPL) via NOAA CoastWatch ERDDAP · Buoys: NOAA NDBC · Radar: NOAA/NWS MRMS via <a href="https://nowcoast.noaa.gov" target="_blank" rel="noopener">NOAA nowCOAST</a>. Regional model guidance — not a nearshore surf forecast; map data does not feed Pirate Score.</span></details>`;
  }

  // ---------- inspector ----------
  function setPin(ll) {
    pin = { lat: ll.lat, lng: ll.lng };
    if (!pinMarker) pinMarker = L.marker(ll, { icon: L.divIcon({ className: 'om-pin', html: '<i></i>', iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(map);
    else pinMarker.setLatLng(ll);
    renderInspector();
  }
  function hidePin(forget = true) { insp.hidden = true; if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; } if (forget) pin = null; }
  function inspectorLines() {
    if (!pin || !frame) return null;
    const { lat, lng } = pin, g = frame.grid, F = frame.fields;
    const t = frames[idx]?.t ?? frame.validTime;
    const sstAge = frame.kind === 'sst' ? freshness('sst', frame.validTime) : null;
    const valid = frame.kind === 'sst' ? `Analysis ${utcDay(frame.validTime)} ${utcHM(frame.validTime)} · ${sstAge.age} old` : `Valid ${chipLabel(t)} · ${runLabel(frame.runTime)}`;
    const nearNote = nearestFilled(frame, lat, lng) ? 'Near the coast: nearest model cell' : '';
    if (frame.kind === 'wave') {
      const h = sampleField(g, F.height, lat, lng), p = sampleField(g, F.period, lat, lng), d = sampleDir(g, F.dir, lat, lng);
      if (h !== h) return { head: 'No wave data here', sub: 'Land or outside the model grid' };
      const main = ui.layer === 'period' ? `${Math.round(p)} sec` : `${h.toFixed(1)} ft`;
      const other = ui.layer === 'period' ? `${h.toFixed(1)} ft` : `${Math.round(p)} sec`;
      return { head: main, lines: [other, `from ${fmtDeg(d)}`], foot: [valid, nearNote].filter(Boolean).join(' · '), tag: 'Model', src: 'Regional wave model · NOAA GFS-Wave' };
    }
    if (frame.kind === 'wind') {
      const s = sampleField(g, F.speed, lat, lng), d = sampleDir(g, F.dir, lat, lng), gu = F.gust ? sampleField(g, F.gust, lat, lng) : NaN;
      if (s !== s) return { head: 'No wind data here', sub: 'Outside the model grid' };
      return { head: `${Math.round(s)} mph`, lines: [gu === gu ? `Gust ${Math.round(gu)} mph` : null, `from ${fmtDeg(d)}`].filter(Boolean), foot: valid, tag: 'Model', src: 'Regional weather model · NOAA GFS 10 m wind' };
    }
    if (frame.kind === 'sst') {
      const v = sampleField(g, F.temp, lat, lng);
      if (v !== v) return { head: 'No sea temp here', sub: 'Land or outside the analysis' };
      return { head: `${Math.round(v)}°F`, lines: [], foot: [valid, nearNote].filter(Boolean).join(' · '), tag: 'Analysis', src: 'Satellite analysis · MUR SST — not a live reading' };
    }
    return null;
  }
  function renderInspector() {
    if (!pin || ui.layer === 'radar') { insp.hidden = true; return; }
    const d = inspectorLines();
    if (!d) { insp.hidden = true; return; }
    insp.innerHTML = `<button type="button" class="om-x" aria-label="Close">${ICONS.close}</button>
      <div class="om-iv">${esc(d.head)}</div>${d.sub ? `<div class="om-il">${esc(d.sub)}</div>` : ''}
      ${(d.lines || []).map(l => `<div class="om-il">${esc(l)}</div>`).join('')}
      ${d.foot ? `<div class="om-if">${esc(d.foot)}</div>` : ''}${d.src ? `<div class="om-is">${d.tag ? `<b class="om-tag">${esc(d.tag)}</b> ` : ''}${esc(d.src)}</div>` : ''}`;
    insp.querySelector('.om-x').addEventListener('click', e => { e.stopPropagation(); hidePin(); });
    insp.hidden = false;
    placeInspector();
  }
  function placeInspector() {
    if (!pin || insp.hidden || !map) return;
    const p = map.latLngToContainerPoint([pin.lat, pin.lng]), W = mapEl.clientWidth, H = mapEl.clientHeight;
    const w = insp.offsetWidth || 150, h = insp.offsetHeight || 90;
    let x = p.x + 14, y = p.y - h - 10;
    if (x + w > W - 8) x = p.x - w - 14;
    if (y < 56) y = p.y + 14;
    insp.style.transform = `translate(${Math.max(6, Math.min(W - w - 6, x))}px, ${Math.max(6, Math.min(H - h - 96, y))}px)`;
  }

  // ---------- buoys (observations) ----------
  function drawBuoys() {
    if (!map) return;
    for (const b of BUOYS) {
      if (!ui.buoys) { if (buoyMarkers[b.id]) { map.removeLayer(buoyMarkers[b.id]); delete buoyMarkers[b.id]; } continue; }
      if (buoyMarkers[b.id]) continue;
      const m = L.marker([b.lat, b.lon], { icon: L.divIcon({ className: 'om-buoy', html: `<i title="NDBC ${b.id}"></i>`, iconSize: [0, 0] }), keyboard: true, title: `NDBC ${b.id} · ${b.name}`, zIndexOffset: -2000 }).addTo(map); // spots always stay on top
      m.bindPopup('<div class="om-bp">Loading NDBC ' + b.id + '…</div>', { className: 'om-popup', closeButton: true, autoPanPaddingTopLeft: [10, 60], autoPanPaddingBottomRight: [10, 110] });
      m.on('popupopen', async () => {
        let html;
        try {
          const r = await fetch(`/api/buoy?station=${b.id}`);
          const o = r.ok ? await r.json() : null;
          if (!o || o.error) throw new Error();
          const rows = [
            o.waveHeightFt != null ? `Observed wave <b>${o.waveHeightFt} ft</b>` : null,
            o.dominantPeriodS != null ? `Period <b>${o.dominantPeriodS} sec</b>` : null,
            o.waveFromDeg != null ? `From <b>${fmtDeg(o.waveFromDeg)}</b>` : null,
            o.waterTempF != null ? `Water <b>${o.waterTempF}°F</b>` : null,
          ].filter(Boolean);
          const when = o.observedAt || o.waterObservedAt;
          const fr = when ? freshness('buoy', when) : null;
          html = `<div class="om-bk">Observation · offshore buoy</div><div class="om-bt">NDBC ${b.id}</div><div class="om-bn">${esc(b.name)}</div>`
            + (rows.length ? rows.map(x => `<div>${x}</div>`).join('') : '<div>No recent reports</div>')
            + (when ? `<div class="om-bu">Observed ${esc(clockET(Date.parse(when)))} · ${esc(ago(fr.ageMs))}</div>` : '')
            + (fr?.delayed ? `<div class="om-bu om-late">${esc(delayedLabel(fr.ageMs))}</div>` : '');
        } catch { html = `<div class="om-bt">NDBC ${b.id}</div><div class="om-late">${UNAVAILABLE}</div>`; }
        m.setPopupContent(`<div class="om-bp">${html}</div>`);
      });
      buoyMarkers[b.id] = m;
    }
  }

  // ---------- spots (from the app) ----------
  function applyApp() {
    if (!map || !latest) return;
    const { spots, results, spotId, t } = latest;
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
    if (spotId !== lastSpot) { lastSpot = spotId; recenter(false); }
  }
  function recenter(force) {
    if (!map || !latest) { map?.fitBounds(HOME); return; }
    const sp = latest.spots.find(s => s.id === latest.spotId);
    const home = L.latLngBounds(HOME);
    if (force) { if (sp && !home.contains([sp.lat, sp.lon])) map.setView([sp.lat, sp.lon], 10); else map.fitBounds(HOME); return; }
    if (sp && !map.getBounds().pad(-0.05).contains([sp.lat, sp.lon])) map.setView([sp.lat, sp.lon], Math.max(map.getZoom(), 9), { animate: !reducedMotion() });
  }

  // SHARED TIME: PirateCast → map. A new PirateCast selection moves the map to the nearest real
  // model frame (forecast layers only — radar stays observed). Map → PirateCast is reported via
  // onTime() but the app does not act on it yet: PirateCast scores daylight 15-minute steps, and
  // pushing a night model hour into it would change the score card and dock.
  function followApp(t) {
    const want = t ? t.getTime() : Date.now();
    selT = want;
    if (!map || ui.layer === 'radar' || ui.layer === 'sst' || !frames.length) return;
    stopPlay();
    const i = nearestFrame(frames, want);
    if (i !== idx || !frame) showIndex(i);
  }

  return {
    update(data) {
      latest = data;
      if (!watching && document.body.dataset.state !== 'loading') { watching = true; requestAnimationFrame(() => near.observe(section)); }
      const tKey = data.t ? data.t.getTime() : null;
      if (tKey !== lastT) { lastT = tKey; followApp(data.t); }
      applyApp();
    },
    get ready() { return !!map; },
    get map() { return map; },
    get radar() { return radar; },
    get layer() { return ui.layer; },
    get particles() { return flow; },
    get field() { return field; },
    get state() { return { layer: ui.layer, theme: ui.theme, base: ui.base, buoys: ui.buoys, motion: ui.motion, legend: ui.legend, idx, frames: frames.length, t: frames[idx]?.t ?? null, playing, loading: loadingIdx >= 0, frameErr, runsErr, run: runs?.[LAYERS[ui.layer]?.kind] ?? null, kind: frame?.kind ?? null, validTime: frame?.validTime ?? null, pin, cache: src.size }; },
    setLayer, step, togglePlay, pick: i => pickIndex(i, {}),
    inspect: (lat, lng) => setPin({ lat, lng }),
  };
}
