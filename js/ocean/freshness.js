// Freshness rules for the ocean map's sources. Every source carries its own timestamp; this module
// turns "how old is it" into a plain label, and says when a source is late enough to call out.
// Map display only — nothing here feeds Pirate Score.
//
// Thresholds (normal behaviour + margin):
//   radar  — MRMS scans every ~2–8 min, a few minutes' latency      → delayed after 20 min
//   models — GFS / GFS-Wave run every 6 h; a run is used once its
//            whole 7-day range is posted (~5–5.5 h after the cycle) → normal age ≤ ~11.5 h, delayed after 13 h
//   SST    — MUR is a daily analysis (09:00 UTC) posted ~1 day later → normal age ~30–55 h, delayed after 72 h
//   buoys  — NDBC reports hourly, posted ~20–50 min later           → delayed after 2 h

export const STALE_MS = {
  radar: 20 * 60e3,
  model: 13 * 3600e3,
  sst: 72 * 3600e3,
  buoy: 2 * 3600e3,
};

/** Compact age: "just now", "12 min", "3h", "34h", "4d". */
export function ageText(ms) {
  const m = Math.max(0, Math.round(ms / 60e3));
  if (m < 1) return 'just now';
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 72 ? `${h}h` : `${Math.round(h / 24)}d`;
}

/** { ageMs, delayed, age } for a source timestamp (ms or ISO). */
export function freshness(kind, t, now = Date.now()) {
  const ms = typeof t === 'number' ? t : Date.parse(t);
  if (!Number.isFinite(ms)) return { ageMs: NaN, delayed: false, age: '' };
  const ageMs = now - ms;
  return { ageMs, delayed: ageMs > STALE_MS[kind], age: ageText(ageMs) };
}

/** "DATA DELAYED · LAST UPDATED 3H AGO" (the chip/pill wording). */
export function delayedLabel(ageMs) {
  const a = ageText(ageMs);
  return `DATA DELAYED · LAST UPDATED ${a === 'just now' ? 'JUST NOW' : `${a.toUpperCase()} AGO`}`;
}
export const UNAVAILABLE = 'DATA UNAVAILABLE';
