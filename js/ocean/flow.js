// Directional motion for the ocean map — generalised from Pirate View's wind particles.
// Works for any vector field: `vec(lat, lon) → [u, v] | null` (TRAVEL direction, u east, v north,
// in the variable's own units) plus `pxPerFrame(magnitude)` to turn that into screen speed.
//   waves / period → particles travel the way the waves travel (peak direction + 180°)
//   wind           → particles travel with the wind
// Where the field has no data (land for water variables) particles are not drawn and respawn.
// Paused off-screen / tab hidden / while the map moves. With motion off or reduced motion it
// draws a sparse grid of static arrows instead (direction only; length grows with magnitude).

const CELL = 20;

export function createFlow(map, L, { reduced = () => false, isWater = () => true } = {}) {
  const pane = map.getPane('flow') || map.createPane('flow');
  pane.style.zIndex = 450; pane.style.pointerEvents = 'none';
  const canvas = L.DomUtil.create('canvas', 'om-flow', pane);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) < 4;

  let src = null, W = 0, H = 0, cols = 0, rows = 0, gu = null, gv = null, gm = null;
  let fromU = null, fromV = null, toU = null, toV = null, blendStart = 0;
  let P = null, running = false, active = false, moving = false, raf = 0, motion = true, theme = 'dark', frames = 0;

  function size() {
    const s = map.getSize(); W = s.x; H = s.y;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    cols = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1;
    const n = Math.round(Math.min(coarse ? 650 : 1500, (W * H) / (coarse ? 520 : 430)) * (weak ? 0.7 : 1));
    P = { x: new Float32Array(n), y: new Float32Array(n), age: new Uint16Array(n), life: new Uint16Array(n), n };
    for (let i = 0; i < n; i++) spawn(i, true);
  }
  function spawn(i, randomAge) {
    P.x[i] = Math.random() * W; P.y[i] = Math.random() * H;
    P.life[i] = 40 + Math.random() * 60; P.age[i] = randomAge ? Math.random() * P.life[i] : 0;
  }

  function sampleGrid() {
    const n = cols * rows, u = new Float32Array(n).fill(NaN), v = new Float32Array(n).fill(NaN);
    if (src) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (src.water && !isWater(c * CELL, r * CELL)) continue; // water-only variables: no particles on land
      const ll = map.containerPointToLatLng([c * CELL, r * CELL]);
      const s = src.vec(ll.lat, ll.lng);
      if (s) { u[r * cols + c] = s[0]; v[r * cols + c] = s[1]; }
    }
    return { u, v };
  }
  function rebuild(blend) {
    const s = map.getSize(); if (s.x !== W || s.y !== H) size(); // may run before 'resize' when the map is revealed
    const g = sampleGrid();
    if (blend && gu && gu.length === g.u.length && motion && !reduced()) { fromU = gu.slice(); fromV = gv.slice(); toU = g.u; toV = g.v; blendStart = performance.now(); }
    else { gu = g.u; gv = g.v; toU = null; }
  }
  function stepBlend(now) {
    if (!toU) return;
    const k = Math.min(1, (now - blendStart) / 380), e = 1 - Math.pow(1 - k, 3);
    for (let i = 0; i < gu.length; i++) {
      const a = fromU[i], b = toU[i];
      if (a !== a || b !== b) { gu[i] = b; gv[i] = toV[i]; continue; }
      gu[i] = a + (b - a) * e; gv[i] = fromV[i] + (toV[i] - fromV[i]) * e;
    }
    if (k >= 1) toU = null;
  }
  function at(x, y) {
    const c = Math.min(cols - 1, Math.max(0, Math.round(x / CELL))), r = Math.min(rows - 1, Math.max(0, Math.round(y / CELL)));
    const i = r * cols + c; return [gu[i], gv[i]];
  }
  // fine-grained land check for a moving particle (the coarse grid alone lets it graze the beach)
  const onLand = (x, y) => src.water && !isWater(x | 0, y | 0);
  const ink = a => (theme === 'light' ? `rgba(12,28,52,${a})` : `rgba(255,255,255,${a})`);

  function frame(now) {
    raf = 0;
    if (!running) return;
    stepBlend(now);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = `rgba(0,0,0,${src.trail ?? 0.86})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = ink(src.alpha ?? 0.85);
    ctx.lineWidth = src.width ?? 1.5; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < P.n; i++) {
      const [u, v] = at(P.x[i], P.y[i]);
      if (u !== u || onLand(P.x[i], P.y[i])) { spawn(i, false); continue; }
      const m = Math.hypot(u, v) || 1e-6, s = src.pxPerFrame(m);
      const x0 = P.x[i], y0 = P.y[i], x1 = x0 + (u / m) * s, y1 = y0 - (v / m) * s;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      P.x[i] = x1; P.y[i] = y1;
      if (++P.age[i] > P.life[i] || x1 < -5 || x1 > W + 5 || y1 < -5 || y1 > H + 5) spawn(i, false);
    }
    ctx.stroke();
    frames++;
    raf = requestAnimationFrame(frame);
  }

  function drawStatic() {
    ctx.clearRect(0, 0, W, H);
    if (!gu || !src) return;
    ctx.strokeStyle = ink(0.8); ctx.fillStyle = ink(0.8); ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    const step = coarse ? 48 : 56;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      const [u, v] = at(x, y); if (u !== u || onLand(x, y)) continue;
      const m = Math.hypot(u, v); if (m < 1e-3) continue;
      const len = Math.min(22, 9 + src.pxPerFrame(m) * 4), dx = u / m, dy = -v / m;
      const x1 = x + dx * len / 2, y1 = y + dy * len / 2, x0 = x - dx * len / 2, y0 = y - dy * len / 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - dx * 5.5 - dy * 3.2, y1 - dy * 5.5 + dx * 3.2); ctx.lineTo(x1 - dx * 5.5 + dy * 3.2, y1 - dy * 5.5 - dx * 3.2); ctx.closePath(); ctx.fill();
    }
  }

  function update() {
    const animate = active && motion && !reduced() && !moving && !document.hidden && !!src;
    if (animate && !running) { running = true; raf = requestAnimationFrame(frame); }
    if (!animate && running) { running = false; cancelAnimationFrame(raf); raf = 0; }
    if (!animate) { if (moving || !src || !active) ctx.clearRect(0, 0, W, H); else drawStatic(); }
  }

  map.on('movestart zoomstart', () => { moving = true; update(); });
  map.on('moveend zoomend', () => { moving = false; L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0])); rebuild(false); update(); });
  map.on('resize', () => { size(); rebuild(false); update(); });
  document.addEventListener('visibilitychange', update);
  size();

  return {
    /** src: { vec(lat,lon)→[u,v]|null, pxPerFrame(m), alpha?, width? } or null (no motion layer) */
    set(s, blend = true) { const had = !!src; src = s; rebuild(had && blend); if (!s) ctx.clearRect(0, 0, W, H); update(); },
    setActive(on) { active = on; update(); },
    setMotion(on) { motion = on; update(); },
    setTheme(t) { theme = t; update(); },
    get running() { return running; },
    get count() { return P.n; },
    get frames() { return frames; },
    get motion() { return motion; },
  };
}
