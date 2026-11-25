// Bottom time dock — a navigation tool, not a dashboard: one line with the selected time, Pirate
// Score, wind, waves and tide, and the coloured scrubber (+ NOW) under it. The scrubber spans the
// selected day (today from the current hour); night has no score colour. Days are picked in the
// Weekly Skim Outlook or by dragging the tide chart across midnight.
// Sits above the iPhone home indicator (safe-area inset). Like every control it only reports
// picks — the app owns the ONE selected time.
import { time } from './format.js';
import { band } from './daygraph.js';
import { rotateTo } from './motion.js';

const ARROW = '<svg class="td-warrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l6 10h-4v9h-4v-9H6z"/></svg>';

export function createTimeDock(dock, { onPick, onNow, zone, enabled = () => true, graphs = [] }) {
  dock.innerHTML = `
    <div class="td-row" aria-hidden="true">
      <span class="td-bubble td-when">Now</span>
      <b class="tc tc-score" data-c="score">–</b>
      <span class="tc tc-wind">${ARROW}<b data-c="wind">–</b></span>
      <b class="tc tc-waves" data-c="waves">–</b>
      <b class="tc tc-tide" data-c="tide">–</b>
    </div>
    <div class="td-track">
      <div class="td-slider" role="slider" tabindex="0" aria-label="Forecast time — drag across the day; arrow keys move 15 minutes, Shift+arrow 1 hour, Home for now, End for the end of the day" aria-valuemin="0">
        <div class="td-strip"></div>
        <div class="td-handle"></div>
      </div>
      <button type="button" class="td-now">Now</button>
    </div>`;
  const slider = dock.querySelector('.td-slider');
  const strip = dock.querySelector('.td-strip'), handle = dock.querySelector('.td-handle'), bubble = dock.querySelector('.td-bubble');
  let ctx = null, drag = null;

  dock.querySelector('.td-now').addEventListener('click', onNow);

  /** day: the selected forecast day; range: the span shown { start, end } (null = none). */
  function render(cond, day, selT, range) {
    if (!range) { strip.style.background = 'var(--td-none)'; ctx = null; bubble.textContent = selT ? time(selT) : 'Now'; dock.querySelector('.td-now').hidden = !selT; return; }
    const pts = cond.timeline.filter(s => s.t >= range.start && s.t < range.end);
    const t0 = range.start.getTime(), span = range.end - range.start, nowMs = cond.now.getTime();
    // a thin strip of the score colors; past and missing parts stay dark
    const stops = [];
    for (let i = 0; i <= 96; i++) {
      const t = t0 + i * span / 96;
      let near = null, d = Infinity;
      for (const s of pts) { const x = Math.abs(s.t - t); if (x < d) { d = x; near = s; } }
      const c = t < nowMs - 9e5 ? 'past' : !near || d > 9e5 ? 'none' : near.skimmable === false ? 'nt' : near.score != null ? band(near.score) : 'none';
      stops.push(`var(--td-${c}) ${(i / 96 * 100).toFixed(2)}%`);
    }
    strip.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    const valid = pts.filter(s => s.t.getTime() >= nowMs - 15 * 60e3);
    const firstPt = pts.length ? pts[0].t.getTime() : t0; // first 15-min step inside the window
    ctx = { cond, day, t0, span, minT: Math.max(firstPt, nowMs), maxT: valid.length ? valid.at(-1).t.getTime() : firstPt };
    slider.setAttribute('aria-valuemax', Math.round(span / 60000));
    place(selT, true);
  }

  function place(selT, instant = false) {
    if (!ctx) return;
    const t = (selT || ctx.cond.now).getTime();
    const raw = (t - ctx.t0) / ctx.span, f = Math.min(1, Math.max(0, raw));
    handle.classList.toggle('instant', instant || !!drag);
    handle.classList.toggle('off', raw < 0 || raw > 1); // outside the span shown: the knob rests at the edge, hollow
    handle.style.left = `${(f * 100).toFixed(3)}%`;
    bubble.textContent = selT ? (ctx.day.index ? `${ctx.day.label} ` : '') + time(new Date(t)) : 'Now';
    dock.querySelector('.td-now').hidden = !selT;
    slider.setAttribute('aria-valuenow', Math.round((t - ctx.t0) / 60000));
    slider.setAttribute('aria-valuetext', bubble.textContent);
  }

  const timeAt = clientX => {
    const r = slider.getBoundingClientRect();
    const t = ctx.t0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * ctx.span;
    return new Date(Math.min(ctx.maxT, Math.max(ctx.minT, Math.round(t / 9e5) * 9e5)));
  };
  // Mouse: drag at once. Touch/pen: a tap sets the time, a horizontal drag scrubs, and a
  // vertical swipe is left to the page (touch-action: pan-y) so scrolling never moves the slider.
  slider.addEventListener('pointerdown', e => {
    if (!ctx) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: e.pointerType === 'mouse' };
    if (drag.active) { slider.setPointerCapture(e.pointerId); dock.classList.add('dragging'); onPick(timeAt(e.clientX), { dragging: true }); }
  });
  slider.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.active) {
      const dx = Math.abs(e.clientX - drag.x0), dy = Math.abs(e.clientY - drag.y0);
      if (dx > 6 && dx > dy) { drag.active = true; slider.setPointerCapture(e.pointerId); dock.classList.add('dragging'); }
      else return;
    }
    e.preventDefault();
    onPick(timeAt(e.clientX), { dragging: true });
  });
  const end = e => {
    if (!drag || drag.id !== e.pointerId) return;
    const wasDrag = drag.active, moved = Math.abs(e.clientY - drag.y0) > 10;
    drag = null; dock.classList.remove('dragging');
    if (wasDrag || !moved) onPick(timeAt(e.clientX), { dragging: false }); // tap or end of a drag
  };
  slider.addEventListener('pointerup', end);
  slider.addEventListener('pointercancel', () => { drag = null; dock.classList.remove('dragging'); }); // page took the gesture (scroll)
  slider.addEventListener('keydown', e => {
    const H = 3600e3, dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); onPick(null, { step: (e.shiftKey ? 1 : 0.25) * H * dir }); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); onPick(null, { step: 3 * H * (e.key === 'PageUp' ? 1 : -1) }); }
    else if (e.key === 'Home') { e.preventDefault(); ctx && ctx.minT > ctx.cond.now.getTime() + 8 * 60e3 ? onPick(new Date(ctx.minT), {}) : onNow(); }
    else if (e.key === 'End') { e.preventDefault(); if (ctx) onPick(new Date(ctx.maxT), {}); }
  });

  /** The line for the selected time (a small view model from the app). */
  function show(vm) {
    const set = (k, v) => { const el = dock.querySelector(`[data-c=${k}]`); if (el.textContent !== v) el.textContent = v; };
    const sc = dock.querySelector('.tc-score');
    sc.className = `tc tc-score ${vm.tone ? 'tone-' + vm.tone : 'none'}${vm.low ? ' low' : ''}`;
    set('score', vm.score);
    set('wind', vm.wind);
    dock.querySelector('.tc-wind').dataset.rel = vm.rel || '';
    const a = dock.querySelector('.td-warrow');
    a.style.visibility = Number.isFinite(vm.windToDeg) ? 'visible' : 'hidden';
    if (Number.isFinite(vm.windToDeg)) rotateTo(a, vm.windToDeg);
    set('tide', vm.tide); set('waves', vm.waves);
    dock.setAttribute('aria-label', `Forecast time ${bubble.textContent}: Pirate Score ${vm.score === '–' ? 'none' : vm.score}${vm.low ? ' (lower confidence)' : ''}, wind ${vm.wind}, waves ${vm.waves}, tide ${vm.tide}`);
  }

  // Visibility: one zone, from the top of PirateCast to the bottom edge of the ocean map, and only
  // where the strip it occupies isn't over one of the graphs. 28 px of hysteresis stops it
  // flickering at the edges; it stays put while being dragged.
  const HYST = 28;
  let shown = false, raf = 0;
  function check() {
    raf = 0;
    if (!zone.top || !zone.bottom) return;
    const vh = window.innerHeight, dockH = dock.offsetHeight || 64;
    const band = vh - dockH - 16;                     // top of the strip the dock covers
    const tr = zone.top.getBoundingClientRect(), br = zone.bottom.getBoundingClientRect();
    const laidOut = enabled() && tr.height > 0 && br.height > 0 && !document.body.classList.contains('cam-only'); // hidden while loading / cam-only / other views
    // stop at the map's bottom edge: the credits line and all text sit below it, so they never meet the dock
    const top = tr.top, bottom = br.bottom;
    // gone once `zone.avoid` (the ocean map, with its own timeline) is really in view — it fills
    // more than half of the screen above the dock. While only its top part peeks in under the
    // graphs, PirateCast keeps the dock.
    const av = zone.avoid?.getBoundingClientRect();
    const mapShown = av ? Math.min(av.bottom, band) - Math.max(av.top, 0) : 0;
    const overAvoid = !!av && av.height > 0 && av.bottom > band && mapShown > vh * 0.5;
    // never sit over a graph: PirateCast's score graph or the tide chart — the dock
    // appears in the space between them (titles, weather row, tide summary, legends)
    const covers = graphs.map(f => f()).filter(Boolean).reduce((m, g) => {
      const r = g.getBoundingClientRect(); return Math.max(m, Math.min(r.bottom, vh) - Math.max(r.top, band));
    }, 0);
    const wantShow = laidOut && !overAvoid && covers <= 0 && top < band - HYST && bottom > vh + HYST;
    const mustHide = !laidOut || overAvoid || covers > dockH * 0.4 || top > band || bottom < vh + 4;
    const next = drag?.active ? shown : shown ? !mustHide : wantShow;
    if (next !== shown) { shown = next; document.body.classList.toggle('dock-on', shown); }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  schedule();

  return { render, place, show, refresh: schedule, get dragging() { return !!drag?.active; } };
}
