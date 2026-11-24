// Minimal GRIB2 writer for tests: template 3.0 lat/lon grid, 4.0 product, 5.0 simple packing,
// optional bitmap (NaN = masked). Produces bytes in the layout NOMADS/NWPS files use.
export function grib2Message({ discipline = 10, cat = 0, num = 3, fh = 0, unit = 1, ref = Date.UTC(2026, 10, 24, 6),
  grid, values, D = 2, template5 = 0, scan = 0x40 }) {
  const { ni, nj, lat0, lon0, dlat, dlon } = grid;
  const present = values.map(v => Number.isFinite(v));
  const useBitmap = present.some(p => !p);
  const ints = values.filter(Number.isFinite).map(v => Math.round(v * 10 ** D));
  const R = ints.length ? Math.min(...ints) : 0;
  const xs = ints.map(v => v - R), maxX = Math.max(0, ...xs);
  const nbits = maxX ? Math.ceil(Math.log2(maxX + 1)) : 0;
  const s = [];
  const u8 = n => [n & 255], u16 = n => [(n >> 8) & 255, n & 255], u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const i32 = n => u32(n < 0 ? (n >>> 0) : n);
  const sec = (sn, body) => [...u32(body.length + 5), sn, ...body];
  const d = new Date(ref);
  s.push(sec(1, [...u16(7), ...u16(0), 2, 1, 1, ...u16(d.getUTCFullYear()), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), 0, 1]));
  const la1 = scan & 0x40 ? lat0 : lat0 + (nj - 1) * dlat, la2 = scan & 0x40 ? lat0 + (nj - 1) * dlat : lat0;
  const lo = x => Math.round((x < 0 ? x + 360 : x) * 1e6);
  s.push(sec(3, [0, ...u32(ni * nj), 0, 0, ...u16(0), 6, 0, ...u32(0), 0, ...u32(0), 0, ...u32(0), ...u32(ni), ...u32(nj), ...u32(0), ...u32(0),
    ...i32(Math.round(la1 * 1e6)), ...u32(lo(lon0)), 48, ...i32(Math.round(la2 * 1e6)), ...u32(lo(lon0 + (ni - 1) * dlon)), ...u32(Math.round(dlon * 1e6)), ...u32(Math.round(dlat * 1e6)), scan]));
  s.push(sec(4, [...u16(0), ...u16(0), cat, num, 2, 0, 0, ...u16(0), 0, unit, ...u32(fh), 1, 0, ...u32(0), 255, 0, ...u32(0)]));
  const f32 = new DataView(new ArrayBuffer(4)); f32.setFloat32(0, R);
  const sign16 = v => (v < 0 ? 0x8000 | -v : v);
  s.push(sec(5, [...u32(ints.length), ...u16(template5), ...new Uint8Array(f32.buffer), ...u16(0), ...u16(sign16(D)), nbits, 0]));
  if (useBitmap) {
    const bm = new Array(Math.ceil(values.length / 8)).fill(0);
    present.forEach((p, i) => { if (p) bm[i >> 3] |= 1 << (7 - (i & 7)); });
    s.push(sec(6, [0, ...bm]));
  } else s.push(sec(6, [255]));
  const bits = []; for (const x of xs) for (let q = nbits - 1; q >= 0; q--) bits.push((x >> q) & 1);
  const data = new Array(Math.ceil(bits.length / 8)).fill(0); bits.forEach((b, i) => { if (b) data[i >> 3] |= 1 << (7 - (i & 7)); });
  s.push(sec(7, data));
  const body = s.flat();
  const total = 16 + body.length + 4;
  const head = [0x47, 0x52, 0x49, 0x42, 0, 0, discipline, 2, 0, 0, 0, 0, ...u32(total)];
  return Uint8Array.from([...head, ...body, 0x37, 0x37, 0x37, 0x37]);
}
export const concat = parts => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
