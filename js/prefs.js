// Small per-browser preferences (no accounts). The first favorite beach opens by default.
const get = k => { try { return localStorage.getItem('pv:' + k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem('pv:' + k) : localStorage.setItem('pv:' + k, v); } catch { /* private mode */ } };

export const prefs = {
  /** Favorite beaches, in the order they were saved (spot ids). Kept in this browser only.
   *  Migrates the earlier single-favorite setting. */
  get favorites() {
    try { const v = JSON.parse(get('favorites') || 'null'); if (Array.isArray(v)) return v.filter(x => typeof x === 'string'); } catch { /* corrupt → start over */ }
    const old = get('favorite');
    return old ? [old] : [];
  },
  set favorites(ids) { set('favorites', JSON.stringify([...new Set(ids)])); set('favorite', null); },
  get favorite() { return this.favorites[0] || null; },
  get camOnly() { return get('camOnly') === '1'; },
  set camOnly(on) { set('camOnly', on ? '1' : null); },
  /** PirateCast view: { mode: 'score'|'waves', range: 'day'|'5d' } */
  get pirateCast() { try { return JSON.parse(get('pirateCast') || '{}') || {}; } catch { return {}; } },
  set pirateCast(o) { set('pirateCast', JSON.stringify(o)); },
  get mapMode() { return get('mapMode'); },
  set mapMode(m) { set('mapMode', m); },
  /** Which map shares the map area: 'ocean' (default) | 'wind' */
  get mapView() { return get('mapView') === 'wind' ? 'wind' : 'ocean'; },
  set mapView(v) { set('mapView', v === 'wind' ? 'wind' : null); },
  // ocean map: one JSON blob { layer, theme, base, baseSet, buoys, motion, legend, timeOpen }
  get ocean() { try { return JSON.parse(get('ocean') || '{}') || {}; } catch { return {}; } },
  set ocean(o) { set('ocean', o ? JSON.stringify(o) : null); },
};
