// Canvas particle renderer for any wind field with sample(lat, lon) → { u, v, mph }.
// Particles move in the field's TRAVEL direction (u east, v north — see model.js for the
// FROM→TO conversion). Screen speed is proportional to wind speed, so stronger wind
// visibly streams faster. Field changes (new forecast time) blend over ~450 ms so the
// flow turns and speeds up/down instead of restarting.
//
// Cheap by design: the field is sampled onto a coarse screen grid only when the map
// stops moving or the field changes; particles do a grid lookup per frame.
// Paused when off-screen / tab hidden; with reduced motion it draws static arrows.

const CELL = 22;                 // px per field-grid cell
const PX_PER_FRAME_PER_MPH = 0.055;
const BLEND_MS = 450;

export function createParticles(map, L, { reduced = () => false } = {}) {
  const pane = map.getPane('wind') || map.createPane('wind');
  pane.style.zIndex = 450; pane.style.pointerEvents = 'none';
  const canvas = L.DomUtil.create('canvas', 'wm-canvas', pane);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const weakDevice = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) < 4;

  let field = null, W = 0, H = 0, cols = 0, rows = 0;
  let gu = null, gv = null, fromU = null, fromV = null, toU = null, toV = null, blendStart = 0;
  let P = null, running = false, active = false, moving = false, raf = 0, meanMotion = null;

  function size() {
    const s = map.getSize(); W = s.x; H = s.y;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    cols = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1;
    const n = Math.round(Math.min(coarse ? 420 : 1100, (W * H) / (coarse ? 750 : 620)) * (weakDevice ? 0.75 : 1));
    P = { x: new Float32Array(n), y: new Float32Array(n), age: new Uint16Array(n), life: new Uint16Array(n), n };
    for (let i = 0; i < n; i++) spawn(i, true);
  }

  function spawn(i, randomAge) {
    P.x[i] = Math.random() * W; P.y[i] = Math.random() * H;
    P.life[i] = 50 + Math.random() * 70; P.age[i] = randomAge ? Math.random() * P.life[i] : 0;
  }

  function sampleGrid() {
    const u = new Float32Array(cols * rows), v = new Float32Array(cols * rows);
    if (field) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const ll = map.containerPointToLatLng([c * CELL, r * CELL]);
      const s = field.sample(ll.lat, ll.lng);
      u[r * cols + c] = s.u; v[r * cols + c] = s.v;
    }
    return { u, v };
  }

  function rebuild(blend) {
    const g = sampleGrid();
    if (blend && gu && gu.length === g.u.length && !reduced()) {
      fromU = gu.slice(); fromV = gv.slice(); toU = g.u; toV = g.v; blendStart = performance.now();
    } else { gu = g.u; gv = g.v; toU = null; }
    if (reduced()) drawStatic();
  }

  function stepBlend(now) {
    if (!toU) return;
    const k = Math.min(1, (now - blendStart) / BLEND_MS), e = 1 - Math.pow(1 - k, 3);
    for (let i = 0; i < gu.length; i++) { gu[i] = fromU[i] + (toU[i] - fromU[i]) * e; gv[i] = fromV[i] + (toV[i] - fromV[i]) * e; }
    if (k >= 1) toU = null;
  }

  function at(x, y) {
    const c = Math.min(cols - 1, Math.max(0, Math.round(x / CELL))), r = Math.min(rows - 1, Math.max(0, Math.round(y / CELL)));
    const i = r * cols + c;
    return [gu[i], gv[i]];
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    stepBlend(now);
    // fade previous frame → short trails
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,0.78)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    let sx = 0, sy = 0;
    for (let i = 0; i < P.n; i++) {
      const [u, v] = at(P.x[i], P.y[i]);
      const x0 = P.x[i], y0 = P.y[i];
      // screen y grows downward, so northward (v > 0) means y decreases
      const x1 = x0 + u * PX_PER_FRAME_PER_MPH, y1 = y0 - v * PX_PER_FRAME_PER_MPH;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      sx += x1 - x0; sy += y1 - y0;
      P.x[i] = x1; P.y[i] = y1;
      if (++P.age[i] > P.life[i] || x1 < -5 || x1 > W + 5 || y1 < -5 || y1 > H + 5) spawn(i, false);
    }
    ctx.stroke();
    meanMotion = { dx: sx / P.n, dy: sy / P.n };
    raf = requestAnimationFrame(frame);
  }

  // Reduced motion: no animation — a sparse grid of arrows (direction + length ∝ speed).
  function drawStatic() {
    ctx.clearRect(0, 0, W, H);
    if (!gu) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.3;
    const step = 64;
    for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
      const [u, v] = at(x, y); const m = Math.hypot(u, v); if (m < 0.3) continue;
      const len = Math.min(26, 6 + m * 1.1), dx = u / m, dy = -v / m;
      const x1 = x + dx * len / 2, y1 = y + dy * len / 2, x0 = x - dx * len / 2, y0 = y - dy * len / 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - dx * 6 - dy * 3.5, y1 - dy * 6 + dx * 3.5); ctx.lineTo(x1 - dx * 6 + dy * 3.5, y1 - dy * 6 - dx * 3.5); ctx.closePath(); ctx.fill();
    }
  }

  function update() {
    const want = active && !moving && !document.hidden && !!field && !reduced();
    if (want && !running) { running = true; raf = requestAnimationFrame(frame); }
    if (!want && running) { running = false; cancelAnimationFrame(raf); raf = 0; }
    if (moving || !field) ctx.clearRect(0, 0, W, H);
    else if (reduced()) drawStatic();
  }

  map.on('movestart zoomstart', () => { moving = true; update(); });
  map.on('moveend zoomend', () => { moving = false; L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0])); rebuild(false); update(); });
  map.on('resize', () => { size(); rebuild(false); update(); });
  document.addEventListener('visibilitychange', update);
  size();

  return {
    setField(f) { const had = !!field; field = f; rebuild(had); update(); },
    setActive(on) { active = on; update(); },
    get running() { return running; },
    get count() { return P.n; },
    get meanMotion() { return meanMotion; }, // screen px/frame (x right, y down)
  };
}
