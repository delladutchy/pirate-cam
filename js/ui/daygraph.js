// PirateCast — the day's Pirate Score graph over the SKIM WINDOW (1 h after sunrise → 1 h
// before sunset, Delaware time) with a draggable marker, and a slim time-aligned weather row
// underneath. Holds no selection of its own: it draws the app's shared selected time and
// reports picks.
// - Color follows the existing score labels: ≥ 7 (GOOD and above) green, 5–6.9 (MAYBE/DECENT)
//   amber, < 5 (POOR) muted red.
// - Time already past and time without forecast data are shown as such — never filled in.
// - Drag (mouse or finger) or tap anywhere on the graph; ← → keys step 15 min / 1 h.
import { hour, short, time } from './format.js';
import { conditionText } from '../engine/weather.js';
import { wxIcon } from './wxicons.js';

const HOUR = 3600e3;
export const band = s => (s >= 7 ? 'g' : s >= 5 ? 'a' : 'r');

/** Whole hours inside [a, b] for the weather row: every hour when there is room, else every
 *  2 h on even hours (8, 10, 12…). */
export function weatherHours(a, b, width) {
  const span = (b - a) / HOUR;
  const step = width / Math.max(1, span) >= 92 ? 1 : 2;
  const out = [];
  let t = Math.ceil(a / HOUR) * HOUR;
  if (step === 2) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(t)); if (h % 2) t += HOUR; }
  for (; t <= b; t += step * HOUR) out.push(t);
  return out;
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

  function render(cond, day, selT, range) {
    const W = Math.max(300, Math.round(el.clientWidth || 640)), H = W < 500 ? 150 : 170;
    const padL = 22, padR = 8, top = 14, bottom = 22, base = H - bottom;
    if (!range) {
      el.innerHTML = `<p class="na">No skim hours on this day.</p>`;
      geo = null; return;
    }
    const t0 = range.start.getTime(), t1 = range.end.getTime(), span = t1 - t0;
    const X = t => padL + (t - t0) / span * (W - padL - padR);
    const Y = v => top + (1 - v / 10) * (base - top);
    const pts = cond.timeline.filter(s => s.t >= range.start && s.t <= range.end);
    const nowMs = cond.now.getTime();

    let svg = `<svg class="daygraph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="slider" tabindex="0" aria-label="Pirate Score through the skim hours, ${time(range.start)} to ${time(range.end)}, 0 to 10 — drag or use arrow keys to choose a time">`;
    svg += `<rect x="${padL}" y="${top}" width="${W - padL - padR}" height="${base - top}" class="dg-day"/>`;
    // rating tiers from the existing score labels (score.js LABELS): faint lines + names in each band
    for (const v of [5, 6, 7, 8, 9]) svg += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="dg-guide${v === 5 || v === 7 ? ' major' : ''}"/>`;
    for (const v of [0, 5, 7, 10]) svg += `<text x="${padL - 5}" y="${Y(v) + 3.5}" class="dg-axis" text-anchor="end">${v}</text>`;
    const tiers = [[0, 5, 'POOR'], [5, 6, 'MAYBE'], [6, 7, 'DECENT'], [7, 8, 'GOOD'], [8, 9, 'VERY GOOD'], [9, 10, 'FIRING']];
    for (const [lo, hi, name] of tiers) svg += `<text x="${W - padR - 4}" y="${(Y(lo) + Y(hi)) / 2 + 3}" class="dg-tier" text-anchor="end">${name}</text>`;
    // past (today) and no-data spans
    if (nowMs > t0) { const a = X(Math.min(nowMs, t1)); svg += `<rect x="${padL}" y="${top}" width="${a - padL}" height="${base - top}" class="dg-past"/>` + (a - padL > 40 ? `<text x="${(padL + a) / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">Past</text>` : ''); }
    const lastScored = [...pts].reverse().find(s => s.score != null);
    if (lastScored && lastScored.t.getTime() + 15 * 60e3 < t1) {
      const a = X(lastScored.t.getTime() + 15 * 60e3);
      svg += `<rect x="${a}" y="${top}" width="${W - padR - a}" height="${base - top}" class="dg-nodata"/>` + (W - padR - a > 60 ? `<text x="${(a + W - padR) / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">Not enough data</text>` : '');
    }
    if (!pts.some(s => s.score != null)) svg += `<text x="${W / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">${cond.score.reason === 'not-configured' ? 'Not rated yet — skim profile not set up' : pts.some(s => s.missing?.includes('waves')) ? 'No nearshore wave forecast — no score this day' : 'Not enough data for a score this day'}</text>`;
    // DAY'S BEST window of this day
    const w = cond.dayWindows?.[day.index];
    if (w && w.start) {
      const a = X(Math.max(w.start.getTime(), t0)), b = X(Math.min(w.end.getTime(), t1));
      // label at the top of the band; when the band hugs the tier names on the right, at its foot instead
      const c = (a + b) / 2, crowded = c > W - padR - 78;
      const lx = Math.min(Math.max(c, padL + 14), W - padR - 14), ly = crowded ? base - 5 : top + 10;
      svg += `<rect x="${a}" y="${top}" width="${Math.max(2, b - a)}" height="${base - top}" class="dg-best"/><text x="${lx}" y="${ly}" class="dg-bestlbl" text-anchor="middle">BEST</text>`;
    }
    // score: filled columns + line, colored per 15-min segment by band; gaps where unscored
    let seg = [];
    const flush = () => {
      for (let i = 0; i < seg.length - 1; i++) {
        const p = seg[i], q = seg[i + 1], c = band((p.score + q.score) / 2);
        svg += `<path d="M${X(p.t)},${base}L${X(p.t)},${Y(p.score)}L${X(q.t)},${Y(q.score)}L${X(q.t)},${base}Z" class="dg-fill dg-${c}"/>`;
        svg += `<line x1="${X(p.t)}" y1="${Y(p.score)}" x2="${X(q.t)}" y2="${Y(q.score)}" class="dg-line dg-${c}"/>`;
      }
      seg = [];
    };
    for (const s of pts) { if (s.score == null) flush(); else seg.push({ t: s.t.getTime(), score: s.score }); }
    flush();
    // time axis: the window's exact edges + whole hours between them
    const hstep = W < 500 ? 2 : 1;
    svg += `<text x="${padL}" y="${H - 6}" class="dg-axis dg-edge" text-anchor="start">${short(range.start)}</text>`;
    svg += `<text x="${W - padR}" y="${H - 6}" class="dg-axis dg-edge" text-anchor="end">${short(range.end)}</text>`;
    for (let t = Math.ceil(t0 / HOUR) * HOUR; t < t1; t += HOUR) {
      const x = X(t);
      if (x - padL < 34 || W - padR - x < 34) continue;
      const h = new Date(t);
      if (hstep === 2 && +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(h) % 2) continue;
      svg += `<text x="${x}" y="${H - 6}" class="dg-axis" text-anchor="middle">${hour(h)}</text>`;
    }
    if (nowMs >= t0 && nowMs <= t1) svg += `<line x1="${X(nowMs)}" x2="${X(nowMs)}" y1="${top}" y2="${base}" class="dg-now"/><text x="${X(nowMs)}" y="${top - 3}" class="dg-nowtxt" text-anchor="middle">NOW</text>`;
    svg += `<g class="dg-marker"><line y1="${top}" y2="${base}"/><g class="dg-dot"><circle r="6"/></g></g></svg>`;

    // time-aligned weather row (NWS forecast for this spot's grid cell)
    const wx = weatherHours(t0, t1, W - padL - padR).map(t => weatherAt(cond.timeline, t)).filter(Boolean);
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
    geo = { W, t0, t1, padL, padR, X, Y, base, pts, cond, minT: Math.max(firstPt, nowMs), maxT: valid.length ? valid.at(-1).t.getTime() : firstPt };
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
    const y = near && near.score != null ? geo.Y(near.score) : geo.base;
    m.classList.toggle('instant', instant || !!drag);
    m.style.transform = `translateX(${geo.X(t)}px)`;
    m.querySelector('.dg-dot').style.transform = `translateY(${y}px)`;
    m.querySelector('.dg-dot').style.opacity = near && near.score != null ? 1 : 0;
    el.querySelector('svg.daygraph').setAttribute('aria-valuetext', `${time(new Date(t))}${near && near.score != null ? ', Pirate Score ' + near.score.toFixed(1) : ', no score'}`);
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
