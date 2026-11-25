// PirateCast's compact readouts for the shared selected time, directly under the graph:
//  · the selected-conditions line — "8.7 · Very Good · Fri 12 PM" (PirateCast) or
//    "Clean · 2.4 ft · Fri 12 PM" (Waves), colour-coded, a moon at night, and the hour's
//    weather (icon + temperature), which also opens the hourly weather row;
//  · a small compass: the beach's shoreline (land shaded), where the wind and the waves come
//    from, with the two readings beside it.
// Display only: everything comes from the app's selected sample. Missing values stay missing.
import { compass, esc, MOON } from './format.js';
import { conditionText } from '../engine/weather.js';
import { surfaceQuality, SURFACE } from '../engine/surface.js';
import { wxIcon } from './wxicons.js';

const title = w => (w || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const CHEV = '<svg class="ps-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** s: the selected sample (with .night); label: "Now" / "Fri 12 PM"; mode: 'score' | 'waves'; open: hourly row shown */
export function renderSel(el, cond, s, { label, mode, open }) {
  let main;
  if (mode === 'waves') {
    const q = surfaceQuality(cond.spot.profile?.shoreFacingDeg ?? null, s.wind, s.waves);
    const ft = s.waves && Number.isFinite(s.waves.ft) ? `${s.waves.ft.toFixed(1)} ft` : 'No wave data';
    main = `${q ? `<b class="ps-v sf-t-${q.cls}">${SURFACE[q.cls].label}</b><i>·</i>` : ''}<span>${ft}</span>`;
  } else if (cond.score.reason === 'not-configured') main = '<span class="ps-na">Not rated yet</span>';
  else if (s.score == null) main = `<span class="ps-na">${s.missing?.includes('waves') ? 'No wave data' : 'No data'}</span>`;
  else main = `<b class="ps-v tone-${s.tone}${s.confidence === 'low' ? ' low' : ''}">${s.score.toFixed(1)}</b><i>·</i><span class="tone-${s.tone} ps-l">${esc(title(s.label))}</span>`;
  const cond0 = conditionText(s.sky, s.wx), night = s.daylight === false;
  const wx = cond0 || Number.isFinite(s.airF)
    ? `${wxIcon(night && cond0 ? cond0.replace(/Sunny/, 'Clear') : cond0, night)}<b>${Number.isFinite(s.airF) ? Math.round(s.airF) + '°' : '–'}</b>`
    : '<span class="ps-na">Weather</span>';
  el.className = `pc-sel${s.night ? ' night' : ''}`;
  el.innerHTML = `<span class="ps-main">${main}<i>·</i><span class="ps-t">${esc(label)}</span>${s.night ? `<span class="ps-moon">${MOON}</span>` : ''}</span>`
    + `<button type="button" class="ps-wx" aria-expanded="${open}" aria-controls="pcMore" aria-label="Hourly weather and legend">${wx}${CHEV}</button>`;
}

const REL = { offshore: 'offshore', 'cross-shore': 'cross-shore', onshore: 'onshore', calm: 'calm' };
/** The compass and the two readings. relation: the wind relative to this beach (score.js). */
export function renderDir(el, cond, s, relation) {
  const face = cond.spot.profile?.shoreFacingDeg;
  const w = s.wind, v = s.waves;
  const hasW = w && Number.isFinite(w.mph) && Number.isFinite(w.fromDeg) && w.mph >= 1;
  const hasV = v && Number.isFinite(v.fromDeg);
  const R = 21, C = 24;
  // an arrow from the edge (where it comes FROM) across the centre (where it goes)
  const arrow = (deg, cls, len) => `<g class="${cls}" transform="rotate(${deg} ${C} ${C})"><line x1="${C}" y1="${C - R + 2}" x2="${C}" y2="${C - R + 2 + len}"/><path d="M${C - 4} ${C - R + len - 3}L${C} ${C - R + 3 + len}L${C + 4} ${C - R + len - 3}"/></g>`;
  const land = Number.isFinite(face) ? `<path class="cp-land" transform="rotate(${face + 180} ${C} ${C})" d="M${C - R} ${C}A${R} ${R} 0 0 1 ${C + R} ${C}Z"/><line class="cp-shore" transform="rotate(${face + 180} ${C} ${C})" x1="${C - R}" y1="${C}" x2="${C + R}" y2="${C}"/>` : '';
  const svg = `<svg class="pc-compass" viewBox="0 0 48 48" width="46" height="46" role="img" aria-label="Wind${hasW ? ' from ' + compass(w.fromDeg) : ''}, waves${hasV ? ' from ' + compass(v.fromDeg) : ''}${Number.isFinite(face) ? '; land shaded' : ''}">
    <circle class="cp-ring" cx="${C}" cy="${C}" r="${R}"/>${land}<text class="cp-n" x="${C}" y="8.5" text-anchor="middle">N</text>
    ${hasV ? arrow(v.fromDeg, 'cp-wave', 2 * R - 8) : ''}${hasW ? arrow(w.fromDeg, `cp-wind rel-${relation || 'none'}`, 2 * R - 4) : ''}</svg>`;
  const windTxt = w && Number.isFinite(w.mph) ? (w.mph < 1 ? 'Calm' : `${compass(w.fromDeg)} ${Math.round(w.mph)} mph`) : '–';
  const waveTxt = v && Number.isFinite(v.ft) ? `${Number.isFinite(v.fromDeg) ? compass(v.fromDeg) + ' ' : ''}${v.ft.toFixed(1)} ft${v.periodS ? ` @ ${Math.round(v.periodS)}s` : ''}` : '–';
  el.innerHTML = `${svg}<div class="pc-dirtx">
    <div class="pd-w"><i class="pd-sw wind rel-${relation || 'none'}"></i><b>${windTxt}</b>${relation && relation !== 'calm' && hasW ? `<span class="pd-rel rel-${relation}">${REL[relation]}</span>` : ''}</div>
    <div class="pd-v"><i class="pd-sw wave"></i><b>${waveTxt}</b></div></div>`;
}
