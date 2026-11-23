// Small monochrome weather symbols (one consistent 16×16 set, drawn in currentColor) for the
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

// building blocks
const sun = (cx, cy, r, rays) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1.3"/>`
  + rays.map(a => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180), r1 = r + 1.6, r2 = r + 3;
    return `<line x1="${(cx + c * r1).toFixed(2)}" y1="${(cy + s * r1).toFixed(2)}" x2="${(cx + c * r2).toFixed(2)}" y2="${(cy + s * r2).toFixed(2)}"/>`; }).join('');
const cloud = (dy = 0) => `<g fill="currentColor" stroke="none"><circle cx="5.6" cy="${9.6 + dy}" r="2.6"/><circle cx="8.8" cy="${7.6 + dy}" r="3.3"/><circle cx="11.6" cy="${9.8 + dy}" r="2.4"/><rect x="3" y="${9.8 + dy}" width="11" height="2.4" rx="1.2"/></g>`;

const SHAPES = {
  clear: sun(8, 8, 3, [0, 45, 90, 135, 180, 225, 270, 315]),
  partly: sun(5.6, 5.6, 2.3, [180, 225, 270, 315]) + cloud(1.4),
  cloudy: cloud(0.6),
  rain: cloud(-2) + '<line x1="6" y1="12.6" x2="5.2" y2="14.6"/><line x1="8.8" y1="12.6" x2="8" y2="14.6"/><line x1="11.6" y1="12.6" x2="10.8" y2="14.6"/>',
  storm: cloud(-2) + '<path d="M9.4 11.2 7.2 13.6h2l-1.2 2.2" fill="none"/>',
  snow: cloud(-2) + '<g fill="currentColor" stroke="none"><circle cx="5.8" cy="13.4" r=".9"/><circle cx="8.6" cy="14.6" r=".9"/><circle cx="11.4" cy="13.4" r=".9"/></g>',
  fog: '<line x1="2.5" y1="5.5" x2="13.5" y2="5.5"/><line x1="4" y1="8.5" x2="12" y2="8.5"/><line x1="2.5" y1="11.5" x2="13.5" y2="11.5"/>',
  unknown: '<line x1="5" y1="8" x2="11" y2="8"/>',
};

/** Inline SVG for a condition; `label` (the NWS wording) is the accessible name. */
export function wxIcon(text) {
  const cat = wxCategory(text), label = text || 'Weather not available';
  return `<svg class="wxi wxi-${cat}" viewBox="0 0 16 16" width="14" height="14" role="img" aria-label="${esc(label)}" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><title>${esc(label)}</title>${SHAPES[cat]}</svg>`;
}
