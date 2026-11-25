// Score card (follows the selected PirateCast time), tide summary, details.
import { time, hour, compass, ft, esc, SOURCE_TAG, MOON } from './format.js';
import { setNumbers, cancelNumberTween, rotateTo } from './motion.js';
import { surfaceQuality, SURFACE } from '../engine/surface.js';

const etDate = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
const wk = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
export const whenLabel = (s, cond) => (s === cond.timeline[0] ? 'Now' : `${etDate(s.t) === etDate(cond.now) ? '' : wk(s.t) + ' '}${hour(s.t).replace('a', ' AM').replace('p', ' PM')}`);
/** Label for an exact selected time (null = now): "Now", "8 PM", "Sun 8:15 AM". */
export const timeLabel = (t, cond) => (!t ? 'Now' : `${etDate(t) === etDate(cond.now) ? '' : wk(t) + ' '}${t.getMinutes() ? time(t) : hour(t).replace('a', ' AM').replace('p', ' PM')}`);

const WAVE_SRC = { obs: 'offshore buoy', model: 'nearshore model', fcst: 'offshore fcst' };
const utcRun = d => `${String(d.getUTCHours()).padStart(2, '0')}Z ${d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}`;
/** "NOAA NWPS run 06Z Nov 24 (previous run)" — the model and run behind a wave value. */
export const modelLabel = w => `NOAA NWPS run ${w.runTime ? utcRun(new Date(w.runTime)) : w.run}${w.fallback ? ' (previous run)' : ''}${w.stale ? ' (delayed)' : ''}`;

/** Plain-language condition facts for a sample. Missing values are left out, never guessed. */
export function facts(s) {
  const out = {};
  if (s.waves && Number.isFinite(s.waves.ft)) out.waves = `${s.waves.ft.toFixed(1)}′${s.waves.periodS ? ` @ ${Math.round(s.waves.periodS)}s` : ''}`;
  if (s.wind && Number.isFinite(s.wind.mph)) out.wind = s.wind.mph < 1 ? 'Calm' : `${compass(s.wind.fromDeg)} ${Math.round(s.wind.mph)} mph`.trim();
  if (s.tide) out.tide = `${s.tide.height.toFixed(1)}′ ${s.tide.rising ? '↑' : '↓'}`;
  return out;
}
export function factSentence(s) {
  const bits = [];
  if (s.tide) bits.push(s.tide.rising ? 'Rising tide' : 'Falling tide');
  if (s.wind && Number.isFinite(s.wind.mph)) bits.push(s.wind.mph < 8 ? `Light ${compass(s.wind.fromDeg)} wind` : `${compass(s.wind.fromDeg)} wind ${Math.round(s.wind.mph)} mph`);
  const f = facts(s);
  if (f.waves) bits.push(f.waves);
  return bits.join(' · ');
}

// ---------- score card ----------
// Minimal (it sits above the camera on a phone): the Pirate Score with its rating and the selected
// time, then wind · waves · tide · air in one row. A small moon marks night (the score is still the
// conditions' own). Everything else — the advice line, gusts, wave direction, the model run,
// confidence and why, the factors and the live observations — is one tap away in Details.
const ARROW = '<svg class="f-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l6 10h-4v9h-4v-9H6z"/></svg>';
export function mountScore(el, cond) {
  const notCfg = cond.score.reason === 'not-configured';
  el.className = 'score';
  el.innerHTML = `
    <div class="sc-top">
      ${notCfg ? '<span class="big muted small">Not rated yet</span>' : '<span class="big num" role="img" aria-label="Pirate Score">–</span>'}
      <span class="sc-meta">${notCfg ? '' : `<span class="lbl"><i></i><span class="sc-moon" hidden>${MOON}</span><span class="lbltxt"></span></span>`}<span class="kicker"><span class="mode"></span><span class="when">Now</span></span></span>
      <button type="button" class="backnow" hidden>Now</button>
    </div>
    <div class="facts">
      <div class="f fwind"><span class="fk">Wind</span><span class="fv">${ARROW}<span data-f="wind">–</span></span></div>
      <div class="f"><span class="fk">Waves</span><span class="fv"><span data-f="waves">–</span></span></div>
      <div class="f"><span class="fk">Tide</span><span class="fv"><span data-f="tide">–</span></span></div>
      <div class="f"><span class="fk">Air</span><span class="fv"><span data-f="air">–</span></span></div>
    </div>
    <details class="why"><summary>Details</summary>
      <p class="rec"><b class="rec-h"></b> <span class="rec-s"></span></p>
      <dl class="more"></dl>
      ${notCfg ? '' : '<div class="factors"></div><p class="why-h">Why this score</p><ul></ul>'}
      <p class="fine conf-x"></p>
      <p class="why-h">Live observations</p><div class="obs"></div><p class="fine src"></p>
    </details>`;
}

const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Lower confidence' };
const LONG_REL = { offshore: 'offshore', 'cross-shore': 'cross-shore', onshore: 'onshore', calm: 'calm' };
const FK = { tide: 'Tide', wind: 'Wind', waves: 'Waves' };
/** Why a score has the confidence it has — the same rules as engine/timeline.js confidenceOf. */
function confWhy(s, cond) {
  if (!s.confidence) return '';
  const ahead = (s.t - cond.now) / 3600e3, why = [];
  if ((s.coverage ?? 1) < 0.999) why.push('some inputs are missing');
  if (ahead > 48) why.push('it is more than 2 days ahead');
  if (s.waves?.stale) why.push('the wave model run is late');
  if (s.confidence === 'high') return `${CONF.high}: observed wind and buoy waves.`;
  if (s.confidence === 'medium') return `${CONF.medium}: NWS wind and NOAA NWPS waves, within 2 days.`;
  return `${CONF.low} (dotted underline): ${why.join(', ') || 'less certain inputs'}.`;
}

export function updateScore(el, cond, s, { onBackToNow, label, isNow = s === cond.timeline[0], relation = null, rec = null } = {}) {
  el.querySelector('.mode').textContent = isNow ? '● Live' : '';
  el.querySelector('.mode').classList.toggle('live', isNow);
  el.querySelector('.when').textContent = isNow ? '' : (label || whenLabel(s, cond));
  const back = el.querySelector('.backnow');
  back.hidden = isNow;
  back.onclick = onBackToNow;
  const ul = el.querySelector('.why ul');
  const moon = el.querySelector('.sc-moon'); if (moon) moon.hidden = !s.night;
  if (s.score != null) {
    el.className = `score tone-${s.tone}${s.confidence === 'low' ? ' low' : ''}${s.night ? ' night' : ''}`;
    setNumbers([{ el: el.querySelector('.num'), format: v => v.toFixed(1) }], s.score); // instant: same value as the dock
    el.querySelector('.lbltxt').textContent = s.label;
    const rs = s.reasons || [];
    if (ul) ul.innerHTML = rs.map(r => `<li class="${r.sign === '+' ? 'pos' : 'neg'}"><b>${r.sign === '+' ? '+' : '−'}</b>${esc(r.text)}</li>`).join('');
  } else if (el.querySelector('.num')) {
    cancelNumberTween();
    el.className = `score tone-none${s.night ? ' night' : ''}`;
    el.querySelector('.num').textContent = '–'; el.querySelector('.num').dataset.v = '';
    el.querySelector('.lbltxt').textContent = s.missing?.includes('waves') ? 'No wave data' : 'No data';
    if (ul) ul.innerHTML = '';
  }
  const set = (k, v) => { const e = el.querySelector(`[data-f=${k}]`); if (e.textContent !== v) e.textContent = v; };
  set('wind', s.wind && Number.isFinite(s.wind.mph) ? (s.wind.mph < 1 ? 'Calm' : `${compass(s.wind.fromDeg)} ${Math.round(s.wind.mph)}`) : '–');
  set('waves', s.waves && Number.isFinite(s.waves.ft) ? `${s.waves.ft.toFixed(1)}′${s.waves.periodS ? ` ${Math.round(s.waves.periodS)}s` : ''}` : '–');
  set('tide', s.tide ? `${s.tide.height.toFixed(1)}′ ${s.tide.rising ? '↑' : '↓'}` : '–');
  set('air', Number.isFinite(s.airF) ? `${Math.round(s.airF)}°` : '–');
  // Details: the finer print, each fact once
  const f = facts(s);
  const gust = s.wind && Number.isFinite(s.wind.gustMph) && s.wind.gustMph > s.wind.mph + 0.5 ? `gusts ${Math.round(s.wind.gustMph)} mph` : '';
  const water = isNow && cond.current.water ? `water ${Math.round(cond.current.water.f)}°F` : '';
  const energy = isNow && cond.current.energy ? `${cond.current.energy.label.toLowerCase()} shorebreak (estimate)` : '';
  const rows = [
    ['Wind', [f.wind, gust, relation ? LONG_REL[relation] : ''].filter(Boolean).join(' · ')],
    ['Waves', s.waves ? [f.waves, Number.isFinite(s.waves.fromDeg) ? `from ${compass(s.waves.fromDeg)} (${Math.round(s.waves.fromDeg)}°)` : '', energy].filter(Boolean).join(' · ') : 'Not available'],
    ['Surface', (() => { const q = surfaceQuality(cond.spot.profile?.shoreFacingDeg ?? null, s.wind, s.waves); return q ? `${SURFACE[q.cls].label} (est.) · ${q.why}` : ''; })()],
    ['Model', s.waves ? (s.waves.source === 'model' ? `${modelLabel(s.waves)} · ~1 km offshore` : WAVE_SRC[s.waves.source] || '') : ''],
    ['Tide', s.tide ? `${s.tide.height.toFixed(1)} ft ${s.tide.rising ? '↑' : '↓'}` : 'Not available'],
    ['Weather', [Number.isFinite(s.airF) ? `${Math.round(s.airF)}°F air` : '', water, Number.isFinite(s.pop) ? `rain ${Math.round(s.pop)}%` : ''].filter(Boolean).join(' · ') || 'Not available'],
  ].filter(([, v]) => v);
  el.querySelector('.more').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
  const fx = el.querySelector('.factors');
  if (fx) {
    const w = cond.spot.profile.weights || {};
    fx.innerHTML = s.score != null && s.factors?.length
      ? `<p class="why-h">Score factors</p>${s.factors.map(x => `<div class="fx"><span>${FK[x.key] || x.key}<i>${Math.round((w[x.key] ?? 0) * 100)}%</i></span><span class="fx-bar"><b style="width:${Math.round(x.q * 100)}%"></b></span><span class="fx-v">${x.q.toFixed(2)}</span></div>`).join('')}`
      : '';
  }
  el.querySelector('.conf-x').textContent = s.score != null ? confWhy(s, cond) + (s.night ? ' Night: best times keep to daylight.' : '') : '';
  const r = el.querySelector('.rec');
  r.className = `rec rec-${rec?.kind || ''}`;
  r.querySelector('.rec-h').textContent = rec?.head || '';
  r.querySelector('.rec-s').textContent = rec?.sub || '';
  const rel = el.querySelector('.fwind'); rel.dataset.rel = relation || '';
  rel.title = relation ? `${LONG_REL[relation]} wind` : '';
  const arrow = el.querySelector('.f-arrow');
  const hasDir = s.wind && Number.isFinite(s.wind.fromDeg) && s.wind.mph >= 1;
  arrow.style.visibility = hasDir ? 'visible' : 'hidden';
  if (hasDir) rotateTo(arrow, s.wind.fromDeg + 180); // arrow shows where the wind blows
}

// ---------- tide: one compact line + Details (follows the selection) ----------
/** head: "Tide · 3.3 ft ↓"; details: the next high and low (times, heights), the phase and rate,
 *  and where the prediction comes from. */
export function renderTideSummary(head, details, cond, s, label) {
  if (!cond.tide || !s.tide) { head.innerHTML = '<span class="muted">Tide unavailable</span>'; details.innerHTML = ''; return; }
  head.innerHTML = `Tide <i>·</i> <b>${s.tide.height.toFixed(1)} ft ${s.tide.rising ? '↑' : '↓'}</b>`;
  const nh = cond.tide.nextHigh(s.t), nl = cond.tide.nextLow(s.t);
  const ev = (k, e) => (e ? `<div><div class="k">Next ${k}</div><div class="v">${time(e.t)}</div><div class="s">${ft(e.v)}</div></div>` : '');
  const order = nh && nl && nl.t < nh.t ? [['low', nl], ['high', nh]] : [['high', nh], ['low', nl]];
  const rate = Number.isFinite(s.tide.rateFtHr) ? ` · ${Math.abs(s.tide.rateFtHr).toFixed(1)} ft/hr` : '';
  details.innerHTML = `<div><div class="k">${label && label !== 'Now' ? esc(label) : 'Now'}</div><div class="v">${s.tide.height.toFixed(1)} ft</div><div class="s">${s.tide.rising ? 'Rising' : 'Falling'}${rate}</div></div>${order.map(([k, e]) => ev(k, e)).join('')}`
    + `<p class="tide-src">NOAA tide predictions · ${esc(cond.spot.sources?.tideName || 'NOAA CO-OPS')} · heights above MLLW</p>`;
}

// ---------- details (current observations; secondary) ----------
export function renderDetails(el, cond) {
  const c = cond.current, src = cond.spot.sources;
  const row = (k, v, s, source) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s || ''}${source ? ' · ' + SOURCE_TAG[source] : ''}</span></div>`;
  let h = '';
  if (c.wind) h += row('Wind', `${compass(c.wind.fromDeg)} ${Math.round(c.wind.mph)} mph${Number.isFinite(c.wind.gustMph) ? `, gusts ${Math.round(c.wind.gustMph)}` : ''}`, c.wind.source === 'obs' ? `${src.obsName}, ${time(c.wind.t)}` : 'NWS', c.wind.source);
  else h += row('Wind', 'Not available');
  const wk = c.usesNwps ? 'Waves · buoy' : 'Waves';
  if (c.waves) h += row(wk, `${c.waves.ft.toFixed(1)} ft${c.waves.periodS ? ` @ ${Math.round(c.waves.periodS)} s` : ''}${Number.isFinite(c.waves.fromDeg) ? ` from ${compass(c.waves.fromDeg)} (${Math.round(c.waves.fromDeg)}°)` : ''}`, c.waves.source === 'obs' ? `${src.buoyName}, ${time(c.waves.t)}` : 'NWS', c.waves.source);
  else h += row(wk, 'Not available', c.usesNwps ? `${src.buoyName}: no recent report` : '');
  if (c.energy) h += row('Shorebreak energy', c.energy.label, 'From wave height & period', 'est');
  if (c.usesNwps) {
    if (c.waveModel) h += row('Waves · nearshore model', `${c.waveModel.ft.toFixed(1)} ft @ ${Math.round(c.waveModel.periodS)} s from ${compass(c.waveModel.fromDeg)} (${Math.round(c.waveModel.fromDeg)}°)`, `${modelLabel(c.waveModel)}, ~1 km offshore · used by Pirate Score`, 'model');
    else h += row('Waves · nearshore model', 'Not available', 'NOAA NWPS · no Pirate Score without it');
  }
  if (c.tide) h += row('Tide', `${c.tide.height.toFixed(2)} ft, ${c.tide.rising ? 'rising' : 'falling'} ${Math.abs(c.tide.rateFtHr).toFixed(1)} ft/hr`, `NOAA ${src.tideName}`, 'fcst');
  else h += row('Tide', 'Not available');
  if (c.water) h += row('Water', `${Math.round(c.water.f)}°F`, c.water.where, c.water.source);
  if (c.air) h += row('Air', `${Math.round(c.air.f)}°F`, c.air.where, c.air.source);
  if (c.pop != null) h += row('Rain chance', `${Math.round(c.pop)}%`, 'NWS', 'fcst');
  const sr = cond.daylight.find(r => r.sunset > cond.now);
  if (sr) h += row(sr.sunrise > cond.now ? 'Sunrise' : 'Sunset', time(sr.sunrise > cond.now ? sr.sunrise : sr.sunset), '');
  const n0 = cond.timeline[0];
  if (cond.score.score != null) h += row('Pirate Score', `${cond.score.score.toFixed(1)} ${cond.score.label}${n0.skimmable === false ? ' · night' : ''}`, 'Pirate View', 'est');
  el.innerHTML = h;
}
