import test from 'node:test'; import assert from 'node:assert/strict';
import { listUrl, parseList, pickFrames, frameUrl, playStep, RADAR_WINDOW_MS, RADAR_LAYER } from '../js/map/radar.js';

// Shape of NOAA nowCOAST's layer capabilities (trimmed from the live document, 2026-11-24 05:08Z).
const CAPS = (times, def = times.at(-1)) => `<?xml version="1.0" encoding="UTF-8"?><WMS_Capabilities version="1.3.0"><Service><Name>WMS</Name></Service>
<Capability><Layer><Layer queryable="1" opaque="0"><Name>${RADAR_LAYER}</Name><Title>CONUS Weather Radar Base Reflectivity</Title>
<Dimension name="time" default="${def}" units="ISO8601" nearestValue="1">${times.join(',')}</Dimension>
<Style><Name>weather_radar_base_reflectivity</Name></Style></Layer></Layer></Capability></WMS_Capabilities>`;

test('radar list: the layer\'s own scan times, newest first, nothing invented', () => {
  assert.match(listUrl(), /^https:\/\/nowcoast\.noaa\.gov\/geoserver\/observations\/weather_radar\/conus_base_reflectivity_mosaic\/ows\?service=WMS&version=1\.3\.0&request=GetCapabilities$/);
  const real = ['2026-11-24T04:47:54.000Z', '2026-11-24T04:51:52.000Z', '2026-11-24T04:55:50.000Z', '2026-11-24T05:00:13.000Z'];
  const s = parseList(CAPS([...real.slice(0, 2), 'garbage', real[2], real[3]]));
  assert.deepEqual(s.map(x => x.id), [...real].reverse(), 'exact listed strings (used verbatim in GetMap), bad entries dropped');
  assert.equal(+s[0].t, Date.parse('2026-11-24T05:00:13Z'));
  assert.deepEqual(parseList('<ServiceExceptionReport/>'), []);
  assert.deepEqual(parseList(null), []);
});

test('radar history: every real scan in the 8 h window, oldest → latest, uneven gaps kept', () => {
  // 130 scans, alternating 3.9 / 4.1 min, newest 05:00:13Z → oldest ~8.6 h back
  const times = []; let t = Date.parse('2026-11-24T05:00:13Z');
  for (let i = 0; i < 130; i++) { times.push(new Date(t).toISOString()); t -= (i % 2 ? 234 : 246) * 1000; }
  const scans = parseList(CAPS(times.slice().reverse()));
  const f = pickFrames(scans);
  assert.equal(RADAR_WINDOW_MS, 8 * 3600e3);
  assert.ok(f.length === 121 && f.at(-1).id === times[0], `${f.length} scans, ending on the latest`);
  assert.ok(f.every((x, i) => i === 0 || x.t > f[i - 1].t), 'strictly increasing time');
  assert.ok(f.at(-1).t - f[0].t <= RADAR_WINDOW_MS);
  const gaps = new Set(f.slice(1).map((x, i) => (x.t - f[i].t) / 1000));
  assert.deepEqual([...gaps].sort(), [234, 246], 'real spacing, not resampled');
  assert.equal(pickFrames([]).length, 0);
  const dup = pickFrames([{ id: 'a', t: new Date(1000) }, { id: 'b', t: new Date(1000) }, { id: 'c', t: new Date(0) }]);
  assert.equal(dup.length, 2, 'a duplicated time appears once');
});

test('radar frame URL: one GetMap image of one exact listed scan', () => {
  const u = frameUrl('2026-11-24T04:55:50.000Z', [-8616129.4, 4273136.2, -7948212.1, 5071522.7], 900, 700);
  assert.match(u, /^https:\/\/nowcoast\.noaa\.gov\/geoserver\/observations\/weather_radar\/ows\?service=WMS&version=1\.3\.0&request=GetMap&layers=conus_base_reflectivity_mosaic&styles=&format=image\/png&transparent=true&crs=EPSG:3857&bbox=-8616129,4273136,-7948212,5071523&width=900&height=700&time=2026-11-24T04%3A55%3A50\.000Z$/);
});

test('radar playback speed: a full history in ~24 s, never faster than ~5 scans/s; reduced motion slow', () => {
  assert.equal(playStep(120), 200);
  assert.equal(playStep(16), 650);
  assert.equal(playStep(400), 180);
  assert.equal(playStep(120, true), 1400);
});
