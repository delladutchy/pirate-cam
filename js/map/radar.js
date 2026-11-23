// RADAR mode for the wind map: NOAA/NWS MRMS base reflectivity (the official time-enabled
// service radar/radar_base_reflectivity_time on mapservices.weather.noaa.gov — US government
// data, no key). Radar is OBSERVED and recent; it never follows the forecast time scrubber.
//
// Cheap by design:
//  - nothing is requested until Radar mode is opened (the map itself is already lazy);
//  - each frame is ONE image for the current view (exportImage, CSS-pixel size, capped), locked
//    to an exact radar scan by its raster id — not a tile pyramid;
//  - Play loads a short loop (≤ 8 frames over ~75 min) once per view and then only swaps images;
//    moving the map while playing stops and reloads the latest frame; while paused on an older
//    scan it reloads THAT scan for the new view.
//  - Each frame is checked for returns (any non-transparent pixel in the image of the view), so
//    a dry view can say so instead of looking broken. Nothing is thresholded or filtered.
//    That check is OPTIONAL: if the pixels can't be read (no CORS, tainted canvas, any error) the
//    image is loaded and shown the plain way and the label is just the scan time. Only a failure
//    to load the image itself makes radar "unavailable".
//  - If NOAA can't be reached it says "Radar unavailable"; no other provider is substituted.

export const RADAR_SERVICE = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
export const RADAR_CREDIT = 'Radar: NOAA/NWS MRMS';
const LIST_TTL = 2 * 60e3, MAX_PX = 900;

/** The CONUS scans the service holds, newest first: [{ id, t }]. */
export function listUrl(count = 24) {
  return `${RADAR_SERVICE}/query?where=${encodeURIComponent("name LIKE 'CONUS%'")}&outFields=objectid,idp_validtime&orderByFields=${encodeURIComponent('idp_validtime DESC')}&resultRecordCount=${count}&returnGeometry=false&f=json`;
}
export function parseList(json) {
  if (!json || json.error || !Array.isArray(json.features)) return [];
  return json.features.map(f => f.attributes).filter(a => a && Number.isFinite(a.objectid) && Number.isFinite(a.idp_validtime))
    .map(a => ({ id: a.objectid, t: new Date(a.idp_validtime) })).sort((a, b) => b.t - a.t);
}

/** Frames for the loop: the latest scan plus older ones at least `gapMs` apart, within `spanMs`,
 *  at most `count` — oldest first, so the loop ends on the latest. */
export function pickFrames(scans, { count = 8, spanMs = 75 * 60e3, gapMs = 8 * 60e3 } = {}) {
  if (!scans.length) return [];
  const latest = scans[0].t.getTime(), out = [scans[0]];
  for (const s of scans.slice(1)) {
    if (out.length >= count) break;
    const t = s.t.getTime();
    if (latest - t > spanMs) break;
    if (out.at(-1).t.getTime() - t >= gapMs) out.push(s);
  }
  return out.reverse();
}

/** True when a decoded radar image (exactly the visible extent) has no returns at all: every
 *  pixel fully transparent. null when it can't be read (then the time is shown as usual). */
export function isEmptyImage(img) {
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  } catch { return null; }
}

/** One image of one exact scan for a Web-Mercator box. */
export function frameUrl(id, bbox, w, h) {
  const mr = encodeURIComponent(JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [id] }));
  return `${RADAR_SERVICE}/exportImage?bbox=${bbox.map(v => Math.round(v)).join(',')}&bboxSR=3857&imageSR=3857&size=${w},${h}&format=png&transparent=true&mosaicRule=${mr}&f=image`;
}

export function createRadar(map, L, { onState = () => {}, reduced = () => false, fetchJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }) } = {}) {
  const pane = map.getPane('radar') || map.createPane('radar');
  pane.style.zIndex = 420; pane.style.pointerEvents = 'none'; // above the base map, below wind + markers
  let on = false, empty = new Map(), scans = null, listAt = 0, view = null, overlay = null, frames = [], imgs = new Map(), idx = -1, timer = 0, playing = false, gen = 0;
  let state = { status: 'off', t: null, playing: false };
  const set = patch => { state = { ...state, ...patch }; onState(state); };

  async function loadList() {
    if (scans && Date.now() - listAt < LIST_TTL) return scans;
    scans = parseList(await fetchJSON(listUrl()));
    listAt = Date.now();
    if (!scans.length) throw new Error('no radar scans');
    return scans;
  }

  function currentView() {
    const b = map.getBounds(), s = map.getSize();
    const sw = L.CRS.EPSG3857.project(b.getSouthWest()), ne = L.CRS.EPSG3857.project(b.getNorthEast());
    const k = Math.min(1, MAX_PX / Math.max(s.x, s.y)); // CSS pixels, capped: radar is ~1 km data, retina buys nothing
    return { bounds: b, bbox: [sw.x, sw.y, ne.x, ne.y], w: Math.max(64, Math.round(s.x * k)), h: Math.max(64, Math.round(s.y * k)), key: `${map.getZoom()}|${b.toBBoxString()}` };
  }

  const loadImg = (url, cors) => new Promise((res, rej) => {
    const img = new Image(); img.decoding = 'async';
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => res(img); img.onerror = () => rej(new Error('radar image'));
    img.src = url;
  });
  // url → 'anonymous' when the image loaded with CORS (pixels readable), null when it had to be
  // loaded plainly. The overlay requests it the same way, so the browser reuses the loaded copy.
  let mode = new Map();
  function image(frame) {
    const url = frameUrl(frame.id, view.bbox, view.w, view.h);
    if (!imgs.has(url)) {
      const p = loadImg(url, true)
        .then(img => { mode.set(url, 'anonymous'); empty.set(url, isEmptyImage(img)); return url; },
          () => loadImg(url, false).then(() => { mode.set(url, null); empty.set(url, null); return url; })); // pixels unreadable: still show it
      imgs.set(url, p);
    }
    return imgs.get(url);
  }

  function show(i) {
    idx = i;
    const url = frameUrl(frames[i].id, view.bbox, view.w, view.h);
    const cors = mode.get(url) ?? null;
    if (!overlay) overlay = L.imageOverlay(url, view.bounds, { pane: 'radar', opacity: 0.66, interactive: false, className: 'wm-radar', crossOrigin: cors ?? false }).addTo(map);
    else {
      const el = overlay.getElement();
      if (el && el.crossOrigin !== cors) { if (cors) el.crossOrigin = cors; else el.removeAttribute('crossorigin'); }
      overlay.setBounds(view.bounds); overlay.setUrl(url);
    }
    set({ t: frames[i].t, frame: i, frames: frames.length, empty: empty.get(url) === true });
  }

  /** The current view at the latest scan — or, when `holdId` is given (paused on an older scan),
   *  at that same scan, keeping the loop's frames. */
  async function refresh(holdId = null) {
    const my = ++gen;
    stop(false);
    set({ status: 'loading', playing: false });
    try {
      let i = holdId != null && frames.length ? frames.findIndex(f => f.id === holdId) : -1;
      if (i < 0) {
        await loadList();
        if (my !== gen || !on) return;
        frames = pickFrames(scans);
        i = frames.length - 1;
      }
      view = currentView(); imgs = new Map(); empty = new Map(); mode = new Map();
      try { await image(frames[i]); } catch (e) {
        if (holdId == null) throw e;
        if (my === gen && on) refresh(); // that older scan is gone: fall back to the latest
        return;
      }
      if (my !== gen || !on) return;
      show(i);
      set({ status: 'ready' });
    } catch {
      if (my !== gen) return;
      if (overlay) { map.removeLayer(overlay); overlay = null; }
      set({ status: 'unavailable', t: null });
    }
  }

  function stop(report = true) { clearTimeout(timer); timer = 0; playing = false; if (report) set({ playing: false }); }

  async function play() {
    if (!on || state.status !== 'ready' || playing) return;
    const my = gen;
    playing = true; set({ playing: true, status: 'loading' });
    try {
      await Promise.all(frames.map(f => image(f))); // preload the loop once for this view
    } catch {
      // a missing older frame: keep the ones that loaded rather than fail the whole loop
      const ok = [];
      for (const f of frames) { try { await image(f); ok.push(f); } catch { /* skip */ } }
      frames = ok.length ? ok : frames.slice(-1);
    }
    if (my !== gen || !playing) return;
    set({ status: 'ready' });
    const step = reduced() ? 1400 : 650, hold = 1600;
    const tick = () => {
      if (!playing) return;
      const next = (idx + 1) % frames.length;
      show(next);
      timer = setTimeout(tick, next === frames.length - 1 ? hold : step); // linger on the latest scan
    };
    timer = setTimeout(tick, 200);
  }

  function pause() { stop(); } // holds the frame on screen; its time stays in the label

  let moveT = 0;
  // playing → stop on the latest scan; paused on an older scan → keep that scan; latest → latest.
  const onMove = () => {
    clearTimeout(moveT);
    const hold = !playing && frames.length && idx >= 0 && idx < frames.length - 1 ? frames[idx].id : null;
    if (playing) stop();
    moveT = setTimeout(() => { if (on) refresh(hold); }, 250);
  };

  return {
    enable() { if (on) return; on = true; map.on('moveend', onMove); refresh(); },
    disable() {
      if (!on) return; on = false; gen++; stop(false); map.off('moveend', onMove);
      if (overlay) { map.removeLayer(overlay); overlay = null; }
      imgs = new Map(); empty = new Map(); mode = new Map(); frames = []; idx = -1; set({ status: 'off', t: null, playing: false, empty: false });
    },
    play, pause, refresh: () => refresh(),
    get state() { return state; },
  };
}
