// 24-hour tide graph (6 h back, 18 h ahead), drawn as SVG at the container's real
// width so labels stay readable on phones. Night is shaded, the best skim window
// is a soft band, highs/lows are labelled, "now" is a line with a dot.
import { short, hour } from './format.js';

const HOUR = 3600e3;

export function renderTideGraph(el, cond) {
  const { tide, now, daylight, window: win } = cond;
  if (!tide) { el.innerHTML = '<p class="na">Tide data temporarily unavailable</p>'; return; }
  const from = new Date(now.getTime() - 6 * HOUR), to = new Date(now.getTime() + 18 * HOUR);
  const W = Math.max(300, Math.round(el.clientWidth || 640)), H = W < 500 ? 170 : 190;
  const padL = 8, padR = 8, top = 30, bottom = 26; // H/L labels sit above their points, ticks below the baseline
  const pts = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 10 * 60e3) {
    const s = tide.covers(new Date(t)) ? tide.at(new Date(t)) : null;
    if (s) pts.push([t, s.height]);
  }
  if (pts.length < 2) { el.innerHTML = '<p class="na">Tide data temporarily unavailable</p>'; return; }
  const ev = tide.events.filter(e => e.t >= from && e.t <= to);
  const hs = pts.map(p => p[1]);
  const lo = Math.min(...hs), hi = Math.max(...hs), span = Math.max(0.5, hi - lo);
  const X = t => padL + (t - from) / (to - from) * (W - padL - padR);
  const Y = h => top + (1 - (h - lo) / span) * (H - top - bottom);
  const base = H - bottom;

  let svg = `<svg class="tidegraph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Tide for the next 18 hours">`;
  // night shading
  let cursor = from.getTime();
  const day = daylight.filter(r => r.sunset > from && r.sunrise < to).sort((a, b) => a.sunrise - b.sunrise);
  const nightRect = (a, b) => { if (b > a) svg += `<rect x="${X(a)}" y="0" width="${X(b) - X(a)}" height="${base}" class="night"/>`; };
  for (const r of day) { nightRect(cursor, Math.max(cursor, r.sunrise.getTime())); cursor = Math.max(cursor, r.sunset.getTime()); }
  nightRect(cursor, to.getTime());
  // best window band
  if (win && win.start && win.end > from) {
    const a = X(Math.max(win.start.getTime(), from.getTime())), b = X(Math.min(win.end.getTime(), to.getTime()));
    svg += `<rect x="${a}" y="0" width="${Math.max(2, b - a)}" height="${base}" class="bestband"/><text x="${(a + b) / 2}" y="${base - 6}" class="bestlbl" text-anchor="middle">BEST</text>`;
  }
  // curve + area
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  svg += `<path d="${line}L${X(pts.at(-1)[0])},${base}L${X(pts[0][0])},${base}Z" class="area"/><path d="${line}" class="curve"/>`;
  // hour ticks every 3 h
  const firstTick = Math.ceil(from.getTime() / (3 * HOUR)) * 3 * HOUR;
  for (let t = firstTick; t <= to.getTime(); t += 3 * HOUR) {
    const x = X(t); if (x < 18 || x > W - 18) continue;
    svg += `<text x="${x}" y="${H - 8}" class="tick" text-anchor="middle">${hour(new Date(t))}</text>`;
  }
  // highs & lows
  for (const e of ev) {
    const x = X(e.t.getTime()), y = Y(e.v), isH = e.type === 'H';
    const anchor = x < 40 ? 'start' : x > W - 40 ? 'end' : 'middle';
    svg += `<circle cx="${x}" cy="${y}" r="2.5" class="hl"/><text x="${x}" y="${y - 9}" class="hltxt" text-anchor="${anchor}">${isH ? 'H' : 'L'} ${e.v.toFixed(1)} · ${short(e.t)}</text>`;
  }
  // now
  const n = tide.at(now);
  if (n) {
    const x = X(now.getTime());
    svg += `<line x1="${x}" x2="${x}" y1="${top - 12}" y2="${base}" class="nowline"/><circle cx="${x}" cy="${Y(n.height)}" r="5" class="nowdot"/>`;
  }
  svg += '</svg>';
  el.innerHTML = svg;
}
