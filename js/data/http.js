// fetch with timeout + small TTL cache (memory, then localStorage so a reload or
// a second tab doesn't refetch). A failed request never throws past the caller's
// Promise — callers decide what "unavailable" looks like.

const mem = new Map();
const LS_PREFIX = 'pv:c:';

// `version` stamps a cached entry with the shape of its data: when a transform changes what it
// keeps (e.g. new forecast fields), bumping the version makes older copies count as a miss, so a
// deploy can never show data that is missing the new fields.
function readCache(key, ttlMs, version) {
  const hit = mem.get(key);
  if (hit && hit.v === version && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw) {
      const { at, data, v = null } = JSON.parse(raw);
      if (v === version && Date.now() - at < ttlMs) { mem.set(key, { at, data, v }); return data; }
    }
  } catch { /* storage unavailable */ }
  return undefined;
}

function writeCache(key, data, persist, version) {
  const entry = { at: Date.now(), data, v: version };
  mem.set(key, entry);
  if (!persist) return;
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry)); } catch { /* quota / private mode */ }
}

/** inflight de-duplication so several spots sharing a station fetch it once */
const inflight = new Map();

export async function getJSON(url, { ttlMs = 10 * 60e3, timeoutMs = 9000, persist = true, transform, version = null } = {}) {
  const key = url;
  const cached = readCache(key, ttlMs, version);
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
      writeCache(key, data, persist, version);
      return data;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
