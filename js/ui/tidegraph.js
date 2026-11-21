// Interactive 24-hour tide graph synced with PirateCast.
// The static layer (curve, night shading, best window, highs/lows, now marker) is
// drawn once per spot/time-window; the playhead slides to the selected time.
// Tapping the graph selects that time. Drawn at the container's real width so
// labels stay readable on phones.
import { short, hour } from './format.js';

const HOUR = 3600e3;
const SPAN = 24 * HOUR;

export function createTideGraph(el, { onPick }) {
  let geo = null; // { fromMs, W, cond, X, Y, tide }

  function windowFor(cond, selT) {
    let from = cond.now.getTime() - 3 * HOUR;
    if (selT && selT.getTime() > from + SPAN - 3 * HOUR) from = selT.getTime() - SPAN / 2;
    return from;
  }

  function render(cond, selT, force = false) {
    const { tide, now, daylight, window: win } = cond;
    if (!tide) { el.innerHTML = '<p class="na">Tide data temporarily unavailable</p>'; geo = null; return; }
    const fromMs = windowFor(cond, selT);
    const W = Math.max(300, Math.round(el.clientWidth || 640));
    if (!force && geo && geo.fromMs === fromMs && geo.W === W && geo.cond === cond) { place(selT); return; }
    const from = new Date(fromMs), to = new Date(fromMs + SPAN);
    const H = W < 500 ? 186 : 206, padL = 8, padR = 8, top = 46, bottom = 26; // top row is reserved for the playhead label
    const pts = [];
    for (let t = fromMs; t <= to.getTime(); t += 10 * 60e3) { const d = new Date(t); if (tide.covers(d)) pts.push([t, tide.at(d).height]); }
    if (pts.length < 2) { el.innerHTML = '<p class="na">Tide data temporarily unavailable</p>'; geo = null; return; }
    const hs = pts.map(p => p[1]);
    const lo = Math.min(...hs), hi = Math.max(...hs), span = Math.max(0.5, hi - lo);
    const X = t => padL + (t - fromMs) / SPAN * (W - padL - padR);
    const Y = h => top + (1 - (h - lo) / span) * (H - top - bottom);
    const base = H - bottom;

    let svg = `<svg class="tidegraph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Tide graph. Tap to pick a time.">`;
    let cursor = fromMs;
    const day = daylight.filter(r => r.sunset > from && r.sunrise < to).sort((a, b) => a.sunrise - b.sunrise);
    const night = (a, b) => { if (b > a) svg += `<rect x="${X(a)}" y="0" width="${X(b) - X(a)}" height="${base}" class="night"/>`; };
    for (const r of day) { night(cursor, Math.max(cursor, r.sunrise.getTime())); cursor = Math.max(cursor, r.sunset.getTime()); }
    night(cursor, to.getTime());
    if (win && win.start && win.end > from && win.start < to) {
      const a = X(Math.max(win.start.getTime(), fromMs)), b = X(Math.min(win.end.getTime(), to.getTime()));
      svg += `<rect x="${a}" y="0" width="${Math.max(2, b - a)}" height="${base}" class="bestband"/>`;
    }
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    svg += `<path d="${line}L${X(pts.at(-1)[0])},${base}L${X(pts[0][0])},${base}Z" class="area"/><path d="${line}" class="curve"/>`;
    for (let t = Math.ceil(fromMs / (3 * HOUR)) * 3 * HOUR; t <= to.getTime(); t += 3 * HOUR) {
      const x = X(t); if (x < 18 || x > W - 18) continue;
      svg += `<text x="${x}" y="${H - 8}" class="tick" text-anchor="middle">${hour(new Date(t))}</text>`;
    }
    for (const e of tide.events.filter(e => e.t >= from && e.t <= to)) {
      const x = X(e.t.getTime()), y = Y(e.v);
      const anchor = x < 40 ? 'start' : x > W - 40 ? 'end' : 'middle';
      svg += `<circle cx="${x}" cy="${y}" r="2.5" class="hl"/><text x="${x}" y="${y - 9}" class="hltxt" text-anchor="${anchor}">${e.type} ${e.v.toFixed(1)} · ${short(e.t)}</text>`;
    }
    const n = tide.covers(now) ? tide.at(now) : null;
    if (n && now >= from) {
      const x = X(now.getTime()), y = Y(n.height);
      svg += `<circle cx="${x}" cy="${y}" r="5" class="nowring"/><circle cx="${x}" cy="${y}" r="3.5" class="nowdot"/>`;
    }
    // playhead (moved with a CSS transform)
    svg += `<g class="playhead"><line x1="0" x2="0" y1="20" y2="${base}"/><g class="ph-dot"><circle r="6"/></g><text class="ph-txt" y="14" text-anchor="middle"></text></g>`;
    svg += '</svg>';
    el.innerHTML = svg;
    geo = { fromMs, W, cond, X, Y, tide };
    place(selT, true);
  }

  function place(selT, instant = false) {
    if (!geo) return;
    const ph = el.querySelector('.playhead');
    const t = selT || geo.cond.now;
    const s = geo.tide.covers(t) ? geo.tide.at(t) : null;
    if (!s) { ph.style.display = 'none'; return; }
    ph.style.display = '';
    const x = geo.X(t.getTime()), y = geo.Y(s.height);
    ph.classList.toggle('instant', instant);
    ph.style.transform = `translateX(${x}px)`;
    ph.querySelector('.ph-dot').style.transform = `translateY(${y}px)`;
    const txt = ph.querySelector('.ph-txt');
    txt.textContent = `${s.height.toFixed(1)} ft ${s.rising ? '↑' : '↓'}`;
    txt.setAttribute('text-anchor', x < 40 ? 'start' : x > geo.W - 40 ? 'end' : 'middle');
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => ph.classList.remove('instant')));
  }

  el.addEventListener('click', e => {
    if (!geo) return;
    const svg = el.querySelector('svg'); const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) * (geo.W / r.width);
    onPick(new Date(geo.fromMs + (x - 8) / (geo.W - 16) * SPAN));
  });

  return { render, place, reset: () => { geo = null; } };
}
