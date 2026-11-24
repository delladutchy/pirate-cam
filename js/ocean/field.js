// Continuous colour field for the ocean map: one canvas in its own Leaflet pane.
// The frame's grid is sampled bilinearly for every pixel of a reduced-resolution buffer (about
// one sample per 3 CSS px), coloured through the variable's scale and drawn back up with
// smoothing, so a ~16 km model grid reads as a smooth surface without inventing finer detail.
// Water-only variables are clipped to the sea with a public-domain coastline (Natural Earth).
//
// Cheap by design: redrawn only when the frame, the variable or the view changes; it scales with
// the zoom animation and is redrawn sharp at the end. Mercator: longitude depends only on x and latitude only on y,
// so lat/lon are computed per row / column, not per pixel.

import { lut } from './scales.js';
import { animateWithZoom } from './zoomanim.js';

const STEP = 3; // CSS px per sample

export function createField(map, L, { coast = null } = {}) {
  const pane = map.getPane('field') || map.createPane('field');
  pane.style.zIndex = 380; pane.style.pointerEvents = 'none';
  const canvas = L.DomUtil.create('canvas', 'om-field', pane);
  const ctx = canvas.getContext('2d');
  const buf = document.createElement('canvas'), bctx = buf.getContext('2d', { willReadFrequently: false });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0, cur = null, opacity = 0.9, lastDrawMs = 0, maskKey = '', lineColor = 'rgba(235,242,250,.55)';
  // water mask at 1/4 resolution: lets the motion layer keep wave particles off land
  const mask = document.createElement('canvas'), mctx = mask.getContext('2d', { willReadFrequently: true });
  let mdata = null, mw = 0;
  const mark = animateWithZoom(map, L, canvas);

  function size() {
    const s = map.getSize(); W = s.x; H = s.y;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }

  function landPath() {
    if (!coast) return null;
    const p = new Path2D();
    p.rect(-10, -10, W + 20, H + 20); // whole view, minus land (even-odd) = water
    const b = map.getBounds().pad(0.2);
    for (const poly of coast.polygons) {
      for (const ring of poly) {
        // quick reject rings entirely outside the view
        let minx = 180, maxx = -180, miny = 90, maxy = -90;
        for (const [x, y] of ring) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
        if (maxx < b.getWest() || minx > b.getEast() || maxy < b.getSouth() || miny > b.getNorth()) continue;
        ring.forEach(([x, y], k) => { const pt = map.latLngToContainerPoint([y, x]); k ? p.lineTo(pt.x, pt.y) : p.moveTo(pt.x, pt.y); });
        p.closePath();
      }
    }
    return p;
  }

  function buildMask() {
    const k = `${W}x${H}|${map.getCenter().lat.toFixed(5)},${map.getCenter().lng.toFixed(5)}|${map.getZoom()}`;
    if (k === maskKey) return;
    maskKey = k;
    mw = Math.ceil(W / 4); const mh = Math.ceil(H / 4);
    mask.width = mw; mask.height = mh;
    mctx.setTransform(0.25, 0, 0, 0.25, 0, 0);
    mctx.clearRect(0, 0, W, H);
    const p = landPath(); if (!p) { mdata = null; return; }
    mctx.fillStyle = '#fff'; mctx.fill(p, 'evenodd'); // water = filled
    mdata = mctx.getImageData(0, 0, mw, mh).data;
  }
  /** Is this container point over water? (true when no coastline is loaded) */
  function isWater(x, y) {
    if (!coast) return true;
    buildMask();
    if (!mdata) return true;
    const i = ((y >> 2) * mw + (x >> 2)) * 4 + 3;
    return mdata[i] > 127;
  }

  /** layer: { frame, field: 'height'|…, scale, water: bool } */
  function draw() {
    const t0 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    mark();
    if (!cur) return;
    const { frame, field, scale, water } = cur;
    const g = frame.grid, arr = frame.fields[field];
    if (!arr) return;
    const bw = Math.ceil(W / STEP) + 1, bh = Math.ceil(H / STEP) + 1;
    if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
    const img = bctx.createImageData(bw, bh), px = img.data;
    const { t, lo, k } = lut(scale);
    // per-column x index, per-row y index into the grid
    const gx = new Float32Array(bw), gy = new Float32Array(bh);
    for (let c = 0; c < bw; c++) gx[c] = (map.containerPointToLatLng([c * STEP, 0]).lng - g.lon0) / g.dlon;
    for (let r = 0; r < bh; r++) gy[r] = (map.containerPointToLatLng([0, r * STEP]).lat - g.lat0) / g.dlat;
    const ni = g.ni, nj = g.nj;
    for (let r = 0; r < bh; r++) {
      const y = gy[r];
      if (y < 0 || y > nj - 1) continue;
      const j = Math.min(nj - 2, y | 0), fy = y - j;
      for (let c = 0; c < bw; c++) {
        const x = gx[c];
        if (x < 0 || x > ni - 1) continue;
        const i = Math.min(ni - 2, x | 0), fx = x - i;
        const a = arr[j * ni + i], b2 = arr[j * ni + i + 1], c2 = arr[(j + 1) * ni + i], d = arr[(j + 1) * ni + i + 1];
        let s = 0, w = 0, ww;
        ww = (1 - fx) * (1 - fy); if (a === a) { s += a * ww; w += ww; }
        ww = fx * (1 - fy); if (b2 === b2) { s += b2 * ww; w += ww; }
        ww = (1 - fx) * fy; if (c2 === c2) { s += c2 * ww; w += ww; }
        ww = fx * fy; if (d === d) { s += d * ww; w += ww; }
        if (w < 0.15) continue; // too far from any cell with data: leave empty
        const v = s / w;
        let q = ((v - lo) * k) | 0; if (q < 0) q = 0; else if (q > 255) q = 255;
        const o = (r * bw + c) * 4;
        px[o] = t[q * 3]; px[o + 1] = t[q * 3 + 1]; px[o + 2] = t[q * 3 + 2];
        px[o + 3] = w >= 0.999 ? 255 : Math.round(255 * Math.min(1, (w - 0.15) / 0.5)); // soft edge at the data boundary
      }
    }
    bctx.putImageData(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const path = coast ? landPath() : null;
    if (water && path) { ctx.save(); ctx.clip(path, 'evenodd'); }
    ctx.drawImage(buf, 0, 0, bw * STEP, bh * STEP);
    if (water && path) ctx.restore();
    ctx.globalAlpha = 1;
    // a thin coastline on top, so geography stays readable under fields that cover land (wind)
    if (path) { ctx.strokeStyle = lineColor; ctx.lineWidth = water ? 0.8 : 1.1; ctx.stroke(path); }
    lastDrawMs = performance.now() - t0;
  }

  map.on('moveend', draw); // zoomend is always followed by moveend
  map.on('resize', () => { size(); draw(); });
  size();

  return {
    set(layer) { cur = layer; draw(); },
    clear() { cur = null; draw(); },
    setOpacity(o) { opacity = o; draw(); },
    setLine(c) { lineColor = c; draw(); },
    redraw: draw,
    isWater,
    get drawMs() { return lastDrawMs; },
    get layer() { return cur; },
  };
}
