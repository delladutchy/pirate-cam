// Motion that carries information only: number tweens and arrow rotation.
// Everything is instant when the user prefers reduced motion.
const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
export const reducedMotion = () => mq.matches;
export const DURATION = 260;

const ease = t => 1 - Math.pow(1 - t, 3);
const running = new WeakMap();

// ---- the Pirate Score number ----
// The score shown for the selected time is ONE value, written synchronously to every place
// that shows it (score card + dock). The only animation is an optional count-up on a spot
// switch, which drives every target from the same tween and is guaranteed to land on the
// final value by a deadline even when animation frames are delayed or suspended
// (background tab, unfocused webview, iOS Low Power Mode).
let tween = null; // { raf, timer, targets, to }

/** Write `v` to each target immediately ({ el, format }), cancelling any count-up in flight. */
export function setNumbers(targets, v) {
  cancelNumberTween();
  for (const { el, format } of targets) if (el) { el.dataset.v = Number.isFinite(v) ? v : ''; el.textContent = format(v); }
}

/** Stop a running count-up and snap its targets to their final value. */
export function cancelNumberTween() {
  if (!tween) return;
  const t = tween; tween = null;
  cancelAnimationFrame(t.raf); clearTimeout(t.timer);
  for (const { el, format } of t.targets) if (el) el.textContent = format(t.to);
}

/**
 * Count every target up from `from` to `to` together. Targets must already hold `to` as their
 * authoritative value (call setNumbers first); this only animates the text. Skipped when motion
 * is reduced, the page is hidden, or there's nothing to animate.
 */
export function countUp(targets, from, to, { duration = DURATION, deadline = duration + 120 } = {}) {
  cancelNumberTween();
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to || reducedMotion() || hidden) return;
  const t0 = performance.now();
  const mine = { targets, to, raf: 0, timer: 0 };
  const paint = v => { for (const { el, format } of targets) if (el) el.textContent = format(v); };
  const step = () => {
    if (tween !== mine) return;
    const k = Math.min(1, (performance.now() - t0) / duration);
    paint(from + (to - from) * ease(k));
    if (k < 1) mine.raf = requestAnimationFrame(step); else cancelNumberTween();
  };
  tween = mine;
  paint(from);
  mine.raf = requestAnimationFrame(step);
  mine.timer = setTimeout(() => { if (tween === mine) cancelNumberTween(); }, deadline); // never stuck mid-way
}

/** True while a spot-switch count-up is in flight (tests/debug). */
export const numberTweenActive = () => !!tween;

/** Rotate an element to `deg`, turning the short way round (CSS transition does the motion). */
export function rotateTo(el, deg) {
  if (!el || !Number.isFinite(deg)) return;
  const prev = parseFloat(el.dataset.rot);
  let next = deg;
  if (Number.isFinite(prev)) {
    const delta = ((deg - prev) % 360 + 540) % 360 - 180;
    next = prev + delta;
  }
  el.dataset.rot = next;
  el.style.transform = `rotate(${next}deg)`;
}
