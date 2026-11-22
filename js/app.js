// Pirate View — wiring: routing, spot/camera switching, data refresh, and the
// single "selected forecast time" that PirateCast, the score card and the tide
// graph all share.
import { cams, camSlug } from './config/cameras.js';
import { spots, spotById, resolveHash } from './config/spots.js';
import { loadSpotData } from './data/load.js';
import { buildConditions } from './engine/conditions.js';
import { renderMedia } from './ui/camera.js';
import { createTideGraph } from './ui/tidegraph.js';
import { createPirateCast } from './ui/piratecast.js';
import { mountScore, updateScore, renderWindow, renderTideSummary, renderDetails, facts, timeLabel } from './ui/conditions.js';
import { sampleAt } from './map/model.js';
import { createDayGraph } from './ui/daygraph.js';
import { createTimeDock } from './ui/timedock.js';
import { forecastDays } from './engine/days.js';
import { bestWindow, windRelation } from './engine/score.js';
import { createWindMap } from './map/windmap.js';
import { esc } from './ui/format.js';
import { reducedMotion } from './ui/motion.js';
import { prefs } from './prefs.js';

const $ = s => document.querySelector(s);
const camBySlug = Object.fromEntries(cams.map(c => [camSlug(c), c]));
const slugs = Object.keys(camBySlug);
const REFRESH_MS = 10 * 60e3;

// selT: the selected forecast time (Date), or null for "now".
const state = { spotId: null, cam: null, results: {}, selT: null }; // results[spotId] = conditions | 'error'

// ---------- routing ----------
function initialRoute() {
  return resolveHash(location.hash, slugs)
    || (prefs.favorite && spotById(prefs.favorite) && resolveHash('#' + prefs.favorite, slugs))
    || resolveHash('#dewey', slugs);
}

function select(spotId, cam) {
  const spot = spotById(spotId);
  const camChoices = spot.cams.length ? spot.cams : spot.nearbyCams || [];
  cam = camChoices.includes(cam) ? cam : camChoices[0];
  const spotChanged = spotId !== state.spotId, camChanged = cam !== state.cam;
  state.spotId = spotId; state.cam = cam;
  history.replaceState(null, '', '#' + (cam === spot.cams[0] || !spot.cams.length ? spot.id : cam));
  if (camChanged) showCamera();
  renderSpotNav();
  renderAngles();
  if (spotChanged) { renderConditions(true); ensureLoaded(spotId); updateMap(); }
}

window.addEventListener('hashchange', () => { const r = resolveHash(location.hash, slugs); if (r) select(r.spotId, r.cam); });

// ---------- camera ----------
function showCamera() {
  const spot = spotById(state.spotId), c = state.cam && camBySlug[state.cam];
  const media = $('#media');
  if (!c) { media.innerHTML = '<div class="cam-fail"><p>Live camera temporarily unavailable</p></div>'; return; }
  renderMedia(media, c);
  const nearby = !spot.cams.length;
  $('#camtitle').textContent = nearby ? spot.fullName : c.name;
  $('#camnote').textContent = nearby ? `No camera here yet · nearest live cam: ${c.name}` : c.note;
  $('#direct').href = c.src;
  $('#camOnlyName').textContent = c.name;
}

function renderAngles() {
  const spot = spotById(state.spotId);
  const list = spot.cams.length ? spot.cams : spot.nearbyCams || [];
  const el = $('#angles');
  if (list.length < 2) { el.innerHTML = ''; return; }
  const label = slug => { const n = camBySlug[slug].name; return spot.cams.length ? n.replace(/^(Bethany|Inlet) /, '') : n; };
  el.innerHTML = list.map(s => `<button class="angle ${s === state.cam ? 'active' : ''}" data-cam="${s}">${esc(label(s))}</button>`).join('');
}
$('#angles').addEventListener('click', e => { const b = e.target.closest('[data-cam]'); if (b) select(state.spotId, b.dataset.cam); });

// ---------- spot nav = overview ----------
function renderSpotNav() {
  $('#spots').innerHTML = spots.map(s => {
    const r = state.results[s.id];
    const sc = r && r !== 'error' ? r.score : null;
    const val = sc && sc.score != null ? `<span class="sv tone-${sc.tone}"><i></i>${sc.score.toFixed(1)}</span>` : `<span class="sv muted">${r === undefined ? '' : '–'}</span>`;
    return `<button class="spot ${s.id === state.spotId ? 'active' : ''}" data-spot="${s.id}" aria-label="${esc(s.fullName)}"><span class="sn">${esc(s.name)}</span>${val}</button>`;
  }).join('');
  const scored = spots.map(s => state.results[s.id]).filter(r => r && r !== 'error' && r.score.score != null);
  const allIn = spots.every(s => state.results[s.id] !== undefined);
  const best = scored.sort((a, b) => b.score.score - a.score.score)[0];
  const el = $('#bestNow');
  if (allIn && best) {
    el.innerHTML = `<span class="k">Best right now</span> <button data-spot="${best.spot.id}">${esc(best.spot.fullName)} <b>${best.score.score.toFixed(1)}</b> ${best.score.label}</button>`;
    el.hidden = false;
  } else el.hidden = true;
}
for (const sel of ['#spots', '#bestNow']) $(sel).addEventListener('click', e => { const b = e.target.closest('[data-spot]'); if (b) select(b.dataset.spot); });

// ---------- conditions ----------
async function ensureLoaded(spotId, force = false) {
  if (!force && state.results[spotId] && state.results[spotId] !== 'error') return;
  const spot = spotById(spotId);
  try {
    const data = await loadSpotData(spot);
    const anything = Object.values(data.status).some(Boolean);
    state.results[spotId] = anything ? buildConditions(spot, data) : 'error';
  } catch (err) {
    console.warn('conditions failed', spotId, err);
    state.results[spotId] = 'error';
  }
  renderSpotNav();
  if (spotId === state.spotId) renderConditions();
  else updateMap();
}

// ---------- the ONE shared selected time ----------
// state.selT is the exact selected time (null = now). Weather/score come from the nearest
// real forecast sample (15-min steps from hourly NWS values — nothing is interpolated);
// the tide, which is a continuous NOAA-predicted curve, follows the exact time.
function current() { const r = state.results[state.spotId]; return r && r !== 'error' ? r : null; }

/** Days + each day's best window, computed once per loaded result. */
function dayInfo(r) {
  if (!r._days) {
    r._days = forecastDays(r.timeline, r.now);
    r.dayWindows = r._days.map(d => {
      const ds = r.timeline.filter(s => s.t >= d.start && s.t < d.end && s.t >= r.now);
      return ds.length > 2 ? bestWindow(ds) : null;
    });
  }
  return r._days;
}
const dayOf = (r, t) => dayInfo(r).find(d => t >= d.start && t < d.end) || dayInfo(r)[0];

let lastDayKey = '';
function setTime(t, { from = '', dragging = false, step = 0 } = {}) {
  const r = current(); if (!r) return;
  if (step) t = new Date((state.selT || r.now).getTime() + step);
  const end = r.timeline.at(-1).t;
  if (t && t > end) t = end;
  if (t && t - r.now < 8 * 60e3) t = null; // within a few minutes of now → "Now"
  state.selT = t;
  const s = sampleAt(r.timeline, t);
  const label = timeLabel(t, r);
  const tideNow = t && r.tide && r.tide.covers(t) ? r.tide.at(t) : s.tide;
  const shown = { ...s, tide: tideNow };
  updateScore($('#score'), r, shown, { label, isNow: !t, relation: windRelation(r.spot.profile.shoreFacingDeg, s.wind), onBackToNow: () => setTime(null, { from: 'back' }) });
  renderTideSummary($('#tideSummary'), r, { t: t || r.now, tide: tideNow }, label);
  tideGraph.render(r, t || r.now, { instant: dragging });
  if (from !== 'cast') pirateCast.highlightTime(t || r.now, { scroll: dragging ? 'instant' : 'smooth' });
  // day graph + dock: redraw when the day (or the data) changes, otherwise just move the marker
  const day = dayOf(r, t || r.now), key = r.spot.id + '|' + day.index + '|' + r.now.getTime();
  if (key !== lastDayKey) { lastDayKey = key; dayGraph.render(r, day, t); timeDock.render(r, dayInfo(r), day, t); }
  else { dayGraph.place(t, dragging); timeDock.place(t, dragging); }
  $('#dayLabel').textContent = `${day.label} · ${day.sub}`;
  const f = facts(shown);
  $('#pcReadout').innerHTML = `<b>${label}</b>${s.score != null ? ` · <span class="tone-${s.tone}"><span class="lbl"><i></i>${s.score.toFixed(1)} ${s.label}</span></span>` : ''}${['waves', 'wind', 'tide'].filter(k => f[k]).map(k => ` · ${k[0].toUpperCase() + k.slice(1)} ${f[k]}`).join('')}${s.daylight ? '' : ' · <span class="muted">after dark</span>'}`;
  if (!dragging) updateMap();
  else scheduleMap();
}

function pickDay(i) {
  const r = current(); if (!r) return;
  if (i === 0) return setTime(null, { from: 'day' });
  const d = dayInfo(r)[i], w = r.dayWindows[i];
  const noon = new Date(d.start.getTime() + 12 * 3600e3);
  setTime(w && w.bestT ? w.bestT : noon, { from: 'day' });
}

const tideGraph = createTideGraph($('#tideGraph'), { onPick: (t, o = {}) => setTime(t, { from: 'graph', dragging: !!o.dragging }) });
const pirateCast = createPirateCast($('#piratecast'), { onSelect: (s, i) => setTime(i === 0 ? null : s.t, { from: 'cast' }) });
const windMap = createWindMap($('#windmapPanel'), { onSelectSpot: id => select(id) });
const dayGraph = createDayGraph($('#dayGraph'), { onPick: (t, o = {}) => setTime(t, { from: 'graph', dragging: !!o.dragging, step: o.step || 0 }) });
const timeDock = createTimeDock($('#timedock'), {
  onPick: (t, o = {}) => setTime(t, { from: 'dock', dragging: !!o.dragging, step: o.step || 0 }),
  onDay: pickDay, onNow: () => setTime(null, { from: 'now' }),
  watch: [$('#piratecastPanel'), $('.tidepanel'), $('#windmapPanel')],
});

function updateMap() {
  const r = current();
  windMap.update({ spots, results: state.results, spotId: state.spotId, t: state.selT, label: r ? timeLabel(state.selT, r) : 'Now' });
}
let mapT = 0; // while scrubbing, refresh the map at most ~6×/s
function scheduleMap() { if (!mapT) mapT = setTimeout(() => { mapT = 0; updateMap(); }, 160); }

function fadeIn(...els) {
  if (reducedMotion()) return;
  for (const el of els) { el.classList.remove('fadein'); void el.offsetWidth; el.classList.add('fadein'); }
}

function renderConditions(spotSwitch = false) {
  const r = state.results[state.spotId];
  const spot = spotById(state.spotId);
  document.body.dataset.state = r === undefined ? 'loading' : r === 'error' ? 'error' : 'ready';
  $('#spotName').textContent = spot.fullName;
  syncFavorite();
  if (r === undefined || r === 'error') {
    $('#score').className = 'score';
    $('#score').innerHTML = r === 'error' ? '<p class="na">Conditions temporarily unavailable</p>' : '<p class="na loading">Loading conditions…</p>';
    $('#window').hidden = true;
    for (const id of ['#tideSummary', '#tideGraph', '#piratecast', '#pcReadout', '#details']) $(id).innerHTML = '';
    tideGraph.reset();
    return;
  }
  if (state.selT && state.selT < r.now) state.selT = null;
  mountScore($('#score'), r);
  renderWindow($('#window'), r, { onPick: t => { setTime(t, { from: 'window' }); $('#piratecastPanel').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); } });
  tideGraph.reset();
  lastDayKey = '';
  pirateCast.render(r, state.selT);          // silent: positions the highlight
  setTime(state.selT, { from: 'cast' });     // then sync everything to the shared time
  renderDetails($('#details'), r);
  const missing = Object.entries(r.status).filter(([, ok]) => !ok).map(([k]) => ({ tide: 'tides', wind: 'observed wind', buoy: 'wave buoy', forecast: 'forecast' }[k]));
  $('#sourceNote').textContent = missing.length ? `Temporarily unavailable: ${missing.join(', ')}.` : '';
  if (spotSwitch) fadeIn($('.rail'), $('#piratecastPanel'), $('.tidepanel'));
}

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { const r = current(); if (r) { tideGraph.render(r, state.selT || r.now, { force: true }); lastDayKey = ''; setTime(state.selT, { from: 'resize' }); } }, 150);
});

$('#window').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#window').click(); } });

// ---------- cam only ----------
function setCamOnly(on) {
  document.body.classList.toggle('cam-only', on);
  prefs.camOnly = on;
  $('#camOnlyBtn').setAttribute('aria-pressed', on);
}
$('#camOnlyBtn').addEventListener('click', () => setCamOnly(true));
$('#exitCamOnly').addEventListener('click', () => setCamOnly(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('cam-only')) setCamOnly(false); });

// ---------- favorite ----------
function syncFavorite() {
  const on = prefs.favorite === state.spotId;
  const b = $('#favBtn');
  b.setAttribute('aria-pressed', on);
  b.textContent = on ? '★ Favorite' : '☆ Favorite';
}
$('#favBtn').addEventListener('click', () => { prefs.favorite = prefs.favorite === state.spotId ? null : state.spotId; syncFavorite(); });

// Test hook, only with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) window.__pv = { state, windMap, setTime };

// ---------- start ----------
const first = initialRoute();
select(first.spotId, first.cam);
if (prefs.camOnly) setCamOnly(true);

const idle = window.requestIdleCallback || (fn => setTimeout(fn, 600));
idle(() => spots.forEach(s => ensureLoaded(s.id)));

// Ambient refresh — conditions only; the camera is never reloaded.
setInterval(() => {
  if (document.hidden) return;
  ensureLoaded(state.spotId, true).then(() => spots.filter(s => s.id !== state.spotId).forEach(s => ensureLoaded(s.id, true)));
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  const r = current();
  if (!document.hidden && r && Date.now() - r.now > REFRESH_MS) ensureLoaded(state.spotId, true);
});

