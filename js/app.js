// Pirate View — wiring: routing, spot/camera switching, data refresh, the Weekly Skim
// Outlook, and the single "selected forecast time" that PirateCast, the score card, the
// floating time controller, the tide graph and the wind map all share.
import { cams, camSlug } from './config/cameras.js';
import { spots, spotById, resolveHash } from './config/spots.js';
import { loadSpotData } from './data/load.js';
import { buildConditions } from './engine/conditions.js';
import { renderMedia, createFullscreen } from './ui/camera.js';
import { createTideGraph } from './ui/tidegraph.js';
import { mountScore, updateScore, renderTideSummary, renderDetails, timeLabel } from './ui/conditions.js';
import { sampleAt } from './map/model.js';
import { createDayGraph, band } from './ui/daygraph.js';
import { createTimeDock } from './ui/timedock.js';
import { forecastDays } from './engine/days.js';
import { windRelation } from './engine/score.js';
import { skimRangeFor, snapToSkim } from './engine/skim.js';
import { weekOutlook, spotOutlook, spotDayBest } from './engine/week.js';
import { createWeek } from './ui/week.js';
import { renderSel, renderDir } from './ui/forecastbar.js';
import { resolveSelection } from './engine/timeline.js';
import { recommendFor } from './engine/recommend.js';
import { compass } from './ui/format.js';
import { createOceanMap, loadLeaflet } from './ocean/oceanmap.js';
import { createWindMap } from './map/windmap.js';
import { esc } from './ui/format.js';
import { reducedMotion, countUp } from './ui/motion.js';
import { prefs } from './prefs.js';
import { shops, shopSection } from './config/shops.js';
import { windowQuality } from './engine/recommend.js';
import { MOON } from './ui/format.js';
import { time } from './ui/format.js';

const $ = s => document.querySelector(s);
const camBySlug = Object.fromEntries(cams.map(c => [camSlug(c), c]));
const slugs = Object.keys(camBySlug);
const REFRESH_MS = 10 * 60e3;

// selT: the selected forecast time (Date), or null for "now". explicitNow: the user asked for
// "Now" (the Now buttons) — otherwise, once today's forecast hours are over, the page opens on
// the next day's best time so PirateCast, the dock and the score card all show the same day.
const state = { wxOpen: false, spotId: null, cam: null, results: {}, selT: null, explicitNow: false, view: 'forecast', weekMode: 'spot',
  graph: { mode: prefs.pirateCast.mode === 'waves' ? 'waves' : 'score', range: prefs.pirateCast.range === '5d' ? '5d' : 'day' }, r5: 0 }; // results[spotId] = conditions | 'error'

// ---------- routing ----------
const VIEWS = { '#favorites': 'favorites', '#shop': 'shop' };
function initialRoute() {
  return (!VIEWS[location.hash] && resolveHash(location.hash, slugs))
    || (prefs.favorite && spotById(prefs.favorite) && resolveHash('#' + prefs.favorite, slugs))
    || resolveHash('#dewey', slugs);
}

function select(spotId, cam) {
  const spot = spotById(spotId);
  const camChoices = spot.cams.length ? spot.cams : spot.nearbyCams || [];
  cam = camChoices.includes(cam) ? cam : camChoices[0];
  const spotChanged = spotId !== state.spotId, camChanged = cam !== state.cam;
  state.spotId = spotId; state.cam = cam;
  if (state.view === 'forecast') history.replaceState(null, '', '#' + (cam === spot.cams[0] || !spot.cams.length ? spot.id : cam));
  if (camChanged) showCamera();
  else if (spotChanged) showCaption(); // same camera, new spot (e.g. Conquest → Dewey): update the caption, never reload the player
  renderSpotNav();
  renderAngles();
  if (spotChanged) { renderConditions(true); ensureLoaded(spotId); updateMap(); }
}

window.addEventListener('hashchange', route);
function route() {
  const v = VIEWS[location.hash];
  if (v) return showView(v);
  const r = resolveHash(location.hash, slugs);
  showView('forecast');
  if (r) select(r.spotId, r.cam);
  else history.replaceState(null, '', '#' + state.spotId);
}

// ---------- views: forecast (default) · favorites · shop ----------
function showView(v) {
  const was = state.view;
  state.view = v;
  document.body.dataset.view = v;
  $('#favView').hidden = v !== 'favorites';
  $('#shopView').hidden = v !== 'shop';
  $('#favNav').toggleAttribute('aria-current', v === 'favorites');
  $('#shopNav').toggleAttribute('aria-current', v === 'shop');
  if (v === 'favorites') renderFavorites();
  if (v === 'shop') renderShop();
  if (v !== was) window.scrollTo(0, 0);
  timeDock.refresh();
  if (v === 'forecast' && was !== 'forecast') { // layout came back: redraw what measures its width
    const r = current(); if (r) { lastDayKey = ''; setTime(state.selT, { from: 'view' }); tideGraph.render(r, state.selT || r.now, { force: true }); }
  }
}
// "‹ Forecast" and the logo go back to the forecast of the current beach
document.addEventListener('click', e => {
  const a = e.target.closest('[data-back], #homeLink');
  if (!a) return;
  e.preventDefault();
  location.hash = '#' + state.spotId;
});

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
  const angle = c.name.replace(/^(Bethany|Inlet) /, ''); // "Dewey Beach" / "Bethany · Ocean" / "Southside · Overview"
  $('.viewer .fs-name').textContent = c.name === spot.fullName || !spot.cams.includes(state.cam) ? c.name : `${spot.name} · ${angle}`;
}

function renderAngles() {
  const spot = spotById(state.spotId);
  const list = spot.cams.length ? spot.cams : spot.nearbyCams || [];
  const el = $('#angles');
  const nearby = !spot.cams.length; // no camera of its own: the borrowed camera stays labelled as nearby
  if (list.length < 2 && !nearby) { el.innerHTML = ''; return; }
  const label = slug => { const n = camBySlug[slug].name; return spot.cams.length ? n.replace(/^(Bethany|Inlet) /, '') : n; };
  el.innerHTML = (nearby ? '<span class="angles-k">Nearby cams</span>' : '') +
    list.map(s => `<button class="angle ${s === state.cam ? 'active' : ''}" data-cam="${s}">${esc(label(s))}</button>`).join('');
}
$('#angles').addEventListener('click', e => { const b = e.target.closest('[data-cam]'); if (b) select(state.spotId, b.dataset.cam); });

// ---------- beach selector: every beach's score at the ONE selected time ----------
// Now → current scores; a forecast time → each beach's score at that time. The small label at the
// start of the row says which ("Now" / "Wed 10:15 AM"); tapping it returns to Now.
function chipHTML(s) {
  const r = state.results[s.id];
  let val = `<span class="sv muted">${r === undefined ? '' : '–'}</span>`;
  if (r && r !== 'error' && r.score.reason !== 'not-configured') {
    const x = sampleAt(r.timeline, state.selT), nt = x.skimmable === false; // night: the score, muted, with a moon
    if (x.score != null) val = `<span class="sv tone-${x.tone}${nt ? ' night' : ''}">${nt ? MOON : '<i></i>'}${x.score.toFixed(1)}</span>`;
  }
  return val;
}
function renderSpotNav() {
  $('#spots').innerHTML = spots.map(s => `<button class="spot ${s.id === state.spotId ? 'active' : ''}" data-spot="${s.id}" aria-label="${esc(s.fullName)}"><span class="sn">${esc(s.name)}</span>${chipHTML(s)}</button>`).join('');
  syncChips();
  renderWeek();
  if (state.view === 'favorites') renderFavorites();
}
/** Refresh the chips' scores and the time label for the selected time (cheap: no rebuild). */
function syncChips() {
  for (const b of document.querySelectorAll('#spots .spot')) { const h = chipHTML(spotById(b.dataset.spot)), v = b.querySelector('.sv'); if (v && v.outerHTML !== h) v.outerHTML = h; }
  const r = current(), w = $('#spotsWhen');
  const txt = state.selT && r ? timeLabel(state.selT, r) : 'Now';
  if (w.textContent !== txt) w.textContent = txt;
  w.classList.toggle('future', !!state.selT);
  w.disabled = !state.selT;
  w.setAttribute('aria-label', state.selT ? `Scores for ${txt} — tap for now` : 'Scores now');
}
$('#spots').addEventListener('click', e => { const b = e.target.closest('[data-spot]'); if (b) select(b.dataset.spot); });
$('#spotsWhen').addEventListener('click', () => setTime(null, { from: 'now' }));

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

/** Days + each day's skim window and DAY'S BEST, computed once per loaded result. The same
 *  spotDayBest feeds the weekly outlook, so a weekly tap lands exactly on PirateCast's BEST.
 *  (Go/Wait keeps using bestWindow: the earliest good-enough opportunity.) */
function dayInfo(r) {
  if (!r._days) {
    r._days = forecastDays(r.timeline, r.now);
    const HOUR = 3600e3, nowHour = Math.floor(r.now / HOUR) * HOUR;
    for (const d of r._days) {
      d.hours = skimRangeFor(d, r.hours); // useful hours, scored: 1 h before sunrise → 1 h after sunset
      // what PirateCast and the dock show: the whole day (today from the current hour — earlier
      // forecast data isn't kept, and is never made up)
      d.view = { start: new Date(d.index === 0 ? Math.max(d.start.getTime(), nowHour) : d.start.getTime()), end: d.end };
    }
    r.dayWindows = r._days.map(d => spotDayBest(r, d));
  }
  return r._days;
}
const dayOf = (r, t) => dayInfo(r).find(d => t >= d.start && t < d.end) || dayInfo(r)[0];
/** The day PirateCast and the time controller show: always the day of the selected time
 *  ("Now" → today), so the graph, the dock and the score card never disagree. */
function viewDay(r, t) {
  return t ? dayOf(r, t) : dayInfo(r)[0];
}
/** When "Now" wasn't asked for and little or nothing of today's PirateCast hours is left (under
 *  2 h, so today's graph would be almost empty — past forecast data isn't kept, and is never made
 *  up), the page opens on the next day's best time (or its first step). Now still shows today. */
const LATE_MS = 2 * 3600e3;
function autoTime(r) {
  const days = dayInfo(r);
  if (state.explicitNow || !days[0].hours || days[0].hours.end - r.now >= LATE_MS) return null;
  const next = days.find(d => d.index > 0 && d.hours);
  if (!next) return null;
  const w = r.dayWindows[next.index];
  return w?.bestT || snapToSkim(next.hours.start, r.hours, { dir: 1, min: r.now });
}

/** What PirateCast and the dock span: the selected day, or 5 days that include it (the 5-day
 *  window only moves when the selection leaves it). */
function graphRange(r, day) {
  if (state.graph.range !== '5d') return day.view;
  const days = dayInfo(r), n = Math.min(5, days.length);
  let k = state.r5;
  if (day.index < k || day.index > k + n - 1) k = Math.max(0, Math.min(day.index, days.length - n));
  state.r5 = k;
  return { start: days[k].view.start, end: days[k + n - 1].end };
}
function syncPcControls() {
  for (const b of document.querySelectorAll('[data-pc]')) { const [k, v] = b.dataset.pc.split(':'); b.setAttribute('aria-pressed', state.graph[k] === v); }
  $('#piratecastPanel').classList.toggle('wx-open', state.wxOpen);
  $('#pcMore').hidden = !state.wxOpen;
  $('.wv-legend').hidden = state.graph.mode !== 'waves';
  $('.dg-legend').hidden = state.graph.mode === 'waves';
}
document.querySelector('.pc-ctl').addEventListener('click', e => {
  const b = e.target.closest('[data-pc]'); if (!b) return;
  const [k, v] = b.dataset.pc.split(':');
  if (state.graph[k] === v) return;
  state.graph[k] = v; prefs.pirateCast = state.graph;
  syncPcControls(); lastDayKey = ''; setTime(state.selT, { from: 'view' });
});
// the hourly weather row + legend open from the selected-conditions line (collapsed by default)
$('#pcNow').addEventListener('click', () => setTime(null, { from: 'now' }));
$('#pcSel').addEventListener('click', e => {
  const b = e.target.closest('.ps-wx'); if (!b) return;
  state.wxOpen = !state.wxOpen; syncPcControls(); b.setAttribute('aria-expanded', state.wxOpen);
});
// tide Details: next high and low, phase, source
$('.tide-more').addEventListener('click', e => {
  const open = $('#tideSummary').hidden; $('#tideSummary').hidden = !open; e.currentTarget.setAttribute('aria-expanded', open);
  e.currentTarget.textContent = open ? 'Less' : 'Details';
});
syncPcControls();

let lastDayKey = '';
function setTime(t, { from = '', dragging = false, step = 0 } = {}) {
  const r = current(); if (!r) return;
  if (from === 'now' || from === 'back') state.explicitNow = true;
  else if (t || step) state.explicitNow = false;
  if (!t && !step) t = autoTime(r);
  // Any forecast time from now to the end of the forecast, day or night (no snapping): every
  // graph and the dock report picks here, and everything follows this one value.
  t = resolveSelection({ t, step, current: state.selT, now: r.now, end: r.timeline.at(-1).t }); // null = live now
  if (t && step) { const q = 15 * 60e3, g = new Date(Math.round(t / q) * q); t = g > r.now ? g : t; } // keyboard steps stay on the 15-min forecast grid
  state.selT = t;
  const raw = sampleAt(r.timeline, t);
  // night (outside 1 h before sunrise → 1 h after sunset): the same conditions score, shown as night
  const dayNow = viewDay(r, t);
  const s = { ...raw, night: raw.skimmable === false };
  const label = timeLabel(t, r);
  const tideEng = t && r.tide && r.tide.covers(t) ? r.tide.at(t) : s.tide;
  // displayed tide = the drawn curve (NOAA 6-min predictions where published); events stay NOAA hi/lo
  const tc = r.tideCurve?.at(t || r.now);
  const tideNow = tideEng && tc ? { ...tideEng, height: tc.height, rising: tc.rising, rateFtHr: tc.rateFtHr } : tideEng;
  const shown = { ...s, tide: tideNow };
  const relation = windRelation(r.spot.profile.shoreFacingDeg, s.wind);
  const rec = recommendFor(r, raw, t, r.dayWindows[dayNow.index]);
  updateScore($('#score'), r, shown, { label, isNow: !t, relation, rec, onBackToNow: () => setTime(null, { from: 'back' }) });
  timeDock.show(dockView(r, shown, t, relation));
  renderTideSummary($('#tideNow'), $('#tideSummary'), r, { t: t || r.now, tide: tideNow }, label);
  renderSel($('#pcSel'), r, shown, { label, mode: state.graph.mode, open: state.wxOpen });
  renderDir($('#pcDir'), r, shown, relation);
  // the tide chart is one continuous multi-day curve under a fixed centre marker: drags follow
  // instantly, other time changes glide there (no rebuilds, also across midnight)
  tideGraph.render(r, t || r.now, { instant: dragging });
  // PirateCast + dock: rebuilt only when what they span changes (day, 5-day window, mode, data) —
  // never while a 5-day drag crosses midnight; otherwise only the marker moves
  const day = dayNow, range = graphRange(r, day);
  const key = [r.spot.id, state.graph.range === '5d' ? '5d' : day.index, +range.start, +range.end, state.graph.mode, +r.now].join('|');
  if (key !== lastDayKey) { lastDayKey = key; dayGraph.render(r, day, t, range, { mode: state.graph.mode, days: dayInfo(r) }); timeDock.render(r, day, t, range); }
  else { dayGraph.place(t, dragging, day); timeDock.place(t, dragging, day); }
  $('#dayLabel').textContent = `${day.long} · ${day.sub}`;
  syncChips();
  $('#pcNow').hidden = !t;
  if (!dragging) { updateMap(); markWeek(); }
  else scheduleMap();
}

const REL = { offshore: 'Offshore', 'cross-shore': 'Cross', onshore: 'Onshore', calm: 'Calm' };
/** Compact view model for the dock: selected time, score, wind, waves, tide — nothing repeated. */
function dockView(r, s, t, relation) {
  const w = s.wind;
  return {
    score: s.score != null ? s.score.toFixed(1) : '–',
    low: s.confidence === 'low', // shown as the same dotted underline as the weekly outlook
    label: s.score != null ? s.label : r.score.reason === 'not-configured' ? 'Not rated' : 'No data',
    night: !!s.night,
    tone: s.score != null ? s.tone : null,
    wind: w && Number.isFinite(w.mph) ? (w.mph < 1 ? 'Calm' : `${compass(w.fromDeg)} ${Math.round(w.mph)}`) : '–',
    windToDeg: w && Number.isFinite(w.fromDeg) && w.mph >= 1 ? w.fromDeg + 180 : NaN, // arrow shows where it blows TO
    rel: relation, relText: relation ? REL[relation] : '',
    tide: s.tide ? `${s.tide.height.toFixed(1)}′${s.tide.rising ? '↑' : '↓'}` : '–',
    waves: s.waves && Number.isFinite(s.waves.ft) ? `${s.waves.ft.toFixed(1)}′${s.waves.periodS ? ` ${Math.round(s.waves.periodS)}s` : ''}` : '–',
  };
}

// ---------- weekly skim outlook ----------
const week = createWeek($('#weekPanel'), { onPick: pickWeekDay });
let outlook = null, regional = null;
function renderWeek() {
  const pending = spots.some(s => state.results[s.id] === undefined);
  const r = current();
  outlook = state.weekMode === 'spot' ? (r ? spotOutlook(r) : null) : weekOutlook(state.results, spots);
  regional = pending ? null : weekOutlook(state.results, spots); // "Best this week" across all beaches
  week.render(outlook, { pending: state.weekMode === 'spot' ? !r : pending, sel: weekSel(), mode: state.weekMode, spot: spotById(state.spotId), regional: regional?.top || null });
}
function weekSel() {
  const r = current();
  return r ? { dayIndex: viewDay(r, state.selT).index, spotId: state.spotId } : null;
}
function markWeek() { // highlight the day being looked at, without rebuilding the row
  const sel = weekSel();
  for (const b of document.querySelectorAll('#weekPanel .wk-day')) b.classList.toggle('on', !!sel && +b.dataset.wday === sel.dayIndex);
}
/** A weekly day. All spots: switch to that day's best rated spot and select its best time (a
 *  different spot shows that spot's live camera). This spot: only the date and time change. */
function pickWeekDay(i) {
  if (i === 'all' || i === 'spot') { state.weekMode = i; return renderWeek(); }
  if (i === 'top') { // the regional best: that beach and its best time
    const t = regional?.top; if (!t) return;
    if (t.spot.id === state.spotId) return setTime(t.w.bestT, { from: 'week' });
    state.selT = t.w.bestT; state.explicitNow = false; return select(t.spot.id);
  }
  const b = outlook?.days[i]?.best; if (!b) return;
  if (state.weekMode === 'spot' || b.spot.id === state.spotId) return setTime(b.w.bestT, { from: 'week' });
  state.selT = b.w.bestT; // renderConditions() syncs everything to it after the switch
  select(b.spot.id);
}

const tideGraph = createTideGraph($('#tideGraph'), { onPick: (t, o = {}) => setTime(t, { from: 'graph', dragging: !!o.dragging }) });
const oceanMap = createOceanMap($('#oceanPanel'), { onSelectSpot: id => select(id) });
const windMap = createWindMap($('#oceanPanel .wm-box'), { onSelectSpot: id => select(id), loadLeaflet });
// Ocean | Wind: two complementary views in ONE map area (the Wind view is built the first time it's chosen)
function setMapView(v) {
  prefs.mapView = v;
  for (const b of document.querySelectorAll('[data-map]')) b.setAttribute('aria-pressed', String(b.dataset.map === v));
  oceanMap.setShown(v === 'ocean');
  windMap.setShown(v === 'wind');
  $('#oceanPanel .om-credits:not(.wm-credits)').hidden = v !== 'ocean';
  $('#oceanPanel .wm-credits').hidden = v !== 'wind';
  $('#oceanPanel').dataset.mapview = v;
}
document.querySelector('.mapsel').addEventListener('click', e => { const b = e.target.closest('[data-map]'); if (b) setMapView(b.dataset.map); });
const dayGraph = createDayGraph($('#dayGraph'), { onPick: (t, o = {}) => setTime(t, { from: 'graph', dragging: !!o.dragging, step: o.step || 0 }) });
const timeDock = createTimeDock($('#timedock'), {
  onPick: (t, o = {}) => setTime(t, { from: 'dock', dragging: !!o.dragging, step: o.step || 0 }),
  onNow: () => setTime(null, { from: 'now' }),
  zone: { top: $('#piratecastPanel'), bottom: $('#oceanPanel .om-wrap'), avoid: $('#oceanPanel .om-wrap') }, // never over the map: it has its own controls
  enabled: () => state.view === 'forecast',
  // never over a graph or PirateCast's readouts (the map has its own rule: zone.avoid)
  graphs: [() => $('#dayGraph svg.daygraph'), () => $('#tideGraph .tg-view'), () => $('#pcSel'), () => $('#piratecastPanel .pc-row')],
});

function updateMap() {
  const r = current();
  const data = { spots, results: state.results, spotId: state.spotId, t: state.selT, label: r ? timeLabel(state.selT, r) : 'Now' };
  oceanMap.update(data);
  windMap.update(data);
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
  syncFavorite();
  if (r === undefined || r === 'error') {
    $('#score').className = 'score';
    $('#score').innerHTML = r === 'error' ? '<p class="na">Conditions temporarily unavailable</p>' : '<p class="na loading">Loading conditions…</p>';
    for (const id of ['#tideSummary', '#tideGraph', '#dayGraph', '#pcSel', '#pcDir', '#tideNow']) $(id).innerHTML = '';
    tideGraph.reset();
    timeDock.refresh();
    return;
  }
  if (state.selT && state.selT < r.now) state.selT = null;
  const prevScore = spotSwitch ? parseFloat($('#score .num')?.dataset.v) : NaN; // for the spot-switch count-up
  mountScore($('#score'), r);
  tideGraph.reset();
  lastDayKey = '';
  setTime(state.selT, { from: 'spot' });     // sync everything to the shared time
  if (spotSwitch) { // count card + dock up together from the previous spot's score (never diverges)
    const card = $('#score .num'), dockNum = $('#timedock [data-c=score]'), to = parseFloat(card?.dataset.v);
    const pre = dockNum && dockNum.textContent.startsWith('≈') ? '≈' : '';
    countUp([{ el: card, format: v => v.toFixed(1) }, { el: dockNum, format: v => pre + v.toFixed(1) }], prevScore, to);
  }
  renderDetails($('#score .obs'), r);
  const missing = Object.entries(r.status).filter(([, ok]) => ok === false).map(([k]) => ({ tide: 'tides', wind: 'observed wind', buoy: 'wave buoy', forecast: 'forecast', nwps: 'nearshore wave forecast (no Pirate Score without it)' }[k]));
  const wm = r.current.waveModelInfo;
  const late = wm && (wm.fallback || wm.stale) ? ` Nearshore waves: ${wm.fallback ? 'previous NWPS run' : 'NWPS run is late'}.` : '';
  $('#score .src').textContent = (missing.length ? `Temporarily unavailable: ${missing.join(', ')}.` : '') + late;
  if (spotSwitch) fadeIn($('#piratecastPanel'));
  timeDock.refresh(); // layout changed (panels shown): re-check whether the dock belongs on screen
}

// Redraw the graphs only when the WIDTH changes: iPhone Safari fires resize whenever its toolbar
// shows or hides during a scroll, and rebuilding then made the graphs flicker under the finger.
let resizeT, lastW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    const r = current(); if (r) { tideGraph.render(r, state.selT || r.now, { force: true }); lastDayKey = ''; setTime(state.selT, { from: 'resize' }); }
  }, 150);
});


// ---------- full screen: swipe between cameras ----------
// Every camera once, in beach order (Dewey → Bethany's angles → the Inlet → Ocean City), each with
// the beach that owns it. A swipe in full screen moves along this list and selects that beach.
const CAM_ORDER = (() => {
  const seen = new Set(), list = [];
  for (const sp of spots) for (const slug of sp.cams) if (!seen.has(slug) && camBySlug[slug]) {
    seen.add(slug);
    const owner = spots.find(o => o.cams[0] === slug) || sp;
    list.push({ spotId: owner.id, cam: slug });
  }
  return list;
})();
function swipeCam(dir) {
  const i = CAM_ORDER.findIndex(x => x.cam === state.cam);
  const next = CAM_ORDER[((i < 0 ? 0 : i) + dir + CAM_ORDER.length) % CAM_ORDER.length];
  select(next.spotId, next.cam);
}
const camFullscreen = createFullscreen($('.viewer'), $('#fsBtn'), { onSwipe: swipeCam });

// ---------- favorites (this browser only, no account) ----------
const isFav = id => prefs.favorites.includes(id);
function toggleFavorite(id) {
  const f = prefs.favorites;
  prefs.favorites = f.includes(id) ? f.filter(x => x !== id) : [...f, id];
  syncFavorite();
  if (state.view === 'favorites') renderFavorites();
}
function syncFavorite() {
  const on = isFav(state.spotId), b = $('#favBtn'), name = spotById(state.spotId)?.fullName || 'this beach';
  b.setAttribute('aria-pressed', on);
  b.setAttribute('aria-label', on ? `Remove ${name} from Favorites` : `Add ${name} to Favorites`);
  b.title = b.getAttribute('aria-label');
}
$('#favBtn').addEventListener('click', () => toggleFavorite(state.spotId));

const dayName = (d, now) => { const k = x => x.toLocaleDateString('en-US', { timeZone: 'America/New_York' }); return k(d) === k(now) ? 'Today' : k(d) === k(new Date(now.getTime() + 864e5)) ? 'Tomorrow' : d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }); };
/** A provider-supported still for a beach's camera: YouTube's own thumbnail for the Ocean City
 *  streams. Angelcam and DelDOT offer no still image (their players fetch video even when paused),
 *  so those tiles show a quiet camera mark instead — no streams run on this page. */
function camStill(spot) {
  const slug = (spot.cams[0] || spot.nearbyCams?.[0]), c = slug && camBySlug[slug];
  const id = c && c.kind === 'youtube' && c.src.match(/embed\/([\w-]{6,})/)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}
const CAMMARK = '<svg class="fv-cam" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3z"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.6l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z"/></svg>';
/** One favorite tile: camera still, name, the score NOW (colour-coded, moon at night), the best
 *  upcoming daylight time, and a filled star that removes it. The whole tile opens the beach. */
function favCard(id) {
  const spot = spotById(id); if (!spot) return '';
  const r = state.results[id];
  let tone = 'none', score = '<span class="fv-num fv-na">…</span>', best = '';
  if (r === 'error') score = '<span class="fv-num fv-na">–</span>';
  else if (r) {
    const n = r.timeline[0], nt = n.skimmable === false;
    if (r.score.reason === 'not-configured') score = '<span class="fv-lbl">Not rated</span>';
    else if (r.score.score != null) { tone = band(r.score.score); /* the graphs' green / amber / red */ score = `<span class="fv-num">${r.score.score.toFixed(1)}</span><span class="fv-lbl">${nt ? MOON : ''}${r.score.label}</span>`; }
    else score = '<span class="fv-num fv-na">–</span>';
    const w = r.window, q = windowQuality(w);
    if (r.score.reason !== 'not-configured' && w && w.start && q) best = `<span class="fv-best band-${band(w.bestScore)}"><span class="k">Best</span> ${w.state === 'now' ? 'now' : dayName(w.bestT, r.now) + ' ' + time(w.bestT)} · <b>${w.bestScore.toFixed(1)}</b></span>`;
  }
  const still = camStill(spot);
  return `<a class="favtile band-${tone}" href="#${id}" data-fav="${id}" aria-label="${esc(spot.fullName)} — open forecast">
    <span class="fv-prev">${still ? `<img src="${esc(still)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : CAMMARK}</span>
    <span class="fv-body"><span class="fv-name">${esc(spot.name)}</span><span class="fv-score">${score}</span>${best}</span>
    <button type="button" class="fv-star" data-remove="${id}" aria-label="Remove ${esc(spot.fullName)} from Favorites" title="Remove from Favorites">${STAR}</button>
  </a>`;
}
function renderFavorites() {
  const ids = prefs.favorites.filter(id => spotById(id));
  const el = $('#favList');
  if (!ids.length) {
    el.innerHTML = `<div class="empty"><p class="empty-h">No favorites yet</p><p>Tap the ☆ under a beach's camera.</p><a href="#" class="pillbtn" data-back>Back to beaches</a></div>`;
    return;
  }
  el.innerHTML = ids.map(favCard).join('');
  for (const img of el.querySelectorAll('.fv-prev img')) img.addEventListener('error', () => { img.parentElement.innerHTML = CAMMARK; }, { once: true });
}
$('#favList').addEventListener('click', e => {
  const x = e.target.closest('[data-remove]');
  if (x) { e.preventDefault(); e.stopPropagation(); toggleFavorite(x.dataset.remove); } // the star never opens the beach
});

// ---------- shop ----------
function renderShop() {
  $('#shopTitle').textContent = shopSection.title;
  $('#shopNote').textContent = shopSection.note;
  // each tile: the shop's logo as the square (on white, as the shops use it), name and town below;
  // a logo that doesn't load leaves a text square with the name
  $('#shopGrid').innerHTML = shops.map(sh => `<a class="shoptile${sh.logo ? ' has-logo' : ''}" href="${esc(sh.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(sh.name)}, ${esc(sh.town)} — official website (opens in a new tab)">
    <span class="shop-sq">${sh.logo ? `<img src="${esc(sh.logo)}" alt="${esc(sh.name)} logo" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="shop-n">${esc(sh.name)}</span></span>
    <span class="shop-cap"><span class="shop-t">${esc(sh.town)}</span><span class="shop-go">Visit site ↗</span></span></a>`).join('');
  for (const img of $('#shopGrid').querySelectorAll('img')) img.addEventListener('error', () => img.closest('.shoptile').classList.remove('has-logo'), { once: true });
}

// Test hook, only with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) window.__pv = { state, windMap, oceanMap, tideGraph, setTime, setMapView, prefs, get outlook() { return outlook; } };

// ---------- start ----------
const first = initialRoute(), firstView = VIEWS[location.hash] || 'forecast';
state.view = firstView; // before select(): a #favorites / #shop link keeps its address
select(first.spotId, first.cam);
setMapView(prefs.mapView);
syncFavorite();
showView(firstView);
if (prefs.camOnly) prefs.camOnly = false; // "Cam only" was retired: full screen does that job

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

