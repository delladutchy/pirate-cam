// Bottom time dock: day chips, NOW, and a time slider with a floating bubble.
// Shows only while the forecast area is on screen; sits above the iPhone home indicator
// (safe-area inset). Dragging the handle never scrolls the page (touch-action: none).
// Like every control, it only reports picks — the app owns the one selected time.
import { time } from './format.js';
import { band } from './daygraph.js';

export function createTimeDock(dock, { onPick, onDay, onNow, watch }) {
  dock.innerHTML = `
    <div class="td-row">
      <div class="td-days" role="tablist" aria-label="Forecast day"></div>
      <button type="button" class="td-now">Now</button>
    </div>
    <div class="td-slider" role="slider" tabindex="0" aria-label="Forecast time" aria-valuemin="0" aria-valuemax="1440">
      <div class="td-strip"></div>
      <div class="td-handle"><span class="td-bubble"></span></div>
    </div>`;
  const days = dock.querySelector('.td-days'), slider = dock.querySelector('.td-slider');
  const strip = dock.querySelector('.td-strip'), handle = dock.querySelector('.td-handle'), bubble = dock.querySelector('.td-bubble');
  let ctx = null, drag = null;

  dock.querySelector('.td-now').addEventListener('click', onNow);
  days.addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b && !b.disabled) onDay(+b.dataset.day); });

  function render(cond, dayList, day, selT) {
    days.innerHTML = dayList.map(d => `<button type="button" role="tab" data-day="${d.index}" aria-selected="${d.index === day.index}" ${d.hasScores || d.index === 0 ? '' : 'disabled title="No forecast data"'} class="${d.index === day.index ? 'on' : ''}">${d.label}</button>`).join('');
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
    const s = nearest(ctx.cond.timeline, t);
    bubble.innerHTML = `${selT ? time(new Date(t)) : 'Now'}${s && s.score != null && Math.abs(s.t - t) <= 9e5 ? ` <b class="dg-${band(s.score)}t">${s.score.toFixed(1)}</b>` : ''}`;
    // keep the bubble inside the dock at the ends
    bubble.style.transform = `translateX(${f < 0.08 ? '-15%' : f > 0.92 ? '-85%' : '-50%'})`;
    slider.setAttribute('aria-valuenow', Math.round((t - ctx.day.start) / 60000));
    slider.setAttribute('aria-valuetext', bubble.textContent);
  }

  const nearest = (tl, t) => { let b = null, d = Infinity; for (const s of tl) { const x = Math.abs(s.t - t); if (x < d) { d = x; b = s; } } return b; };
  const timeAt = clientX => {
    const r = slider.getBoundingClientRect();
    const t = ctx.day.start.getTime() + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * ctx.span;
    return new Date(Math.min(ctx.maxT, Math.max(ctx.minT, Math.round(t / 9e5) * 9e5)));
  };
  slider.addEventListener('pointerdown', e => {
    if (!ctx) return;
    drag = e.pointerId; slider.setPointerCapture(e.pointerId); dock.classList.add('dragging');
    onPick(timeAt(e.clientX), { dragging: true });
  });
  slider.addEventListener('pointermove', e => { if (drag === e.pointerId) { e.preventDefault(); onPick(timeAt(e.clientX), { dragging: true }); } });
  const end = e => { if (drag === e.pointerId) { drag = null; dock.classList.remove('dragging'); onPick(timeAt(e.clientX), { dragging: false }); } };
  slider.addEventListener('pointerup', end);
  slider.addEventListener('pointercancel', () => { drag = null; dock.classList.remove('dragging'); });
  slider.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    onPick(null, { step: (e.shiftKey ? 1 : 0.25) * 3600e3 * (e.key === 'ArrowRight' ? 1 : -1) });
  });

  // visible only while the forecast area is on screen
  const seen = new Set();
  const io = new IntersectionObserver(es => {
    for (const e of es) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target);
    document.body.classList.toggle('dock-on', seen.size > 0);
  }, { rootMargin: '0px 0px -110px 0px' }); // ignore the strip the dock itself covers
  watch.forEach(el => io.observe(el));

  return { render, place, get dragging() { return drag != null; } };
}
