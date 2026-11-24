// Score card (follows the selected PirateCast time), tide summary, details.
import { time, hour, compass, ft, esc, SOURCE_TAG } from './format.js';
import { setNumbers, cancelNumberTween, rotateTo } from './motion.js';

const etDate = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
const wk = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });
export const whenLabel = (s, cond) => (s === cond.timeline[0] ? 'Now' : `${etDate(s.t) === etDate(cond.now) ? '' : wk(s.t) + ' '}${hour(s.t).replace('a', ' AM').replace('p', ' PM')}`);
/** Label for an exact selected time (null = now): "Now", "8 PM", "Sun 8:15 AM". */
export const timeLabel = (t, cond) => (!t ? 'Now' : `${etDate(t) === etDate(cond.now) ? '' : wk(t) + ' '}${t.getMinutes() ? time(t) : hour(t).replace('a', ' AM').replace('p', ' PM')}`);

// Small compass: N tick + an arrow pointing where the wind BLOWS TO (meteorological from + 180).
const COMPASS = '<svg class="wcompass" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" class="wc-ring"/><text x="18" y="7.5" class="wc-n" text-anchor="middle">N</text><g class="wc-arrow"><path d="M18 7l5 9h-3.3v12h-3.4V16H13z"/></g></svg>';
const REL = { offshore: 'Offshore', 'cross-shore': 'Cross-shore', onshore: 'Onshore', calm: 'Calm' };
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
export function mountScore(el, cond) {
  const notCfg = cond.score.reason === 'not-configured';
  el.className = 'score';
  el.innerHTML = `
    <div class="kicker"><span class="mode"></span><span class="when">Now</span><button type="button" class="backnow" hidden>Now</button></div>
    ${notCfg ? `<div class="big muted small">Not rated yet</div><div class="sub">${esc(cond.spot.name)}'s skim profile hasn't been set up yet.</div>`
    : `<div class="scoreline"><span class="big num" role="img" aria-label="Pirate Score">–</span><span class="lbl"><i></i><span class="lbltxt"></span></span><span class="conf"></span></div>`}
    <div class="rec"><b class="rec-h"></b> <span class="rec-s"></span></div>
    <div class="facts">
      <div class="f fwind"><span class="fk">Wind</span><span class="fv">${COMPASS}<span><span data-f="wind">–</span><span class="fs" data-f="windsub"></span></span></span></div>
      <div class="f"><span class="fk">Waves</span><span class="fv"><span><span data-f="waves">–</span><span class="fs" data-f="wavesub"></span></span></span></div>
      <div class="f"><span class="fk">Tide</span><span class="fv"><span><span data-f="tide">–</span><span class="fs" data-f="tidesub"></span></span></span></div>
      <div class="f"><span class="fk">Temp</span><span class="fv"><span><span data-f="air">–</span><span class="fs" data-f="airsub"></span></span></span></div>
    </div>
    ${notCfg ? '' : '<details class="why"><summary>Why this score?</summary><ul></ul><p class="fine">Pirate View estimate from NOAA data.</p></details>'}`;
}

const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

export function updateScore(el, cond, s, { onBackToNow, label, isNow = s === cond.timeline[0], relation = null, rec = null } = {}) {
  el.querySelector('.mode').textContent = isNow ? '● Live now' : 'Forecast · ';
  el.querySelector('.mode').classList.toggle('live', isNow);
  el.querySelector('.when').textContent = isNow ? '' : (label || whenLabel(s, cond));
  const back = el.querySelector('.backnow');
  back.hidden = isNow;
  back.onclick = onBackToNow;
  if (s.score != null) {
    el.className = `score tone-${s.tone}`;
    setNumbers([{ el: el.querySelector('.num'), format: v => v.toFixed(1) }], s.score); // instant: same value as the dock
    el.querySelector('.lbltxt').textContent = s.label;
    const rs = s.reasons || [];
    el.querySelector('.why ul').innerHTML = rs.map(r => `<li class="${r.sign === '+' ? 'pos' : 'neg'}"><b>${r.sign === '+' ? '+' : '−'}</b>${esc(r.text)}</li>`).join('');
    el.querySelector('.why').style.visibility = '';
  } else if (el.querySelector('.num')) {
    cancelNumberTween();
    el.className = `score tone-none${s.outside ? ' outside' : ''}`;
    el.querySelector('.num').textContent = '–'; el.querySelector('.num').dataset.v = '';
    // outside skim hours is not a bad score — it's no skim forecast at all
    el.querySelector('.lbltxt').textContent = s.outside ? (s.daylight ? 'Outside skim hours' : 'After dark') : s.missing?.includes('waves') ? 'No wave forecast' : 'Not enough data';
    el.querySelector('.why ul').innerHTML = '';
    el.querySelector('.why').style.visibility = 'hidden'; // nothing to explain (the line above says why) — space kept so nothing jumps
  }
  const f = facts(s);
  const set = (k, v) => { el.querySelector(`[data-f=${k}]`).textContent = v; };
  set('wind', f.wind || 'Not available');
  const gust = s.wind && Number.isFinite(s.wind.gustMph) && s.wind.gustMph > s.wind.mph + 0.5 ? `gusts ${Math.round(s.wind.gustMph)}` : '';
  set('windsub', [gust, relation ? REL[relation] : ''].filter(Boolean).join(' · '));
  set('waves', f.waves || 'Not available');
  // offshore wave data is NOT the beach shorebreak: say where it comes from; the shorebreak line is an estimate
  const energy = isNow && cond.current.energy ? `${cond.current.energy.label.toLowerCase()} shorebreak (est.)` : '';
  set('wavesub', [s.waves ? WAVE_SRC[s.waves.source] || 'offshore fcst' : '', s.waves && Number.isFinite(s.waves.fromDeg) ? compass(s.waves.fromDeg) : '', energy].filter(Boolean).join(' · '));
  const fine = el.querySelector('.why .fine');
  if (fine) fine.textContent = s.waves?.source === 'model' ? `Pirate View estimate. Waves: ${modelLabel(s.waves)}, ~1 km offshore (a model forecast, not a beach measurement).` : 'Pirate View estimate from NOAA data.';
  set('tide', f.tide || 'Not available');
  set('tidesub', s.tide ? (s.tide.rising ? 'Rising · incoming' : 'Falling · outgoing') : '');
  set('air', Number.isFinite(s.airF) ? `${Math.round(s.airF)}°F` : 'Not available');
  const water = isNow && cond.current.water ? `water ${Math.round(cond.current.water.f)}°` : '';
  set('airsub', [water, Number.isFinite(s.pop) && s.pop >= 10 ? `rain ${Math.round(s.pop)}%` : '', s.daylight === false ? 'after dark' : ''].filter(Boolean).join(' · '));
  const conf = el.querySelector('.conf');
  if (conf) { conf.textContent = s.confidence ? CONF[s.confidence] : ''; conf.dataset.c = s.confidence || ''; }
  const r = el.querySelector('.rec');
  r.className = `rec rec-${rec?.kind || ''}`;
  r.querySelector('.rec-h').textContent = rec?.head || '';
  r.querySelector('.rec-s').textContent = rec?.sub || '';
  const rel = el.querySelector('.fwind'); rel.dataset.rel = relation || '';
  const arrow = el.querySelector('.wc-arrow');
  const hasDir = s.wind && Number.isFinite(s.wind.fromDeg) && s.wind.mph >= 1;
  arrow.style.visibility = hasDir ? 'visible' : 'hidden';
  if (hasDir) rotateTo(arrow, s.wind.fromDeg + 180); // arrow shows where the wind blows
}

// ---------- tide summary (follows selection) ----------
export function renderTideSummary(el, cond, s, label) {
  if (!cond.tide || !s.tide) { el.innerHTML = ''; return; }
  const nh = cond.tide.nextHigh(s.t), nl = cond.tide.nextLow(s.t);
  const ev = (k, e) => (e ? `<div><div class="k">Next ${k}</div><div class="v">${time(e.t)}</div><div class="s">${ft(e.v)}</div></div>` : '');
  const order = nh && nl && nl.t < nh.t ? [['low', nl], ['high', nh]] : [['high', nh], ['low', nl]];
  el.innerHTML = `<div><div class="k">${label ? (label === 'Now' ? 'Tide now' : 'Tide ' + label) : s === cond.timeline[0] ? 'Tide now' : 'Tide ' + whenLabel(s, cond)}</div><div class="v">${s.tide.height.toFixed(1)} ft</div><div class="s">${s.tide.rising ? 'Rising' : 'Falling'}</div></div>${order.map(([k, e]) => ev(k, e)).join('')}`;
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
  if (n0.skimmable === false && cond.score.reason !== 'not-configured') h += row('Pirate Score', c.daylight ? 'Outside skim hours' : 'After dark', cond.skim?.length ? 'Skim forecast: 1 h after sunrise to 1 h before sunset' : '');
  else if (cond.score.score != null) h += row('Pirate Score', `${cond.score.score.toFixed(1)} ${cond.score.label}`, 'Pirate View', 'est');
  el.innerHTML = h;
}
