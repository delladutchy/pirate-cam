// Score, best window, condition strip, hourly forecast and detail list.
import { time, range, hour, compass, ft, mins, esc, SOURCE_TAG } from './format.js';

const tag = src => (src ? `<span class="tag tag-${src}">${SOURCE_TAG[src]}</span>` : '');
const etDate = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York' });

export function renderScore(el, cond) {
  const s = cond.score;
  if (s.score == null) {
    const notCfg = s.reason === 'not-configured';
    el.className = 'score tone-none';
    el.innerHTML = `<div class="kicker">Skim score</div>
      <div class="big muted">${notCfg ? 'Not rated yet' : '—'}</div>
      <div class="sub">${notCfg ? `${esc(cond.spot.name)}'s skim profile hasn't been set up yet. Live conditions are below.` : 'Conditions temporarily unavailable'}</div>`;
    return;
  }
  el.className = `score tone-${s.tone}`;
  const reasons = s.reasons.map(r => `<li class="${r.sign === '+' ? 'pos' : 'neg'}"><b>${r.sign === '+' ? '+' : '−'}</b>${esc(r.text)}</li>`).join('');
  el.innerHTML = `<div class="kicker">Skim score</div>
    <div class="scoreline"><span class="big">${s.score.toFixed(1)}</span><span class="lbl"><i></i>${s.label}</span></div>
    <details class="why"><summary>Why this score?</summary><ul>${reasons}</ul>
    <p class="fine">Pirate View estimate from NOAA data${s.confidence < 1 ? ' · some data unavailable, scored on what was' : ''}.</p></details>`;
}

export function renderWindow(el, cond) {
  const w = cond.window, now = cond.now;
  el.className = 'window';
  if (w.state === 'unknown') { el.innerHTML = cond.score.reason === 'not-configured' ? '' : `<div class="kicker">Best skim window</div><div class="mid muted">Not available</div>`; el.hidden = !el.innerHTML; return; }
  el.hidden = false;
  if (w.state === 'none') {
    el.innerHTML = `<div class="kicker">Best skim window</div><div class="mid">No good window</div><div class="sub">Nothing better than MAYBE in daylight over the next 24 hours.</div>`;
    return;
  }
  const day = etDate(w.start) === etDate(now) ? '' : 'Tomorrow ';
  if (w.state === 'go') {
    el.innerHTML = `<div class="kicker go">Go now</div><div class="mid">Best conditions are happening now</div><div class="sub">Good until ${time(w.end)}</div>`;
  } else {
    const soon = w.minutesUntil <= 180 ? `Conditions improve over the next ${mins(w.minutesUntil)}.` : `Better conditions expected around ${hour(w.bestT).replace('a', ' AM').replace('p', ' PM')}.`;
    el.innerHTML = `<div class="kicker wait">Wait · best skim window</div><div class="mid">${day}${range(w.start, w.end)}</div><div class="sub">${soon}</div>`;
  }
}

export function renderStrip(el, cond) {
  const c = cond.current;
  const item = (k, v, sub, src) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub || '&nbsp;'}</div>${tag(src)}</div>`;
  const na = k => `<div class="cell na"><div class="k">${k}</div><div class="v">—</div><div class="s">Not available</div></div>`;
  let h = '';
  h += c.wind ? item('Wind', `${compass(c.wind.fromDeg)} ${Math.round(c.wind.mph)}<small> mph</small>`, Number.isFinite(c.wind.gustMph) ? `gusts ${Math.round(c.wind.gustMph)}` : '', c.wind.source) : na('Wind');
  h += c.tide ? item('Tide', `${c.tide.height.toFixed(1)}<small> ft</small>`, c.tide.rising ? 'Incoming' : 'Outgoing', 'fcst') : na('Tide');
  h += c.waves ? item('Waves', `${c.waves.ft.toFixed(1)}<small> ft</small>${c.waves.periodS ? `<small> @ ${Math.round(c.waves.periodS)}s</small>` : ''}`, c.energy ? `${c.energy.label} shorebreak` : '', c.waves.source) : na('Waves');
  if (c.water) h += item('Water', `${Math.round(c.water.f)}°`, '', c.water.source);
  if (c.air) h += item('Air', `${Math.round(c.air.f)}°`, '', c.air.source);
  el.innerHTML = h;
}

export function renderTideSummary(el, cond) {
  const t = cond.current.tide;
  if (!t) { el.innerHTML = ''; return; }
  const ev = (k, e) => (e ? `<div><div class="k">${k}</div><div class="v">${time(e.t)}</div><div class="s">${ft(e.v)}</div></div>` : '');
  const order = t.nextHigh && t.nextLow && t.nextLow.t < t.nextHigh.t ? [['Low', t.nextLow], ['High', t.nextHigh]] : [['High', t.nextHigh], ['Low', t.nextLow]];
  el.innerHTML = `<div><div class="k">Tide now</div><div class="v">${t.height.toFixed(1)} ft</div><div class="s">${t.rising ? 'Rising' : 'Falling'}</div></div>${order.map(([k, e]) => ev(k, e)).join('')}`;
}

export function renderHourly(el, cond) {
  const w = cond.window;
  const inWin = (t, i) => w && w.start && w.end > t && w.start < (i === 0 ? new Date(t.getTime() + 60 * 6e4 - (t.getMinutes() * 6e4)) : new Date(t.getTime() + 36e5)); // cell overlaps window
  el.innerHTML = cond.hourly.map((s, i) => {
    const sc = s.score;
    const wind = s.wind ? `<span class="arrow" style="transform:rotate(${(s.wind.fromDeg ?? 0) + 180}deg)">↑</span>${Math.round(s.wind.mph)}` : '–';
    const tide = s.tide ? (s.tide.rising ? '↗' : '↘') : '';
    const bar = sc == null ? 0 : Math.max(4, sc * 10);
    return `<div class="hr ${inWin(s.t, i) ? 'best' : ''} ${s.daylight ? '' : 'night'} ${sc == null ? '' : 'tone-' + s.tone}">
      <div class="t">${i === 0 ? 'Now' : hour(s.t)}</div>
      <div class="n">${sc == null ? '–' : sc.toFixed(1)}</div>
      <div class="bar"><i style="height:${bar}%"></i></div>
      <div class="w" title="Wind mph">${wind}</div>
      <div class="td" title="Tide">${tide}</div></div>`;
  }).join('');
}

export function renderDetails(el, cond) {
  const c = cond.current, src = cond.spot.sources;
  const row = (k, v, s, source) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s || ''}${source ? ' · ' + SOURCE_TAG[source] : ''}</span></div>`;
  let h = '';
  if (c.wind) h += row('Wind', `${compass(c.wind.fromDeg)} ${Math.round(c.wind.mph)} mph${Number.isFinite(c.wind.gustMph) ? `, gusts ${Math.round(c.wind.gustMph)}` : ''}`, c.wind.source === 'obs' ? `${src.obsName}, ${time(c.wind.t)}` : 'NWS', c.wind.source);
  else h += row('Wind', 'Not available');
  if (c.waves) h += row('Waves', `${c.waves.ft.toFixed(1)} ft${c.waves.periodS ? ` @ ${Math.round(c.waves.periodS)} s` : ''}${Number.isFinite(c.waves.fromDeg) ? ` from ${compass(c.waves.fromDeg)}` : ''}`, c.waves.source === 'obs' ? `${src.buoyName}, ${time(c.waves.t)}` : 'NWS', c.waves.source);
  else h += row('Waves', 'Not available');
  if (c.energy) h += row('Shorebreak energy', c.energy.label, 'From wave height & period', 'est');
  if (c.tide) h += row('Tide', `${c.tide.height.toFixed(2)} ft, ${c.tide.rising ? 'rising' : 'falling'} ${Math.abs(c.tide.rateFtHr).toFixed(1)} ft/hr`, `NOAA ${src.tideName}`, 'fcst');
  else h += row('Tide', 'Not available');
  if (c.water) h += row('Water', `${Math.round(c.water.f)}°F`, c.water.where, c.water.source);
  if (c.air) h += row('Air', `${Math.round(c.air.f)}°F`, c.air.where, c.air.source);
  if (c.pop != null) h += row('Rain chance', `${Math.round(c.pop)}%`, 'NWS', 'fcst');
  const sr = cond.daylight.find(r => r.sunset > cond.now);
  if (sr) h += row(sr.sunrise > cond.now ? 'Sunrise' : 'Sunset', time(sr.sunrise > cond.now ? sr.sunrise : sr.sunset), '');
  if (cond.score.score != null) h += row('Skim score', `${cond.score.score.toFixed(1)} ${cond.score.label}`, 'Pirate View', 'est');
  el.innerHTML = h;
}
