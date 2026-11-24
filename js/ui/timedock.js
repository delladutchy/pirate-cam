// Bottom time dock — the master forecast scrubber: a compact conditions strip for the selected
// time, a one-line recommendation with NOW, and the slider with a floating time bubble. The
// slider spans the selected day's SKIM WINDOW (1 h after sunrise → 1 h before sunset); days
// are picked in the Weekly Skim Outlook. Sits above the iPhone home indicator (safe-area inset).
// Like every control it only reports picks — the app owns the ONE selected time.
import { time } from './format.js';
import { band } from './daygraph.js';
import { rotateTo } from './motion.js';
import { esc } from './format.js';

const ARROW = '<svg class="td-warrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l6 10h-4v9h-4v-9H6z"/></svg>';

export function createTimeDock(dock, { onPick, onNow, zone }) {
  dock.innerHTML = `
    <div class="td-cond" aria-hidden="true">
      <div class="tc tc-score"><b class="tc-v" data-c="score">–</b><span class="tc-s" data-c="label"></span></div>
      <div class="tc tc-wind">${ARROW}<span><b class="tc-v" data-c="wind">–</b><span class="tc-s" data-c="windsub"></span></span></div>
      <div class="tc"><b class="tc-v" data-c="tide">–</b><span class="tc-s" data-c="tidesub"></span></div>
      <div class="tc"><b class="tc-v" data-c="waves">–</b><span class="tc-s" data-c="wavesub"></span></div>
      <div class="tc tc-temp"><b class="tc-v" data-c="temp">–</b><span class="tc-s" data-c="tempsub"></span></div>
    </div>
    <p class="td-rec" aria-live="polite"></p>
    <div class="td-track">
      <div class="td-slider" role="slider" tabindex="0" aria-label="Forecast time within the skim hours — arrow keys move 15 minutes, Shift+arrow 1 hour, Home for now or the first skim time, End for the last" aria-valuemin="0">
        <div class="td-strip"></div>
        <div class="td-handle"><span class="td-bubble"></span></div>
      </div>
      <button type="button" class="td-now">Now</button>
    </div>`;
  const slider = dock.querySelector('.td-slider');
  const strip = dock.querySelector('.td-strip'), handle = dock.querySelector('.td-handle'), bubble = dock.querySelector('.td-bubble');
  let ctx = null, drag = null;

  dock.querySelector('.td-now').addEventListener('click', onNow);

  /** day: the selected forecast day; range: its skim window { start, end } (null = none). */
  function render(cond, day, selT, range) {
    if (!range) { strip.style.background = 'var(--td-none)'; ctx = null; bubble.textContent = selT ? time(selT) : 'Now'; return; }
    const pts = cond.timeline.filter(s => s.t >= range.start && s.t <= range.end);
    const t0 = range.start.getTime(), span = range.end - range.start, nowMs = cond.now.getTime();
    // a thin strip of the skim window's score colors; past / missing parts stay dark
    const stops = [];
    for (let i = 0; i <= 96; i++) {
      const t = t0 + i * span / 96;
      let near = null, d = Infinity;
      for (const s of pts) { const x = Math.abs(s.t - t); if (x < d) { d = x; near = s; } }
      const c = t < nowMs - 9e5 ? 'past' : near && d <= 9e5 && near.score != null ? band(near.score) : 'none';
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
    handle.classList.toggle('off', raw < 0 || raw > 1); // "Now" outside this skim window: the knob rests at the edge, hollow
    handle.style.left = `${(f * 100).toFixed(3)}%`;
    bubble.textContent = selT ? (ctx.day.index ? `${ctx.day.label} ` : '') + time(new Date(t)) : 'Now';
    // keep the bubble inside the dock at the ends
    bubble.style.transform = `translateX(${f < 0.08 ? '-15%' : f > 0.92 ? '-85%' : '-50%'})`;
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

  /** Conditions strip + recommendation for the selected time (a small view model from the app). */
  function show(vm) {
    const set = (k, v) => { const el = dock.querySelector(`[data-c=${k}]`); if (el.textContent !== v) el.textContent = v; };
    const sc = dock.querySelector('.tc-score');
    sc.className = `tc tc-score ${vm.tone ? 'tone-' + vm.tone : ''}`;
    set('score', vm.score); set('label', vm.label);
    set('wind', vm.wind); set('windsub', vm.windsub);
    dock.querySelector('.tc-wind').dataset.rel = vm.rel || '';
    const a = dock.querySelector('.td-warrow');
    a.style.visibility = Number.isFinite(vm.windToDeg) ? 'visible' : 'hidden';
    if (Number.isFinite(vm.windToDeg)) rotateTo(a, vm.windToDeg);
    set('tide', vm.tide); set('tidesub', vm.tidesub);
    set('waves', vm.waves); set('wavesub', vm.wavesub);
    set('temp', vm.temp); set('tempsub', vm.tempsub);
    const rec = dock.querySelector('.td-rec');
    rec.className = `td-rec rec-${vm.recKind || ''}`;
    rec.innerHTML = vm.rec ? `<b>${esc(vm.rec)}</b>${vm.recSub ? ' · ' + esc(vm.recSub) : ''}` : '';
  }

  // Visibility: one zone, from the top of PirateCast to the bottom edge of the wind map.
  // The dock is shown only while the strip it occupies lies over that zone, so it is gone
  // before the text under the map, the details and the footer reach it. 28 px of
  // hysteresis stops it flickering at the edges; it stays put while being dragged.
  const HYST = 28;
  let shown = false, raf = 0;
  function check() {
    raf = 0;
    if (!zone.top || !zone.bottom) return;
    const vh = window.innerHeight, dockH = dock.offsetHeight || 96;
    const band = vh - dockH - 16;                     // top of the strip the dock covers
    const tr = zone.top.getBoundingClientRect(), br = zone.bottom.getBoundingClientRect();
    const laidOut = tr.height > 0 && br.height > 0 && !document.body.classList.contains('cam-only'); // hidden while loading / cam-only
    // stop at the map's bottom edge: the credits line and all text sit below it, so they never meet the dock
    const top = tr.top, bottom = br.bottom;
    // gone once `zone.avoid` (the ocean map, with its own timeline) is really in view — its top
    // well above the dock's strip. While only its top edge peeks in, PirateCast keeps the dock.
    const av = zone.avoid?.getBoundingClientRect();
    const overAvoid = !!av && av.height > 0 && av.top < band - 180 && av.bottom > band;
    const wantShow = laidOut && !overAvoid && top < band - HYST && bottom > vh + HYST;
    const mustHide = !laidOut || overAvoid || top > band || bottom < vh + 4;
    const next = drag?.active ? shown : shown ? !mustHide : wantShow;
    if (next !== shown) { shown = next; document.body.classList.toggle('dock-on', shown); }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  schedule();

  return { render, place, show, refresh: schedule, get dragging() { return !!drag?.active; } };
}
