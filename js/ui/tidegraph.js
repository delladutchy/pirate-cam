// Interactive 24-hour tide graph, synced with PirateCast through the app's ONE
// shared selected time (this module never stores its own selection).
//
// - Static layer (curve, night, best window, highs/lows, now pulse) is drawn once
//   per spot/time-window; only the playhead moves. The window is stable: today's 24 h (from 3 h
//   ago), or the selected day — it never slides along with a selection, and it holds still while
//   any forecast graph is being dragged.
// - Tap/click selects a time. Press-and-drag scrubs continuously (Pointer Events +
//   pointer capture). On touch, `touch-action: pan-y` leaves vertical swipes to the
//   browser (page scroll) and gives us horizontal drags.
// - The playhead dot rides the real tide curve (makeTide interpolation), not a fixed Y.
// - Keyboard: ← → move 1 h, Shift+← → move 15 min.
import { short, hour, time } from './format.js';

const HOUR = 3600e3;
const SPAN = 24 * HOUR;
const PAD = 8;

export function createTideGraph(el, { onPick }) {
  let geo = null;            // { fromMs, W, H, cond, X, Y, tide, minT, maxT }
  let drag = null;           // { id, x0, y0, active, type }
  let lastT = null;

  function windowFor(cond, selT, dayFrom) {
    const today = cond.now.getTime() - 3 * HOUR;
    if (dayFrom == null) return today;
    const t = selT ? selT.getTime() : today;
    return t >= today && t <= today + SPAN ? today : dayFrom; // a selection still inside today's window keeps it
  }

  function render(cond, selT, { force = false, instant = false, hold = false, from: dayFrom = null } = {}) {
    const { tide, now, daylight, window: win } = cond;
    if (!tide) { el.innerHTML = '<p class="na">Tide data temporarily unavailable</p>'; geo = null; return; }
    const W = Math.max(300, Math.round(el.clientWidth || 640));
    // While dragging, the time window is frozen so the graph never jumps under the finger.
    if (geo && geo.cond === cond && geo.W === W && (drag?.active || (!force && (hold || geo.fromMs === windowFor(cond, selT, dayFrom))))) { place(selT, instant); return; }
    const fromMs = windowFor(cond, selT, dayFrom);
    const from = new Date(fromMs), to = new Date(fromMs + SPAN);
    const H = W < 500 ? 106 : 132, top = 20, bottom = 18; // compact: ~70 px of curve on a phone; the top row holds the playhead label
    const pts = [];
    for (let t = fromMs; t <= to.getTime(); t += 10 * 60e3) { const d = new Date(t); if (tide.covers(d)) pts.push([t, tide.at(d).height]); }
    if (pts.length < 2) { el.innerHTML = '<p class="na">Tide data temporarily unavailable</p>'; geo = null; return; }
    const hs = pts.map(p => p[1]);
    const lo = Math.min(...hs), hi = Math.max(...hs), span = Math.max(0.5, hi - lo);
    const X = t => PAD + (t - fromMs) / SPAN * (W - 2 * PAD);
    const Y = h => top + (1 - (h - lo) / span) * (H - top - bottom);
    const base = H - bottom;

    let svg = `<svg class="tidegraph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="slider" tabindex="0" aria-label="Tide graph — drag or use arrow keys to choose a time" aria-valuetext="">`;
    let cursor = fromMs;
    const day = daylight.filter(r => r.sunset > from && r.sunrise < to).sort((a, b) => a.sunrise - b.sunrise);
    const night = (a, b) => { if (b > a) svg += `<rect x="${X(a)}" y="0" width="${X(b) - X(a)}" height="${base}" class="night"/>`; };
    for (const r of day) { night(cursor, Math.max(cursor, r.sunrise.getTime())); cursor = Math.max(cursor, r.sunset.getTime()); }
    night(cursor, to.getTime());
    if (win && win.start && win.end > from && win.start < to) {
      const a = X(Math.max(win.start.getTime(), fromMs)), b = X(Math.min(win.end.getTime(), to.getTime()));
      svg += `<rect x="${a}" y="0" width="${Math.max(2, b - a)}" height="${base}" class="bestband"/>`;
    }
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    svg += `<path d="${line}L${X(pts.at(-1)[0])},${base}L${X(pts[0][0])},${base}Z" class="area"/><path d="${line}" class="curve"/>`;
    for (let t = Math.ceil(fromMs / (3 * HOUR)) * 3 * HOUR; t <= to.getTime(); t += 3 * HOUR) {
      const x = X(t); if (x < 18 || x > W - 18) continue;
      svg += `<text x="${x}" y="${H - 5}" class="tick" text-anchor="middle">${hour(new Date(t))}</text>`;
    }
    for (const e of tide.events.filter(e => e.t >= from && e.t <= to)) {
      const x = X(e.t.getTime()), y = Y(e.v);
      const anchor = x < 40 ? 'start' : x > W - 40 ? 'end' : 'middle';
      // highs labelled just under the crest, lows just above the trough: inside the curve's band,
      // clear of the playhead label (top) and the hours (bottom)
      svg += `<circle cx="${x}" cy="${y}" r="2.5" class="hl"/><text x="${x}" y="${e.type === 'H' ? y + 14 : y - 7}" class="hltxt" text-anchor="${anchor}">${e.type} ${e.v.toFixed(1)} · ${short(e.t)}</text>`;
    }
    const n = tide.covers(now) ? tide.at(now) : null;
    if (n && now >= from) {
      const x = X(now.getTime()), y = Y(n.height);
      svg += `<circle cx="${x}" cy="${y}" r="5" class="nowring"/><circle cx="${x}" cy="${y}" r="3.5" class="nowdot"/>`;
    }
    // hover preview (desktop) and the selected playhead — both moved with CSS transforms
    svg += `<g class="hoverhead" style="display:none"><line x1="0" x2="0" y1="20" y2="${base}"/><text class="hv-txt" y="${base - 6}" text-anchor="middle"></text></g>`;
    svg += `<g class="playhead"><line x1="0" x2="0" y1="20" y2="${base}"/><g class="ph-dot"><circle r="6"/></g><text class="ph-txt" y="14" text-anchor="middle"></text></g>`;
    svg += '</svg>';
    el.innerHTML = svg;
    // Selectable range: the visible window ∩ [now, end of the forecast timeline] ∩ tide coverage.
    const tlEnd = cond.timeline.at(-1).t.getTime();
    geo = { fromMs, W, H, cond, X, Y, tide, minT: Math.max(fromMs, now.getTime()), maxT: Math.min(fromMs + SPAN, tlEnd, pts.at(-1)[0]) };
    place(selT, true);
  }

  function place(selT, instant = false) {
    if (!geo) return;
    const svg = el.querySelector('svg'), ph = el.querySelector('.playhead');
    const t = selT || geo.cond.now;
    lastT = t;
    const s = geo.tide.covers(t) ? geo.tide.at(t) : null;
    if (!s || t.getTime() < geo.fromMs || t.getTime() > geo.fromMs + SPAN) { ph.style.display = 'none'; return; }
    ph.style.display = '';
    const x = geo.X(t.getTime()), y = geo.Y(s.height);
    ph.classList.toggle('instant', instant || !!drag?.active);
    ph.style.transform = `translateX(${x}px)`;
    ph.querySelector('.ph-dot').style.transform = `translateY(${y}px)`;
    const txt = ph.querySelector('.ph-txt');
    txt.textContent = `${s.height.toFixed(1)} ft ${s.rising ? '↑' : '↓'}${drag?.active ? ' · ' + time(t) : ''}`;
    txt.setAttribute('text-anchor', x < 60 ? 'start' : x > geo.W - 60 ? 'end' : 'middle');
    svg.setAttribute('aria-valuetext', `${time(t)}, tide ${s.height.toFixed(1)} feet, ${s.rising ? 'rising' : 'falling'}`);
    if (instant && !drag?.active) requestAnimationFrame(() => requestAnimationFrame(() => ph.classList.remove('instant')));
  }

  // ---- pointer → time ----
  function timeAtClientX(clientX) {
    const svg = el.querySelector('svg'); const r = svg.getBoundingClientRect();
    const x = (clientX - r.left) * (geo.W / r.width);
    const t = geo.fromMs + (x - PAD) / (geo.W - 2 * PAD) * SPAN;
    return new Date(Math.min(geo.maxT, Math.max(geo.minT, t)));
  }

  el.addEventListener('pointerdown', e => {
    if (!geo || !e.target.closest('svg') || e.button > 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, type: e.pointerType, active: false };
    if (e.pointerType === 'mouse') { // mouse: scrub immediately
      drag.active = true;
      el.querySelector('svg').setPointerCapture(e.pointerId);
      el.classList.add('scrubbing');
      onPick(timeAtClientX(e.clientX), { dragging: true });
    }
  });

  el.addEventListener('pointermove', e => {
    if (!geo) return;
    if (drag && e.pointerId === drag.id) {
      if (!drag.active) {
        // touch/pen: only a deliberate horizontal drag scrubs; vertical stays page scroll
        const dx = Math.abs(e.clientX - drag.x0), dy = Math.abs(e.clientY - drag.y0);
        if (dx > 8 && dx > dy * 1.2) {
          drag.active = true;
          el.querySelector('svg').setPointerCapture(e.pointerId);
          el.classList.add('scrubbing');
        } else return;
      }
      e.preventDefault();
      onPick(timeAtClientX(e.clientX), { dragging: true });
      return;
    }
    if (e.pointerType === 'mouse') hover(e.clientX); // subtle preview, desktop only
  });

  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasDrag = drag.active;
    drag = null;
    el.classList.remove('scrubbing');
    if (wasDrag) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); onPick(lastT, { dragging: false, end: true }); }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; el.classList.remove('scrubbing'); } });
  el.addEventListener('pointerleave', () => { const h = el.querySelector('.hoverhead'); if (h) h.style.display = 'none'; });

  let suppressClick = false;
  el.addEventListener('click', e => {
    if (!geo || suppressClick || !e.target.closest('svg')) return;
    onPick(timeAtClientX(e.clientX), { dragging: false });
  });

  el.addEventListener('keydown', e => {
    if (!geo || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.25 : 1) * HOUR * (e.key === 'ArrowRight' ? 1 : -1);
    const base = (lastT || geo.cond.now).getTime();
    onPick(new Date(Math.min(geo.maxT, Math.max(geo.cond.now.getTime(), base + step))), { dragging: false });
  });

  function hover(clientX) {
    const h = el.querySelector('.hoverhead'); if (!h) return;
    const t = timeAtClientX(clientX);
    h.style.display = '';
    h.style.transform = `translateX(${geo.X(t.getTime())}px)`;
    h.querySelector('.hv-txt').textContent = short(t);
  }

  return { render, place, reset: () => { geo = null; }, get dragging() { return !!drag?.active; } };
}
