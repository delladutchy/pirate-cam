// WEEKLY OUTLOOK row: TODAY | MON | TUE … — per day, the selected beach's best daylight Pirate
// Score and its time, with the weather then; plus one line with the best of the week across ALL
// beaches ("Best this week: Sun · Bethany · 9.3"), which selects that beach and time. Only the
// days the forecast covers are shown; a day without a complete forecast says so (–), never guessed.
// Logic lives in engine/week.js; this only draws it and reports taps.
import { esc, time, short } from './format.js';
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
  el.addEventListener('click', e => { const b = e.target.closest('[data-wday]'); if (b && !b.disabled) onPick(/^\d+$/.test(b.dataset.wday) ? +b.dataset.wday : b.dataset.wday); });

  /** outlook: weekOutlook() / spotOutlook() or null; pending: still loading; sel: { dayIndex, spotId };
   *  mode: 'all' (best rated beach each day) | 'spot' (the beach being viewed) */
  function render(outlook, { pending = false, sel = null, mode = 'all', spot = null, regional = null } = {}) {
    const row = el.querySelector('.wk-row'), topEl = el.querySelector('.wk-top');
    for (const b of el.querySelectorAll('.wk-mode [data-wday]')) b.setAttribute('aria-pressed', b.dataset.wday === mode);
    el.querySelector('.wk-key').hidden = true;
    const one = mode === 'spot';
    const bestLine = b => (b ? `<button type="button" data-wday="${one ? 'top' : b.dayIndex}" class="wk-best tone-${b.w.tone}" aria-label="Best this week: ${esc(b.spot.fullName)}, ${esc(b.dayIndex === 0 ? 'today' : DOW(b.w.bestT))} ${time(b.w.bestT)}, ${b.w.bestScore.toFixed(1)} — show it"><span class="k">Best this week</span> ${b.dayIndex === 0 ? 'Today' : DOW(b.w.bestT)} · ${esc(b.spot.name)} · <b>${b.w.bestScore.toFixed(1)}</b></button>` : '');
    if (!outlook) { row.innerHTML = `<p class="na">${pending ? 'Loading the week…' : mode === 'spot' ? `${esc(spot?.name || 'This beach')} isn't rated yet.` : 'No rated spots available right now.'}</p>`; topEl.innerHTML = one ? bestLine(regional) : ''; return; }
    const top = outlook.top;
    // the forecast horizon, honestly: the row ends with the last day that has a complete forecast
    let last = outlook.days.length - 1;
    while (last > 0 && !outlook.days[last].best) last--;
    // once today's skim window is over, Today is simply left out (no empty card)
    // compact cards: day + weather on top, score + beach + time below; the week's best is tagged
    row.innerHTML = outlook.days.map((d, i) => (i > last || (i === 0 && outlook.todayOver && !d.best) ? '' : (() => {
      const b = d.best, label = i === 0 ? 'Today' : DOW(d.day.start).toUpperCase();
      const on = sel && sel.dayIndex === i ? ' on' : '';
      if (!b) {
        const why = pending ? 'Loading…' : i === 0 ? 'No skim hours left' : 'No complete forecast yet';
        // same rows as a scored card so every card in the week is the same height
        return `<button type="button" class="wk-day none${on}" data-wday="${i}" disabled aria-label="${esc(d.day.long)}: ${why}"><span class="wk-dn">${label}</span><span class="wk-wx" aria-hidden="true"></span><span class="wk-sc"><b class="wk-na">${pending ? '…' : i === 0 ? 'Done' : '–'}</b></span><span class="wk-sp wk-na2" aria-hidden="true">${pending || i === 0 ? '&nbsp;' : 'No forecast yet'}</span></button>`;
      }
      const low = b.sample?.confidence === 'low';
      const isTop = top && top.dayIndex === i;
      const wx = weatherLine(b.sample), wxh = weatherHTML(b.sample);
      const aria = `${d.day.long}: best ${b.w.bestScore.toFixed(1)} ${b.w.label} at ${b.spot.name}, ${time(b.w.bestT)}${wx ? ', ' + wx : ''}${low ? ', low confidence' : ''}${isTop ? ', best day this week' : ''}`;
      return `<button type="button" class="wk-day tone-${b.w.tone}${on}${isTop ? ' top' : ''}${low ? ' low' : ''}" data-wday="${i}" aria-label="${esc(aria)}">
        <span class="wk-dn">${label}</span>
        <span class="wk-wx" title="${esc(wx)}">${wxh}</span>
        <span class="wk-sc"><b${low ? ' title="Lower confidence — more than 2 days out, or the wave model run is late"' : ''}>${b.w.bestScore.toFixed(1)}</b></span>
        <span class="wk-sp">${one ? '' : `<span class="wk-spn">${esc(b.spot.name)}</span>`}<span class="wk-t">${short(b.w.bestT)}</span></span>
      </button>`;
    })())).join('');
    // one quiet key for the dotted underline, only when some day is lower confidence
    // (the dotted underline for lower confidence is explained in PirateCast's legend / Details)
    topEl.innerHTML = bestLine(one ? regional : top);
    const onEl = row.querySelector('.on');
    if (onEl) { const l = onEl.offsetLeft, r = l + onEl.offsetWidth; if (l < row.scrollLeft) row.scrollLeft = l - 8; else if (r > row.scrollLeft + row.clientWidth) row.scrollLeft = r - row.clientWidth + 8; }
  }

  return { render };
}
