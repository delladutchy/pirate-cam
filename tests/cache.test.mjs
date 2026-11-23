// Forecast cache versioning: a copy cached by an older deploy (older data shape) is never read.
import test from 'node:test'; import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
let fetches = 0;
globalThis.fetch = async () => { fetches++; return { ok: true, status: 200, json: async () => ({ fresh: true }) }; };
const { getJSON } = await import('../js/data/http.js');
const { FORECAST_CACHE_VERSION } = await import('../js/data/noaa.js');

test('an unversioned (pre-weather) cached forecast is ignored and refetched', async () => {
  store.set('pv:c:https://x/old', JSON.stringify({ at: Date.now(), data: { windMph: [] } })); // no sky/wx, no version
  const d = await getJSON('https://x/old', { ttlMs: 60e3, version: FORECAST_CACHE_VERSION });
  assert.deepEqual(d, { fresh: true }); assert.equal(fetches, 1);
  assert.equal(JSON.parse(store.get('pv:c:https://x/old')).v, FORECAST_CACHE_VERSION, 'rewritten with the current version');
});

test('a cached forecast with the current version is used without a request', async () => {
  store.set('pv:c:https://x/new', JSON.stringify({ at: Date.now(), data: { cached: 1 }, v: FORECAST_CACHE_VERSION }));
  const before = fetches;
  assert.deepEqual(await getJSON('https://x/new', { ttlMs: 60e3, version: FORECAST_CACHE_VERSION }), { cached: 1 });
  assert.equal(fetches, before);
});

test('unversioned callers keep working as before', async () => {
  store.set('pv:c:https://x/tide', JSON.stringify({ at: Date.now(), data: { tide: 1 } }));
  const before = fetches;
  assert.deepEqual(await getJSON('https://x/tide', { ttlMs: 60e3 }), { tide: 1 });
  assert.equal(fetches, before);
});
