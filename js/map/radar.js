// RADAR mode for the ocean map: NOAA/NWS MRMS quality-controlled base reflectivity (the CONUS
// mosaic, ~1 km, a new scan every ~4 min) as published by NOAA nowCOAST — the official NOAA/NOS
// map service, layer weather_radar:conus_base_reflectivity_mosaic. US government data, no key,
// CORS-enabled. Radar is OBSERVED (past → latest scan); it never follows the forecast time.
//
// Why nowCOAST (verified live 2026-11-24 05:08Z, Delmarva view):
//   nowCOAST WMS                — 120 scans / 7.9 h, every ~4.0 min, newest 7.9 min old, 15–70 KB PNG, ~160 ms
//   mapservices ImageServer     — 16 scans / 1.7 h, every ~6–8 min, newest 12 min old, ~160 KB PNG, ~390 ms (old source)
//   opengeo.ncep conus_bref_qcd — 60 scans / 2.0 h, every ~2 min, newest 2.4 min old
//   Same MRMS scans (e.g. CONUS_L2_BREF_QCD 04:55:50Z appears in all three); nowCOAST keeps the
//   longest history, so it is the only one that gives a useful several-hour loop.
//
// Cheap by design:
//  - nothing is requested until Radar mode is opened (the map itself is already lazy);
//  - the scan list is the layer's own WMS capabilities (~10 KB): its time dimension lists every
//    scan it holds. Only those exact times are ever requested (nowCOAST would otherwise snap an
//    unlisted time to the nearest scan) — nothing is interpolated or invented;
//  - each frame is ONE image for the current view (GetMap, CSS-pixel size, capped), fetched
//    once and kept as a small encoded blob for that view (~15–70 KB), so scrubbing back and forth
//    or replaying never re-downloads, and nothing decoded is held in memory;
//  - images load on demand: the scan on screen, then a few neighbours; Play streams forward
//    (each scan waits for its own image) instead of downloading the whole history at once;
//  - moving the map while playing stops and reloads the latest frame; while paused on an older
//    scan it reloads THAT scan for the new view;
//  - each frame is checked for returns (any non-transparent pixel in the image of the view), so
//    a dry view can say so instead of looking broken. Nothing is thresholded or filtered. That
//    check is OPTIONAL: if the image can't be read (no CORS, tainted canvas, any error) it is
//    shown the plain way and the label is just the scan time. Only a failure to load the image
//    itself skips that scan / makes radar "unavailable";
//  - if NOAA can't be reached it says so; no other provider is substituted.

export const RADAR_SERVICE = 'https://nowcoast.noaa.gov/geoserver/observations/weather_radar';
export const RADAR_LAYER = 'conus_base_reflectivity_mosaic';
export const RADAR_CREDIT = 'Radar: NOAA/NWS MRMS via NOAA nowCOAST';
const LIST_TTL = 2 * 60e3, MAX_PX = 900, POLL = 4 * 60e3;
export const RADAR_WINDOW_MS = 8 * 3600e3; // nowCOAST's rolling window (live: 120 scans ≈ 7.9 h)

/** The layer's WMS capabilities: its time dimension is the list of scans it holds. */
export function listUrl() {
  return `${RADAR_SERVICE}/${RADAR_LAYER}/ows?service=WMS&version=1.3.0&request=GetCapabilities`;
}
/** Capabilities XML → the scans it lists, newest first: [{ id: exact ISO time, t: Date }]. */
export function parseList(xml) {
  if (typeof xml !== 'string') return [];
  const at = xml.indexOf(`<Name>${RADAR_LAYER}</Name>`);
  const m = /<Dimension\b[^>]*name="time"[^>]*>([^<]*)<\/Dimension>/.exec(at >= 0 ? xml.slice(at) : xml);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(s => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(s))
    .map(id => ({ id, t: new Date(id) })).sort((a, b) => b.t - a.t);
}

/** Every real scan within `spanMs` of the latest one (no thinning, no invented times), oldest
 *  first so the history ends on the latest scan. Duplicate times are kept once. */
export function pickFrames(scans, { spanMs = RADAR_WINDOW_MS } = {}) {
  if (!scans.length) return [];
  const latest = scans[0].t.getTime(), out = [], seen = new Set();
  for (const s of scans) {
    const t = s.t.getTime();
    if (latest - t > spanMs) break;
    if (seen.has(t)) continue;
    seen.add(t); out.push(s);
  }
  return out.reverse();
}

/** Playback speed: a whole history plays in ~24 s, never faster than ~5 scans a second. */
export const playStep = (n, reduced = false) => (reduced ? 1400 : Math.round(Math.max(180, Math.min(650, 24000 / Math.max(1, n)))));

/** True when a decoded radar image (exactly the visible extent) has no returns at all: every
 *  pixel fully transparent. null when it can't be read (then the time is shown as usual). */
export function isEmptyImage(img) {
  try {
    const w = img.naturalWidth ?? img.width, h = img.naturalHeight ?? img.height;
    if (!w || !h) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  } catch { return null; }
}

/** One image of one exact scan (a time from the list) for a Web-Mercator box. */
export function frameUrl(id, bbox, w, h) {
  return `${RADAR_SERVICE}/ows?service=WMS&version=1.3.0&request=GetMap&layers=${RADAR_LAYER}&styles=&format=image/png&transparent=true`
    + `&crs=EPSG:3857&bbox=${bbox.map(v => Math.round(v)).join(',')}&width=${w}&height=${h}&time=${encodeURIComponent(id)}`;
}

export function createRadar(map, L, {
  onState = () => {}, reduced = () => false,
  fetchText = u => fetch(u).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }),
} = {}) {
  const pane = map.getPane('radar') || map.createPane('radar');
  pane.style.zIndex = 420; pane.style.pointerEvents = 'none'; // above the base map, below wind + markers
  let on = false, scans = null, listAt = 0, view = null, overlay = null, frames = [], imgs = new Map(), idx = -1, timer = 0, playing = false, gen = 0;
  let retired = []; // blob URLs of a previous view, released once the new view is on screen
  let state = { status: 'off', t: null, playing: false };
  const set = patch => { state = { ...state, ...patch }; onState(state); };

  async function loadList(force = false) {
    if (!force && scans && Date.now() - listAt < LIST_TTL) return scans;
    const next = parseList(await fetchText(listUrl()));
    if (!next.length) throw new Error('no radar scans');
    scans = next; listAt = Date.now();
    return scans;
  }

  function currentView() {
    const b = map.getBounds(), s = map.getSize();
    const sw = L.CRS.EPSG3857.project(b.getSouthWest()), ne = L.CRS.EPSG3857.project(b.getNorthEast());
    const k = Math.min(1, MAX_PX / Math.max(s.x, s.y)); // CSS pixels, capped: radar is ~1 km data, retina buys nothing
    return { bounds: b, bbox: [sw.x, sw.y, ne.x, ne.y], w: Math.max(64, Math.round(s.x * k)), h: Math.max(64, Math.round(s.y * k)) };
  }

  const loadImg = url => new Promise((res, rej) => {
    const img = new Image(); img.decoding = 'async';
    img.onload = () => res(img); img.onerror = () => rej(new Error('radar image'));
    img.src = url;
  });
  // One scan's image for the current view → { src, empty }. Normally fetched with CORS and kept
  // as a blob URL (pixels readable → the dry-view check). If that fails for any reason, the image
  // is loaded the plain way (fail open: shown, just not inspected). Both failing = this scan failed.
  function image(frame) {
    const url = frameUrl(frame.id, view.bbox, view.w, view.h);
    if (!imgs.has(url)) {
      const p = (async () => {
        try {
          const r = await fetch(url, { mode: 'cors' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const blob = await r.blob();
          if (!/^image\//.test(blob.type)) throw new Error('not an image'); // WMS errors arrive as XML
          let empty = null;
          try { const bmp = await createImageBitmap(blob); empty = isEmptyImage(bmp); bmp.close?.(); } catch { /* unreadable: no check */ }
          return { src: URL.createObjectURL(blob), empty, blob: true };
        } catch {
          await loadImg(url);
          return { src: url, empty: null, blob: false };
        }
      })();
      p.catch(() => imgs.delete(url)); // a failed scan can be retried later
      imgs.set(url, p);
    }
    return imgs.get(url);
  }
  const release = list => { for (const p of list) p.then(x => { if (x.blob && x.src !== overlay?._url) URL.revokeObjectURL(x.src); }, () => {}); };

  async function show(i) {
    const rec = await image(frames[i]); // already loaded by the caller
    idx = i;
    if (!overlay) overlay = L.imageOverlay(rec.src, view.bounds, { pane: 'radar', opacity: 0.66, interactive: false, className: 'wm-radar' }).addTo(map);
    else { overlay.setBounds(view.bounds); overlay.setUrl(rec.src); }
    if (retired.length) { release(retired); retired = []; }
    set({ t: frames[i].t, frame: i, frames: frames.length, empty: rec.empty === true });
  }

  /** The current view at the latest scan — or, when `holdId` is given (paused on an older scan),
   *  at that same scan, keeping the history's frames. */
  async function refresh(holdId = null, { force = false } = {}) {
    const my = ++gen;
    stop(false);
    set({ status: 'loading', playing: false });
    try {
      let i = holdId != null && frames.length ? frames.findIndex(f => f.id === holdId) : -1;
      if (i < 0) {
        await loadList(force);
        if (my !== gen || !on) return;
        frames = pickFrames(scans);
        i = frames.length - 1;
      }
      view = currentView(); retired.push(...imgs.values()); imgs = new Map();
      // the newest scan may still be failing to render: fall back to the next newest that loads
      for (;;) {
        try { await image(frames[i]); break; } catch (e) {
          if (holdId != null) { if (my === gen && on) refresh(); return; } // that older scan is gone: go to the latest
          if (--i < 0 || frames.length - 1 - i > 3) throw e;
        }
      }
      if (my !== gen || !on) return;
      await show(i);
      set({ status: 'ready' });
      prefetch(i - 2, 2);
    } catch {
      if (my !== gen) return;
      if (overlay) { map.removeLayer(overlay); overlay = null; }
      set({ status: 'unavailable', t: null });
    }
  }

  function stop(report = true) { clearTimeout(timer); timer = 0; playing = false; if (report) set({ playing: false }); }

  // a few neighbouring scans, quietly (never the whole history at once)
  function prefetch(i, ahead = 3) {
    for (let k = 1; k <= ahead; k++) { const f = frames[((i + k) % frames.length + frames.length) % frames.length]; if (f) image(f).catch(() => {}); }
  }

  async function play() {
    if (!on || state.status !== 'ready' || playing || frames.length < 2) return;
    const my = gen;
    playing = true; set({ playing: true });
    if (idx >= frames.length - 1) idx = -1; // from the latest: start again at the oldest scan
    const step = playStep(frames.length, reduced()), hold = 1600;
    const tick = async () => {
      if (!playing || my !== gen) return;
      let next = (idx + 1) % frames.length;
      prefetch(next, 5);
      // stream: wait for THIS scan's image; a scan whose image fails is skipped, never faked
      for (let tries = 0; tries < frames.length; tries++) {
        try { await image(frames[next]); break; } catch { next = (next + 1) % frames.length; }
      }
      if (!playing || my !== gen) return;
      await show(next);
      timer = setTimeout(tick, next === frames.length - 1 ? hold : step); // linger on the latest scan
    };
    timer = setTimeout(tick, 150);
  }

  function pause() { stop(); } // holds the frame on screen; its time stays in the label

  let moveT = 0, gotoTicket = 0, poll = 0;
  // playing → stop on the latest scan; paused on an older scan → keep that scan; latest → latest.
  const onMove = () => {
    clearTimeout(moveT);
    const hold = !playing && frames.length && idx >= 0 && idx < frames.length - 1 ? frames[idx].id : null;
    if (playing) stop();
    moveT = setTimeout(() => { if (on) refresh(hold); }, 250);
  };
  // Sitting on the latest scan: look for a newer one every ~4 min (one ~10 KB request), so "latest"
  // stays true. Never while playing, scrubbed back in time, or with the page hidden.
  const tickPoll = () => {
    if (!on || playing || state.status !== 'ready' || idx !== frames.length - 1 || document.hidden) return;
    refresh(null, { force: true });
  };

  return {
    enable() { if (on) return; on = true; map.on('moveend', onMove); poll = setInterval(tickPoll, POLL); refresh(); },
    disable() {
      if (!on) return; on = false; gen++; stop(false); map.off('moveend', onMove); clearInterval(poll);
      if (overlay) { map.removeLayer(overlay); overlay = null; }
      release([...imgs.values(), ...retired]); retired = []; imgs = new Map();
      frames = []; idx = -1; set({ status: 'off', t: null, playing: false, empty: false });
    },
    play, pause, refresh: () => refresh(),
    /** Show scan i of the history (stops playback). For the ocean map's frame strip. */
    async goto(i) {
      if (!on || state.status !== 'ready' || !frames[i]) return;
      if (playing) stop();
      const my = gen, ticket = ++gotoTicket; // a newer goto (fast scrubbing) wins
      try { await image(frames[i]); } catch { return; }
      if (my === gen && on && ticket === gotoTicket) { await show(i); prefetch(i, 2); prefetch(i - 3, 2); }
    },
    /** The history's scans, oldest first: [{ t }] — read-only. */
    get frames() { return frames.map(f => ({ t: f.t.getTime() })); },
    get loaded() { return imgs.size; },
    get state() { return state; },
  };
}
