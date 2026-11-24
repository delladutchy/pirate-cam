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
// Every camera player has its own full-screen control, and we use it wherever it works:
//  - YouTube: its own button (works everywhere, including iPhone);
//  - DelDOT HLS <video>: the browser's video controls (iPhone opens Apple's video player);
//  - Angelcam: its own button, which uses the Fullscreen API — fine on desktop, Android and iPad.
// iPhone Safari has no Fullscreen API for page elements, so there Angelcam's button can only fill
// its own small frame. Only in that case we show our button, placed exactly over Angelcam's (one
// icon, never two): it makes the camera fill the window (rotate to landscape for the largest
// picture). Exit with the same button or Escape. Provider players are never altered.
const EXPAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const COLLAPSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

export function createFullscreen(viewer, button) {
  const doc = document;
  const elementFs = !!(viewer.requestFullscreen || viewer.webkitRequestFullscreen) && !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  doc.documentElement.classList.toggle('no-element-fs', !elementFs); // CSS shows the button only then
  const isActive = () => viewer.classList.contains('pseudo-fs');

  function set(on) {
    viewer.classList.toggle('pseudo-fs', on);
    doc.documentElement.classList.toggle('pseudo-fs-on', on);
    button.innerHTML = on ? COLLAPSE : EXPAND;
    button.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    button.title = on ? 'Exit full screen' : 'Full screen';
  }
  button.addEventListener('click', () => set(!isActive()));
  // Escape leaves the full-window view (and nothing else reacts to that Escape, e.g. Cam only)
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && isActive()) { set(false); e.stopImmediatePropagation(); } });
  set(false);
  return { active: isActive, exit: () => set(false) };
}
