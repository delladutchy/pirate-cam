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
import { dayBestWindow, windRelation } from './engine/score.js';
import { resolveSelection } from './engine/timeline.js';
import { recommendFor } from './engine/recommend.js';
import { compass } from './ui/format.js';
import { createWindMap } from './map/windmap.js';
import { esc } from './ui/format.js';
import { reducedMotion, countUp } from './ui/motion.js';
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
  else if (spotChanged) showCaption(); // same camera, new spot (e.g. Conquest → Dewey): update the caption, never reload the player
  renderSpotNav();
  renderAngles();
  if (spotChanged) { renderConditions(true); ensureLoaded(spotId); updateMap(); }
}

window.addEventListener('hashchange', () => { const r = resolveHash(location.hash, slugs); if (r) select(r.spotId, r.cam); });

// ---------- camera ----------
function showCamera() {
  const c = state.cam && camBySlug[state.cam];
  const media = $('#media');
  if (!c) { media.innerHTML = '<div class="cam-fail"><p>Live camera temporarily unavailable</p></div>'; return; }
  renderMedia(media, c);
  showCaption();
}

function showCaption() {
  const spot = spotById(state.spotId), c = state.cam && camBySlug[state.cam];
  if (!c) return;
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
    // One DAY'S BEST window per day: the button's number, the time a tap selects, the day
    // graph's BEST band and the day wording all come from it. (The "Best next window" and
    // Go/Wait keep using bestWindow: the earliest good-enough opportunity.)
    r.dayWindows = r._days.map(d => {
      const ds = r.timeline.filter(s => s.t >= d.start && s.t < d.end && s.t >= r.now);
      return ds.length > 2 ? dayBestWindow(ds) : null;
    });
    for (const d of r._days) d.preview = dayPreview(r, d, r.dayWindows[d.index]);
  }
  return r._days;
}
/** What a day button shows. Today → the live score (a tap goes to NOW); other days → that
 *  day's best (a tap goes to exactly that moment). */
function dayPreview(r, d, w) {
  if (d.index === 0) {
    const s = r.timeline[0];
    return s.score != null ? { best: s.score, tone: s.tone, bestT: null, confidence: s.confidence, kind: 'now' } : { best: null };
  }
  if (!w || !w.peak) return { best: null };
  return { best: w.bestScore, tone: w.tone, bestT: w.bestT, confidence: w.peak.confidence ?? null, kind: 'daybest' };
}
const dayOf = (r, t) => dayInfo(r).find(d => t >= d.start && t < d.end) || dayInfo(r)[0];

let lastDayKey = '';
function setTime(t, { from = '', dragging = false, step = 0 } = {}) {
  const r = current(); if (!r) return;
  t = resolveSelection({ t, step, current: state.selT, now: r.now, end: r.timeline.at(-1).t }); // null = live now
  state.selT = t;
  const s = sampleAt(r.timeline, t);
  const label = timeLabel(t, r);
  const tideNow = t && r.tide && r.tide.covers(t) ? r.tide.at(t) : s.tide;
  const shown = { ...s, tide: tideNow };
  const relation = windRelation(r.spot.profile.shoreFacingDeg, s.wind);
  const dayNow = dayOf(r, t || r.now);
  const rec = recommendFor(r, s, t, r.dayWindows[dayNow.index]);
  updateScore($('#score'), r, shown, { label, isNow: !t, relation, rec, onBackToNow: () => setTime(null, { from: 'back' }) });
  timeDock.show(dockView(r, shown, t, relation, rec));
  renderTideSummary($('#tideSummary'), r, { t: t || r.now, tide: tideNow }, label);
  tideGraph.render(r, t || r.now, { instant: dragging });
  if (from !== 'cast') pirateCast.highlightTime(t || r.now, { scroll: dragging ? 'instant' : 'smooth' });
  // day graph + dock: redraw when the day (or the data) changes, otherwise just move the marker
  const day = dayOf(r, t || r.now), key = r.spot.id + '|' + day.index + '|' + r.now.getTime();
  if (key !== lastDayKey) { lastDayKey = key; dayGraph.render(r, day, t); timeDock.render(r, dayInfo(r), day, t); }
  else { dayGraph.place(t, dragging); timeDock.place(t, dragging); }
  $('#dayLabel').textContent = `${day.long} · ${day.sub}`;
  const f = facts(shown);
  $('#pcReadout').innerHTML = `<b>${label}</b>${s.score != null ? ` · <span class="tone-${s.tone}"><span class="lbl"><i></i>${s.score.toFixed(1)} ${s.label}</span></span>` : ''}${['waves', 'wind', 'tide'].filter(k => f[k]).map(k => ` · ${k[0].toUpperCase() + k.slice(1)} ${f[k]}`).join('')}${s.daylight ? '' : ' · <span class="muted">after dark</span>'}`;
  if (!dragging) updateMap();
  else scheduleMap();
}

const REL = { offshore: 'Offshore', 'cross-shore': 'Cross-shore', onshore: 'Onshore', calm: 'Calm' };
/** Compact view model for the dock's conditions strip — the essentials visible while scrubbing. */
function dockView(r, s, t, relation, rec) {
  const w = s.wind, isNow = !t;
  const gust = w && Number.isFinite(w.gustMph) && w.gustMph > w.mph + 0.5 ? `g${Math.round(w.gustMph)}` : '';
  return {
    score: s.score != null ? (s.confidence === 'low' ? '≈' : '') + s.score.toFixed(1) : '–', // ≈ = low confidence (inputs missing / far out)
    label: s.score != null ? s.label : r.score.reason === 'not-configured' ? 'NOT RATED' : 'NO DATA',
    tone: s.score != null ? s.tone : null,
    wind: w && Number.isFinite(w.mph) ? (w.mph < 1 ? 'Calm' : `${compass(w.fromDeg)} ${Math.round(w.mph)}`) : '–',
    windsub: [gust, relation ? REL[relation] : ''].filter(Boolean).join(' · ') || (w ? 'mph' : 'no wind data'),
    windToDeg: w && Number.isFinite(w.fromDeg) && w.mph >= 1 ? w.fromDeg + 180 : NaN, // arrow shows where it blows TO
    rel: relation,
    tide: s.tide ? `${s.tide.height.toFixed(1)}′ ${s.tide.rising ? '↑' : '↓'}` : '–',
    tidesub: s.tide ? (s.tide.rising ? 'incoming' : 'outgoing') : 'tide',
    waves: s.waves && Number.isFinite(s.waves.ft) ? `${s.waves.ft.toFixed(1)}′` : '–',
    wavesub: s.waves ? (s.waves.periodS ? `${Math.round(s.waves.periodS)}s · buoy` : 'offshore fcst') : 'waves',
    temp: Number.isFinite(s.airF) ? `${Math.round(s.airF)}°` : '–',
    tempsub: isNow && r.current.water ? `water ${Math.round(r.current.water.f)}°` : Number.isFinite(s.pop) && s.pop >= 10 ? `rain ${Math.round(s.pop)}%` : 'air',
    rec: rec?.head, recSub: rec?.sub, recKind: rec?.kind,
  };
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
  zone: { top: $('#piratecastPanel'), bottom: $('#windmapPanel .wm-map') },
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
    timeDock.refresh();
    return;
  }
  if (state.selT && state.selT < r.now) state.selT = null;
  const prevScore = spotSwitch ? parseFloat($('#score .num')?.dataset.v) : NaN; // for the spot-switch count-up
  mountScore($('#score'), r);
  renderWindow($('#window'), r, { onPick: t => { setTime(t, { from: 'window' }); $('#piratecastPanel').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); } });
  tideGraph.reset();
  lastDayKey = '';
  pirateCast.render(r, state.selT);          // silent: positions the highlight
  setTime(state.selT, { from: 'cast' });     // then sync everything to the shared time
  if (spotSwitch) { // count card + dock up together from the previous spot's score (never diverges)
    const card = $('#score .num'), dockNum = $('#timedock [data-c=score]'), to = parseFloat(card?.dataset.v);
    const pre = dockNum && dockNum.textContent.startsWith('≈') ? '≈' : '';
    countUp([{ el: card, format: v => v.toFixed(1) }, { el: dockNum, format: v => pre + v.toFixed(1) }], prevScore, to);
  }
  renderDetails($('#details'), r);
  const missing = Object.entries(r.status).filter(([, ok]) => !ok).map(([k]) => ({ tide: 'tides', wind: 'observed wind', buoy: 'wave buoy', forecast: 'forecast' }[k]));
  $('#sourceNote').textContent = missing.length ? `Temporarily unavailable: ${missing.join(', ')}.` : '';
  if (spotSwitch) fadeIn($('.rail'), $('#piratecastPanel'), $('.tidepanel'));
  timeDock.refresh(); // layout changed (panels shown): re-check whether the dock belongs on screen
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
  timeDock.refresh();
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

