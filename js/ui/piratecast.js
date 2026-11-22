// PirateCast — the tappable hourly forecast timeline.
// Tap (or click) an hour to select it. With a mouse you can also press and drag
// across hours to scrub. On touch, horizontal swipes scroll naturally; taps select.
// Arrow keys move the selection when the timeline has focus.
import { hour } from './format.js';
import { reducedMotion } from './motion.js';

const DAY = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });

/** Index of the hour cell nearest `t`, or -1 when `t` lies past the last hour PirateCast covers
 *  (half an hour of slack, the same rounding the cells use). Pure: exported for tests. */
export function cellIndexFor(hours, t) {
  if (!hours.length) return -1;
  if (!t) return 0;
  const last = hours[hours.length - 1].t;
  if (t - last > 30 * 60e3) return -1;
  let best = 0, d = Infinity;
  hours.forEach((s, i) => { const x = Math.abs(s.t - t); if (x < d) { d = x; best = i; } });
  return best;
}

export function createPirateCast(el, { onSelect }) {
  let cells = [], hours = [], selIdx = 0, endCell = null, beyond = false;

  function render(cond, selectedT) {
    hours = cond.hourly;
    const w = cond.window;
    const inWin = (s, i) => {
      if (!w || !w.start) return false;
      const end = i === 0 ? new Date(Math.ceil(s.t.getTime() / 36e5) * 36e5) : new Date(s.t.getTime() + 36e5);
      return w.end > s.t && w.start < end;
    };
    el.innerHTML = hours.map((s, i) => {
      const sc = s.score;
      return `<button type="button" class="pc ${inWin(s, i) ? 'best' : ''} ${s.daylight ? '' : 'night'} ${sc == null ? '' : 'tone-' + s.tone} ${s.newDay ? 'newday' : ''}" data-i="${i}" aria-label="${i === 0 ? 'Now' : hour(s.t)}${sc == null ? '' : ', score ' + sc.toFixed(1)}">
        ${s.newDay ? `<span class="day">${DAY(s.t)}</span>` : ''}
        <span class="t">${i === 0 ? 'Now' : hour(s.t)}</span>
        <span class="n">${sc == null ? '–' : sc.toFixed(1)}</span>
        <span class="bar"><i style="height:${sc == null ? 0 : Math.max(6, sc * 10)}%"></i></span>
      </button>`;
    }).join('') + (hours.length > 1 ? `<div class="pc-end" role="note">
        <span class="t">Hourly ends</span><span class="e">${DAY(hours[hours.length - 1].t)} ${hour(hours[hours.length - 1].t)}</span><span class="h">Later: day graph &amp; time bar</span>
      </div>` : '');
    cells = [...el.querySelectorAll('.pc')];
    endCell = el.querySelector('.pc-end');
    highlightTime(selectedT, { scroll: 'instant' });
  }

  function setBeyond(on) {
    beyond = on;
    el.classList.toggle('beyond', on);
    endCell?.classList.toggle('on', on);
  }

  function reveal(c, scroll) {
    const box = el.getBoundingClientRect(), r = c.getBoundingClientRect();
    if (r.left < box.left + 8 || r.right > box.right - 8) {
      el.scrollTo({ left: el.scrollLeft + (r.left - box.left) - box.width / 2 + r.width / 2, behavior: scroll === 'smooth' && !reducedMotion() ? 'smooth' : 'auto' });
    }
  }

  function select(i, { scroll = 'smooth', silent = false } = {}) {
    if (!cells.length) return;
    i = Math.max(0, Math.min(cells.length - 1, i));
    cells[selIdx]?.classList.remove('sel'); cells[selIdx]?.setAttribute('aria-pressed', 'false');
    selIdx = i;
    setBeyond(false);
    cells[i].classList.add('sel'); cells[i].setAttribute('aria-pressed', 'true');
    reveal(cells[i], scroll);
    if (!silent) onSelect(hours[i], i);
  }

  // tap / click
  el.addEventListener('click', e => { const b = e.target.closest('.pc'); if (b && !dragged) select(+b.dataset.i); });
  // mouse press-and-drag scrubbing (touch keeps native scrolling)
  let scrubbing = false, dragged = false;
  el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { scrubbing = true; dragged = false; } });
  window.addEventListener('pointerup', () => { scrubbing = false; setTimeout(() => { dragged = false; }, 0); });
  el.addEventListener('pointermove', e => {
    if (!scrubbing) return;
    const b = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.pc');
    if (b && +b.dataset.i !== selIdx) { dragged = true; select(+b.dataset.i); }
  });
  // keyboard
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); if (beyond) return; select(selIdx + 1); cells[selIdx].focus({ preventScroll: true }); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); select(beyond ? cells.length - 1 : selIdx - 1); cells[selIdx].focus({ preventScroll: true }); }
  });

  /** Move the highlight to the hour nearest `t` without emitting a selection (used when
   *  another control — tide graph, best window, map — owns the change). */
  function highlightTime(t, { scroll = 'smooth' } = {}) {
    if (!cells.length) return;
    const i = cellIndexFor(hours, t);
    if (i >= 0) return select(i, { scroll, silent: true });
    // past PirateCast's last hour: no hour cell may look selected — the end marker takes over
    cells[selIdx]?.classList.remove('sel'); cells[selIdx]?.setAttribute('aria-pressed', 'false');
    setBeyond(true);
    if (endCell) reveal(endCell, scroll);
  }

  return { render, select, highlightTime, get selected() { return beyond ? null : hours[selIdx]; }, get beyond() { return beyond; } };
}
