// Live camera player — same behaviour as the original Skim Cams file:
// Angelcam feeds are iframes with the PIRATE VIEW badge; DelDOT feeds are HLS
// <video> played through hls.js (works in Chrome/Firefox/Android/Safari),
// falling back to native HLS when hls.js isn't supported.
// hls.js is now loaded only the first time an HLS camera is opened.

let hls = null;
let hlsLoader = null;

function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoader) {
    hlsLoader = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = '/vendor/hls.light.min.js';
      s.onload = () => resolve(window.Hls || null);
      s.onerror = () => resolve(null); // native playback fallback
      document.head.appendChild(s);
    });
  }
  return hlsLoader;
}

// Broadcast-style bug, top-left, sized by CSS to the Angelcam logo underneath
// (that logo scales with the player height: 7% of it, clamped 15–30 px).
const SKULL = '<svg viewBox="0 0 100 100" aria-hidden="true"><g stroke="#fff" stroke-width="9" stroke-linecap="round"><line x1="16" y1="62" x2="84" y2="94"/><line x1="84" y1="62" x2="16" y2="94"/></g><path fill="#fff" d="M50 8c-19 0-32 13-32 30 0 10 5 17 11 21v10c0 3 2 5 5 5h32c3 0 5-2 5-5V59c6-4 11-11 11-21C82 21 69 8 50 8z"/><circle cx="38" cy="40" r="8" fill="#0a0b0c"/><circle cx="62" cy="40" r="8" fill="#0a0b0c"/><path d="M50 50l-5 9h10z" fill="#0a0b0c"/></svg>';
const BUG = `${SKULL}<span>PIRATE VIEW</span>`;

function showFailure(media, onRetry) {
  if (media.querySelector('.cam-fail')) return;
  const d = document.createElement('div');
  d.className = 'cam-fail';
  d.innerHTML = '<p>Live camera temporarily unavailable</p><button type="button">Try again</button>';
  d.querySelector('button').onclick = onRetry;
  media.appendChild(d);
}

let renderToken = 0;

export async function renderMedia(media, c) {
  const token = ++renderToken;
  if (hls) { hls.destroy(); hls = null; }
  media.innerHTML = '';
  media.dataset.kind = c.kind; // which player is showing (decides whether our full-screen button is needed)
  const retry = () => renderMedia(media, c);
  let e;
  if (c.kind === 'hls') {
    e = document.createElement('video'); e.controls = true; e.autoplay = true; e.muted = true; e.playsInline = true;
    media.appendChild(e);
    const Hls = await loadHls();
    if (token !== renderToken) return; // user switched camera while hls.js loaded
    if (Hls && Hls.isSupported()) {
      hls = new Hls({ liveDurationInfinity: true });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
        showFailure(media, retry);
      });
      hls.loadSource(c.src); hls.attachMedia(e);
    } else {
      e.addEventListener('error', () => showFailure(media, retry), { once: true });
      e.src = c.src;
    }
  } else if (c.kind === 'youtube') {
    // YouTube's own embed player, unmodified (no overlay on its branding). YouTube needs the
    // referrer to identify the embedding site.
    e = document.createElement('iframe'); e.src = c.src;
    e.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'; e.allowFullscreen = true;
    e.referrerPolicy = 'strict-origin-when-cross-origin';
    e.title = `${c.name} live camera (YouTube)`;
    media.appendChild(e);
  } else {
    e = document.createElement('iframe'); e.src = c.src; e.allow = 'autoplay; fullscreen; picture-in-picture'; e.allowFullscreen = true;
    e.title = `${c.name} live camera`;
    media.appendChild(e);
    const bug = document.createElement('div');
    bug.className = 'pv-bug';
    bug.innerHTML = BUG;
    media.appendChild(bug);
  }
}

// ---------- full screen ----------
// Pirate View's own full screen (the expand icon under the camera): the camera fills the screen
// — the browser's Fullscreen API where it exists (desktop, Android, iPad), the whole window on
// iPhone (no Fullscreen API for page elements there; rotate for the largest picture). Inside it,
// swipe left / right (or ‹ ›, or the arrow keys) to move to the next or previous camera; a slim
// bar shows the beach. The bottom strip is left to the player, so its own controls still work.
// Providers' own players and full-screen buttons are untouched (their full screen can't see our
// swipes). Exit with ✕, the expand icon or Escape.
const EXPAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const COLLAPSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

export function createFullscreen(viewer, button, { onSwipe = () => {} } = {}) {
  const doc = document;
  const elementFs = !!(viewer.requestFullscreen || viewer.webkitRequestFullscreen) && !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  const fsEl = () => doc.fullscreenElement || doc.webkitFullscreenElement;
  const isActive = () => viewer.classList.contains('is-fs');

  function mark(on) {
    viewer.classList.toggle('is-fs', on);
    viewer.classList.toggle('pseudo-fs', on && !(fsEl() === viewer));
    doc.documentElement.classList.toggle('pseudo-fs-on', on && !(fsEl() === viewer));
    button.innerHTML = on ? COLLAPSE : EXPAND;
    button.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    button.title = button.getAttribute('aria-label');
  }
  async function set(on) {
    if (on) {
      if (elementFs) { try { await (viewer.requestFullscreen ? viewer.requestFullscreen() : viewer.webkitRequestFullscreen()); } catch { /* refused: fill the window instead */ } }
      mark(true);
    } else {
      if (fsEl() === viewer) { try { await (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen()); } catch { /* already out */ } }
      mark(false);
    }
  }
  const onFsChange = () => { if (isActive() && fsEl() !== viewer && !viewer.classList.contains('pseudo-fs')) mark(false); };
  doc.addEventListener('fullscreenchange', onFsChange); doc.addEventListener('webkitfullscreenchange', onFsChange);
  button.addEventListener('click', () => set(!isActive()));
  viewer.querySelector('.fs-exit')?.addEventListener('click', () => set(false));
  viewer.querySelector('.fs-prev')?.addEventListener('click', () => onSwipe(-1));
  viewer.querySelector('.fs-next')?.addEventListener('click', () => onSwipe(1));
  doc.addEventListener('keydown', e => {
    if (!isActive()) return;
    if (e.key === 'Escape') { set(false); e.stopImmediatePropagation(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); onSwipe(e.key === 'ArrowRight' ? 1 : -1); }
  });
  // swipe: a deliberate sideways stroke on the picture (not the player's bottom control strip)
  const layer = viewer.querySelector('.fs-swipe');
  let start = null;
  layer?.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; layer.setPointerCapture?.(e.pointerId); });
  layer?.addEventListener('pointerup', e => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, dt = performance.now() - start.t; start = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 900) onSwipe(dx < 0 ? 1 : -1); // finger moves left → next
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) viewer.classList.toggle('fs-bar-hidden'); // a tap shows / hides the bar
  });
  layer?.addEventListener('pointercancel', () => { start = null; });
  mark(false);
  return { active: isActive, exit: () => set(false), enter: () => set(true) };
}
