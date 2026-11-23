// WEEKLY SKIM OUTLOOK row: TODAY | MON | TUE … — per day, the best rated opportunity across all
// Pirate View spots (score, rating, spot, time, weather at that time), plus a subtle
// BEST THIS WEEK line. Logic lives in engine/week.js; this only draws it and reports taps.
import { esc, time } from './format.js';
import { conditionText } from '../engine/weather.js';

const DOW = d => d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' });

/** "56° · Partly sunny" for a sample; missing parts are left out, never guessed. */
export function weatherLine(s) {
  if (!s) return '';
  const bits = [];
  if (Number.isFinite(s.airF)) bits.push(`${Math.round(s.airF)}°`);
  const c = conditionText(s.sky, s.wx);
  const pop = Number.isFinite(s.pop) && s.pop >= 20 ? `${Math.round(s.pop)}%` : '';
  if (c && pop && /Rain|Showers|T-storms|Drizzle|Snow|Sleet/.test(c)) bits.push(`${c} ${pop}`); // "Rain 94%"
  else { if (c) bits.push(c); if (pop) bits.push(`rain ${pop}`); }
  return bits.join(' · ');
}

export function createWeek(el, { onPick }) {
  el.addEventListener('click', e => { const b = e.target.closest('[data-wday]'); if (b && !b.disabled) onPick(+b.dataset.wday); });

  /** outlook: weekOutlook() or null; pending: rated spots still loading; sel: { dayIndex, spotId } */
  function render(outlook, { pending = false, sel = null } = {}) {
    const row = el.querySelector('.wk-row'), topEl = el.querySelector('.wk-top');
    if (!outlook) { row.innerHTML = `<p class="na">${pending ? 'Loading the week…' : 'No rated spots available right now.'}</p>`; topEl.innerHTML = ''; return; }
    const top = outlook.top;
    row.innerHTML = outlook.days.map((d, i) => {
      const b = d.best, label = i === 0 ? 'Today' : DOW(d.day.start).toUpperCase();
      const on = sel && sel.dayIndex === i ? ' on' : '';
      if (!b) {
        const why = pending ? 'Loading…' : i === 0 ? 'No skim hours left' : 'Not enough data';
        return `<button type="button" class="wk-day none${on}" data-wday="${i}" disabled aria-label="${esc(d.day.long)}: ${why}"><span class="wk-dn">${label}</span><span class="wk-na">${pending ? '…' : i === 0 ? 'Done' : '–'}</span></button>`;
      }
      const low = b.sample?.confidence === 'low';
      const isTop = top && top.dayIndex === i;
      const wx = weatherLine(b.sample);
      const aria = `${d.day.long}: best ${b.w.bestScore.toFixed(1)} ${b.w.label} at ${b.spot.name}, ${time(b.w.bestT)}${low ? ', low confidence' : ''}${isTop ? ', best this week' : ''}`;
      return `<button type="button" class="wk-day tone-${b.w.tone}${on}${isTop ? ' top' : ''}" data-wday="${i}" aria-label="${esc(aria)}">
        <span class="wk-dn">${label}</span>
        <span class="wk-sc"><b>${low ? '≈' : ''}${b.w.bestScore.toFixed(1)}</b><span class="lbl"><i></i>${b.w.label}</span></span>
        <span class="wk-sp">${esc(b.spot.name)}</span>
        <span class="wk-t">${time(b.w.bestT)}</span>
        <span class="wk-wx">${esc(wx) || '&nbsp;'}</span>
      </button>`;
    }).join('');
    topEl.innerHTML = top
      ? `<button type="button" data-wday="${top.dayIndex}" class="wk-best tone-${top.w.tone}"><span class="k">Best this week</span> · ${esc(top.spot.name)} · ${top.dayIndex === 0 ? 'Today' : DOW(top.w.bestT)} ${time(top.w.bestT)} · <b>${top.w.bestScore.toFixed(1)}</b></button>`
      : '';
    const onEl = row.querySelector('.on');
    if (onEl) { const l = onEl.offsetLeft, r = l + onEl.offsetWidth; if (l < row.scrollLeft) row.scrollLeft = l - 8; else if (r > row.scrollLeft + row.clientWidth) row.scrollLeft = r - row.clientWidth + 8; }
  }

  return { render };
}
