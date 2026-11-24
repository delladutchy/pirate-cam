// Minimal GRIB2 reader for the small NOAA subsets the ocean map uses (NOMADS GRIB filter output:
// regular lat/lon grid — template 3.0 — and simple packing — template 5.0 — with an optional
// bitmap for land). Anything else is rejected rather than guessed. Pure; no dependencies.
//
// Returns one record per message:
//   { discipline, category, number, refTime (ms), fh (hours), grid: { ni, nj, lat0, lon0, dlat, dlon },
//     values: Float32Array (row-major, south→north rows, west→east columns; NaN = no data) }

export function parseGrib2(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = [];
  let off = 0;
  while (off + 16 <= b.length) {
    if (b[off] !== 0x47 || b[off + 1] !== 0x52 || b[off + 2] !== 0x49 || b[off + 3] !== 0x42) break; // "GRIB"
    if (b[off + 7] !== 2) throw new Error('not GRIB edition 2');
    const discipline = b[off + 6];
    const len = Number(dv.getBigUint64(off + 8));
    if (len < 16 || off + len > b.length) throw new Error('truncated GRIB2 message');
    const end = off + len;
    let p = off + 16;
    const m = { discipline };
    let grid = null, R = 0, E = 0, D = 0, nbits = 0, bitmap = null, data = null, npack = 0;
    while (p + 5 <= end - 4) {
      const sl = dv.getUint32(p), sn = b[p + 4];
      if (sl < 5 || p + sl > end) throw new Error('bad GRIB2 section');
      if (sn === 1) {
        m.refTime = Date.UTC(dv.getUint16(p + 12), b[p + 14] - 1, b[p + 15], b[p + 16], b[p + 17], b[p + 18]);
      } else if (sn === 3) {
        const tpl = dv.getUint16(p + 12);
        if (tpl !== 0) throw new Error(`unsupported grid template 3.${tpl}`);
        const ni = dv.getUint32(p + 30), nj = dv.getUint32(p + 34);
        const la1 = dv.getInt32(p + 46) / 1e6, lo1 = dv.getUint32(p + 50) / 1e6;
        const la2 = dv.getInt32(p + 55) / 1e6, lo2 = dv.getUint32(p + 59) / 1e6;
        const di = dv.getUint32(p + 63) / 1e6, dj = dv.getUint32(p + 67) / 1e6, scan = b[p + 71];
        const wrap = x => (x > 180 ? x - 360 : x);
        // scanning mode: bit 0x80 = west-to-east is NOT the order, 0x40 = south-to-north rows
        if (scan & 0x80) throw new Error('unsupported scan order');
        const southFirst = !!(scan & 0x40);
        grid = { ni, nj, lat0: Math.min(la1, la2), lon0: wrap(lo1), dlat: dj, dlon: di, southFirst };
      } else if (sn === 4) {
        m.category = b[p + 9]; m.number = b[p + 10];
        const unit = b[p + 17], v = dv.getUint32(p + 18);
        m.fh = unit === 1 ? v : unit === 0 ? v / 60 : unit === 2 ? v * 24 : v; // hours
        m.surface = b[p + 22]; m.level = dv.getUint32(p + 24);
      } else if (sn === 5) {
        npack = dv.getUint32(p + 5);
        const tpl = dv.getUint16(p + 9);
        if (tpl !== 0) throw new Error(`unsupported packing template 5.${tpl}`);
        R = dv.getFloat32(p + 11);
        const e = dv.getUint16(p + 15), d = dv.getUint16(p + 17);
        E = e & 0x8000 ? -(e & 0x7fff) : e;
        D = d & 0x8000 ? -(d & 0x7fff) : d;
        nbits = b[p + 19];
      } else if (sn === 6) {
        const ind = b[p + 5];
        if (ind === 0) bitmap = b.subarray(p + 6, p + sl);
        else if (ind !== 255) throw new Error('unsupported bitmap');
      } else if (sn === 7) {
        data = b.subarray(p + 5, p + sl);
      }
      p += sl;
    }
    if (!grid || !data) throw new Error('incomplete GRIB2 message');
    const n = grid.ni * grid.nj;
    const raw = new Float32Array(n).fill(NaN);
    const scale2 = Math.pow(2, E), scale10 = Math.pow(10, -D);
    let bit = 0, k = 0;
    for (let i = 0; i < n; i++) {
      if (bitmap && !((bitmap[i >> 3] >> (7 - (i & 7))) & 1)) continue;
      let x = 0;
      for (let q = 0; q < nbits; q++) { x = (x << 1) | ((data[bit >> 3] >> (7 - (bit & 7))) & 1); bit++; }
      raw[i] = (R + x * scale2) * scale10;
      k++;
    }
    if (npack && k !== npack) throw new Error('GRIB2 point count mismatch');
    // normalise to south→north rows
    let values = raw;
    if (!grid.southFirst) {
      values = new Float32Array(n);
      for (let j = 0; j < grid.nj; j++) values.set(raw.subarray((grid.nj - 1 - j) * grid.ni, (grid.nj - j) * grid.ni), j * grid.ni);
    }
    delete grid.southFirst;
    out.push({ ...m, grid, values });
    off = end;
  }
  if (!out.length) throw new Error('no GRIB2 messages');
  return out;
}

/** Find a message by (discipline, category, number[, surface]). */
export function pick(msgs, discipline, category, number, surface = null) {
  return msgs.find(m => m.discipline === discipline && m.category === category && m.number === number && (surface == null || m.surface === surface)) || null;
}
