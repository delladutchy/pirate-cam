// Bottom time dock — the master forecast scrubber: day chips (with each day's best score),
// a compact conditions strip for the selected time, a one-line recommendation, and the slider
// with a floating time bubble. Sits above the iPhone home indicator (safe-area inset).
// Like every control it only reports picks — the app owns the ONE selected time.
import { time } from './format.js';
import { band } from './daygraph.js';
import { rotateTo } from './motion.js';
import { esc } from './format.js';

const ARROW = '<svg class="td-warrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l6 10h-4v9h-4v-9H6z"/></svg>';

export function createTimeDock(dock, { onPick, onDay, onNow, zone }) {
  dock.innerHTML = `
    <div class="td-row">
      <div class="td-days" role="tablist" aria-label="Forecast day"></div>
      <button type="button" class="td-now">Now</button>
    </div>
    <div class="td-cond" aria-hidden="true">
      <div class="tc tc-score"><b class="tc-v" data-c="score">–</b><span class="tc-s" data-c="label"></span></div>
      <div class="tc tc-wind">${ARROW}<span><b class="tc-v" data-c="wind">–</b><span class="tc-s" data-c="windsub"></span></span></div>
      <div class="tc"><b class="tc-v" data-c="tide">–</b><span class="tc-s" data-c="tidesub"></span></div>
      <div class="tc"><b class="tc-v" data-c="waves">–</b><span class="tc-s" data-c="wavesub"></span></div>
      <div class="tc tc-temp"><b class="tc-v" data-c="temp">–</b><span class="tc-s" data-c="tempsub"></span></div>
    </div>
    <p class="td-rec" aria-live="polite"></p>
    <div class="td-slider" role="slider" tabindex="0" aria-label="Forecast time — arrow keys move 15 minutes, Shift+arrow 1 hour, Home for now, End for the end of the day" aria-valuemin="0" aria-valuemax="1440">
      <div class="td-strip"></div>
      <div class="td-handle"><span class="td-bubble"></span></div>
    </div>`;
  const days = dock.querySelector('.td-days'), slider = dock.querySelector('.td-slider');
  const strip = dock.querySelector('.td-strip'), handle = dock.querySelector('.td-handle'), bubble = dock.querySelector('.td-bubble');
  let ctx = null, drag = null;

  dock.querySelector('.td-now').addEventListener('click', onNow);
  days.addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b && !b.disabled) onDay(+b.dataset.day); });

  function render(cond, dayList, day, selT) {
    days.innerHTML = dayList.map(d => {
      const p = d.preview || {}, off = !d.hasScores && d.index !== 0;
      const low = p.confidence === 'low';
      const v = p.best != null ? `<span class="dv dg-${band(p.best)}t">${low ? '≈' : ''}${p.best.toFixed(1)}</span>` : '<span class="dv na">–</span>';
      const aria = `${d.long}${p.best != null ? `, best ${p.best.toFixed(1)}${low ? ', low confidence' : ''}` : off ? ', not enough data' : ''}`;
      return `<button type="button" role="tab" data-day="${d.index}" aria-selected="${d.index === day.index}" aria-label="${aria}" ${off ? 'disabled title="Not enough data"' : ''} class="${d.index === day.index ? 'on' : ''}"><span class="dn">${d.label}</span>${v}</button>`;
    }).join('');
    // keep the selected chip in view by scrolling ONLY the chip row (scrollIntoView could move the page)
    const on = days.querySelector('.on');
    if (on) {
      const l = on.offsetLeft, r = l + on.offsetWidth;
      if (l < days.scrollLeft) days.scrollLeft = l - 8;
      else if (r > days.scrollLeft + days.clientWidth) days.scrollLeft = r - days.clientWidth + 8;
    }
    const pts = cond.timeline.filter(s => s.t >= day.start && s.t < day.end);
    const span = day.end - day.start, nowMs = cond.now.getTime();
    // a thin strip of the day's score colors; past / missing parts stay dark
    const stops = [];
    for (let i = 0; i <= 96; i++) {
      const t = day.start.getTime() + i * span / 96;
      let near = null, d = Infinity;
      for (const s of pts) { const x = Math.abs(s.t - t); if (x < d) { d = x; near = s; } }
      const c = t < nowMs - 9e5 ? 'past' : near && d <= 9e5 && near.score != null ? band(near.score) : 'none';
      stops.push(`var(--td-${c}) ${(i / 96 * 100).toFixed(2)}%`);
    }
    strip.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    const valid = pts.filter(s => s.t.getTime() >= nowMs - 15 * 60e3);
    ctx = { cond, day, span, minT: Math.max(day.start.getTime(), nowMs), maxT: valid.length ? valid.at(-1).t.getTime() : day.start.getTime() };
    place(selT, true);
  }

  function place(selT, instant = false) {
    if (!ctx) return;
    const t = (selT || ctx.cond.now).getTime();
    const f = Math.min(1, Math.max(0, (t - ctx.day.start) / ctx.span));
    handle.classList.toggle('instant', instant || !!drag);
    handle.style.left = `${(f * 100).toFixed(3)}%`;
    bubble.textContent = selT ? (ctx.day.index ? `${ctx.day.label} ` : '') + time(new Date(t)) : 'Now';
    // keep the bubble inside the dock at the ends
    bubble.style.transform = `translateX(${f < 0.08 ? '-15%' : f > 0.92 ? '-85%' : '-50%'})`;
    slider.setAttribute('aria-valuenow', Math.round((t - ctx.day.start) / 60000));
    slider.setAttribute('aria-valuetext', bubble.textContent);
  }

  const timeAt = clientX => {
    const r = slider.getBoundingClientRect();
    const t = ctx.day.start.getTime() + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * ctx.span;
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
    else if (e.key === 'Home') { e.preventDefault(); ctx?.day.index ? onPick(new Date(ctx.minT), {}) : onNow(); }
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
    const wantShow = laidOut && top < band - HYST && bottom > vh + HYST;
    const mustHide = !laidOut || top > band || bottom < vh + 4;
    const next = drag?.active ? shown : shown ? !mustHide : wantShow;
    if (next !== shown) { shown = next; document.body.classList.toggle('dock-on', shown); }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  schedule();

  return { render, place, show, refresh: schedule, get dragging() { return !!drag?.active; } };
}
