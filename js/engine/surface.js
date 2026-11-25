// ESTIMATED SURFACE QUALITY — Clean / Fair / Choppy. A separate, transparent estimate of how
// textured the water is likely to be, from the wind's speed and direction relative to the beach
// (its shore orientation) and, when known, the wave period. It is NOT part of the Pirate Score
// and never changes it. Pure: no DOM, no I/O.
//
// The rules, in full:
//   calm (< 5 mph, any direction)                     → Clean
//   offshore      ≤ 15 mph Clean · ≤ 22 mph Fair · above → Choppy
//   cross-shore   <  8 mph Clean · < 15 mph Fair · above → Choppy
//   onshore       <  6 mph Clean · < 12 mph Fair · above → Choppy
//   short-period wind sea (period < 6 s with ≥ 8 mph wind): one step rougher
// No wind reading, or a beach without a known orientation (and wind ≥ 5 mph) → no estimate.
import { windRelation } from './score.js';

export const SURFACE = {
  clean: { label: 'Clean', note: 'smooth to lightly textured water' },
  fair: { label: 'Fair', note: 'some texture or bumps' },
  choppy: { label: 'Choppy', note: 'wind-blown, choppy water' },
};
const LIMITS = { offshore: [15, 22], 'cross-shore': [8, 15], onshore: [6, 12] };

/** { cls: 'clean'|'fair'|'choppy', relation, why } or null when it can't be estimated. */
export function surfaceQuality(shoreFacingDeg, wind, waves = null) {
  if (!wind || !Number.isFinite(wind.mph)) return null;
  const mph = wind.mph;
  let cls, relation = null, why;
  if (mph < 5) { cls = 'clean'; why = `light wind (${Math.round(mph)} mph)`; }
  else {
    relation = windRelation(shoreFacingDeg, wind);
    if (!relation || relation === 'calm') return null; // orientation unknown
    const [clean, fair] = LIMITS[relation];
    cls = relation === 'offshore' ? (mph <= clean ? 'clean' : mph <= fair ? 'fair' : 'choppy')
      : mph < clean ? 'clean' : mph < fair ? 'fair' : 'choppy';
    why = `${relation} wind ${Math.round(mph)} mph`;
  }
  const p = waves && Number.isFinite(waves.periodS) ? waves.periodS : null;
  if (p != null && p < 6 && mph >= 8 && cls !== 'choppy') {
    cls = cls === 'clean' ? 'fair' : 'choppy';
    why += `, short-period wind sea (${Math.round(p)} s)`;
  }
  return { cls, relation, why };
}
