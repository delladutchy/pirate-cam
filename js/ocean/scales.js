// Pirate View's own colour scales for the ocean map (original palettes — not copied from any
// other product). Each scale has stops [value, '#rrggbb']; colours between stops are
// interpolated, so the field reads as one continuous surface. `legend` lists the labelled steps
// the collapsible legend shows (the last one is "N+": everything above it is that colour).

export const SCALES = {
  waves: {
    title: 'Waves', units: 'ft', decimals: 1,
    // deep navy → blue → cyan → aqua → green → yellow → orange; warm colours only for big surf
    stops: [[0, '#0a1a46'], [1, '#13308a'], [2, '#1d58c4'], [3, '#1b8fd6'], [4, '#22bfd8'], [5, '#3ad9c2'],
      [6, '#62df92'], [8, '#c9df52'], [10, '#f5c443'], [13, '#f08a35'], [17, '#e0503a']],
    legend: [0, 1, 2, 3, 4, 6, 8, 10],
  },
  period: {
    title: 'Period', units: 'sec', decimals: 0,
    // indigo → violet-blue → teal → spring green → gold: long-period groundswell stands out
    stops: [[3, '#1a1645'], [5, '#2b2d86'], [7, '#3f53c2'], [9, '#2f8fd0'], [11, '#2cc0b6'], [13, '#7fd57a'], [15, '#e3d35a'], [18, '#f29a45']],
    legend: [4, 6, 8, 10, 12, 14, 16],
  },
  wind: {
    title: 'Wind', units: 'mph', decimals: 0,
    stops: [[0, '#122a52'], [5, '#1e5a9e'], [10, '#2496c4'], [15, '#30c2a8'], [20, '#8fd463'], [25, '#efcf4a'], [30, '#f0913a'], [40, '#dc4b3a'], [55, '#b23a78']],
    legend: [0, 5, 10, 15, 20, 25, 30, 40],
  },
  sst: {
    title: 'Sea temp', units: '°F', decimals: 0,
    stops: [[32, '#2a1b5c'], [40, '#283f9c'], [46, '#2477c8'], [52, '#22aed0'], [58, '#3ccfa8'], [64, '#8ed76a'], [70, '#e9d34e'], [76, '#f0963c'], [84, '#d9483a']],
    legend: [40, 45, 50, 55, 60, 65, 70, 75, 80],
  },
  // nowCOAST's own colour map for this layer (its WMS GetLegendGraphic) — the radar image itself
  // is NOAA's; this only labels it. Below 6 dBZ nowCOAST draws faint grey at 40 % opacity.
  radar: {
    title: 'Radar', units: 'dBZ', decimals: 0, discrete: true,
    stops: [[5, '#777777'], [10, '#00ecec'], [15, '#01a0f6'], [20, '#0000f6'], [25, '#00ff00'], [30, '#00c800'], [35, '#009000'],
      [40, '#ffff00'], [45, '#e7c000'], [50, '#ff9000'], [55, '#ff0000'], [60, '#dc0000'], [65, '#c00000'], [70, '#ff00ff'], [75, '#9955c9']],
    legend: [5, 15, 25, 35, 45, 55, 65],
  },
};

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** RGB for a value on a scale (clamped to the ends). */
export function colorAt(scale, v) {
  const s = scale.stops;
  if (!(v > s[0][0])) return hex(s[0][1]);
  if (v >= s[s.length - 1][0]) return hex(s[s.length - 1][1]);
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      if (scale.discrete) return hex(s[i - 1][1]);
      const [a, ca] = s[i - 1], [b, cb] = s[i];
      const k = (v - a) / (b - a), A = hex(ca), B = hex(cb);
      return [0, 1, 2].map(j => Math.round(A[j] + (B[j] - A[j]) * k));
    }
  }
  return hex(s[s.length - 1][1]);
}

/** 256-entry RGB lookup over [lo, hi] for fast per-pixel colouring. */
export function lut(scale) {
  const lo = scale.stops[0][0], hi = scale.stops[scale.stops.length - 1][0];
  const t = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) { const c = colorAt(scale, lo + (hi - lo) * i / 255); t[i * 3] = c[0]; t[i * 3 + 1] = c[1]; t[i * 3 + 2] = c[2]; }
  return { t, lo, hi, k: 255 / (hi - lo) };
}

export const cssColor = (scale, v) => `rgb(${colorAt(scale, v).join(',')})`;
