// Ocean-map Forecast panel: the time chip (always shown — it is also the open/close control),
// and, when open, a day-segmented strip along the bottom of the map with previous / play / next.
// Collapsed, only the chip remains, so the map stays clear. Frames are the source's REAL timesteps; dragging anywhere on
// the strip moves the selection under the finger and snaps to the nearest real frame — nothing
// is interpolated to make it look continuous. Near either edge while dragging, the strip scrolls.
//
// modes:  'forecast' — a time axis (px per hour), labelled by day, hours shaded every 3 h
//         'observed' — radar: every real scan on a time axis, PAST → latest scan
//         'single'   — one frame (daily SST analysis): nothing to scrub

import { esc } from '../ui/format.js';

const TZ = 'America/New_York';
const fmt = (o, t) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).format(t);
export const dayKey = t => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, t);
/** "EST" / "EDT" for that instant (DST handled by Intl). */
export const tzName = t => (new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(t).find(p => p.type === 'timeZoneName')?.value || 'ET');
/** Local (Delaware) clock time with zone: "10:31 PM EST". */
export const clockET = t => `${fmt({ hour: 'numeric', minute: '2-digit' }, t)} ${tzName(t)}`;
/** Forecast valid time in local (Delaware) time: "Mon Nov 24, 3 PM EST". */
export const chipLabel = t => `${fmt({ weekday: 'short' }, t)} ${fmt({ month: 'short', day: 'numeric' }, t)}, ${fmt({ hour: 'numeric', minute: '2-digit' }, t).replace(':00', '')} ${tzName(t)}`;

const ICON = {
  prev: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5 4 10l6 5zM16 5l-6 5 6 5z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 5 6 5-6 5zM4 5l6 5-6 5z" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.5v11l9-5.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4.5v11M13 4.5v11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  chev: '<svg class="om-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 12.5 4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function createTimeline(root, { onPick, onPlay, onStep, open: open0 = false, onToggle = () => {} }) {
  root.innerHTML = `
    <button type="button" class="om-chip" aria-live="polite" aria-expanded="false" aria-label="Forecast time"><span class="om-chiptxt"></span><span class="om-chipbtn">${ICON.chev}</span></button>
    <div class="om-ctrls" role="group" aria-label="Forecast frames">
      <button type="button" class="om-btn om-prev" aria-label="Previous frame">${ICON.prev}</button>
      <button type="button" class="om-btn om-play" aria-label="Play">${ICON.play}</button>
      <button type="button" class="om-btn om-next" aria-label="Next frame">${ICON.next}</button>
    </div>
    <div class="om-strip" role="slider" tabindex="0" aria-label="Forecast time — drag to scrub">
      <div class="om-track"><div class="om-days"></div><div class="om-cells"></div><div class="om-sel"></div></div>
    </div>`;
  const chip = root.querySelector('.om-chiptxt'), chipBtn = root.querySelector('.om-chip'), strip = root.querySelector('.om-strip'), track = root.querySelector('.om-track');
  const daysEl = root.querySelector('.om-days'), cellsEl = root.querySelector('.om-cells'), selEl = root.querySelector('.om-sel');
  const playBtn = root.querySelector('.om-play');
  root.querySelector('.om-prev').addEventListener('click', () => onStep(-1));
  root.querySelector('.om-next').addEventListener('click', () => onStep(1));
  playBtn.addEventListener('click', () => onPlay());
  let open = !!open0;
  function setOpen(on) {
    open = on;
    root.classList.toggle('open', on);
    chipBtn.setAttribute('aria-expanded', String(on));
    chipBtn.title = on ? 'Hide the forecast timeline' : 'Show the forecast timeline';
    if (on && frames.length) { build(); place(); keepVisible(); }
  }
  chipBtn.addEventListener('click', () => { setOpen(!open); onToggle(open); });

  let frames = [], index = 0, mode = 'forecast', key = '', pxH = 10, scroll = 0, t0 = 0, width = 0, drag = null;

  function pxPerHour() {
    const w = strip.clientWidth || 360;
    return Math.max(7, Math.min(13, w / 70));
  }
  let obsK = 0; // observed mode: px per ms
  const xOf = i => {
    if (mode === 'forecast') return ((frames[i].t - t0) / 3600e3) * pxH;
    if (mode === 'observed') return frames.length > 1 ? 14 + (frames[i].t - t0) * obsK : 14;
    return 14;
  };
  // width of the selection block: the frame's own time step
  const stepW = i => {
    if (mode !== 'forecast') return 14;
    const n = frames[i + 1] ? frames[i + 1].t - frames[i].t : frames[i - 1] ? frames[i].t - frames[i - 1].t : 3600e3;
    return Math.max(5, (n / 3600e3) * pxH);
  };

  function build() {
    pxH = pxPerHour();
    daysEl.innerHTML = ''; cellsEl.innerHTML = '';
    if (!frames.length) { width = 0; return; }
    if (mode === 'forecast') {
      // start the axis at the first frame's local midnight-aligned 3-h block, so shading lines up
      t0 = frames[0].t;
      const tEnd = frames[frames.length - 1].t + 3600e3;
      width = ((tEnd - t0) / 3600e3) * pxH;
      // day segments
      let html = '', cells = '';
      const seen = new Set();
      for (let t = t0; t <= tEnd; t += 3600e3) {
        const k = dayKey(new Date(t));
        if (seen.has(k)) continue;
        seen.add(k);
        const x = ((t - t0) / 3600e3) * pxH;
        // the first (partial) day starts at the first frame, later ones at local midnight
        const xm = seen.size === 1 ? 0 : x;
        html += `<span class="om-day" style="left:${xm.toFixed(1)}px"><b>${esc(fmt({ weekday: 'short' }, t))}</b> ${esc(fmt({ month: 'numeric', day: 'numeric' }, t))}</span>`;
      }
      // 3-hour cells (local hour boundaries)
      for (let t = t0; t < tEnd; t += 3600e3) {
        const h = +fmt({ hour: 'numeric', hourCycle: 'h23' }, t);
        if (h % 3 !== 0 && t !== t0) continue;
        const x = ((t - t0) / 3600e3) * pxH;
        cells += `<i style="left:${x.toFixed(1)}px;width:${(3 * pxH - 2).toFixed(1)}px"${(h / 3) % 2 ? ' class="alt"' : ''}></i>`;
      }
      daysEl.innerHTML = html; cellsEl.innerHTML = cells;
    } else if (mode === 'observed' && frames.length > 1) {
      width = strip.clientWidth;
      t0 = frames[0].t;
      obsK = (width - 28) / Math.max(1, frames[frames.length - 1].t - t0);
      // one tick per real scan; labels at whole local hours, and the latest scan on the right
      // tick width follows the real spacing, so a dense history (e.g. 120 scans) stays a row of ticks
      let gap = Infinity;
      for (let i = 1; i < frames.length; i++) gap = Math.min(gap, (frames[i].t - frames[i - 1].t) * obsK);
      const tw = Math.max(1, Math.min(6, gap - 1));
      cellsEl.innerHTML = frames.map((f, i) => `<i class="pt" style="left:${(xOf(i) - tw / 2).toFixed(1)}px;width:${tw.toFixed(1)}px"></i>`).join('');
      let html = `<span class="om-day" style="left:0"><b>${esc(fmt({ hour: 'numeric', minute: '2-digit' }, frames[0].t))}</b></span>`;
      const hr = 3600e3;
      for (let t = Math.ceil(t0 / hr) * hr; t < frames[frames.length - 1].t; t += hr) {
        html += `<span class="om-day tick" style="left:${(14 + (t - t0) * obsK).toFixed(1)}px">${esc(fmt({ hour: 'numeric' }, t))}</span>`;
      }
      html += `<span class="om-day end" style="right:0"><b>Latest ${esc(fmt({ hour: 'numeric', minute: '2-digit' }, frames[frames.length - 1].t))}</b></span>`;
      daysEl.innerHTML = html;
    } else {
      width = strip.clientWidth;
      cellsEl.innerHTML = frames.map((f, i) => `<i class="pt" style="left:${(xOf(i) - 6).toFixed(1)}px;width:12px"></i>`).join('');
      daysEl.innerHTML = `<span class="om-day" style="left:0"><b>${esc(frames[0]?.label || '')}</b></span>`;
    }
    track.style.width = Math.max(width, strip.clientWidth) + 'px';
    fitLabels();
  }

  // Labels never collide: going right to left, a label that would run into the next one keeps
  // its divider line but hides its text (the partial first day or a crowded hour tick goes first).
  function fitLabels() {
    const els = [...daysEl.children];
    if (!els.length || !strip.clientWidth) return;
    const W = Math.max(width, strip.clientWidth);
    const box = el => { const w = el.scrollWidth; const left = el.classList.contains('end') ? W - w : el.offsetLeft; return [left, left + w]; };
    els.forEach(el => el.classList.remove('crowded'));
    let limit = Infinity;
    for (let k = els.length - 1; k >= 0; k--) {
      const [l, r] = box(els[k]);
      if (r + 6 > limit) els[k].classList.add('crowded');
      else limit = l;
    }
  }

  function clampScroll(s) { return Math.max(0, Math.min(Math.max(0, width - strip.clientWidth + 8), s)); }
  function applyScroll() { track.style.transform = `translateX(${-scroll}px)`; }
  function keepVisible() {
    if (mode !== 'forecast' || !frames.length) { scroll = 0; applyScroll(); return; }
    const x = xOf(index), w = strip.clientWidth, pad = Math.min(80, w * 0.2);
    if (x - scroll < pad) scroll = clampScroll(x - pad);
    else if (x - scroll > w - pad) scroll = clampScroll(x - w + pad);
    applyScroll();
  }
  function place() {
    if (!frames.length) { selEl.hidden = true; return; }
    selEl.hidden = false;
    const w = stepW(index);
    selEl.style.left = (mode === 'forecast' ? xOf(index) : xOf(index) - 7).toFixed(1) + 'px';
    selEl.style.width = w.toFixed(1) + 'px';
    strip.setAttribute('aria-valuemin', 0); strip.setAttribute('aria-valuemax', Math.max(0, frames.length - 1)); strip.setAttribute('aria-valuenow', index);
    strip.setAttribute('aria-valuetext', frames[index] ? chipLabel(frames[index].t) : '');
  }

  function indexAt(clientX) {
    const r = strip.getBoundingClientRect(), x = clientX - r.left + scroll;
    if (mode === 'forecast') {
      const t = t0 + (x / pxH) * 3600e3 - 0.5 * 3600e3 * 0; // block i covers [t_i, t_i+step)
      let best = 0;
      for (let i = 0; i < frames.length; i++) if (frames[i].t <= t + 1) best = i;
      return best;
    }
    let best = 0, d = Infinity;
    frames.forEach((f, i) => { const q = Math.abs(xOf(i) - x); if (q < d) { d = q; best = i; } });
    return best;
  }

  // ---- drag to scrub ----
  strip.addEventListener('pointerdown', e => {
    if (!frames.length || mode === 'single' || e.button > 0) return;
    e.preventDefault();
    strip.setPointerCapture?.(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, timer: 0 };
    root.classList.add('scrubbing');
    pick(indexAt(e.clientX), true);
    const edge = () => {
      if (!drag || mode !== 'forecast') return;
      const r = strip.getBoundingClientRect(), zone = 36;
      let v = 0;
      if (drag.x < r.left + zone) v = -1; else if (drag.x > r.right - zone) v = 1;
      if (v) { const s = clampScroll(scroll + v * pxH * 1.5); if (s !== scroll) { scroll = s; applyScroll(); pick(indexAt(drag.x), true); } }
      drag.timer = setTimeout(edge, 40);
    };
    drag.timer = setTimeout(edge, 120);
  });
  strip.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; drag.x = e.clientX; pick(indexAt(e.clientX), true); });
  const end = e => { if (!drag || (e && e.pointerId !== drag.id)) return; clearTimeout(drag.timer); const i = indexAt(drag.x); drag = null; root.classList.remove('scrubbing'); pick(i, false); };
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', end);
  // trackpad / mouse wheel scrolls the strip sideways (never the page vertically)
  strip.addEventListener('wheel', e => {
    if (mode !== 'forecast') return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (!d) return;
    e.preventDefault(); scroll = clampScroll(scroll + d); applyScroll();
  }, { passive: false });
  strip.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); onStep(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); onStep(-1); }
    else if (e.key === 'Home') { e.preventDefault(); pick(0, false); }
    else if (e.key === 'End') { e.preventDefault(); pick(frames.length - 1, false); }
  });

  let lastPick = -1;
  function pick(i, dragging) {
    if (i === lastPick && dragging) return;
    lastPick = i;
    onPick(i, { dragging });
  }

  new ResizeObserver(() => { if (frames.length) { build(); place(); keepVisible(); } }).observe(strip);
  setOpen(open);

  return {
    /** frames: [{ t, label? }], index, mode, playing, chip: text, chipNote?, loading?, disabled? */
    set(s) {
      const k = `${s.mode}|${s.frames.length}|${s.frames[0]?.t}|${s.frames.at(-1)?.t}`;
      mode = s.mode; frames = s.frames;
      // while a finger is on the strip, the finger decides the selection (an observed scan may still be loading)
      index = Math.max(0, Math.min(frames.length - 1, drag && k === key && lastPick >= 0 ? lastPick : s.index));
      strip.setAttribute('aria-label', mode === 'observed' ? 'Radar scan time — drag to scrub' : 'Forecast time — drag to scrub');
      if (k !== key) { key = k; build(); scroll = 0; }
      place();
      if (!drag) keepVisible();
      chip.innerHTML = s.chip ? `${esc(s.chip)}${s.chipNote ? `<small>${esc(s.chipNote)}</small>` : ''}` : '';
      chipBtn.classList.toggle('loading', !!s.loading);
      chipBtn.classList.toggle('na', !!s.unavailable);
      chipBtn.hidden = !s.chip;
      if (s.chipTitle) chip.title = s.chipTitle; else chip.removeAttribute('title');
      const one = frames.length <= 1 || mode === 'single';
      root.classList.toggle('single', one);
      playBtn.innerHTML = s.playing ? ICON.pause : ICON.play;
      playBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      playBtn.setAttribute('aria-pressed', String(!!s.playing));
      for (const b of root.querySelectorAll('.om-btn')) b.disabled = one || !!s.disabled;
      lastPick = index;
    },
    get dragging() { return !!drag; },
    get open() { return open; },
    setOpen,
    get scroll() { return scroll; },
  };
}
