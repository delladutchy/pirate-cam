// PirateCast tide chart: one continuous multi-day tide curve that slides under a fixed centre
// marker, synced with the app's ONE shared selected time (this module never owns a selection).
//
// - The whole curve (yesterday → the end of NOAA's predictions, ~9 days) is drawn once per spot
//   into a wide SVG strip. Changing the time only translates that strip (GPU transform), so there
//   are no rebuilds, no day pages and no jumps at midnight; the y-scale is fixed for the strip.
// - The curve is the spot's display tide curve (engine/tide.js makeTideCurve): NOAA 6-minute
//   predictions where the station publishes them, otherwise NOAA's hi/lo predictions joined the
//   standard way. Highs and lows (times and heights) are always NOAA's hi/lo predictions.
// - Drag the chart sideways to move time (finger-locked, no easing; vertical swipes still scroll
//   the page via `touch-action: pan-y`). Drags elsewhere (PirateCast, dock) move it instantly too;
//   discrete changes (Weekly Outlook, Now, taps) glide there with easing, unless reduced motion.
// - Tap the chart to show the selected time, height, rising/falling and the highs and lows;
//   tap again, or anywhere outside, to hide them. Keyboard: ← → 1 h, Shift 15 min.
import { short, time } from './format.js';

const HOUR = 3600e3;
const VIEW = 24 * HOUR;               // visible span
const TZ = 'America/New_York';
const hourOf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
const dowOf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const dayOf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ease = k => 1 - Math.pow(1 - k, 3);

export function createTideGraph(el, { onPick }) {
  // g: { cond, curve, W, H, pxMs, start, end, Y, minT, maxT }
  let g = null, shownT = 0, targetT = 0, anim = 0, open = false, drag = null, pickRaf = 0, pendingPick = null;

  function render(cond, selT, { force = false, instant = false } = {}) {
    const curve = cond.tideCurve;
    if (!curve) { el.innerHTML = '<p class="na">Tide data temporarily unavailable</p>'; g = null; return; }
    const W = Math.max(280, Math.round(el.clientWidth || 640));
    if (g && !force && g.cond === cond && g.W === W) { place(selT, instant); return; }
    build(cond, curve, W);
    place(selT, true);
  }

  function build(cond, curve, W) {
    const H = W < 500 ? 92 : 108, top = 10, axis = 18, base = H - axis;
    const pxMs = W / VIEW, start = curve.start, end = curve.end, SW = Math.ceil((end - start) * pxMs);
    const X = t => (t - start) * pxMs;
    // fixed scale over the whole dataset: moving through time never rescales the curve
    const pts = [];
    const dt = curve.source === 'noaa6' ? 6 * 60e3 : 10 * 60e3;
    for (let t = start; t <= end; t += dt) { const s = curve.at(t); if (s) pts.push([t, s.height]); }
    const hs = pts.map(p => p[1]), lo = Math.min(...hs), hi = Math.max(...hs), span = Math.max(0.5, hi - lo);
    const Y = h => top + (1 - (h - lo) / span) * (base - top - 4);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    let s = '';
    // night, subtly
    let c = start;
    for (const r of cond.daylight.filter(r => r.sunset > start && r.sunrise < end).sort((a, b) => a.sunrise - b.sunrise)) {
      const a = Math.max(c, start), b = Math.min(r.sunrise.getTime(), end); if (b > a) s += `<rect x="${X(a).toFixed(1)}" y="0" width="${(X(b) - X(a)).toFixed(1)}" height="${base}" class="tg-night"/>`;
      c = Math.max(c, r.sunset.getTime());
    }
    if (end > c) s += `<rect x="${X(c).toFixed(1)}" y="0" width="${(X(end) - X(c)).toFixed(1)}" height="${base}" class="tg-night"/>`;
    s += `<path d="${line}L${X(pts.at(-1)[0]).toFixed(1)},${base}L${X(pts[0][0]).toFixed(1)},${base}Z" class="tg-area"/><path d="${line}" class="tg-curve"/>`;
    // minimal axis: weekday at midnight, 6a · 12p · 6p
    for (let t = Math.ceil(start / HOUR) * HOUR; t <= end; t += HOUR) {
      const h = +hourOf.format(t) % 24; if (h % 6) continue;
      const lbl = h === 0 ? dowOf.format(t) : h === 6 ? '6a' : h === 12 ? '12p' : '6p';
      if (h === 0) s += `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${top}" y2="${base}" class="tg-mid"/>`;
      s += `<text x="${X(t).toFixed(1)}" y="${H - 5}" class="tg-tick${h === 0 ? ' tg-day' : ''}" text-anchor="middle">${lbl}</text>`;
    }
    // highs and lows: only shown while the chart is opened (tap); labelled inside the curve's band
    // (under a crest, over a trough) so they never clip at the edges
    s += '<g class="tg-hl">';
    for (const e of curve.events) {
      const t = e.t.getTime(); if (t < start || t > end) continue;
      const y = Y(curve.at(t)?.height ?? e.v), x = X(t);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/><text x="${x.toFixed(1)}" y="${(e.type === 'H' ? y + 15 : y - 8).toFixed(1)}" text-anchor="middle">${e.type === 'H' ? 'High' : 'Low'} ${e.v.toFixed(1)} · ${short(e.t)}</text>`;
    }
    s += '</g>';
    el.innerHTML = `<div class="tg-view" style="height:${H}px" role="slider" tabindex="0" aria-label="Tide chart — drag sideways or use the arrow keys to change the time; tap for highs and lows" aria-valuetext="">
      <svg class="tg-strip" width="${SW}" height="${H}" viewBox="0 0 ${SW} ${H}" aria-hidden="true">${s}</svg>
      <div class="tg-center" style="height:${base}px" aria-hidden="true"><i class="tg-dot"></i></div>
      <div class="tg-card" style="height:${axis}px" aria-hidden="true"></div>
    </div>`;
    const tlEnd = cond.timeline.at(-1).t.getTime();
    g = { cond, curve, W, H, base, pxMs, start, end, Y, strip: el.querySelector('.tg-strip'), dot: el.querySelector('.tg-dot'), card: el.querySelector('.tg-card'), view: el.querySelector('.tg-view'),
      minT: Math.max(start + 1, cond.now.getTime()), maxT: Math.min(end, tlEnd) };
    el.classList.toggle('tg-open', open);
    cancelAnimationFrame(anim); anim = 0; shownT = 0;
  }

  const clamp = t => Math.min(g.maxT, Math.max(g.minT, t));

  /** Move to a time: instantly (drags, first paint, reduced motion) or with easing. */
  function place(selT, instant = false) {
    if (!g) return;
    const t = clamp((selT || g.cond.now).getTime ? (selT || g.cond.now).getTime() : +selT);
    targetT = t;
    if (drag?.active) { if (Math.abs(t - shownT) > 1) paint(t); return; } // the finger owns the chart
    if (instant || !shownT || Math.abs(t - shownT) < 60e3 || reducedMotion() || document.hidden) { /* a minute or less: nothing to glide */ cancelAnimationFrame(anim); anim = 0; paint(t); return; }
    const from = shownT, d = Math.abs(t - from), dur = Math.min(650, 260 + 70 * Math.sqrt(d / HOUR)), t0 = performance.now();
    cancelAnimationFrame(anim);
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      paint(from + (targetT - from) * ease(k));
      anim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    anim = requestAnimationFrame(step);
  }

  function paint(t) {
    shownT = t;
    const x = g.W / 2 - (t - g.start) * g.pxMs;
    g.strip.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    const s = g.curve.at(t);
    if (!s) { g.dot.style.opacity = '0'; return; }
    g.dot.style.opacity = '';
    g.dot.style.transform = `translateY(${g.Y(s.height).toFixed(1)}px)`;
    const d = new Date(t);
    if (open || drag?.active) g.card.innerHTML = `<b>${dayOf.format(d)} · ${time(d)}</b> <span>${s.height.toFixed(1)} ft ${s.rising ? '↑ Rising' : '↓ Falling'}</span>`;
    g.view.setAttribute('aria-valuetext', `${dayOf.format(d)} ${time(d)}, tide ${s.height.toFixed(1)} feet, ${s.rising ? 'rising' : 'falling'}`);
  }

  function setOpen(on) {
    open = on; el.classList.toggle('tg-open', on);
    if (g) paint(shownT || targetT);
  }

  // ---- pointer: drag the curve under the marker; tap toggles the details ----
  el.addEventListener('pointerdown', e => {
    if (!g || !e.target.closest('.tg-view') || e.button > 0) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: targetT, active: false, mouse: e.pointerType === 'mouse' };
  });
  el.addEventListener('pointermove', e => {
    if (!g || !drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      // a deliberate sideways drag moves time; vertical stays page scroll
      if (Math.abs(dx) > (drag.mouse ? 3 : 8) && Math.abs(dx) > Math.abs(dy) * 1.2) {
        drag.active = true; drag.x0 = e.clientX; drag.t0 = shownT || targetT;
        cancelAnimationFrame(anim); anim = 0;
        try { g.view.setPointerCapture(e.pointerId); } catch {}
        el.classList.add('tg-drag');
      } else return;
    }
    e.preventDefault();
    const t = clamp(drag.t0 - (e.clientX - drag.x0) / g.pxMs);
    targetT = t; paint(t);           // the curve follows the finger this frame
    pendingPick = t;                 // the rest of the page follows once per frame
    if (!pickRaf) pickRaf = requestAnimationFrame(() => { pickRaf = 0; if (pendingPick != null) { const p = pendingPick; pendingPick = null; onPick(new Date(p), { dragging: true }); } });
  }, { passive: false });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const was = drag.active; drag = null;
    el.classList.remove('tg-drag');
    if (pickRaf) { cancelAnimationFrame(pickRaf); pickRaf = 0; pendingPick = null; }
    if (was) { suppress = true; setTimeout(() => { suppress = false; }, 0); onPick(new Date(targetT), { dragging: false, end: true }); }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) { const was = drag.active; drag = null; el.classList.remove('tg-drag'); if (was) onPick(new Date(targetT), { dragging: false, end: true }); } });
  let suppress = false;
  el.addEventListener('click', e => { if (!g || suppress || !e.target.closest('.tg-view')) return; setOpen(!open); });
  document.addEventListener('pointerdown', e => { if (open && !el.contains(e.target)) setOpen(false); }, true);

  el.addEventListener('keydown', e => {
    if (!g) return;
    if (e.key === 'Escape' && open) { setOpen(false); return; }
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const step = (e.shiftKey ? 0.25 : 1) * HOUR * (e.key === 'ArrowRight' ? 1 : -1);
    onPick(new Date(clamp(targetT + step)), { dragging: false });
  });

  return {
    render, place: (t, instant) => place(t, instant),
    reset: () => { g = null; cancelAnimationFrame(anim); anim = 0; },
    get dragging() { return !!drag?.active; },
    get open() { return open; },
    /** test/debug: what is shown under the marker right now */
    get shown() { return g ? { t: shownT, target: targetT, x: g.strip.style.transform, animating: !!anim } : null; },
  };
}
