// Motion that carries information only: number tweens and arrow rotation.
// Everything is instant when the user prefers reduced motion.
const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
export const reducedMotion = () => mq.matches;
export const DURATION = 260;

const ease = t => 1 - Math.pow(1 - t, 3);
const running = new WeakMap();

/** Tween the number shown in `el` to `to`. `format` turns a number into text. */
export function tweenNumber(el, to, format = v => v.toFixed(1)) {
  if (!el) return;
  const from = parseFloat(el.dataset.v);
  el.dataset.v = to;
  if (!Number.isFinite(from) || !Number.isFinite(to) || reducedMotion() || from === to) { el.textContent = format(to); return; }
  cancelAnimationFrame(running.get(el));
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / DURATION);
    el.textContent = format(from + (to - from) * ease(k));
    if (k < 1) running.set(el, requestAnimationFrame(step));
  };
  running.set(el, requestAnimationFrame(step));
}

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
