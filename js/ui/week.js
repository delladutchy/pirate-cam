// WEEKLY SKIM OUTLOOK row: TODAY | MON | TUE … — per day, the best rated opportunity across all
// Pirate View spots (score, rating, spot, time, weather at that time), plus a subtle
// BEST THIS WEEK line. Logic lives in engine/week.js; this only draws it and reports taps.
import { esc, time } from './format.js';
import { conditionText } from '../engine/weather.js';
import { wxGlyph } from './wxicons.js';

const DOW = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });

/** Weather at a moment as plain words ("56° · Partly sunny · rain 30%") — the accessible text.
 *  Missing parts are left out, never guessed. */
export function weatherLine(s) {
  if (!s) return '';
  const bits = [];
  if (Number.isFinite(s.airF)) bits.push(`${Math.round(s.airF)}°`);
  const c = conditionText(s.sky, s.wx);
  if (c) bits.push(c);
  if (Number.isFinite(s.pop) && s.pop >= 20) bits.push(`rain ${Math.round(s.pop)}%`);
  return bits.join(' · ');
}

/** The same weather drawn as one compact row: "[symbol] 58° 94%". The condition word is shown
 *  only when there's no symbol for it (unknown category). */
export function weatherHTML(s) {
  if (!s) return '';
  const c = conditionText(s.sky, s.wx);
  const t = Number.isFinite(s.airF) ? `<span class="wk-temp">${Math.round(s.airF)}°</span>` : '';
  const pop = Number.isFinite(s.pop) && s.pop >= 20 ? `<span class="wk-pop">${Math.round(s.pop)}%</span>` : '';
  if (!t && !c) return '';
  const g = c ? wxGlyph(c) : '';
  return `${g || (c ? `<span class="wk-cond">${esc(c)}</span>` : '')}${t}${pop}`;
}

export function createWeek(el, { onPick }) {
  el.addEventListener('click', e => { const b = e.target.closest('[data-wday]'); if (b && !b.disabled) onPick(+b.dataset.wday); });

  /** outlook: weekOutlook() or null; pending: rated spots still loading; sel: { dayIndex, spotId } */
  function render(outlook, { pending = false, sel = null } = {}) {
    const row = el.querySelector('.wk-row'), topEl = el.querySelector('.wk-top');
    if (!outlook) { row.innerHTML = `<p class="na">${pending ? 'Loading the week…' : 'No rated spots available right now.'}</p>`; topEl.innerHTML = ''; return; }
    const top = outlook.top;
    // once today's skim window is over, Today is simply left out (no empty card)
    row.innerHTML = outlook.days.map((d, i) => (i === 0 && outlook.todayOver && !d.best ? '' : (() => {
      const b = d.best, label = i === 0 ? 'Today' : DOW(d.day.start).toUpperCase();
      const on = sel && sel.dayIndex === i ? ' on' : '';
      if (!b) {
        const why = pending ? 'Loading…' : i === 0 ? 'No skim hours left' : 'Not enough data';
        return `<button type="button" class="wk-day none${on}" data-wday="${i}" disabled aria-label="${esc(d.day.long)}: ${why}"><span class="wk-dn">${label}</span><span class="wk-na">${pending ? '…' : i === 0 ? 'Done' : '–'}</span></button>`;
      }
      const low = b.sample?.confidence === 'low';
      const isTop = top && top.dayIndex === i;
      const wx = weatherLine(b.sample), wxh = weatherHTML(b.sample);
      const aria = `${d.day.long}: best ${b.w.bestScore.toFixed(1)} ${b.w.label} at ${b.spot.name}, ${time(b.w.bestT)}${wx ? ', ' + wx : ''}${low ? ', low confidence' : ''}${isTop ? ', best this week' : ''}`;
      return `<button type="button" class="wk-day tone-${b.w.tone}${on}${isTop ? ' top' : ''}" data-wday="${i}" aria-label="${esc(aria)}">
        <span class="wk-dn">${label}</span>
        <span class="wk-sc"><b>${low ? '≈' : ''}${b.w.bestScore.toFixed(1)}</b></span>
        <span class="wk-sp">${esc(b.spot.name)}</span>
        <span class="wk-t">${time(b.w.bestT)}</span>
        <span class="wk-wx" title="${esc(wx)}">${wxh || '&nbsp;'}</span>
      </button>`;
    })())).join('');
    topEl.innerHTML = top
      ? `<button type="button" data-wday="${top.dayIndex}" class="wk-best tone-${top.w.tone}"><span class="k">Best this week</span> · ${esc(top.spot.name)} · ${top.dayIndex === 0 ? 'Today' : DOW(top.w.bestT)} ${time(top.w.bestT)} · <b>${top.w.bestScore.toFixed(1)}</b></button>`
      : '';
    const onEl = row.querySelector('.on');
    if (onEl) { const l = onEl.offsetLeft, r = l + onEl.offsetWidth; if (l < row.scrollLeft) row.scrollLeft = l - 8; else if (r > row.scrollLeft + row.clientWidth) row.scrollLeft = r - row.clientWidth + 8; }
  }

  return { render };
}
