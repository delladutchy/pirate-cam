// "Map" basemap for the ocean map: land and water drawn from the coastline (Natural Earth,
// public domain) in Pirate View's palette — deep navy/charcoal land in Dark, warm off-white in
// Light. The USGS topo tiles sit lightly on top for roads and place names. Drawing the land
// ourselves keeps the map clean and readable even when the tile server is slow.
import { animateWithZoom } from './zoomanim.js';

const THEMES = {
  dark: { water: '#0a1422', land: '#152335', edge: 'rgba(150,180,210,.28)' },
  light: { water: '#d6e2ea', land: '#ede8dd', edge: 'rgba(60,80,100,.30)' },
};

export function createBase(map, L, coast) {
  const pane = map.getPane('base') || map.createPane('base');
  pane.style.zIndex = 150; pane.style.pointerEvents = 'none';
  const canvas = L.DomUtil.create('canvas', 'om-base', pane);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0, theme = 'dark', on = true;
  const mark = animateWithZoom(map, L, canvas);

  function size() {
    const s = map.getSize(); W = s.x; H = s.y;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  function draw() {
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    mark();
    if (!on) return;
    const c = THEMES[theme];
    ctx.fillStyle = c.water; ctx.fillRect(0, 0, W, H);
    if (!coast) return;
    const b = map.getBounds().pad(0.3);
    const p = new Path2D();
    for (const poly of coast.polygons) for (const ring of poly) {
      let minx = 180, maxx = -180, miny = 90, maxy = -90;
      for (const [x, y] of ring) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
      if (maxx < b.getWest() || minx > b.getEast() || maxy < b.getSouth() || miny > b.getNorth()) continue;
      ring.forEach(([x, y], k) => { const pt = map.latLngToContainerPoint([y, x]); k ? p.lineTo(pt.x, pt.y) : p.moveTo(pt.x, pt.y); });
      p.closePath();
    }
    ctx.fillStyle = c.land; ctx.fill(p, 'evenodd');
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1; ctx.stroke(p);
    mark();
  }
  map.on('moveend zoomend', draw);
  map.on('resize', () => { size(); draw(); });
  size(); draw();
  return {
    setTheme(t) { theme = t === 'light' ? 'light' : 'dark'; draw(); },
    setOn(v) { on = v; draw(); },
  };
}
