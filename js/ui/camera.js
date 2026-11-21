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

const BADGE = `<div style="width:215px;height:58px;background:#090a0b;border:1px solid #34383c;border-radius:4px;display:flex;align-items:center;padding:4px 10px;gap:10px;overflow:hidden">
      <div style="width:47px;height:47px;border-radius:2px;overflow:hidden;background:white;flex:0 0 47px">
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" style="display:block"><rect width="100" height="100" fill="#000"/><g stroke="#fff" stroke-width="9" stroke-linecap="round"><line x1="16" y1="62" x2="84" y2="94"/><line x1="84" y1="62" x2="16" y2="94"/></g><path fill="#fff" d="M50 8c-19 0-32 13-32 30 0 10 5 17 11 21v10c0 3 2 5 5 5h32c3 0 5-2 5-5V59c6-4 11-11 11-21C82 21 69 8 50 8z"/><circle cx="38" cy="40" r="8" fill="#000"/><circle cx="62" cy="40" r="8" fill="#000"/><path d="M50 50l-5 9h10z" fill="#000"/><g stroke="#000" stroke-width="2.5"><line x1="42" y1="66" x2="42" y2="74"/><line x1="50" y1="66" x2="50" y2="74"/><line x1="58" y1="66" x2="58" y2="74"/></g></svg>
      </div>
      <span style="font-family:'Pirata One',Georgia,serif;color:#f4f1e8;font-size:22px;letter-spacing:.8px;white-space:nowrap">PIRATE VIEW</span>
    </div>`;

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
  } else {
    e = document.createElement('iframe'); e.src = c.src; e.allow = 'autoplay; fullscreen; picture-in-picture'; e.allowFullscreen = true;
    e.title = `${c.name} live camera`;
    media.appendChild(e);
    const flag = document.createElement('div');
    flag.className = 'pirate-cover';
    flag.style.display = 'flex';
    flag.innerHTML = BADGE;
    media.appendChild(flag);
  }
}
