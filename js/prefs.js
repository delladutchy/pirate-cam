// Small per-browser preferences (no accounts). Favorite spot opens by default.
const get = k => { try { return localStorage.getItem('pv:' + k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem('pv:' + k) : localStorage.setItem('pv:' + k, v); } catch { /* private mode */ } };

export const prefs = {
  get favorite() { return get('favorite'); },
  set favorite(id) { set('favorite', id); },
  get camOnly() { return get('camOnly') === '1'; },
  set camOnly(on) { set('camOnly', on ? '1' : null); },
};
