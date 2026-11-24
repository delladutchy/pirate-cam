// Ocean City, MD spots (first two) — and proof the Delaware spots/cameras are untouched.
import test from 'node:test'; import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spots, spotById, resolveHash } from '../js/config/spots.js';
import { cams, camSlug } from '../js/config/cameras.js';
import { scoreSample } from '../js/engine/score.js';
import { withWaves } from '../js/data/load.js';

const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const DELAWARE = ['dewey', 'bethany', 'southside', 'northside', 'conquest'];

test('the five Delaware spots and six Delaware cameras are byte-for-byte what 16e4fe3 shipped', () => {
  assert.deepEqual(spots.slice(0, 5).map(s => s.id), DELAWARE);
  // the only Delaware change since then is the added NWPS sampling point (sources.nwps)
  const without = spots.slice(0, 5).map(s => { const { nwps, ...src } = s.sources; return { ...s, sources: src }; });
  assert.equal(hash(without), 'e76a27c85b9c0c32');
  for (const s of spots.slice(0, 5)) assert.ok(s.sources.nwps && s.sources.nwps.lon > s.lon, `${s.id}: NWPS point lies offshore (east)`);
  for (const s of spots.slice(5)) assert.equal(s.sources.nwps, undefined, `${s.id}: outside the PHI NWPS grid`);
  assert.equal(hash(cams.slice(0, 6)), '69a3150b9e7afffb');
});

test('OC Downtown and OC Midtown exist with Ocean City sources, not Delaware ones', () => {
  for (const id of ['oc-downtown', 'oc-midtown']) {
    const s = spotById(id);
    assert.ok(s, id);
    assert.ok(s.lat > 38.33 && s.lat < 38.37 && s.lon > -75.09 && s.lon < -75.06, `${id} sits on the Ocean City beach`);
    assert.equal(s.sources.tide, '8570280', 'Ocean City (Fishing Pier) tide predictions');
    assert.equal(s.sources.obs, '8570283', 'Ocean City Inlet observations');
    assert.equal(s.sources.buoy, '44084', 'nearest reporting wave buoy');
    assert.ok(s.sources.waveForecast && s.sources.waveForecast.lon > s.lon, 'wave forecast point lies offshore (east)');
  }
});

test('Ocean City spots are NOT RATED: no calibration invented or copied', () => {
  for (const id of ['oc-downtown', 'oc-midtown', 'conquest']) {
    const p = spotById(id).profile;
    assert.deepEqual([p.shoreFacingDeg, p.tide, p.wind, p.waves], [null, null, null, null], id);
    const ideal = { tide: { phase: 0.5, rising: true, rateFtHr: 0.3 }, wind: { mph: 5, fromDeg: 270 }, waves: { ft: 2, periodS: 9 }, pop: 0, thunder: 0, daylight: true };
    assert.equal(scoreSample(p, ideal).reason, 'not-configured', id);
  }
});

test('OC cameras: official YouTube embeds, direct links, correct defaults', () => {
  const dt = cams.find(c => camSlug(c) === 'commander-hotel-14th-st');
  const mt = cams.find(c => camSlug(c) === 'econo-lodge-29th-st');
  for (const [c, id] of [[dt, 'zCEiot7sEWY'], [mt, 'zGima24vRHM']]) {
    assert.equal(c.kind, 'youtube');
    assert.equal(c.src, `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0`);
    assert.equal(c.href, `https://www.youtube.com/watch?v=${id}`);
  }
  const slugs = cams.map(camSlug);
  assert.deepEqual(resolveHash('#oc-downtown', slugs), { spotId: 'oc-downtown', cam: 'commander-hotel-14th-st' });
  assert.deepEqual(resolveHash('#oc-midtown', slugs), { spotId: 'oc-midtown', cam: 'econo-lodge-29th-st' });
  assert.deepEqual(resolveHash('#econo-lodge-29th-st', slugs), { spotId: 'oc-midtown', cam: 'econo-lodge-29th-st' });
  assert.deepEqual(resolveHash('#dewey', slugs), { spotId: 'dewey', cam: 'dewey-beach' }, 'Delaware links unchanged');
});

test('withWaves keeps the spot forecast and takes only wave height from the ocean cell', () => {
  const t = new Date('2026-11-23T15:00Z');
  const beach = { updated: 'u', at: () => ({ windMph: 7, windFromDeg: 280, tempF: 55, pop: 10, waveFt: null }) };
  const ocean = { at: () => ({ windMph: 20, windFromDeg: 10, tempF: 50, pop: 90, waveFt: 4.9 }) };
  assert.deepEqual(withWaves(beach, ocean).at(t), { windMph: 7, windFromDeg: 280, tempF: 55, pop: 10, waveFt: 4.9 });
  assert.equal(withWaves(beach, { at: () => ({ waveFt: null }) }).at(t).waveFt, null, 'missing stays missing');
});
