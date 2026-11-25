// Map gestures shared by the Ocean and Wind maps (Leaflet).
//
// Touch screens — cooperative gestures, no mode to learn:
//   · one finger scrolls the PAGE (the map never traps a scroll);
//   · two fingers pan and pinch-zoom the MAP (Leaflet touchZoom follows the pinch centre);
//   · a one-finger swipe over the map shows a brief, small "two fingers" hint;
//   · the small hand button lets one finger pan too (for one-handed use). It turns itself off
//     again on a tap outside the map, or once the map scrolls out of view.
// Mouse / trackpad: click-and-drag pans, double-click and the +/− buttons zoom, Ctrl/⌘ + wheel
//   zooms (a plain wheel keeps scrolling the page).

const HAND = '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9.5V4.2a1.2 1.2 0 0 1 2.4 0V9M9.4 8.6V3.2a1.2 1.2 0 0 1 2.4 0v5.4M11.8 8.8V4.4a1.2 1.2 0 0 1 2.4 0v6.8c0 3.3-2 5.6-5 5.6-2.2 0-3.3-1-4.6-3.1L2.9 10.9a1.2 1.2 0 0 1 2-1.3L7 12"/></svg>';

export const isCoarse = () => !!window.matchMedia?.('(pointer: coarse)').matches;

/** Leaflet options for a page-embedded map. */
export function mapOptions(extra = {}) {
  const coarse = isCoarse();
  return { zoomControl: false, attributionControl: false, scrollWheelZoom: false, tap: false, dragging: !coarse, touchZoom: true, doubleClickZoom: true, ...extra };
}

/**
 * map: Leaflet map; el: its container; host: where the hand button goes (null = none).
 * Returns { unlocked, setUnlocked(on) }.
 */
export function setupGestures(map, el, { host = null, hint = true } = {}) {
  el.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); map.setZoom(map.getZoom() + (e.deltaY < 0 ? 0.5 : -0.5)); } }, { passive: false });
  // iPhone Safari: its own pinch-zoom gesture events would zoom the PAGE under a map pinch — the
  // map handles the pinch itself (touch-action keeps one-finger scrolling for the page)
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) el.addEventListener(ev, e => e.preventDefault(), { passive: false });
  if (!isCoarse()) return { unlocked: true, setUnlocked() {} };

  let unlocked = false, tip = null, tipT = 0, shownTips = 0;
  const btn = host ? document.createElement('button') : null;
  if (btn) {
    btn.type = 'button'; btn.className = 'om-sq map-hand'; btn.innerHTML = HAND;
    host.prepend(btn);
    btn.addEventListener('click', e => { e.stopPropagation(); set(!unlocked); });
  }
  function set(on) {
    unlocked = on;
    if (on) map.dragging.enable(); else map.dragging.disable();
    el.classList.toggle('map-unlocked', on);
    el.closest('.om-wrap')?.classList.toggle('map-unlocked', on);
    if (btn) { btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', on ? 'One-finger panning on — tap to turn off' : 'Pan with one finger'); btn.title = btn.getAttribute('aria-label'); }
    if (on) hideTip();
  }
  set(false);

  // brief hint when one finger slides over the locked map (the page scrolls, as it should)
  let start = null;
  el.addEventListener('touchstart', e => { start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; if (e.touches.length > 1) hideTip(); }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!hint || unlocked || !start || e.touches.length !== 1 || shownTips >= 3) return;
    const dx = Math.abs(e.touches[0].clientX - start.x), dy = Math.abs(e.touches[0].clientY - start.y);
    if (dx > 24 && dx > dy * 1.4) { start = null; showTip(); } // a sideways swipe: they meant the map
  }, { passive: true });
  function showTip() {
    shownTips++;
    if (!tip) { tip = document.createElement('div'); tip.className = 'map-tip'; tip.textContent = 'Two fingers to move the map'; tip.setAttribute('aria-hidden', 'true'); el.closest('.om-wrap')?.appendChild(tip); }
    tip.classList.add('on'); clearTimeout(tipT); tipT = setTimeout(hideTip, 1400);
  }
  function hideTip() { tip?.classList.remove('on'); }

  // never leave one-finger panning on by accident
  document.addEventListener('pointerdown', e => { if (unlocked && !el.closest('.om-wrap')?.contains(e.target)) set(false); }, true);
  new IntersectionObserver(es => { if (unlocked && !es.some(x => x.intersectionRatio > 0.4)) set(false); }, { threshold: [0, 0.4] }).observe(el);

  return { get unlocked() { return unlocked; }, setUnlocked: set };
}
