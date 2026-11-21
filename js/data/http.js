// fetch with timeout + small TTL cache (memory, then localStorage so a reload or
// a second tab doesn't refetch). A failed request never throws past the caller's
// Promise — callers decide what "unavailable" looks like.

const mem = new Map();
const LS_PREFIX = 'pv:c:';

function readCache(key, ttlMs) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw) {
      const { at, data } = JSON.parse(raw);
      if (Date.now() - at < ttlMs) { mem.set(key, { at, data }); return data; }
    }
  } catch { /* storage unavailable */ }
  return undefined;
}

function writeCache(key, data, persist) {
  const entry = { at: Date.now(), data };
  mem.set(key, entry);
  if (!persist) return;
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry)); } catch { /* quota / private mode */ }
}

/** inflight de-duplication so several spots sharing a station fetch it once */
const inflight = new Map();

export async function getJSON(url, { ttlMs = 10 * 60e3, timeoutMs = 9000, persist = true, transform } = {}) {
  const key = url;
  const cached = readCache(key, ttlMs);
  if (cached !== undefined) return cached;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json, application/geo+json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json && json.error) throw new Error('source error');
      const data = transform ? transform(json) : json;
      writeCache(key, data, persist);
      return data;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
