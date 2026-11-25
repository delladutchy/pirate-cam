// PirateCast — the selected day's Pirate Score graph (Delaware time; today from the current hour),
// with sunrise and sunset marked, night lightly shaded, a draggable marker and a slim
// time-aligned weather row underneath. Scores cover 1 h before sunrise → 1 h after sunset; night
// shows conditions elsewhere but no score line. Holds no selection of its own: it draws the
// app's shared selected time and reports picks.
// - Color follows the existing score labels: ≥ 7 (GOOD and above) green, 5–6.9 (MAYBE/DECENT)
//   amber, < 5 (POOR) muted red.
// - Time already past and time without forecast data are shown as such — never filled in.
// - Drag (mouse or finger) or tap anywhere on the graph; ← → keys step 15 min / 1 h.
import { hour, short, time } from './format.js';
import { conditionText } from '../engine/weather.js';
import { windowQuality } from '../engine/recommend.js';
import { surfaceQuality, SURFACE } from '../engine/surface.js';
import { wxIcon } from './wxicons.js';

const HOUR = 3600e3;
export const band = s => (s >= 7 ? 'g' : s >= 5 ? 'a' : 'r');

/** Whole hours inside [a, b] for the weather row, spaced so cells never crowd: every hour when
 *  there is room, else every 2, 3, 4 or 6 h on matching clock hours (8, 10, 12… / 9, 12, 15…).
 *  With `has(t)` (is there forecast weather at t?), only hours with data are used — late in the
 *  day, when few hours remain, every remaining hour is shown rather than none. */
export function weatherHours(a, b, width, has = null) {
  const span = (b - a) / HOUR, pxh = width / Math.max(1, span);
  const all = [];
  for (let t = Math.ceil(a / HOUR) * HOUR; t < b; t += HOUR) all.push(t); // the end (next midnight) belongs to the next day
  const avail = has ? all.filter(has) : all;
  let step = [1, 2, 3, 4, 6, 12, 24].find(k => k * pxh >= 46) || 24;
  if (pxh < 92 && step < 2 && span > 4) step = 2; // the old rule: hourly only with ~92 px per hour
  if (step > 1 && has && avail.length && (avail.at(-1) - avail[0]) / HOUR * pxh < 3 * 92) step = 1; // a short stretch left: every hour
  if (step === 1) return avail;
  const hr = t => +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(t));
  return avail.filter(t => (step === 24 ? hr(t) === 12 : hr(t) % step === 0)); // daily: noon
}

/** Weather for one forecast hour from the spot's own timeline (nearest 15-min sample at that
 *  hour). Missing values stay missing. */
export function weatherAt(timeline, t) {
  const s = timeline.find(x => Math.abs(x.t - t) < 8 * 60e3);
  if (!s) return null;
  return {
    t: new Date(t),
    temp: Number.isFinite(s.airF) ? Math.round(s.airF) : null,
    cond: conditionText(s.sky, s.wx),
    pop: Number.isFinite(s.pop) ? Math.round(s.pop) : null,
  };
}

export function createDayGraph(el, { onPick }) {
  let geo = null, drag = null;

  /** opts.mode: 'score' (Pirate Score) | 'waves' (NWPS wave height, coloured by estimated
   *  surface quality). range may be one day or several (5 Days). */
  function render(cond, day, selT, range, opts = {}) {
    const mode = opts.mode === 'waves' ? 'waves' : 'score';
    const W = Math.max(300, Math.round(el.clientWidth || 640)), H = W < 500 ? 132 : 160;
    const padL = 22, padR = 6, top = 12, bottom = 20, base = H - bottom;
    if (!range) {
      el.innerHTML = `<p class="na">No forecast hours on this day.</p>`;
      geo = null; return;
    }
    const t0 = range.start.getTime(), t1 = range.end.getTime(), span = t1 - t0, multi = span > 36 * HOUR;
    const X = t => padL + (t - t0) / span * (W - padL - padR);
    const pts = cond.timeline.filter(s => s.t >= range.start && s.t < range.end);
    const nowMs = cond.now.getTime();
    const suns = (cond.daylight || []).filter(r => r.sunset.getTime() >= t0 && r.sunrise.getTime() <= t1);
    const usefuls = (cond.skim || []).filter(r => r.end.getTime() >= t0 && r.start.getTime() <= t1); // scored hours
    const scored = s => s.score != null && s.skimmable !== false; // no score line at night
    // waves mode: the nearshore wave height (ft) — the y axis fits the data, at least 0–4 ft
    const wv = s => (s.waves && Number.isFinite(s.waves.ft) ? s.waves.ft : null);
    const wMax = Math.max(4, Math.ceil(Math.max(0, ...pts.map(wv).filter(v => v != null)) + 0.5));
    const Y = mode === 'waves' ? v => top + (1 - v / wMax) * (base - top) : v => top + (1 - v / 10) * (base - top);
    const face = cond.spot.profile?.shoreFacingDeg ?? null;
    const surf = s => surfaceQuality(face, s.wind, s.waves)?.cls || 'none';

    const what = mode === 'waves' ? 'Nearshore wave height (NOAA NWPS), coloured by estimated surface quality' : 'Pirate Score, 0 to 10, scored from 1 hour before sunrise to 1 hour after sunset';
    let svg = `<svg class="daygraph${mode === 'waves' ? ' waves' : ''}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="slider" tabindex="0" aria-label="${what} — drag or use arrow keys to choose any time">`;
    svg += `<rect x="${padL}" y="${top}" width="${W - padL - padR}" height="${base - top}" class="dg-day"/>`;
    // night (outside the scored hours): a slightly darker ground, nothing more
    const night = (a, b) => { const x0 = X(Math.max(t0, a)), x1 = X(Math.min(t1, b)); if (x1 > x0 + 0.5) svg += `<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${base - top}" class="dg-night"/>`; };
    let cur = t0;
    for (const u of usefuls) { night(cur, u.start.getTime()); cur = Math.max(cur, u.end.getTime()); }
    night(cur, t1);
    // sunrise and sunset: a faint line and a small label each (labels on a single day only)
    for (const sun of suns) for (const [t, k] of [[sun.sunrise, 'sunrise'], [sun.sunset, 'sunset']]) {
      if (t.getTime() < t0 || t.getTime() > t1) continue;
      const x = X(t.getTime());
      svg += `<line x1="${x}" x2="${x}" y1="${top}" y2="${base}" class="dg-sun"/>` + (multi ? '' : `<text x="${x + (k === 'sunrise' ? 3 : -3)}" y="${base - 4}" class="dg-suntxt" text-anchor="${k === 'sunrise' ? 'start' : 'end'}">${k} ${short(t)}</text>`);
    }
    // quiet guides: score 5 and 7, or a few wave heights
    const guides = mode === 'waves' ? [1, 2, 3, 4, 6, 8, 10, 12, 15, 20].filter(v => v < wMax).filter((v, i, a) => a.length <= 4 || v % 2 === 0).slice(-4) : [5, 7];
    for (const v of guides) svg += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="dg-guide major"/><text x="${padL - 4}" y="${Y(v) + 3.5}" class="dg-axis" text-anchor="end">${v}${mode === 'waves' ? '′' : ''}</text>`;
    // past (today)
    if (nowMs > t0) { const a = X(Math.min(nowMs, t1)); svg += `<rect x="${padL}" y="${top}" width="${a - padL}" height="${base - top}" class="dg-past"/>`; }
    if (mode === 'score') {
      if (!multi) {
        // no data inside the scored hours (e.g. beyond the wave forecast)
        const useful = usefuls[0], lastScored = [...pts].reverse().find(scored);
        const scoreEnd = useful ? Math.min(t1, useful.end.getTime()) : t1;
        if (lastScored && lastScored.t.getTime() + 15 * 60e3 < scoreEnd) {
          const a = X(lastScored.t.getTime() + 15 * 60e3), b = X(scoreEnd);
          svg += `<rect x="${a}" y="${top}" width="${b - a}" height="${base - top}" class="dg-nodata"/>` + (b - a > 70 ? `<text x="${(a + b) / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">No score data</text>` : '');
        }
        if (!pts.some(scored)) svg += `<text x="${W / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">${cond.score.reason === 'not-configured' ? 'Not rated yet — skim profile not set up' : !useful || nowMs >= useful.end.getTime() ? 'Night — no Pirate Score until 1 h before sunrise' : pts.some(s => s.missing?.includes('waves')) ? 'No nearshore wave forecast — no score this day' : 'Not enough data for a score this day'}</text>`;
      } else if (!pts.some(scored)) svg += `<text x="${W / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">${cond.score.reason === 'not-configured' ? 'Not rated yet — skim profile not set up' : 'No Pirate Scores in these days'}</text>`;
      // each day's best window: "BEST" only when it is actually good; weaker days say what they are,
      // poor days get no band at all (on 5 Days: bands only, no words)
      const days = multi ? (opts.days || []).filter(d => d.end > range.start && d.start < range.end) : [day];
      for (const d of days) {
        const w = cond.dayWindows?.[d.index], q = windowQuality(w);
        if (!(w && w.start && q && q !== 'poor')) continue;
        const a = X(Math.max(w.start.getTime(), t0)), b = X(Math.min(w.end.getTime(), t1));
        const good = q === 'good' || q === 'decent', txt = good ? 'BEST' : 'BEST AVAILABLE';
        svg += `<rect x="${a}" y="${top}" width="${Math.max(2, b - a)}" height="${base - top}" class="dg-best${good ? '' : ' weak'}"/>`;
        if (!multi) { const c = (a + b) / 2, half = good ? 16 : 40; svg += `<text x="${Math.min(Math.max(c, padL + half), W - padR - half)}" y="${top + 10}" class="dg-bestlbl${good ? '' : ' weak'}" text-anchor="middle">${txt}</text>`; }
      }
    } else if (!pts.some(s => wv(s) != null)) {
      svg += `<text x="${W / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">No wave forecast for ${multi ? 'these days' : 'this day'}</text>`;
    }
    // the curve: filled columns + line per 15-min segment; gaps where there is no value
    const val = mode === 'waves' ? wv : s => (scored(s) ? s.score : null);
    const cls = mode === 'waves' ? (p, q) => 'sf-' + (p.c === q.c ? p.c : p.c === 'none' ? q.c : p.c) : (p, q) => 'dg-' + band((p.v + q.v) / 2);
    let seg = [];
    const flush = () => {
      for (let i = 0; i < seg.length - 1; i++) {
        const p = seg[i], q = seg[i + 1], c = cls(p, q);
        svg += `<path d="M${X(p.t)},${base}L${X(p.t)},${Y(p.v)}L${X(q.t)},${Y(q.v)}L${X(q.t)},${base}Z" class="dg-fill ${c}"/>`;
        svg += `<line x1="${X(p.t)}" y1="${Y(p.v)}" x2="${X(q.t)}" y2="${Y(q.v)}" class="dg-line ${c}"/>`;
      }
      seg = [];
    };
    for (const s of pts) { const v = val(s); if (v == null) flush(); else seg.push({ t: s.t.getTime(), v, c: mode === 'waves' ? surf(s) : null }); }
    flush();
    // time axis: whole hours on one day; on 5 Days, the days themselves
    if (multi) {
      for (const d of (opts.days || []).filter(d => d.end > range.start && d.start < range.end)) {
        const x = X(d.start.getTime());
        if (d.start.getTime() > t0) svg += `<line x1="${x}" x2="${x}" y1="${top}" y2="${base}" class="dg-daysep"/>`;
        const mid = X(Math.min(t1, d.end.getTime()) / 2 + Math.max(t0, d.start.getTime()) / 2);
        svg += `<text x="${mid}" y="${H - 6}" class="dg-axis${d.index === day.index ? ' dg-edge' : ''}" text-anchor="middle">${d.index === 0 ? 'Today' : d.label}</text>`;
      }
    } else {
      const pxh = (W - padL - padR) / (span / HOUR), hstep = [1, 2, 3, 4, 6].find(k => k * pxh >= 36) || 6;
      svg += `<text x="${padL}" y="${H - 6}" class="dg-axis dg-edge" text-anchor="start">${short(range.start)}</text>`;
      svg += `<text x="${W - padR}" y="${H - 6}" class="dg-axis dg-edge" text-anchor="end">${short(range.end)}</text>`;
      for (let t = Math.ceil(t0 / HOUR) * HOUR; t < t1; t += HOUR) {
        const x = X(t);
        if (x - padL < 34 || W - padR - x < 34) continue;
        const h = new Date(t);
        if (hstep > 1 && +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(h) % hstep) continue;
        svg += `<text x="${x}" y="${H - 6}" class="dg-axis" text-anchor="middle">${hour(h)}</text>`;
      }
    }
    if (nowMs >= t0 && nowMs <= t1) svg += `<line x1="${X(nowMs)}" x2="${X(nowMs)}" y1="${top}" y2="${base}" class="dg-now"/><text x="${X(nowMs)}" y="${top - 3}" class="dg-nowtxt" text-anchor="middle">NOW</text>`;
    svg += `<g class="dg-marker"><line y1="${top}" y2="${base}"/><g class="dg-dot"><circle r="6"/></g></g></svg>`;

    // time-aligned weather row (NWS forecast for this spot's grid cell)
    const wx = weatherHours(t0, t1, W - padL - padR, t => !!weatherAt(cond.timeline, t)).map(t => weatherAt(cond.timeline, t)).filter(Boolean);
    const any = wx.some(x => x.temp != null || x.cond);
    const row = !any ? '<div class="dg-wx none">Weather forecast not available for these hours</div>'
      : `<div class="dg-wx" aria-label="Weather by hour"><span class="wx-k" aria-hidden="true">Weather</span>${wx.map(x => {
        const pct = X(x.t.getTime()) / W * 100;
        const pop = x.pop != null && x.pop >= 10 ? `${x.pop}%` : '';
        const words = [x.cond || 'Weather not available', x.temp != null ? `${x.temp}°` : '', pop ? `rain ${pop}` : ''].filter(Boolean).join(', ');
        // symbol · temperature · rain chance; the NWS wording is the accessible name and tooltip
        return `<div class="wxc" style="left:${pct.toFixed(2)}%" data-t="${x.t.getTime()}" aria-label="${hour(x.t)}: ${words}" title="${words}">${wxIcon(x.cond)}<b>${x.temp != null ? x.temp + '°' : '–'}</b><span class="pp">${pop || '&nbsp;'}</span></div>`;
      }).join('')}</div>`;
    el.innerHTML = svg + row;
    // cells stay centred on their hour; one that would run past an edge is nudged just inside
    const rowW = el.clientWidth || W;
    for (const c of el.querySelectorAll('.wxc')) {
      const x = parseFloat(c.style.left) / 100 * rowW, half = c.offsetWidth / 2;
      const shift = x - half < 0 ? half - x : x + half > rowW ? rowW - x - half : 0;
      if (shift) c.style.transform = `translateX(calc(-50% + ${shift.toFixed(1)}px))`;
    }
    const valid = pts.filter(s => s.t.getTime() >= nowMs - 15 * 60e3);
    const firstPt = pts.length ? pts[0].t.getTime() : t0; // first 15-min step inside the window
    geo = { W, t0, t1, padL, padR, X, Y, base, pts, cond, val, mode, minT: Math.max(firstPt, nowMs), maxT: valid.length ? valid.at(-1).t.getTime() : firstPt };
    place(selT, true);
  }

  function place(selT, instant = false) {
    if (!geo) return;
    const m = el.querySelector('.dg-marker');
    const t = (selT || geo.cond.now).getTime();
    const inRange = t >= geo.t0 && t <= geo.t1;
    // highlight the weather cell nearest the selected time. Cells are 1 h or 2 h apart and span the
    // graph, so a selection inside the graph always has one; an exact tie (3:30 between 3 PM and
    // 4 PM) goes to the earlier hour, whose forecast covers it
    let on = null, best = Infinity;
    for (const c of el.querySelectorAll('.wxc')) { const d = Math.abs(+c.dataset.t - t); if (d < best) { best = d; on = c; } }
    for (const c of el.querySelectorAll('.wxc')) c.classList.toggle('on', inRange && c === on);
    if (!inRange) { m.style.display = 'none'; return; }
    m.style.display = '';
    let near = null, d = Infinity;
    for (const s of geo.pts) { const x = Math.abs(s.t - t); if (x < d) { d = x; near = s; } }
    const v = near ? geo.val(near) : null, ok = v != null;
    const y = ok ? geo.Y(v) : geo.base;
    m.classList.toggle('instant', instant || !!drag);
    m.style.transform = `translateX(${geo.X(t)}px)`;
    m.querySelector('.dg-dot').style.transform = `translateY(${y}px)`;
    m.querySelector('.dg-dot').style.opacity = ok ? 1 : 0;
    el.querySelector('svg.daygraph').setAttribute('aria-valuetext', `${time(new Date(t))}${!ok ? (geo.mode === 'waves' ? ', no wave forecast' : ', no score') : geo.mode === 'waves' ? `, waves ${v.toFixed(1)} feet${(() => { const q = surfaceQuality(geo.cond.spot.profile?.shoreFacingDeg ?? null, near.wind, near.waves); return q ? ', ' + SURFACE[q.cls].label.toLowerCase() + ' (estimated)' : ''; })()}` : ', Pirate Score ' + v.toFixed(1)}`);
  }

  const timeAt = clientX => {
    const r = el.querySelector('svg.daygraph').getBoundingClientRect();
    const x = (clientX - r.left) * (geo.W / r.width);
    const t = geo.t0 + (x - geo.padL) / (geo.W - geo.padL - geo.padR) * (geo.t1 - geo.t0);
    return new Date(Math.min(geo.maxT, Math.max(geo.minT, Math.round(t / 9e5) * 9e5)));
  };
  el.addEventListener('pointerdown', e => {
    if (!geo || !e.target.closest('svg.daygraph')) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: e.pointerType === 'mouse' };
    if (drag.active) { el.querySelector('svg.daygraph').setPointerCapture(e.pointerId); onPick(timeAt(e.clientX), { dragging: true }); }
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      const dx = Math.abs(e.clientX - drag.x0), dy = Math.abs(e.clientY - drag.y0);
      if (dx > 8 && dx > dy * 1.2) { drag.active = true; el.querySelector('svg.daygraph').setPointerCapture(e.pointerId); } else return;
    }
    e.preventDefault();
    onPick(timeAt(e.clientX), { dragging: true });
  });
  let suppress = false;
  const end = e => { if (drag && e.pointerId === drag.id) { if (drag.active) { suppress = true; setTimeout(() => { suppress = false; }, 0); onPick(timeAt(e.clientX), { dragging: false }); } drag = null; } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { drag = null; });
  el.addEventListener('click', e => {
    if (!geo || suppress) return;
    const c = e.target.closest('.wxc');
    if (c) return onPick(new Date(Math.min(geo.maxT, Math.max(geo.minT, +c.dataset.t))), { dragging: false });
    if (e.target.closest('svg.daygraph')) onPick(timeAt(e.clientX), { dragging: false });
  });
  el.addEventListener('keydown', e => {
    if (!geo || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    onPick(null, { step: (e.shiftKey ? 1 : 0.25) * HOUR * (e.key === 'ArrowRight' ? 1 : -1) });
  });

  return { render, place, get dragging() { return !!drag?.active; } };
}
