// Full-day Pirate Score graph (midnight → midnight, Delaware time) with a draggable marker.
// Holds no selection of its own: it draws the app's shared selected time and reports picks.
// - Color follows the existing score labels: ≥ 7 (GOOD and above) green, 5–6.9 (MAYBE/DECENT)
//   amber, < 5 (POOR) muted red. Night hours are capped by the score itself (After dark).
// - Hours already past and hours without forecast data are shown as such — never filled in.
// - Drag (mouse or finger) or tap anywhere on the graph; ← → keys step 15 min / 1 h.
import { hour, time } from './format.js';

const HOUR = 3600e3;
export const band = s => (s >= 7 ? 'g' : s >= 5 ? 'a' : 'r');

export function createDayGraph(el, { onPick }) {
  let geo = null, drag = null;

  function render(cond, day, selT) {
    const W = Math.max(300, Math.round(el.clientWidth || 640)), H = W < 500 ? 150 : 170;
    const padL = 22, padR = 8, top = 14, bottom = 22, base = H - bottom;
    const t0 = day.start.getTime(), t1 = day.end.getTime(), span = t1 - t0;
    const X = t => padL + (t - t0) / span * (W - padL - padR);
    const Y = v => top + (1 - v / 10) * (base - top);
    const pts = cond.timeline.filter(s => s.t >= day.start && s.t < day.end);
    const nowMs = cond.now.getTime();

    let svg = `<svg class="daygraph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="slider" tabindex="0" aria-label="Pirate Score through the day — drag to choose a time">`;
    // night everywhere, daylight lifted on top
    svg += `<rect x="${padL}" y="${top}" width="${W - padL - padR}" height="${base - top}" class="dg-night"/>`;
    for (const r of cond.daylight) {
      const a = Math.max(t0, r.sunrise.getTime()), b = Math.min(t1, r.sunset.getTime());
      if (b > a) svg += `<rect x="${X(a)}" y="${top}" width="${X(b) - X(a)}" height="${base - top}" class="dg-day"/>`;
    }
    // threshold guides at 5 and 7
    for (const v of [5, 7]) svg += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="dg-guide"/><text x="${padL - 5}" y="${Y(v) + 3.5}" class="dg-axis" text-anchor="end">${v}</text>`;
    svg += `<text x="${padL - 5}" y="${Y(10) + 3.5}" class="dg-axis" text-anchor="end">10</text>`;
    // past (today) and no-data spans
    if (nowMs > t0) svg += `<rect x="${padL}" y="${top}" width="${X(Math.min(nowMs, t1)) - padL}" height="${base - top}" class="dg-past"/>` + (X(Math.min(nowMs, t1)) - padL > 40 ? `<text x="${(padL + X(Math.min(nowMs, t1))) / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">Past</text>` : '');
    const lastScored = [...pts].reverse().find(s => s.score != null);
    if (lastScored && lastScored.t.getTime() + 15 * 60e3 < t1) {
      const a = X(lastScored.t.getTime() + 15 * 60e3);
      svg += `<rect x="${a}" y="${top}" width="${W - padR - a}" height="${base - top}" class="dg-nodata"/>` + (W - padR - a > 60 ? `<text x="${(a + W - padR) / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">No forecast</text>` : '');
    }
    if (!pts.some(s => s.score != null)) svg += `<text x="${W / 2}" y="${(top + base) / 2}" class="dg-note" text-anchor="middle">${cond.score.reason === 'not-configured' ? 'Not rated yet — skim profile not set up' : 'No scored forecast for this day'}</text>`;
    // best window of this day
    const w = cond.dayWindows?.[day.index];
    if (w && w.start) {
      const a = X(Math.max(w.start.getTime(), t0)), b = X(Math.min(w.end.getTime(), t1));
      svg += `<rect x="${a}" y="${top}" width="${Math.max(2, b - a)}" height="${base - top}" class="dg-best"/><text x="${(a + b) / 2}" y="${top + 10}" class="dg-bestlbl" text-anchor="middle">BEST</text>`;
    }
    // score: filled columns + line, colored per 15-min segment by band; gaps where unscored
    let seg = [];
    const flush = () => {
      if (seg.length > 1) {
        for (let i = 0; i < seg.length - 1; i++) {
          const p = seg[i], q = seg[i + 1], c = band((p.score + q.score) / 2);
          const dark = !p.daylight && !q.daylight ? ' dg-dark' : ''; // after dark the score is capped; draw it quietly
          svg += `<path d="M${X(p.t)},${base}L${X(p.t)},${Y(p.score)}L${X(q.t)},${Y(q.score)}L${X(q.t)},${base}Z" class="dg-fill dg-${c}${dark}"/>`;
          svg += `<line x1="${X(p.t)}" y1="${Y(p.score)}" x2="${X(q.t)}" y2="${Y(q.score)}" class="dg-line dg-${c}${dark}"/>`;
        }
      }
      seg = [];
    };
    for (const s of pts) { if (s.score == null) flush(); else seg.push({ t: s.t.getTime(), score: s.score, daylight: s.daylight }); }
    flush();
    // hour labels
    const step = W < 500 ? 6 : 3;
    for (let h = 0; h <= 24; h += step) {
      const t = t0 + h * HOUR; if (t > t1) break;
      const x = X(t);
      svg += `<text x="${x}" y="${H - 6}" class="dg-axis" text-anchor="${h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}">${h === 24 ? '12a' : hour(new Date(t))}</text>`;
    }
    if (nowMs >= t0 && nowMs < t1) svg += `<line x1="${X(nowMs)}" x2="${X(nowMs)}" y1="${top}" y2="${base}" class="dg-now"/><text x="${X(nowMs)}" y="${top - 3}" class="dg-nowtxt" text-anchor="middle">NOW</text>`;
    svg += `<g class="dg-marker"><line y1="${top}" y2="${base}"/><g class="dg-dot"><circle r="6"/></g></g></svg>`;
    el.innerHTML = svg;
    const valid = pts.filter(s => s.t.getTime() >= nowMs - 15 * 60e3);
    geo = { W, t0, t1, X, Y, base, pts, cond, minT: Math.max(t0, nowMs), maxT: valid.length ? valid.at(-1).t.getTime() : t0 };
    place(selT, true);
  }

  function place(selT, instant = false) {
    if (!geo) return;
    const m = el.querySelector('.dg-marker');
    const t = (selT || geo.cond.now).getTime();
    if (t < geo.t0 || t >= geo.t1) { m.style.display = 'none'; return; }
    m.style.display = '';
    let near = null, d = Infinity;
    for (const s of geo.pts) { const x = Math.abs(s.t - t); if (x < d) { d = x; near = s; } }
    const y = near && near.score != null ? geo.Y(near.score) : geo.base;
    m.classList.toggle('instant', instant || !!drag);
    m.style.transform = `translateX(${geo.X(t)}px)`;
    m.querySelector('.dg-dot').style.transform = `translateY(${y}px)`;
    m.querySelector('.dg-dot').style.opacity = near && near.score != null ? 1 : 0;
    el.querySelector('svg').setAttribute('aria-valuetext', `${time(new Date(t))}${near && near.score != null ? ', Pirate Score ' + near.score.toFixed(1) : ', no score'}`);
  }

  const timeAt = clientX => {
    const r = el.querySelector('svg').getBoundingClientRect();
    const x = (clientX - r.left) * (geo.W / r.width);
    const t = geo.t0 + (x - 22) / (geo.W - 30) * (geo.t1 - geo.t0);
    return new Date(Math.min(geo.maxT, Math.max(geo.minT, Math.round(t / 9e5) * 9e5)));
  };
  el.addEventListener('pointerdown', e => {
    if (!geo || !e.target.closest('svg')) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: e.pointerType === 'mouse' };
    if (drag.active) { el.querySelector('svg').setPointerCapture(e.pointerId); onPick(timeAt(e.clientX), { dragging: true }); }
  });
  el.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      const dx = Math.abs(e.clientX - drag.x0), dy = Math.abs(e.clientY - drag.y0);
      if (dx > 8 && dx > dy * 1.2) { drag.active = true; el.querySelector('svg').setPointerCapture(e.pointerId); } else return;
    }
    e.preventDefault();
    onPick(timeAt(e.clientX), { dragging: true });
  });
  let suppress = false;
  const end = e => { if (drag && e.pointerId === drag.id) { if (drag.active) { suppress = true; setTimeout(() => { suppress = false; }, 0); onPick(timeAt(e.clientX), { dragging: false }); } drag = null; } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { drag = null; });
  el.addEventListener('click', e => { if (geo && !suppress && e.target.closest('svg')) onPick(timeAt(e.clientX), { dragging: false }); });
  el.addEventListener('keydown', e => {
    if (!geo || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    onPick(null, { step: (e.shiftKey ? 1 : 0.25) * HOUR * (e.key === 'ArrowRight' ? 1 : -1) });
  });

  return { render, place, get dragging() { return !!drag?.active; } };
}
