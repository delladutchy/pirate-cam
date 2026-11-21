import test from 'node:test'; import assert from 'node:assert/strict';
import { parseRealtime } from '../api/buoy.js';
// Real NDBC 44084 rows captured 2026-11-21 (test fixture)
const TXT = `#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 11 21 19 26  MM   MM   MM   0.5     8   7.0 129     MM    MM  14.1    MM   MM   MM    MM
2026 11 21 18 56  MM   MM   MM   0.5     8   7.0 133     MM    MM  13.8    MM   MM   MM    MM`;
test('parses latest NDBC observation', () => {
  const r = parseRealtime(TXT, Date.UTC(2026, 10, 21, 19, 40));
  assert.equal(r.waveHeightFt, 1.6); assert.equal(r.dominantPeriodS, 8); assert.equal(r.waveFromDeg, 129); assert.equal(r.waterTempF, 57);
  assert.equal(r.observedAt, '2026-11-21T19:26:00.000Z');
});
test('stale buoy data is not reported as current', () => {
  const r = parseRealtime(TXT, Date.UTC(2026, 10, 22, 3, 0));
  assert.equal(r.waveHeightFt, null); assert.equal(r.waterTempF, null);
});
test('missing field falls back to previous report', () => {
  const r = parseRealtime(TXT.replace('0.5     8   7.0 129', ' MM     8   7.0 129'), Date.UTC(2026, 10, 21, 19, 40));
  assert.equal(r.waveHeightFt, 1.6); assert.equal(r.observedAt, '2026-11-21T18:56:00.000Z');
});
