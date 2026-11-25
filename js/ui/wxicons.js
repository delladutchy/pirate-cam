// Monochrome weather symbols (one bold 16×16 set, drawn in currentColor) for the
// weekly outlook and the WEATHER row. The symbol only restates the NWS condition already loaded
// (engine/weather.js conditionText); the words stay in title / aria-label for accessibility.
import { esc } from './format.js';

/** Condition text → symbol category. Unknown text or no data → 'unknown'. */
export function wxCategory(text) {
  if (!text) return 'unknown';
  if (/T-storm/i.test(text)) return 'storm';
  if (/snow|sleet|freezing|hail/i.test(text)) return /snow/i.test(text) ? 'snow' : 'rain';
  if (/rain|shower|drizzle/i.test(text)) return 'rain';
  if (/fog|haze|smoke|mist|dust|spray/i.test(text)) return 'fog';
  if (/^sunny$/i.test(text)) return 'clear';
  if (/mostly sunny|partly sunny/i.test(text)) return 'partly';
  if (/cloudy/i.test(text)) return 'cloudy';
  return 'unknown';
}

/** Inline SVG for a condition, in the shared bold set below (the PirateCast WEATHER row).
 *  `label` (the NWS wording) is the accessible name; an unknown condition gets a short dash. */
export function wxIcon(text, night = false) {
  const cat = wxCategory(text), label = text || 'Weather not available';
  const shape = cat === 'unknown' ? '<line x1="5" y1="8" x2="11" y2="8"/>' : night && NIGHT[cat] ? NIGHT[cat] : BOLD[cat]; // after dark: a moon, not a sun
  return `<svg class="wxi wxi-${cat}" viewBox="0 0 16 16" width="14" height="14" role="img" aria-label="${esc(label)}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><title>${esc(label)}</title>${shape}</svg>`;
}

// ONE bold set for all of Pirate View (weekly cards and the PirateCast WEATHER row): fewer,
// heavier shapes that still read at 14–15px — a solid sun, a solid cloud, drops / bolt / flakes /
// fog bars. Same categories, same words.
const CLOUD = (dx = 0, dy = 0) => `<path transform="translate(${dx} ${dy})" d="M4.2 12.5H12A2.8 2.8 0 0 0 12.3 6.93 3.9 3.9 0 0 0 4.85 7.6 2.5 2.5 0 0 0 4.2 12.5Z"/>`;
const RAYS = (cx, cy, r1, r2, angles) => angles.map(a => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
  return `<line x1="${(cx + c * r1).toFixed(2)}" y1="${(cy + s * r1).toFixed(2)}" x2="${(cx + c * r2).toFixed(2)}" y2="${(cy + s * r2).toFixed(2)}"/>`; }).join('');
const BOLD = {
  clear: `<circle cx="8" cy="8" r="3.1" fill="currentColor" stroke="none"/>${RAYS(8, 8, 5.1, 7, [0, 45, 90, 135, 180, 225, 270, 315])}`,
  // sun peeking out top-left; the cloud is cut out of it with a thin gap in the card colour
  partly: `<circle cx="5.4" cy="5.4" r="2.5" fill="currentColor" stroke="none"/>${RAYS(5.4, 5.4, 3.9, 5.1, [180, 225, 270])}`
    + `<g fill="currentColor" class="wxi-gap" stroke-width="1.4">${CLOUD(0.6, 1.9)}</g>`,
  cloudy: `<g fill="currentColor" stroke="none" transform="translate(8 9.2) scale(1.22) translate(-8.6 -9.4)">${CLOUD()}</g>`,
  rain: `<g fill="currentColor" stroke="none">${CLOUD(0, -2.6)}</g><line x1="5.4" y1="12.4" x2="4.6" y2="14.8"/><line x1="8.4" y1="12.4" x2="7.6" y2="14.8"/><line x1="11.4" y1="12.4" x2="10.6" y2="14.8"/>`,
  storm: `<g fill="currentColor" stroke="none">${CLOUD(0, -2.6)}<path d="M9.3 10.2 6 13.6h2.2l-1.2 2.6 3.6-3.9H8.4l.9-2.1Z"/></g>`,
  snow: `<g fill="currentColor" stroke="none">${CLOUD(0, -2.6)}<circle cx="5.2" cy="13" r="1"/><circle cx="8.2" cy="14.6" r="1"/><circle cx="11.2" cy="13" r="1"/></g>`,
  fog: '<line x1="2.5" y1="5" x2="13.5" y2="5"/><line x1="4.5" y1="8" x2="11.5" y2="8"/><line x1="2.5" y1="11" x2="13.5" y2="11"/>',
  unknown: '',
};

// after dark the sun shapes become a crescent moon (same categories, same NWS condition)
const CRESCENT = 'M10.3 2.6a5.6 5.6 0 1 0 3.1 9A4.8 4.8 0 0 1 10.3 2.6z';
const NIGHT = {
  clear: `<path d="${CRESCENT}" fill="currentColor" stroke="none"/>`,
  partly: `<path transform="translate(.3 -.4) scale(.6)" d="${CRESCENT}" fill="currentColor" stroke="none"/><g fill="currentColor" class="wxi-gap" stroke-width="1.4">${CLOUD(0.6, 1.9)}</g>`,
};

/** Bold inline SVG for the weekly cards (same categories / accessible name as wxIcon).
 *  Returns '' for an unknown condition — the caller shows the words instead. */
export function wxGlyph(text) {
  const cat = wxCategory(text);
  if (cat === 'unknown') return '';
  return `<svg class="wxg wxi-${cat}" viewBox="0 0 16 16" width="15" height="15" role="img" aria-label="${esc(text)}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><title>${esc(text)}</title>${BOLD[cat]}</svg>`;
}
