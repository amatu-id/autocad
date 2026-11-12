// Pembaca FlatGeobuf (flatgeobuf.org) minimal tanpa dependensi: header → indeks R-tree Hilbert terkemas → fitur,
// semuanya lewat HTTP Range, jadi dari berkas puluhan GB hanya beberapa ratus KB yang diunduh untuk area kecil.
// Dipakai untuk jejak bangunan terbuka (Google Open Buildings + Microsoft + OSM, gabungan VIDA di source.coop).
const NODE = 40; // minX minY maxX maxY (f64) + offset (u64)
const MAGIC = [0x66, 0x67, 0x62, 0x03];

async function getRange(url, a, b, signal, stat) { // byte a … b-1
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` }, signal });
  if (r.status !== 206) { try { r.body?.cancel(); } catch { } throw new Error(r.status === 200 ? 'server tidak mendukung Range' : 'HTTP ' + r.status); }
  const ab = await r.arrayBuffer(); if (stat) { stat.req++; stat.bytes += ab.byteLength; }
  return ab;
}
// --- FlatBuffers minimal ---
const tab = (dv, pos) => { const vt = pos - dv.getInt32(pos, true), vl = dv.getUint16(vt, true); return { dv, pos, f: i => (4 + 2 * i < vl ? dv.getUint16(vt + 4 + 2 * i, true) : 0) }; };
const ref = (t, i) => { const o = t.f(i); return o ? t.pos + o + t.dv.getUint32(t.pos + o, true) : 0; };
const str = (t, i) => { const p = ref(t, i); return p ? new TextDecoder().decode(new Uint8Array(t.dv.buffer, t.dv.byteOffset + p + 4, t.dv.getUint32(p, true))) : null; };
const u8 = (t, i, d = 0) => { const o = t.f(i); return o ? t.dv.getUint8(t.pos + o) : d; };
const u16 = (t, i, d = 0) => { const o = t.f(i); return o ? t.dv.getUint16(t.pos + o, true) : d; };
const u64 = (t, i, d = 0) => { const o = t.f(i); return o ? Number(t.dv.getBigUint64(t.pos + o, true)) : d; };
const vec = (t, i) => { const p = ref(t, i); return p ? { p: p + 4, n: t.dv.getUint32(p, true) } : { p: 0, n: 0 }; };

function readHeader(dv, at) {
  const t = tab(dv, at + dv.getUint32(at, true)), cols = [], cv = vec(t, 7);
  for (let k = 0; k < cv.n; k++) { const ct = tab(dv, cv.p + 4 * k + dv.getUint32(cv.p + 4 * k, true)); cols.push({ name: str(ct, 0), type: u8(ct, 1) }); }
  return { name: str(t, 0), gtype: u8(t, 2), hasZ: !!u8(t, 3), hasM: !!u8(t, 4), cols, count: u64(t, 8), nodeSize: u16(t, 9, 16) };
}
function levelBounds(n, ns) { // [awal, akhir) indeks node per tingkat, daun dulu (seperti flatgeobuf packedrtree)
  const sizes = [n]; let tot = n; do { n = Math.ceil(n / ns); tot += n; sizes.push(n); } while (n !== 1);
  const out = []; let e = tot; for (const s of sizes) { out.push([e - s, e]); e -= s; } return out;
}
function readProps(dv, p, len, cols) {
  const o = {}, end = p + len;
  while (p < end) {
    const c = cols[dv.getUint16(p, true)]; p += 2; if (!c) break;
    switch (c.type) {
      case 0: o[c.name] = dv.getInt8(p); p += 1; break; case 1: o[c.name] = dv.getUint8(p); p += 1; break; case 2: o[c.name] = !!dv.getUint8(p); p += 1; break;
      case 3: o[c.name] = dv.getInt16(p, true); p += 2; break; case 4: o[c.name] = dv.getUint16(p, true); p += 2; break;
      case 5: o[c.name] = dv.getInt32(p, true); p += 4; break; case 6: o[c.name] = dv.getUint32(p, true); p += 4; break;
      case 7: o[c.name] = Number(dv.getBigInt64(p, true)); p += 8; break; case 8: o[c.name] = Number(dv.getBigUint64(p, true)); p += 8; break;
      case 9: o[c.name] = dv.getFloat32(p, true); p += 4; break; case 10: o[c.name] = dv.getFloat64(p, true); p += 8; break;
      default: { const l = dv.getUint32(p, true); p += 4; if (c.type !== 14) o[c.name] = new TextDecoder().decode(new Uint8Array(dv.buffer, dv.byteOffset + p, l)); p += l; }
    }
  }
  return o;
}
// cincin poligon dari Geometry (xy + ends); MultiPolygon lewat parts
function rings(dv, gt, out) {
  const xy = vec(gt, 1), ends = vec(gt, 0), parts = vec(gt, 7);
  if (parts.n) { for (let k = 0; k < parts.n; k++) rings(dv, tab(dv, parts.p + 4 * k + dv.getUint32(parts.p + 4 * k, true)), out); return out; }
  if (!xy.n) return out;
  const n = xy.n / 2, E = ends.n ? Array.from({ length: ends.n }, (_, k) => dv.getUint32(ends.p + 4 * k, true)) : [n];
  let s = 0;
  for (const e of E) { const r = new Float64Array((e - s) * 2); for (let k = 0; k < r.length; k++) r[k] = dv.getFloat64(xy.p + 8 * (2 * s + k), true); out.push(r); s = e; }
  return out;
}

// Fitur di dalam bbox {minX,minY,maxX,maxY} (derajat lon/lat). onProg(teks) opsional. Hasil: { feats:[{rings,props}], stat }
export async function fgbBBox(url, bb, { signal, onProg, maxFeat = 20000 } = {}) {
  const stat = { req: 0, bytes: 0 };
  let head = await getRange(url, 0, 1 << 18, signal, stat), dv = new DataView(head); // header + puncak indeks sekaligus
  for (let k = 0; k < 4; k++) if (dv.getUint8(k) !== MAGIC[k]) throw new Error('bukan berkas FlatGeobuf');
  const hs = dv.getUint32(8, true);
  if (12 + hs > head.byteLength) { head = await getRange(url, 0, 12 + hs + (1 << 18), signal, stat); dv = new DataView(head); }
  const H = readHeader(dv, 12);
  if (!H.nodeSize || !H.count) throw new Error('berkas tanpa indeks spasial');
  const LB = levelBounds(H.count, H.nodeSize), treeAt = 12 + hs, featAt = treeAt + LB[0][1] * NODE; // daun disimpan paling akhir
  const cache = [{ a: 0, b: head.byteLength, dv }];
  const node = (i) => { const a = treeAt + i * NODE; for (const c of cache) if (a >= c.a && a + NODE <= c.b) return [c.dv, a - c.a]; return null; };
  const covered = (i, j) => cache.some(c => treeAt + i * NODE >= c.a && treeAt + j * NODE <= c.b);
  const hit = (d, o) => !(bb.maxX < d.getFloat64(o, true) || bb.maxY < d.getFloat64(o + 8, true) || bb.minX > d.getFloat64(o + 16, true) || bb.minY > d.getFloat64(o + 24, true));
  const off = (d, o) => Number(d.getBigUint64(o + 32, true));
  // telusuri per tingkat (atas → bawah); rentang node berdekatan digabung jadi satu permintaan
  let todo = [[0, 1]], found = [];
  for (let lv = LB.length - 1; lv >= 0 && todo.length; lv--) {
    const [, lvEnd] = LB[lv], leaf = lv === 0;
    todo.sort((x, y) => x[0] - y[0]);
    const runs = []; for (const [a, b] of todo) { const L = runs[runs.length - 1]; if (L && a - L[1] < 2048) L[1] = Math.max(L[1], b); else runs.push([a, b]); }
    for (const r of runs) { r[1] = Math.min(lvEnd, r[1] + (leaf ? 1 : 0)); } // daun: +1 node untuk panjang fitur terakhir
    const need = runs.filter(([a, b]) => !covered(a, b));
    if (need.length) {
      onProg?.(`indeks tingkat ${LB.length - lv}/${LB.length}`);
      const got = await Promise.all(need.map(([a, b]) => getRange(url, treeAt + a * NODE, treeAt + b * NODE, signal, stat)));
      need.forEach(([a, b], k) => cache.push({ a: treeAt + a * NODE, b: treeAt + b * NODE, dv: new DataView(got[k]) }));
    }
    const next = [];
    for (const [a, b] of todo) {
      const e = Math.min(b, lvEnd);
      for (let i = a; i < e; i++) {
        const [d, o] = node(i); if (!hit(d, o)) continue;
        if (leaf) { const nx = i + 1 < lvEnd ? node(i + 1) : null; found.push({ off: off(d, o), end: nx ? off(nx[0], nx[1]) : null }); }
        else { const c = off(d, o); next.push([c, Math.min(c + H.nodeSize, LB[lv - 1][1])]); }
      }
    }
    todo = next;
    if (found.length > maxFeat) throw new Error('terlalu banyak bangunan di area ini');
  }
  // fitur: offset berurutan (urutan Hilbert) → beberapa rentang besar
  found.sort((x, y) => x.off - y.off);
  const fr = []; for (const f of found) { const end = f.end ?? f.off + 16384, L = fr[fr.length - 1]; if (L && f.off - L.b < 65536) { L.b = Math.max(L.b, end); L.f.push(f); } else fr.push({ a: f.off, b: end, f: [f] }); }
  onProg?.(`${found.length} bangunan`);
  const bufs = await Promise.all(fr.map(r => getRange(url, featAt + r.a, featAt + r.b, signal, stat)));
  const feats = [];
  fr.forEach((r, k) => {
    const d = new DataView(bufs[k]);
    for (const f of r.f) {
      const p = f.off - r.a; if (p + 8 > d.byteLength) continue;
      const len = d.getUint32(p, true); if (p + 4 + len > d.byteLength) continue;
      const ft = tab(d, p + 4 + d.getUint32(p + 4, true)), g = ref(ft, 0); if (!g) continue;
      const pv = vec(ft, 1), rs = rings(d, tab(d, g), []);
      if (rs.length) feats.push({ rings: rs, props: pv.n ? readProps(d, pv.p, pv.n, H.cols) : {} });
    }
  });
  return { feats, stat, header: { count: H.count, cols: H.cols.map(c => c.name), levels: LB.length } };
}
