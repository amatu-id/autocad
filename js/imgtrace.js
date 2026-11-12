// Auto Trace — gambar raster (sketsa / foto / siluet) → garis CAD halus.
// Jalur:
//   garis  : warna kertas lokal → tinta (ΔE) → ambang Otsu → bersihkan → penipisan Zhang–Suen → graf kerangka (centerline)
//   foto   : filter domain-transform penjaga tepi (tekstur hilang, tepi tetap) → Canny warna Di Zenzo + histeresis → graf tepi
//   siluet : tinta → kontur iso sub-piksel (marching squares berinterpolasi)
// lalu pangkas cabang pendek, sambung lurus di persimpangan, jembatani celah, sambung ujung ke garis (T),
// deteksi sudut → penghalusan Gauss per ruas → fit garis + busur bersambung singgung (biarc G1)
// → lingkaran / elips / garis / busur / polyline (bulge) / spline.
// Modul murni tanpa DOM: dipakai di Web Worker (imgtrace-worker.js) dan di Node untuk pengujian.
// Koordinat hasil: piksel gambar kerja, sumbu Y ke ATAS (asal kiri-bawah), siap diskalakan ke satuan gambar.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const median = a => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const pct = (a, q) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// ---------- warna: sRGB → CIELab (D65), alfa dikomposit di atas putih ----------
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const lin = v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fl = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 0.137931;
export function toLab(rgba, W, H) {
  const N = W * H, L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  let tr = 0;
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const a = rgba[j + 3];
    let r, g, b;
    if (a === 255) { r = LIN[rgba[j]]; g = LIN[rgba[j + 1]]; b = LIN[rgba[j + 2]]; }
    else { if (a < 128) tr++; const k = a / 255, w = 255 * (1 - k); r = lin(rgba[j] * k + w); g = lin(rgba[j + 1] * k + w); b = lin(rgba[j + 2] * k + w); }
    const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
    const fx = fl(X), fy = fl(Y), fz = fl(Z);
    L[i] = 116 * fy - 16; A[i] = 500 * (fx - fy); B[i] = 200 * (fy - fz);
  }
  return { L, A, B, transparent: tr / N };
}

// ---------- filter ----------
function boxBlur(src, W, H, r, out = new Float32Array(W * H)) {
  const tmp = new Float32Array(W * H), inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    const o = y * W; let acc = 0;
    for (let i = -r - 1; i < r; i++) acc += src[o + clamp(i, 0, W - 1)];
    for (let x = 0; x < W; x++) { acc += src[o + Math.min(W - 1, x + r)] - src[o + Math.max(0, x - r - 1)]; tmp[o + x] = acc * inv; }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let i = -r - 1; i < r; i++) acc += tmp[clamp(i, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) { acc += tmp[Math.min(H - 1, y + r) * W + x] - tmp[Math.max(0, y - r - 1) * W + x]; out[y * W + x] = acc * inv; }
  }
  return out;
}
export function gauss(src, W, H, s) {
  const out = new Float32Array(W * H);
  if (s < 0.3) { out.set(src); return out; }
  if (s > 3.5) { const r = Math.max(1, Math.round((Math.sqrt(4 * s * s + 1) - 1) / 2)); return boxBlur(boxBlur(boxBlur(src, W, H, r), W, H, r), W, H, r, out); }
  const R = Math.ceil(s * 3), k = new Float32Array(2 * R + 1); let sum = 0;
  for (let i = -R; i <= R; i++) sum += k[i + R] = Math.exp(-i * i / (2 * s * s));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) { let acc = 0; for (let i = -R; i <= R; i++) { const xx = x + i; acc += src[o + (xx < 0 ? 0 : xx >= W ? W - 1 : xx)] * k[i + R]; } tmp[o + x] = acc; } }
  for (let y = 0; y < H; y++) for (let i = -R; i <= R; i++) { const yy = clamp(y + i, 0, H - 1) * W, kk = k[i + R], o = y * W; if (i === -R) for (let x = 0; x < W; x++) out[o + x] = tmp[yy + x] * kk; else for (let x = 0; x < W; x++) out[o + x] += tmp[yy + x] * kk; }
  return out;
}
// Filter domain transform rekursif (Gastal & Oliveira 2011): menghaluskan tekstur, menjaga tepi kuat. sR dalam satuan Lab.
export function dtFilter(chs, W, H, sS, sR, iters = 3) {
  const N = W * H, ratio = sS / sR, [L0, A0, B0] = chs;
  const L = Float32Array.from(L0), A = Float32Array.from(A0), B = Float32Array.from(B0);
  const VH = new Float32Array(N), VV = new Float32Array(N);
  // σH iterasi ke-i: σs·√3·2^(N−i−1)/√(4^N−1) → eksponen berlipat dua tiap iterasi → V berikutnya = V²
  const sH0 = sS * Math.sqrt(3) * 2 ** (iters - 1) / Math.sqrt(4 ** iters - 1), la = -Math.SQRT2 / sH0;
  for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) { const i = y * W + x; VH[i] = Math.exp(la * (1 + ratio * (Math.abs(L[i] - L[i - 1]) + Math.abs(A[i] - A[i - 1]) + Math.abs(B[i] - B[i - 1])))); }
  for (let i = W; i < N; i++) VV[i] = Math.exp(la * (1 + ratio * (Math.abs(L[i] - L[i - W]) + Math.abs(A[i] - A[i - W]) + Math.abs(B[i] - B[i - W]))));
  for (let it = 0; it < iters; it++) {
    if (it) for (let i = 0; i < N; i++) { VH[i] *= VH[i]; VV[i] *= VV[i]; }
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 1; x < W; x++) { const i = o + x, v = VH[i]; L[i] += v * (L[i - 1] - L[i]); A[i] += v * (A[i - 1] - A[i]); B[i] += v * (B[i - 1] - B[i]); }
      for (let x = W - 2; x >= 0; x--) { const i = o + x, v = VH[i + 1]; L[i] += v * (L[i + 1] - L[i]); A[i] += v * (A[i + 1] - A[i]); B[i] += v * (B[i + 1] - B[i]); }
    }
    for (let i = W; i < N; i++) { const v = VV[i]; L[i] += v * (L[i - W] - L[i]); A[i] += v * (A[i - W] - A[i]); B[i] += v * (B[i - W] - B[i]); }
    for (let i = N - W - 1; i >= 0; i--) { const v = VV[i + W]; L[i] += v * (L[i + W] - L[i]); A[i] += v * (A[i + W] - A[i]); B[i] += v * (B[i + W] - B[i]); }
  }
  return [L, A, B];
}

// ---------- ambang & morfologi biner ----------
function otsu(v, lo, hi, bins = 256) {
  const h = new Float64Array(bins), sc = (bins - 1) / (hi - lo || 1); let n = 0;
  for (let i = 0; i < v.length; i++) { h[clamp(Math.round((v[i] - lo) * sc), 0, bins - 1)]++; n++; }
  let sum = 0; for (let i = 0; i < bins; i++) sum += i * h[i];
  const mu = sum / n; let vt = 0; for (let i = 0; i < bins; i++) vt += h[i] * (i - mu) ** 2; vt /= n;
  let wB = 0, sB = 0, best = -1, bt = 0;
  for (let t = 0; t < bins - 1; t++) {
    wB += h[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * h[t]; const d = sB / wB - (sum - sB) / wF, b = wB * wF * d * d / (n * n);
    if (b > best) { best = b; bt = t; }
  }
  return { t: lo + (bt + 0.5) / sc, eta: vt > 0 ? best / vt : 0 };
}
const zeroBorder = (m, W, H) => { m.fill(0, 0, W); m.fill(0, (H - 1) * W); for (let y = 0; y < H; y++) { m[y * W] = 0; m[y * W + W - 1] = 0; } };
// hapus komponen (8-tetangga) kecil; kembalikan jumlah komponen tersisa
function removeSmall(m, W, H, minA) {
  const N = W * H, lab = new Int32Array(N), st = new Int32Array(N), OFF = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  let id = 0, kept = 0;
  for (let i = 0; i < N; i++) {
    if (!m[i] || lab[i]) continue;
    id++; let sp = 0, n = 0; st[sp++] = i; lab[i] = id;
    const list = [];
    while (sp) { const p = st[--sp]; if (n < minA) list.push(p); n++; for (const o of OFF) { const q = p + o; if (q >= 0 && q < N && m[q] && !lab[q]) { lab[q] = id; st[sp++] = q; } } }
    if (n < minA) for (const p of list) m[p] = 0; else kept++;
  }
  return kept;
}
// isi lubang latar (4-tetangga) kecil yang tidak menyentuh tepi
function fillHoles(m, W, H, maxA) {
  const N = W * H, seen = new Uint8Array(N), st = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (m[i] || seen[i]) continue;
    let sp = 0; st[sp++] = i; seen[i] = 1; const list = []; let border = false;
    while (sp) {
      const p = st[--sp]; if (list.length <= maxA) list.push(p); const x = p % W, y = (p / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (x > 0 && !m[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; st[sp++] = p - 1; }
      if (x < W - 1 && !m[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; st[sp++] = p + 1; }
      if (y > 0 && !m[p - W] && !seen[p - W]) { seen[p - W] = 1; st[sp++] = p - W; }
      if (y < H - 1 && !m[p + W] && !seen[p + W]) { seen[p + W] = 1; st[sp++] = p + W; }
    }
    if (!border && list.length <= maxA) for (const p of list) m[p] = 1;
  }
}
// jarak chamfer 3-4 ke latar (piksel)
function chamfer(m, W, H) {
  const N = W * H, d = new Float32Array(N), INF = 1e9;
  for (let i = 0; i < N; i++) d[i] = m[i] ? INF : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!d[i]) continue; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) { v = Math.min(v, d[i - W] + 3); if (x > 0) v = Math.min(v, d[i - W - 1] + 4); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4); }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (!d[i]) continue; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < H - 1) { v = Math.min(v, d[i + W] + 3); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4); if (x > 0) v = Math.min(v, d[i + W - 1] + 4); }
    d[i] = v;
  }
  for (let i = 0; i < N; i++) d[i] /= 3;
  return d;
}

// ---------- penipisan (Zhang–Suen) + pembersihan tangga → kerangka 1 piksel, 8-terhubung ----------
// kode tetangga: bit0 N, bit1 NE, bit2 E, bit3 SE, bit4 S, bit5 SW, bit6 W, bit7 NW
const ZS = [new Uint8Array(256), new Uint8Array(256)], SIMPLE = new Uint8Array(256);
(() => {
  for (let c = 0; c < 256; c++) {
    const P = k => (c >> k) & 1, p2 = P(0), p4 = P(2), p6 = P(4), p8 = P(6);
    let B = 0, A = 0; for (let k = 0; k < 8; k++) { B += P(k); if (!P(k) && P((k + 1) & 7)) A++; }
    const ok = B >= 2 && B <= 6 && A === 1;
    ZS[0][c] = ok && !(p2 && p4 && p6) && !(p4 && p6 && p8) ? 1 : 0;
    ZS[1][c] = ok && !(p2 && p4 && p8) && !(p2 && p6 && p8) ? 1 : 0;
    // titik sederhana untuk kerangka: ≥ 3 tetangga, 1 komponen depan (8), 1 komponen latar yang 4-bertetangga dengan p
    if (B >= 3) {
      const par = [0, 1, 2, 3, 4, 5, 6, 7], f = x => par[x] === x ? x : (par[x] = f(par[x])), u = (a, b) => { par[f(a)] = f(b); };
      for (let k = 0; k < 8; k++) { if (P(k) && P((k + 1) & 7)) u(k, (k + 1) & 7); if (!(k & 1) && P(k) && P((k + 2) & 7)) u(k, (k + 2) & 7); }
      const roots = new Set(); for (let k = 0; k < 8; k++) if (P(k)) roots.add(f(k));
      // latar: run nol berurutan yang memuat posisi genap (N/E/S/W)
      let runs = 0;
      for (let k = 0; k < 8; k++) {
        if (P(k) || !P((k + 7) & 7)) continue; // awal run nol
        let has = false; for (let j = k; !P(j & 7) && j < k + 8; j++) if (!(j & 1)) has = true;
        if (has) runs++;
      }
      if (c === 0) runs = 1;
      SIMPLE[c] = roots.size === 1 && runs === 1 ? 1 : 0;
    }
  }
})();
const nbCode = (m, i, W) => m[i - W] | (m[i - W + 1] << 1) | (m[i + 1] << 2) | (m[i + W + 1] << 3) | (m[i + W] << 4) | (m[i + W - 1] << 5) | (m[i - 1] << 6) | (m[i - W - 1] << 7);
export function thin(m, W, H) {
  zeroBorder(m, W, H);
  let list = []; for (let i = 0; i < m.length; i++) if (m[i]) list.push(i);
  const del = [];
  for (let guard = 0; guard < 500; guard++) {
    let ch = 0;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0; const T = ZS[pass];
      for (const i of list) if (m[i] && T[nbCode(m, i, W)]) del.push(i);
      for (const i of del) m[i] = 0;
      ch += del.length;
    }
    if (!ch) break;
    list = list.filter(i => m[i]);
  }
  // tangga 4-terhubung & sisa blok 2×2 → buang piksel sederhana berurutan (raster)
  for (let pass = 0; pass < 2; pass++) for (const i of list) if (m[i] && SIMPLE[nbCode(m, i, W)]) m[i] = 0;
  return m;
}

// ---------- graf kerangka ----------
// nodes: {x,y,e:[edgeId]} (titik ujung / klaster persimpangan); edges: {a,b,p:[x,y,…] (pusat piksel, y ke bawah), alive, loop}
export function skelGraph(m, W, H) {
  const N = W * H, OFF = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1];
  const deg = new Uint8Array(N), fg = [];
  for (let i = W; i < N - W; i++) if (m[i]) { let d = 0; for (const o of OFF) d += m[i + o]; deg[i] = d; fg.push(i); }
  const nodeOf = new Int32Array(N).fill(-1), nodes = [];
  for (const i of fg) {
    if (nodeOf[i] >= 0 || deg[i] === 2 || deg[i] === 0) continue;
    const id = nodes.length, pix = [i]; nodeOf[i] = id;
    if (deg[i] >= 3) for (let k = 0; k < pix.length; k++) for (const o of OFF) { const q = pix[k] + o; if (m[q] && deg[q] >= 3 && nodeOf[q] < 0) { nodeOf[q] = id; pix.push(q); } }
    let sx = 0, sy = 0; for (const p of pix) { sx += p % W; sy += (p / W) | 0; }
    nodes.push({ x: sx / pix.length + 0.5, y: sy / pix.length + 0.5, pix, e: [], deg0: deg[i] >= 3 ? 3 : 1 });
  }
  const edges = [], vis = new Uint8Array(N);
  const px = i => [(i % W) + 0.5, ((i / W) | 0) + 0.5];
  const add = (a, b, list, loop = false) => {
    if (a >= 0 && a === b && list.length < 6) return; // simpul → dirinya sendiri lewat 1–3 piksel: sisa klaster
    const p = []; for (const i of list) { const [x, y] = px(i); p.push(x, y); }
    if (a >= 0) { p[0] = nodes[a].x; p[1] = nodes[a].y; }
    if (b >= 0) { p[p.length - 2] = nodes[b].x; p[p.length - 1] = nodes[b].y; }
    const id = edges.length; edges.push({ a, b, p, alive: true, loop, px: list });
    if (a >= 0) nodes[a].e.push(id); if (b >= 0) nodes[b].e.push(id);
  };
  for (let a = 0; a < nodes.length; a++) for (const s of nodes[a].pix) for (const o of OFF) {
    const q = s + o; if (!m[q]) continue;
    const nq = nodeOf[q];
    if (nq === a) continue;
    if (nq >= 0) { if (a < nq) add(a, nq, [s, q]); continue; }
    if (vis[q]) continue;
    const list = [s, q]; vis[q] = 1; let prev = s, cur = q, end = -1;
    for (let guard = 0; guard < N; guard++) {
      let nx = -1;
      for (const o2 of OFF) { const r = cur + o2; if (r === prev || !m[r]) continue; if (nodeOf[r] >= 0) { if (!(nodeOf[r] === a && r === s && list.length < 3)) { nx = r; break; } } else if (!vis[r]) nx = r; }
      if (nx < 0) break;
      list.push(nx);
      if (nodeOf[nx] >= 0) { end = nodeOf[nx]; break; }
      vis[nx] = 1; prev = cur; cur = nx;
    }
    if (end >= 0) add(a, end, list); else if (list.length > 2) add(a, -1, list);
  }
  // lingkaran murni (tanpa simpul)
  for (const i of fg) {
    if (deg[i] !== 2 || vis[i] || nodeOf[i] >= 0) continue;
    const list = [i]; vis[i] = 1; let prev = -1, cur = i;
    for (let guard = 0; guard < N; guard++) {
      let nx = -1;
      for (const o of OFF) { const r = cur + o; if (r !== prev && m[r] && !vis[r] && nodeOf[r] < 0) { nx = r; break; } }
      if (nx < 0) break;
      vis[nx] = 1; list.push(nx); prev = cur; cur = nx;
    }
    if (list.length >= 6) add(-1, -1, list, true);
  }
  return { nodes, edges };
}
const plen = p => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };
const aliveDeg = (G, n) => { let d = 0; for (const id of G.nodes[n].e) { const e = G.edges[id]; if (!e.alive) continue; d += e.a === n && e.b === n ? 2 : 1; } return d; };
const revP = p => { const o = new Array(p.length); for (let i = 0, n = p.length / 2; i < n; i++) { o[2 * i] = p[2 * (n - 1 - i)]; o[2 * i + 1] = p[2 * (n - 1 - i) + 1]; } return o; };
// arah tepi meninggalkan simpul n, diukur pada jarak d sepanjang tepi
function dirFrom(G, eid, n, d) {
  const e = G.edges[eid], p = e.a === n ? e.p : revP(e.p), x0 = p[0], y0 = p[1];
  let s = 0, k = 2;
  for (; k < p.length; k += 2) { s += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]); if (s >= d) break; }
  k = Math.min(k, p.length - 2);
  const dx = p[k] - x0, dy = p[k + 1] - y0, l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
// gabungkan dua tepi di simpul n menjadi satu (melewati n)
function joinAt(G, e1, e2, n, via = false) {
  const A = G.edges[e1], B = G.edges[e2];
  const pa = A.b === n ? A.p : revP(A.p), pb = B.a === n ? B.p : revP(B.p);
  const a = A.b === n ? A.a : A.b, b = B.a === n ? B.b : B.a;
  const p = pa.concat(pb.slice(2));
  A.alive = false; B.alive = false;
  const id = G.edges.length, V = [...(A.via || []), ...(B.via || [])];
  if (via) V.push([G.nodes[n].x, G.nodes[n].y]);
  G.edges.push({ a, b, p, alive: true, loop: false, via: V });
  if (a >= 0) G.nodes[a].e.push(id); if (b >= 0 && b !== a) G.nodes[b].e.push(id); else if (b === a && a >= 0) G.nodes[a].e.push(id);
  return id;
}
function mergeDeg2(G) {
  for (let n = 0; n < G.nodes.length; n++) {
    const N = G.nodes[n]; if (N.gone) continue;
    const ids = N.e.filter(id => G.edges[id].alive);
    if (ids.length === 1 && G.edges[ids[0]].a === n && G.edges[ids[0]].b === n) { const e = G.edges[ids[0]]; e.a = e.b = -1; e.loop = true; N.gone = true; continue; } // loop sendiri → tertutup
    if (ids.length !== 2 || ids[0] === ids[1]) continue;
    let via = false;
    if (N.deg0 >= 3) { const d1 = dirFrom(G, ids[0], n, 8), d2 = dirFrom(G, ids[1], n, 8); via = d1[0] * d2[0] + d1[1] * d2[1] < -0.79; }
    joinAt(G, ids[0], ids[1], n, via); N.gone = true;
  }
}
function prune(G, spur) {
  for (let it = 0; it < 4; it++) {
    let ch = 0;
    for (const e of G.edges) {
      if (!e.alive || e.loop || e.a < 0 || e.b < 0) continue;
      const da = aliveDeg(G, e.a), db = aliveDeg(G, e.b);
      if (((da === 1 && db >= 3) || (db === 1 && da >= 3)) && plen(e.p) < spur) { e.alive = false; ch++; }
    }
    mergeDeg2(G);
    if (!ch) break;
  }
  // sisa tepi pendek terpencil (dua ujung bebas)
  for (const e of G.edges) if (e.alive && !e.loop && e.a >= 0 && e.b >= 0 && aliveDeg(G, e.a) === 1 && aliveDeg(G, e.b) === 1 && plen(e.p) < spur * 0.6) e.alive = false;
}
// di persimpangan: sambungkan pasangan tepi yang paling lurus (bar huruf T, silang X) → goresan panjang yang utuh
function pairJunctions(G, d, maxDev = 38) {
  const lim = -Math.cos(maxDev * Math.PI / 180);
  for (let n = 0; n < G.nodes.length; n++) {
    const N = G.nodes[n]; if (N.gone) continue;
    for (let guard = 0; guard < 3; guard++) {
      const ids = [...new Set(N.e.filter(id => G.edges[id].alive && !(G.edges[id].a === n && G.edges[id].b === n)))];
      if (ids.length < 3) break;
      const dirs = ids.map(id => dirFrom(G, id, n, d));
      let bi = -1, bj = -1, bd = lim;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const c = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]; if (c < bd) { bd = c; bi = i; bj = j; } }
      if (bi < 0) break;
      const nid = joinAt(G, ids[bi], ids[bj], n, true);
      (N.thru ||= []).push(nid);
    }
  }
  mergeDeg2(G);
}
// semua tepi hidup → jalur {p (y ke bawah), closed, free:[ujung awal bebas?, ujung akhir bebas?]}
function graphPaths(G) {
  const out = [];
  for (const e of G.edges) {
    if (!e.alive) continue;
    let closed = !!e.loop;
    if (!closed && e.a >= 0 && e.a === e.b) closed = true;
    const free = n => n < 0 || (aliveDeg(G, n) === 1 && !G.nodes[n].thru?.length);
    const fa = free(e.a), fb = free(e.b);
    const isT = n => n >= 0 && !!G.nodes[n].thru?.length;
    out.push({ p: e.p, closed, free: [closed ? false : fa, closed ? false : fb], via: e.via || [], tEnd: closed ? [false, false] : [isT(e.a), isT(e.b)] });
  }
  return out;
}

// ---------- Canny warna (tensor struktur Di Zenzo) ----------
function gradient(C, W, H, wa = 0.75) {
  const N = W * H, M = new Float32Array(N), DX = new Float32Array(N), DY = new Float32Array(N), [L, A, B] = C, w2 = wa * wa;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, a = i - W, b = i + W;
    const lx = (L[a + 1] + 2 * L[i + 1] + L[b + 1] - L[a - 1] - 2 * L[i - 1] - L[b - 1]) * 0.125, ly = (L[b - 1] + 2 * L[b] + L[b + 1] - L[a - 1] - 2 * L[a] - L[a + 1]) * 0.125;
    const ax = (A[a + 1] + 2 * A[i + 1] + A[b + 1] - A[a - 1] - 2 * A[i - 1] - A[b - 1]) * 0.125, ay = (A[b - 1] + 2 * A[b] + A[b + 1] - A[a - 1] - 2 * A[a] - A[a + 1]) * 0.125;
    const bx = (B[a + 1] + 2 * B[i + 1] + B[b + 1] - B[a - 1] - 2 * B[i - 1] - B[b - 1]) * 0.125, by = (B[b - 1] + 2 * B[b] + B[b + 1] - B[a - 1] - 2 * B[a] - B[a + 1]) * 0.125;
    const xx = lx * lx + w2 * (ax * ax + bx * bx), yy = ly * ly + w2 * (ay * ay + by * by), xy = lx * ly + w2 * (ax * ay + bx * by);
    const df = xx - yy, lam = 0.5 * (xx + yy + Math.sqrt(df * df + 4 * xy * xy));
    M[i] = Math.sqrt(lam);
    let vx = xy, vy = lam - xx; const ux = lam - yy, uy = xy;
    if (ux * ux + uy * uy > vx * vx + vy * vy) { vx = ux; vy = uy; }
    const l = Math.sqrt(vx * vx + vy * vy);
    if (l > 1e-12) { DX[i] = vx / l; DY[i] = vy / l; } else { DX[i] = 1; DY[i] = 0; }
  }
  return { M, DX, DY };
}
function nmsHyst(G, W, H, lo, hi) {
  const { M, DX, DY } = G, N = W * H;
  const bil = (x, y) => { const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0; return (M[i] * (1 - fx) + M[i + 1] * fx) * (1 - fy) + (M[i + W] * (1 - fx) + M[i + W + 1] * fx) * fy; };
  const E = new Uint8Array(N);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = y * W + x, m = M[i]; if (m < lo) continue;
    const dx = DX[i], dy = DY[i], m1 = bil(x + dx, y + dy), m2 = bil(x - dx, y - dy);
    if (m > m1 && m >= m2) E[i] = m >= hi ? 2 : 1;
  }
  const out = new Uint8Array(N), st = new Int32Array(N), OFF = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]; let sp = 0;
  for (let i = 0; i < N; i++) if (E[i] === 2) { out[i] = 1; st[sp++] = i; }
  while (sp) { const i = st[--sp]; for (const o of OFF) { const j = i + o; if (E[j] && !out[j]) { out[j] = 1; st[sp++] = j; } } }
  return out;
}

// ---------- kontur iso sub-piksel (marching squares berinterpolasi) ----------
export function isoContours(F, W, H, t) {
  const PW = W + 2, PH = H + 2, G = new Float32Array(PW * PH).fill(t - 1e3);
  for (let y = 0; y < H; y++) G.set(F.subarray(y * W, y * W + W), (y + 1) * PW + 1);
  const segs = [], at = new Map();
  const hE = (x, y) => 2 * (y * PW + x), vE = (x, y) => 2 * (y * PW + x) + 1;
  const link = (e1, e2) => { const s = segs.length / 2; segs.push(e1, e2); for (const e of [e1, e2]) { const l = at.get(e); if (l) l.push(s); else at.set(e, [s]); } };
  for (let y = 0; y < PH - 1; y++) for (let x = 0; x < PW - 1; x++) {
    const i = y * PW + x, tl = G[i] > t, tr = G[i + 1] > t, br = G[i + PW + 1] > t, bl = G[i + PW] > t;
    const c = (tl << 3) | (tr << 2) | (br << 1) | bl; if (c === 0 || c === 15) continue;
    const T = hE(x, y), R = vE(x + 1, y), B = hE(x, y + 1), L = vE(x, y);
    const mid = (G[i] + G[i + 1] + G[i + PW + 1] + G[i + PW]) / 4 > t;
    switch (c) {
      case 1: case 14: link(L, B); break;
      case 2: case 13: link(B, R); break;
      case 3: case 12: link(L, R); break;
      case 4: case 11: link(T, R); break;
      case 6: case 9: link(T, B); break;
      case 7: case 8: link(T, L); break;
      case 5: if (mid) { link(T, L); link(B, R); } else { link(T, R); link(L, B); } break;
      case 10: if (mid) { link(T, R); link(L, B); } else { link(T, L); link(B, R); } break;
    }
  }
  const pt = e => { const k = e >> 1, x = k % PW, y = (k / PW) | 0; if (e & 1) { const a = G[k], b = G[k + PW], u = clamp((t - a) / (b - a), 0, 1); return [x - 0.5, y + u - 0.5]; } const a = G[k], b = G[k + 1], u = clamp((t - a) / (b - a), 0, 1); return [x + u - 0.5, y - 0.5]; };
  const used = new Uint8Array(segs.length / 2), out = [];
  for (let s0 = 0; s0 < used.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1; const e0 = segs[2 * s0]; let cur = segs[2 * s0 + 1];
    const p = [...pt(e0), ...pt(cur)];
    for (let guard = 0; guard < segs.length; guard++) {
      if (cur === e0) break;
      const l = at.get(cur); let nx = -1;
      for (const s of l) if (!used[s]) { nx = s; break; }
      if (nx < 0) break;
      used[nx] = 1; cur = segs[2 * nx] === cur ? segs[2 * nx + 1] : segs[2 * nx];
      if (cur !== e0) p.push(...pt(cur));
    }
    if (p.length >= 8) out.push(p);
  }
  return out;
}
const shoelace = p => { let s = 0; const n = p.length; for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; s += p[i] * p[j + 1] - p[j] * p[i + 1]; } return s / 2; };

// ---------- analisis: jenis gambar ----------
function quadSurface(g, gw, gh) {
  const n = gw * gh; if (n < 9) return null;
  const w = new Float64Array(n).fill(1); let c = null;
  for (let it = 0; it < 5; it++) {
    const A = Array.from({ length: 6 }, () => new Float64Array(6)), r = new Float64Array(6);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = y * gw + x; if (!w[i]) continue;
      const u = x / Math.max(1, gw - 1) - 0.5, v = y / Math.max(1, gh - 1) - 0.5, f = [1, u, v, u * u, u * v, v * v];
      for (let a = 0; a < 6; a++) { r[a] += f[a] * g[i]; for (let b = 0; b < 6; b++) A[a][b] += f[a] * f[b]; }
    }
    // eliminasi Gauss
    const M = A.map((row, i) => [...row, r[i]]);
    let ok = true;
    for (let col = 0; col < 6; col++) {
      let piv = col; for (let k = col + 1; k < 6; k++) if (Math.abs(M[k][col]) > Math.abs(M[piv][col])) piv = k;
      if (Math.abs(M[piv][col]) < 1e-9) { ok = false; break; }
      [M[col], M[piv]] = [M[piv], M[col]];
      for (let k = 0; k < 6; k++) if (k !== col) { const f = M[k][col] / M[col][col]; for (let j = col; j < 7; j++) M[k][j] -= f * M[col][j]; }
    }
    if (!ok) break;
    c = M.map((row, i) => row[6] / row[i]);
    let kept = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x, u = x / Math.max(1, gw - 1) - 0.5, v = y / Math.max(1, gh - 1) - 0.5, z = c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * u * v + c[5] * v * v; w[i] = g[i] > z - 6 ? 1 : 0; kept += w[i]; }
    if (kept < 6) break;
  }
  if (!c) return null;
  const out = new Float32Array(n);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const u = x / Math.max(1, gw - 1) - 0.5, v = y / Math.max(1, gh - 1) - 0.5; out[y * gw + x] = c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * u * v + c[5] * v * v; }
  return out;
}
function paperBg(L, W, H, floor) {
  const b = clamp(Math.round(Math.hypot(W, H) / 40), 10, 64), gw = Math.ceil(W / b), gh = Math.ceil(H / b);
  let g = new Float32Array(gw * gh); const hist = new Uint32Array(102);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    hist.fill(0); let n = 0;
    for (let y = gy * b; y < Math.min(H, (gy + 1) * b); y++) for (let x = gx * b; x < Math.min(W, (gx + 1) * b); x++) { hist[clamp(Math.round(L[y * W + x]), 0, 101)]++; n++; }
    let c = 0, k = 101; const lim = n * 0.1; for (; k > 0; k--) { c += hist[k]; if (c >= lim) break; }
    g[gy * gw + gx] = k;
  }
  for (let pass = 0; pass < 2; pass++) { const o = new Float32Array(g.length); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let v = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) v = Math.max(v, g[yy * gw + xx]); } o[y * gw + x] = v; } g = o; }
  // permukaan kertas halus (kuadrat 2D, robust): blok yang jauh lebih gelap (tertutup tinta / bidang hitam) diabaikan,
  // lalu blok tak boleh lebih gelap dari permukaan − 5 → vinyet / bayangan foto kertas ikut, bidang tinta besar tidak
  const S = quadSurface(g, gw, gh);
  for (let i = 0; i < g.length; i++) g[i] = Math.max(g[i], S ? S[i] - 5 : floor, 15);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = clamp((y + 0.5) / b - 0.5, 0, gh - 1), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = clamp((x + 0.5) / b - 0.5, 0, gw - 1), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      out[y * W + x] = (g[y0 * gw + x0] * (1 - tx) + g[y0 * gw + x1] * tx) * (1 - ty) + (g[y1 * gw + x0] * (1 - tx) + g[y1 * gw + x1] * tx) * ty;
    }
  }
  return out;
}
export function analyze(lab, W, H) {
  const { L, A, B } = lab, N = W * H, diag = Math.hypot(W, H);
  // warna latar dari cincin tepi gambar
  const bw = Math.max(2, Math.round(Math.min(W, H) * 0.012)), sL = [], sA = [], sB = [], bI = [];
  const step = Math.max(1, Math.round(2 * (W + H) * bw / 24000));
  let k = 0;
  const take = i => { if (k++ % step === 0) { sL.push(L[i]); sA.push(A[i]); sB.push(B[i]); bI.push(i); } };
  for (let y = 0; y < H; y++) { if (y < bw || y >= H - bw) for (let x = 0; x < W; x++) take(y * W + x); else { for (let x = 0; x < bw; x++) take(y * W + x); for (let x = W - bw; x < W; x++) take(y * W + x); } }
  const mL = median(sL), mA = median(sA), mB = median(sB);
  let uni = 0; for (let i = 0; i < sL.length; i++) if (Math.hypot(sL[i] - mL, sA[i] - mA, sB[i] - mB) < 12) uni++;
  uni /= sL.length || 1;
  // tinta = beda dari kertas lokal (ΔE, terang dinormalisasi oleh latar setempat → bayangan / foto kertas aman)
  const allL = []; for (let i = 0; i < N; i += Math.max(1, Math.floor(N / 30000))) allL.push(L[i]);
  const gBg = uni > 0.5 ? mL : pct(allL, 0.9);
  const bg = paperBg(L, W, H, Math.max(20, gBg - 28));
  const ink = new Float32Array(N);
  for (let i = 0; i < N; i++) { const ln = Math.min(100, L[i] / Math.max(1, bg[i]) * 100), dl = 100 - ln, da = A[i] - mA, db = B[i] - mB; ink[i] = Math.sqrt(dl * dl + 0.6 * (da * da + db * db)); }
  const O = otsu(ink, 0, 110);
  let uniInk = 0; for (const i of bI) if (ink[i] < 12) uniInk++; uniInk /= bI.length || 1; // tepi = kertas (setelah koreksi bayangan)
  let nI = 0, sI = 0, s2 = 0, nB = 0, sBg = 0, per = 0, chroma = 0, qL = 0, qL2 = 0, qA = 0, qA2 = 0, qB = 0, qB2 = 0;
  for (let i = 0; i < N; i++) { const v = ink[i]; if (v > O.t) { nI++; sI += v; s2 += v * v; chroma += Math.sqrt(A[i] * A[i] + B[i] * B[i]); qL += L[i]; qL2 += L[i] * L[i]; qA += A[i]; qA2 += A[i] * A[i]; qB += B[i]; qB2 += B[i] * B[i]; } else { nB++; sBg += v; } }
  const vr = (s1, s2) => nI ? Math.max(0, s2 / nI - (s1 / nI) ** 2) : 0, sdL = Math.sqrt(vr(qL, qL2)), sdC = Math.sqrt(vr(qA, qA2) + vr(qB, qB2));
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (ink[i] > O.t && (ink[i - 1] <= O.t || ink[i + 1] <= O.t || ink[i - W] <= O.t || ink[i + W] <= O.t)) per++; }
  const mI = nI ? sI / nI : 0, sdI = nI ? Math.sqrt(Math.max(0, s2 / nI - mI * mI)) : 0, mBg = nB ? sBg / nB : 0;
  const contrast = mI - mBg, flat = contrast > 1 ? sdI / contrast : 9, frac = nI / N, width = per ? 2 * nI / per : 0;
  let mode = 'photo';
  if (contrast >= 18 && O.eta >= 0.68 && Math.max(uni, uniInk) >= 0.55 && flat <= 0.34) {
    if (frac <= 0.3 && width <= Math.max(5, 0.011 * diag)) mode = 'line';
    else if (flat <= 0.2 && sdL < 6 && sdC < 8) mode = 'shape'; // satu warna rata (logo / ikon / siluet); objek berwarna-warni = foto
  }
  return { mode, ink, T: O.t, eta: O.eta, frac, width, flat, contrast, uni, uniInk, sdL, sdC, bgLab: [mL, mA, mB], chroma: nI ? chroma / nI : 0 };
}

// ---------- jalur per mode ----------
const DET = { // indeks detail 0..4
  lineInk: [1.12, 1.0, 0.9, 0.82, 0.74],
  lineMin: [3.2, 2.2, 1.5, 1.1, 0.8],     // × lebar goresan
  sS: [15, 11, 8.5, 6.5, 4.8],            // px (dikalikan skala resolusi)
  sR: [34, 28, 23, 19, 15],               // ΔE
  hi: [6.2, 4.6, 3.4, 2.6, 1.9],          // ΔE / px
  minLen: [0.045, 0.028, 0.017, 0.010, 0.0065], // × diagonal
  shapeA: [0.0012, 0.0005, 0.0002, 0.00008, 0.00003], // × luas gambar
};
function traceLine(lab, W, H, an, d) {
  const N = W * H, diag = Math.hypot(W, H);
  const ink = gauss(an.ink, W, H, 0.65), T = Math.max(9, an.T * DET.lineInk[d]);
  const m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = ink[i] > T ? 1 : 0;
  zeroBorder(m, W, H);
  const w0 = Math.max(1, an.width);
  removeSmall(m, W, H, Math.max(6, Math.round(w0 * w0 * DET.lineMin[d])));
  fillHoles(m, W, H, Math.max(4, Math.round(0.6 * w0 * w0)));
  const dt = chamfer(m, W, H);
  thin(m, W, H);
  const G = skelGraph(m, W, H), ws = [];
  for (let i = 0; i < N; i += 3) if (m[i]) ws.push(2 * dt[i] - 1);
  const wmed = Math.max(1, median(ws));
  prune(G, Math.max(3, 1.6 * wmed + 1));
  pairJunctions(G, Math.max(5, 1.5 * wmed + 3));
  let paths = graphPaths(G);
  for (const P of paths) { const s = []; for (let i = 0; i < P.p.length; i += 2) { const x = P.p[i] | 0, y = P.p[i + 1] | 0; s.push(2 * dt[y * W + x] - 1); } P.w = Math.max(1, median(s)); }
  const minL = Math.max(3, wmed * DET.lineMin[d] * 1.4, diag * 0.002);
  paths = paths.filter(P => plen(P.p) >= minL || (P.closed && plen(P.p) >= minL * 0.7));
  const rj = 0.8 * wmed + 1.5;
  cleanJunctions(paths, rj);
  paths = bridge(paths, Math.max(2.5, 1.6 * wmed, diag * 0.0035), 0.5);
  snapEnds(paths, Math.max(rj + 2, 1.2 * wmed + 2));
  return { paths, wmed };
}
function tracePhoto(lab, W, H, an, d, opt, mark = () => { }) {
  const N = W * H, diag = Math.hypot(W, H), rs = clamp(Math.max(W, H) / 1300, 0.6, 1.8);
  const [Ls, As, Bs] = dtFilter([lab.L, lab.A, lab.B], W, H, DET.sS[d] * rs, DET.sR[d], 3);
  mark('dt');
  const C = [gauss(Ls, W, H, 0.8), gauss(As, W, H, 0.8), gauss(Bs, W, H, 0.8)];
  // kontras gambar: gambar redup → ambang ikut turun (maks. 45%)
  let hiAbs = DET.hi[d];
  const Gr = gradient(C, W, H), M = Gr.M;
  const ms = []; for (let i = 0; i < N; i += 7) if (M[i] > 0.5) ms.push(M[i]);
  const p95 = pct(ms, 0.95);
  if (p95 > 0 && p95 < hiAbs * 3.2) hiAbs *= Math.max(0.55, p95 / (hiAbs * 3.2));
  const E = nmsHyst(Gr, W, H, hiAbs * 0.42, hiAbs);
  mark('canny');
  // latar polos: abaikan tepi di latar (bayangan lembut, tekstur dinding/lantai)
  let fg = null;
  if (opt.bg !== false && an.uni >= 0.6) {
    fg = bgFlood(C, M, W, H, an.bgLab, hiAbs);
    if (fg) for (let i = 0; i < N; i++) if (E[i] && !fg[i]) E[i] = 0;
  }
  mark('bg');
  thin(E, W, H);
  const G = skelGraph(E, W, H);
  mark('graph');
  prune(G, 5);
  pairJunctions(G, 6, 32);
  let paths = graphPaths(G);
  cleanJunctions(paths, 3);
  const minL = Math.max(6, diag * DET.minLen[d]);
  for (const P of paths) { let s = 0; const n = P.p.length / 2; for (let i = 0; i < P.p.length; i += 2) s += M[(P.p[i + 1] | 0) * W + (P.p[i] | 0)]; P.mag = s / n; P.len = plen(P.p); }
  paths = paths.filter(P => P.len >= minL * (P.mag > hiAbs * 2.5 ? 0.5 : 1) && P.len * P.mag >= minL * hiAbs * 1.2);
  if (fg) paths = paths.filter(P => !shadowEdge(P, C, Gr, W, H, an.bgLab));
  paths = bridge(paths, Math.max(4, diag * 0.012), 0.55);
  snapEnds(paths, Math.max(3, diag * 0.006));
  paths = paths.filter(P => plen(P.p) >= minL * 1.2 || P.closed);
  if (fg) markOuter(paths, fg, W, H);
  return { paths };
}
// latar = area terhubung ke tepi gambar, menjalar lewat perubahan warna halus (bayangan lembut ikut), berhenti di tepi tajam
function bgFlood(C, M, W, H, bgLab, hi) {
  const N = W * H, bg = new Uint8Array(N), st = new Int32Array(N); let sp = 0;
  const [L, A, B] = C, [l0, a0, b0] = bgLab;
  const near = i => { const dl = L[i] - l0, da = A[i] - a0, db = B[i] - b0; return dl * dl + da * da + db * db < 196; };
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (!bg[i] && near(i)) { bg[i] = 1; st[sp++] = i; } }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (!bg[i] && near(i)) { bg[i] = 1; st[sp++] = i; } }
  if (!sp) return null;
  const g0 = hi * 0.8;
  while (sp) {
    const p = st[--sp], x = p % W, y = (p / W) | 0;
    const tryq = q => { if (bg[q] || M[q] > g0) return; const dl = L[q] - L[p], da = A[q] - A[p], db = B[q] - B[p]; if (dl * dl + da * da + db * db > 9) return; const ca = A[q] - a0, cb = B[q] - b0; if (ca * ca + cb * cb > 256) return; bg[q] = 1; st[sp++] = q; };
    if (x > 0) tryq(p - 1); if (x < W - 1) tryq(p + 1); if (y > 0) tryq(p - W); if (y < H - 1) tryq(p + W);
  }
  let nb = 0; for (let i = 0; i < N; i++) nb += bg[i];
  if (nb < N * 0.15 || nb > N * 0.97) return null;
  // depan = bukan latar, dilatasi 3 px (tepi objek ada di batasnya)
  const fg = new Uint8Array(N); for (let i = 0; i < N; i++) fg[i] = bg[i] ? 0 : 1;
  for (let r = 0; r < 3; r++) { const t = Uint8Array.from(fg); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (!t[i] && (t[i - 1] | t[i + 1] | t[i - W] | t[i + W])) fg[i] = 1; } }
  fg.bgMask = bg;
  return fg;
}
// tepi bayangan jatuh di lantai polos: kedua sisi akromatik (seperti latar), sisi terang = lantai (≈ latar),
// sisi gelap lebih gelap 4–45 L* dan SERAGAM sepanjang tepi (bayangan rata). Objek abu-abu bergradasi / punya detail → tetap.
function shadowEdge(P, C, Gr, W, H, bgLab) {
  const [L, A, B] = C, [l0, a0, b0] = bgLab, p = P.p, n = p.length / 2, dk = [];
  const at = (F, x, y) => { x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001); const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0, x1 = Math.min(W - 1, x0 + 1) - x0, y1 = (Math.min(H - 1, y0 + 1) - y0) * W; return (F[i] * (1 - fx) + F[i + x1] * fx) * (1 - fy) + (F[i + y1] * (1 - fx) + F[i + y1 + x1] * fx) * fy; };
  let ok = 0, tot = 0;
  for (let k = 0; k < n; k += 3) {
    const x = p[2 * k] - 0.5, y = p[2 * k + 1] - 0.5, i = clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1), dx = Gr.DX[i] * 3.5, dy = Gr.DY[i] * 3.5;
    const s1 = [at(L, x + dx, y + dy), at(A, x + dx, y + dy), at(B, x + dx, y + dy)], s2 = [at(L, x - dx, y - dy), at(A, x - dx, y - dy), at(B, x - dx, y - dy)];
    const [br, d] = s1[0] >= s2[0] ? [s1, s2] : [s2, s1];
    tot++;
    const ach = q => (q[1] - a0) ** 2 + (q[2] - b0) ** 2 <= 49;
    if (ach(br) && ach(d) && br[0] >= l0 - 5 && d[0] <= l0 - 4 && d[0] >= l0 - 45) { ok++; dk.push(d[0]); }
  }
  if (tot < 3 || ok < tot * 0.75) return false;
  const m = dk.reduce((s, v) => s + v, 0) / dk.length, sd = Math.sqrt(dk.reduce((s, v) => s + (v - m) ** 2, 0) / dk.length);
  return sd < 4.5;
}
// tandai jalur kontur luar (berimpit batas latar) → bisa diberi garis lebih tebal
function markOuter(paths, fg, W, H) {
  const bg = fg.bgMask;
  for (const P of paths) {
    let n = 0, k = 0;
    for (let i = 0; i < P.p.length; i += 4) {
      const x = P.p[i] | 0, y = P.p[i + 1] | 0; k++;
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && bg[yy * W + xx]) { near = true; break; } }
      if (near) n++;
    }
    P.outer = k > 0 && n / k > 0.6;
  }
}
function traceShape(lab, W, H, an, d) {
  const sm = gauss(an.ink, W, H, 1.1), T = an.T;
  const loops = isoContours(sm, W, H, T), minA = Math.max(12, W * H * DET.shapeA[d]);
  const paths = [];
  for (const p of loops) { const a = Math.abs(shoelace(p)); if (a >= minA) paths.push({ p, closed: true, free: [false, false], area: a }); }
  return { paths };
}

// ---------- celah: sambung ujung-ke-ujung (searah) ----------
function endInfo(P, end) {
  const p = P.p, n = p.length / 2, L = Math.min(6, plen(p) / 3);
  let s = 0, k;
  if (end === 0) { for (k = 1; k < n; k++) { s += Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]); if (s >= L) break; } k = Math.min(k, n - 1); const dx = p[0] - p[2 * k], dy = p[1] - p[2 * k + 1], l = Math.hypot(dx, dy) || 1; return { x: p[0], y: p[1], tx: dx / l, ty: dy / l }; }
  for (k = n - 2; k >= 0; k--) { s += Math.hypot(p[2 * k + 2] - p[2 * k], p[2 * k + 3] - p[2 * k + 1]); if (s >= L) break; }
  k = Math.max(k, 0); const dx = p[2 * n - 2] - p[2 * k], dy = p[2 * n - 1] - p[2 * k + 1], l = Math.hypot(dx, dy) || 1;
  return { x: p[2 * n - 2], y: p[2 * n - 1], tx: dx / l, ty: dy / l };
}
function bridge(paths, gap, minCos) {
  const ends = [];
  paths.forEach((P, i) => { if (P.closed) return; for (const e of [0, 1]) if (P.free?.[e] !== false) ends.push({ i, e, ...endInfo(P, e) }); });
  if (ends.length < 2) return paths;
  const cell = gap, grid = new Map(), key = (x, y) => (Math.floor(x / cell) + 30000) * 70000 + Math.floor(y / cell) + 30000;
  ends.forEach((E, k) => { const kk = key(E.x, E.y); const l = grid.get(kk); if (l) l.push(k); else grid.set(kk, [k]); });
  const cand = [];
  ends.forEach((E, a) => {
    const cx = Math.floor(E.x / cell), cy = Math.floor(E.y / cell);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const b of grid.get((cx + dx + 30000) * 70000 + cy + dy + 30000) || []) {
      if (b <= a) continue; const F = ends[b];
      if (E.i === F.i && plen(paths[E.i].p) < 4 * gap) continue;
      const vx = F.x - E.x, vy = F.y - E.y, d = Math.hypot(vx, vy); if (d > gap) continue;
      let score;
      if (d < 1.2) score = d * 0.1;
      else {
        const ux = vx / d, uy = vy / d, c1 = E.tx * ux + E.ty * uy, c2 = -(F.tx * ux + F.ty * uy), c3 = -(E.tx * F.tx + E.ty * F.ty);
        if (c1 < minCos || c2 < minCos || c3 < minCos - 0.3) continue;
        score = d * (3.2 - c1 - c2 - 0.5 * c3);
      }
      cand.push([score, a, b]);
    }
  });
  cand.sort((x, y) => x[0] - y[0]);
  const link = new Map(), used = new Set();
  for (const [, a, b] of cand) { if (used.has(a) || used.has(b)) continue; used.add(a); used.add(b); const A = ends[a], B = ends[b]; link.set(A.i * 2 + A.e, B.i * 2 + B.e); link.set(B.i * 2 + B.e, A.i * 2 + A.e); }
  if (!link.size) return paths;
  const done = new Uint8Array(paths.length), out = [];
  const orient = (i, startEnd) => startEnd === 0 ? paths[i].p : revP(paths[i].p);
  for (let i = 0; i < paths.length; i++) {
    if (done[i]) continue;
    if (paths[i].closed) { done[i] = 1; out.push(paths[i]); continue; }
    // cari ujung rantai
    let ci = i, ce = 0, guard = 0, cyc = false;
    for (; guard < paths.length + 2; guard++) { const l = link.get(ci * 2 + ce); if (l === undefined) break; const ni = l >> 1, ne = l & 1; ci = ni; ce = 1 - ne; if (ci === i && ce === 0) { cyc = true; break; } }
    // ci/ce = ujung awal rantai (ujung bebas ce dari jalur ci)
    let p = [], j = ci, e = ce; const fr = [paths[ci].free?.[ce] ?? true, true];
    for (let g2 = 0; g2 < paths.length + 2; g2++) {
      if (done[j]) break; done[j] = 1;
      const q = orient(j, e); p = p.length ? p.concat(q) : q.slice();
      const other = j * 2 + (1 - e), l = link.get(other);
      if (l === undefined) { fr[1] = paths[j].free?.[1 - e] ?? true; break; }
      j = l >> 1; e = l & 1;
    }
    out.push({ ...paths[ci], p, closed: cyc, free: cyc ? [false, false] : fr });
  }
  return out;
}
// distorsi kerangka di persimpangan: buang titik dekat simpul yang dilewati lurus (dijembatani garis lurus),
// potong ujung batang T (lalu disambung ulang tepat ke garisnya oleh snapEnds)
function cleanJunctions(paths, r) {
  for (const P of paths) {
    let p = P.p;
    if (P.via?.length) {
      const keep = [], n = p.length;
      for (let i = 0; i < n; i += 2) {
        let near = false;
        if (i && i < n - 2) for (const [vx, vy] of P.via) if (Math.hypot(p[i] - vx, p[i + 1] - vy) < r) { near = true; break; }
        if (!near) keep.push(p[i], p[i + 1]);
      }
      if (keep.length >= 4) p = keep;
    }
    for (const e of [0, 1]) {
      if (!P.tEnd?.[e]) continue;
      const n = p.length / 2; if (n < 4) continue;
      const jx = e ? p[2 * n - 2] : p[0], jy = e ? p[2 * n - 1] : p[1];
      let k = 0;
      while (k < n - 3 && Math.hypot(p[2 * (e ? n - 1 - k : k)] - jx, p[2 * (e ? n - 1 - k : k) + 1] - jy) < r) k++;
      if (k > 0 && plen(p) - r > 2 * r) p = e ? p.slice(0, p.length - 2 * k) : p.slice(2 * k);
    }
    P.p = p;
  }
}
// ujung yang hampir menyentuh garis lain (sambungan T) → perpanjang searah ujungnya tepat sampai garis itu
function snapEnds(paths, r) {
  const cell = r * 2, grid = new Map(), key = (x, y) => (Math.floor(x / cell) + 30000) * 70000 + Math.floor(y / cell) + 30000;
  paths.forEach((P, i) => { const p = P.p; for (let k = 0; k < p.length; k += 2) { const kk = key(p[k], p[k + 1]); const l = grid.get(kk); if (l) l.push(i, k); else grid.set(kk, [i, k]); } });
  const R = r * 1.6;
  for (let i = 0; i < paths.length; i++) {
    const P = paths[i]; if (P.closed) continue;
    for (const e of [0, 1]) {
      const E = endInfo(P, e), n = P.p.length / 2;
      let best = null, bt = R, near = null, nd = r;
      const cx = Math.floor(E.x / cell), cy = Math.floor(E.y / cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const l = grid.get((cx + dx + 30000) * 70000 + cy + dy + 30000); if (!l) continue;
        for (let t = 0; t < l.length; t += 2) {
          const j = l[t], k = l[t + 1], q = paths[j].p;
          if (j === i) { const idx = k / 2, fromEnd = e === 0 ? idx : n - 1 - idx; if (fromEnd < Math.max(8, 3 * r)) continue; }
          // sinar dari ujung (arah keluar) vs ruas k−1..k dan k..k+1 jalur j
          for (const [a, b] of [[k - 2, k], [k, k + 2]]) {
            if (a < 0 || b >= q.length) continue;
            const ax = q[a], ay = q[a + 1], sx = q[b] - ax, sy = q[b + 1] - ay, den = E.tx * sy - E.ty * sx;
            if (Math.abs(den) < 1e-9) continue;
            const wx = ax - E.x, wy = ay - E.y, tt = (wx * sy - wy * sx) / den, u = (wx * E.ty - wy * E.tx) / den;
            if (tt > -0.3 && tt < bt && u >= -0.02 && u <= 1.02) { bt = tt; best = [E.x + E.tx * tt, E.y + E.ty * tt]; }
          }
          const qx = q[k], qy = q[k + 1], vx = qx - E.x, vy = qy - E.y, dd = Math.hypot(vx, vy);
          if (dd > 0.3 && dd < nd && (vx * E.tx + vy * E.ty) / dd > 0.35) { nd = dd; near = [qx, qy]; }
        }
      }
      const pt = best && Math.abs(bt) > 0.3 ? best : best ? null : near;
      if (pt) { if (e === 0) P.p = [pt[0], pt[1], ...P.p]; else P.p.push(pt[0], pt[1]); (P.snap ||= [false, false])[e] = true; }
    }
  }
}

// ---------- fit kurva: sudut → penghalusan → garis + busur (biarc G1) ----------
function resample(p, closed, step = 1) {
  const n = p.length / 2, out = [p[0], p[1]];
  let carry = 0;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const ax = p[2 * i], ay = p[2 * i + 1], j = (i + 1) % n, bx = p[2 * j], by = p[2 * j + 1], L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-9) continue;
    let t = step - carry;
    while (t <= L + 1e-9) { out.push(ax + (bx - ax) * t / L, ay + (by - ay) * t / L); t += step; }
    carry = L - (t - step);
  }
  if (closed) { // buang titik terakhir bila berimpit titik awal
    const k = out.length; if (k >= 4 && Math.hypot(out[k - 2] - out[0], out[k - 1] - out[1]) < step * 0.5) out.length = k - 2;
  } else if (carry > step * 0.3 || out.length < 4) out.push(p[2 * n - 2], p[2 * n - 1]);
  else { out[out.length - 2] = p[2 * n - 2]; out[out.length - 1] = p[2 * n - 1]; }
  return out;
}
function turnAt(Q, n, i, k, closed) {
  const a = closed ? ((i - k) % n + n) % n : i - k, b = closed ? (i + k) % n : i + k;
  if (!closed && (a < 0 || b >= n)) return 0;
  const ux = Q[2 * i] - Q[2 * a], uy = Q[2 * i + 1] - Q[2 * a + 1], vx = Q[2 * b] - Q[2 * i], vy = Q[2 * b + 1] - Q[2 * i + 1];
  const den = Math.hypot(ux, uy) * Math.hypot(vx, vy); if (den < 1e-9) return 0;
  return Math.acos(clamp((ux * vx + uy * vy) / den, -1, 1));
}
function findCorners(Q, closed, k, thr) {
  const n = Q.length / 2; if (n < 2 * k + 3) return [];
  const ang = new Float64Array(n);
  for (let i = 0; i < n; i++) ang[i] = turnAt(Q, n, i, k, closed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ang[i]; if (a < thr) continue;
    let isMax = true;
    for (let j = -k; j <= k && isMax; j++) { if (!j) continue; const q = closed ? ((i + j) % n + n) % n : i + j; if (q < 0 || q >= n) continue; if (ang[q] > a || (ang[q] === a && j < 0)) isMax = false; }
    if (!isMax) continue;
    const a2 = turnAt(Q, n, i, 2 * k, closed);
    if (a2 && a2 > a * 1.5 + 0.2) continue; // lengkung mulus (sudut ikut membesar), bukan pojok
    out.push(i);
  }
  return out;
}
// Gauss sepanjang ruas. Ujung di sudut / sambungan disematkan (cermin titik); ujung BEBAS diperpanjang lurus mengikuti
// garis kuadrat-terkecil setempat lalu ikut dihaluskan (piksel ujung goresan tipis sering meleset ±½ px).
function smoothRun(R, sigma, loop, free0 = false, free1 = false) {
  const n = R.length / 2, out = new Float64Array(R.length);
  if (sigma < 0.3 || n < 3) { out.set(R); return out; }
  const s = loop ? sigma : Math.min(sigma, (n - 1) / 3), rad = Math.max(1, Math.ceil(2.5 * s)), w = [];
  let ws = 0; for (let j = -rad; j <= rad; j++) { const v = Math.exp(-j * j / (2 * s * s)); w.push(v); ws += v; }
  const ext = (fromEnd) => { // garis LS dari m titik di ujung → fungsi titik ke-t (t<0 = di luar ujung)
    const m = Math.min(n, Math.max(4, Math.round(3 * s))), idx = j => fromEnd ? n - 1 - j : j;
    let mx = 0, my = 0; for (let j = 0; j < m; j++) { mx += R[2 * idx(j)]; my += R[2 * idx(j) + 1]; } mx /= m; my /= m;
    let xx = 0, yy = 0, xy = 0; for (let j = 0; j < m; j++) { const dx = R[2 * idx(j)] - mx, dy = R[2 * idx(j) + 1] - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
    const th = 0.5 * Math.atan2(2 * xy, xx - yy); let ux = Math.cos(th), uy = Math.sin(th);
    const ox = R[2 * idx(m - 1)] - R[2 * idx(0)], oy = R[2 * idx(m - 1) + 1] - R[2 * idx(0) + 1]; if (ux * ox + uy * oy < 0) { ux = -ux; uy = -uy; } // menjauhi ujung
    const t0 = (R[2 * idx(0)] - mx) * ux + (R[2 * idx(0) + 1] - my) * uy; // proyeksi ujung
    return t => [mx + ux * (t0 + t), my + uy * (t0 + t)]; // t negatif = keluar dari ujung
  };
  const E0 = !loop && free0 ? ext(false) : null, E1 = !loop && free1 ? ext(true) : null;
  const at = (i, c) => {
    if (loop) { const q = ((i % n) + n) % n; return R[2 * q + c]; }
    if (i < 0) return E0 ? E0(i)[c] : 2 * R[c] - R[2 * Math.min(n - 1, -i) + c];
    if (i >= n) return E1 ? E1(-(i - n + 1))[c] : 2 * R[2 * (n - 1) + c] - R[2 * Math.max(0, 2 * (n - 1) - i) + c];
    return R[2 * i + c];
  };
  for (let i = 0; i < n; i++) { let x = 0, y = 0; for (let j = -rad; j <= rad; j++) { x += at(i + j, 0) * w[j + rad]; y += at(i + j, 1) * w[j + rad]; } out[2 * i] = x / ws; out[2 * i + 1] = y / ws; }
  if (!loop) {
    if (!E0) { out[0] = R[0]; out[1] = R[1]; }
    if (!E1) { out[2 * n - 2] = R[2 * n - 2]; out[2 * n - 1] = R[2 * n - 1]; }
  }
  return out;
}
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
export function arcOf(ax, ay, bx, by, bu) { // busur dari bulge (CCW +): pusat, jari-jari, sudut awal, sapuan bertanda
  if (Math.abs(bu) < 1e-9) return null;
  const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy); if (d < 1e-12) return null;
  const ux = dx / d, uy = dy / d, k = d * (1 - bu * bu) / (4 * bu);
  const cx = (ax + bx) / 2 - uy * k, cy = (ay + by) / 2 + ux * k, r = d * (1 + bu * bu) / (4 * Math.abs(bu));
  return { cx, cy, r, sa: Math.atan2(ay - cy, ax - cx), sw: 4 * Math.atan(bu) };
}
function arcDist(px, py, A, ax, ay, bx, by) {
  if (!A) return segDist(px, py, ax, ay, bx, by);
  let t = Math.atan2(py - A.cy, px - A.cx) - A.sa;
  if (A.sw >= 0) { t = ((t % TAU) + TAU) % TAU; if (t <= A.sw) return Math.abs(Math.hypot(px - A.cx, py - A.cy) - A.r); }
  else { t = ((-t % TAU) + TAU) % TAU; if (t <= -A.sw) return Math.abs(Math.hypot(px - A.cx, py - A.cy) - A.r); }
  return Math.min(Math.hypot(px - ax, py - ay), Math.hypot(px - bx, py - by));
}
const bulgeFrom = (ax, ay, tx, ty, bx, by) => { const cx = bx - ax, cy = by - ay; return Math.tan(Math.atan2(tx * cy - ty * cx, tx * cx + ty * cy) / 2); };
function biarc(x0, y0, t0x, t0y, x1, y1, t1x, t1y) {
  const vx = x1 - x0, vy = y1 - y0, vv = vx * vx + vy * vy; if (vv < 1e-12) return null;
  const tx = t0x + t1x, ty = t0y + t1y, vt = vx * tx + vy * ty, den = 2 * (1 - (t0x * t1x + t0y * t1y));
  let d;
  if (Math.abs(den) < 1e-9) { const v1 = vx * t1x + vy * t1y; if (Math.abs(v1) < 1e-9) return null; d = vv / (4 * v1); }
  else d = (-vt + Math.sqrt(Math.max(0, vt * vt + den * vv))) / den;
  if (!(d > 0) || !isFinite(d)) return null;
  const q0x = x0 + d * t0x, q0y = y0 + d * t0y, q1x = x1 - d * t1x, q1y = y1 - d * t1y, jx = (q0x + q1x) / 2, jy = (q0y + q1y) / 2;
  let ux = q1x - q0x, uy = q1y - q0y; const ul = Math.hypot(ux, uy); if (ul < 1e-12) { ux = t0x; uy = t0y; } else { ux /= ul; uy /= ul; }
  return { jx, jy, b1: bulgeFrom(x0, y0, t0x, t0y, jx, jy), b2: bulgeFrom(jx, jy, ux, uy, x1, y1) };
}
// tangen: fit kuadrat lokal (kerangka acuan = tali busur jendela) → akurat di garis lurus maupun lengkung, juga di ujung ruas
function tangents(S, h) {
  const n = S.length / 2, T = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n - 1, i + h);
    let ux = S[2 * b] - S[2 * a], uy = S[2 * b + 1] - S[2 * a + 1]; const ul = Math.hypot(ux, uy);
    if (ul < 1e-9) { T[2 * i] = 1; T[2 * i + 1] = 0; continue; }
    ux /= ul; uy /= ul;
    const ox = S[2 * i], oy = S[2 * i + 1];
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (let j = a; j <= b; j++) { const dx = S[2 * j] - ox, dy = S[2 * j + 1] - oy, x = dx * ux + dy * uy, y = -dx * uy + dy * ux, x2 = x * x; s0++; s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2; t0 += y; t1 += x * y; t2 += x2 * y; }
    let slope;
    const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
    if (b - a >= 4 && Math.abs(det) > 1e-9) slope = (s0 * (t1 * s4 - s3 * t2) - t0 * (s1 * s4 - s3 * s2) + s2 * (s1 * t2 - t1 * s2)) / det; // c1 (Cramer)
    else { const dd = s0 * s2 - s1 * s1; slope = Math.abs(dd) > 1e-9 ? (s0 * t1 - s1 * t0) / dd : 0; }
    const l = Math.hypot(1, slope); T[2 * i] = (ux - uy * slope) / l; T[2 * i + 1] = (uy + ux * slope) / l;
  }
  return T;
}
// Fit satu ruas mulus (tanpa sudut) S: tiap langkah pilih yang terpanjang antara garis lurus (tali busur) dan biarc
// bersinggungan (G1). Hasil: verteks [{x,y,b,si}] tanpa titik akhir.
function fitRun(S, tol, tStart, tEnd, hT = 6) {
  const n = S.length / 2, V = [];
  if (n < 2) return V;
  const lineTest = (s, e) => { const ax = S[2 * s], ay = S[2 * s + 1], bx = S[2 * e], by = S[2 * e + 1]; for (let i = s + 1; i < e; i++) if (segDist(S[2 * i], S[2 * i + 1], ax, ay, bx, by) > tol) return false; return true; };
  if (lineTest(0, n - 1)) { V.push({ x: S[0], y: S[1], b: 0, si: 0 }); return V; }
  const T = tangents(S, hT);
  if (tStart) { T[0] = tStart[0]; T[1] = tStart[1]; }
  if (tEnd) { T[2 * n - 2] = tEnd[0]; T[2 * n - 1] = tEnd[1]; }
  const test = (s, e) => {
    const x0 = S[2 * s], y0 = S[2 * s + 1], x1 = S[2 * e], y1 = S[2 * e + 1];
    const B = biarc(x0, y0, T[2 * s], T[2 * s + 1], x1, y1, T[2 * e], T[2 * e + 1]);
    if (!B) return null;
    if (Math.abs(B.b1) > 1.2 || Math.abs(B.b2) > 1.2) return null; // > ±200° per busur: bukan bentuk wajar
    const A1 = arcOf(x0, y0, B.jx, B.jy, B.b1), A2 = arcOf(B.jx, B.jy, x1, y1, B.b2);
    for (let i = s + 1; i < e; i++) {
      const px = S[2 * i], py = S[2 * i + 1];
      if (Math.min(arcDist(px, py, A1, x0, y0, B.jx, B.jy), arcDist(px, py, A2, B.jx, B.jy, x1, y1)) > tol) return null;
    }
    // sebaliknya: titik tengah busur & sambungan harus dekat data
    const probe = [[B.jx, B.jy]];
    for (const [A, ax, ay, bx, by] of [[A1, x0, y0, B.jx, B.jy], [A2, B.jx, B.jy, x1, y1]]) { if (A) { const m = A.sa + A.sw / 2; probe.push([A.cx + A.r * Math.cos(m), A.cy + A.r * Math.sin(m)]); } else probe.push([(ax + bx) / 2, (ay + by) / 2]); }
    for (const [qx, qy] of probe) { let dm = Infinity; for (let i = s; i <= e; i++) { const dd = Math.hypot(S[2 * i] - qx, S[2 * i + 1] - qy); if (dd < dm) dm = dd; } if (dm > tol * 2 + 0.5) return null; }
    return B;
  };
  // pencarian eksponensial + biner: indeks e terjauh yang lolos uji f(s, e)
  const reach = (s, f) => {
    let good = Math.min(n - 1, s + 1), gv = f(s, good), bad = -1, step = 4;
    if (!gv) return { e: good, v: null };
    for (;;) {
      const e = Math.min(n - 1, s + step); if (e <= good) { if (good === n - 1) break; step *= 2; continue; }
      const v = f(s, e); if (v) { good = e; gv = v; if (e === n - 1) break; step *= 2; } else { bad = e; break; }
    }
    if (bad > 0) while (bad - good > 1) { const m = (good + bad) >> 1, v = f(s, m); if (v) { good = m; gv = v; } else bad = m; }
    return { e: good, v: gv };
  };
  let s = 0;
  while (s < n - 1) {
    const L = reach(s, lineTest), Bq = reach(s, test);
    if (L.e >= Bq.e * 0.85 + s * 0.15 || !Bq.v) { // garis lurus (diutamakan bila hampir sama panjang)
      V.push({ x: S[2 * s], y: S[2 * s + 1], b: 0, si: s });
      const e = Bq.v && Bq.e > L.e ? L.e : L.e;
      // singgung lanjutan = arah garis → busur berikutnya bersambung mulus
      if (e < n - 1) { const dx = S[2 * e] - S[2 * s], dy = S[2 * e + 1] - S[2 * s + 1], l = Math.hypot(dx, dy); if (l > 1e-9 && e - s >= 6) { const c = (dx * T[2 * e] + dy * T[2 * e + 1]) / l; if (c > 0.996) { T[2 * e] = dx / l; T[2 * e + 1] = dy / l; } } }
      s = Math.max(e, s + 1); continue;
    }
    const gB = Bq.v, good = Bq.e, jsi = s + ((good - s) >> 1);
    V.push({ x: S[2 * s], y: S[2 * s + 1], b: gB.b1, si: s }, { x: gB.jx, y: gB.jy, b: gB.b2, si: jsi });
    s = good;
  }
  return V;
}
// sederhanakan: bulge sangat kecil → garis, garis segaris digabung, busur sepusat digabung (dicek terhadap data)
function tidy(V, closed, S, tol) {
  const nP = S.length / 2;
  const dev = (i0, i1, ax, ay, bx, by, A) => { if (i1 < i0) i1 += nP; let m = 0; for (let i = i0; i <= i1; i++) { const q = i % nP; m = Math.max(m, arcDist(S[2 * q], S[2 * q + 1], A, ax, ay, bx, by)); } return m; };
  const nxt = i => closed ? (i + 1) % V.length : i + 1;
  for (let i = 0; i < V.length; i++) {
    const j = nxt(i); if (j >= V.length) break;
    const c = Math.hypot(V[j].x - V[i].x, V[j].y - V[i].y);
    if (Math.abs(V[i].b) * c / 2 < 0.06) V[i].b = 0;
  }
  for (let guard = 0; guard < 4; guard++) {
    let ch = false;
    for (let i = closed ? 0 : 1; i < V.length && V.length > (closed ? 3 : 2); i++) {
      const h = (i - 1 + V.length) % V.length, j = nxt(i); if (j >= V.length) break;
      if (!closed && i === V.length - 1) break;
      const P = V[h], Q = V[i], R = V[j];
      if (!P.b && !Q.b) {
        if (segDist(Q.x, Q.y, P.x, P.y, R.x, R.y) < tol * 0.5 && dev(P.si, R.si, P.x, P.y, R.x, R.y, null) <= tol) { V.splice(i, 1); i--; ch = true; }
        continue;
      }
      if (P.b && Q.b && Math.sign(P.b) === Math.sign(Q.b)) {
        const A1 = arcOf(P.x, P.y, Q.x, Q.y, P.b), A2 = arcOf(Q.x, Q.y, R.x, R.y, Q.b);
        if (!A1 || !A2) continue;
        const rr = Math.max(A1.r, A2.r), e = Math.max(0.6, 0.03 * rr);
        if (Math.hypot(A1.cx - A2.cx, A1.cy - A2.cy) > e || Math.abs(A1.r - A2.r) > e) continue;
        const sw = A1.sw + A2.sw; if (Math.abs(sw) > 1.9 * Math.PI) continue;
        const nb = Math.tan(sw / 4), A = arcOf(P.x, P.y, R.x, R.y, nb);
        if (dev(P.si, R.si, P.x, P.y, R.x, R.y, A) > tol * 1.2) continue;
        P.b = nb; V.splice(i, 1); i--; ch = true;
      }
    }
    if (!ch) break;
  }
  return V;
}
function dpIdx(S, i0, i1, eps, keep) {
  const st = [[i0, i1]];
  while (st.length) {
    const [a, b] = st.pop(); if (b - a < 2) continue;
    let mi = -1, md = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(S[2 * i], S[2 * i + 1], S[2 * a], S[2 * a + 1], S[2 * b], S[2 * b + 1]); if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
}
// lingkaran (Kasa + Gauss-Newton)
function fitCircle(S) {
  const n = S.length / 2; if (n < 8) return null;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += S[2 * i]; my += S[2 * i + 1]; } mx /= n; my /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let i = 0; i < n; i++) { const u = S[2 * i] - mx, v = S[2 * i + 1] - my; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
  const det = suu * svv - suv * suv; if (Math.abs(det) < 1e-12) return null;
  const r1 = 0.5 * (suuu + suvv), r2 = 0.5 * (svvv + svuu);
  let cx = (r1 * svv - r2 * suv) / det + mx, cy = (r2 * suu - r1 * suv) / det + my, r = 0;
  for (let it = 0; it < 6; it++) { // Gauss–Newton geometrik
    let sr = 0; for (let i = 0; i < n; i++) sr += Math.hypot(S[2 * i] - cx, S[2 * i + 1] - cy); r = sr / n;
    let ax = 0, ay = 0; for (let i = 0; i < n; i++) { const dx = S[2 * i] - cx, dy = S[2 * i + 1] - cy, d = Math.hypot(dx, dy) || 1; ax += dx / d; ay += dy / d; }
    const ncx = mx - r * ax / n, ncy = my - r * ay / n; if (Math.hypot(ncx - cx, ncy - cy) < 1e-4) { cx = ncx; cy = ncy; break; } cx = ncx; cy = ncy;
  }
  let sr = 0; for (let i = 0; i < n; i++) sr += Math.hypot(S[2 * i] - cx, S[2 * i + 1] - cy); r = sr / n;
  let emax = 0; for (let i = 0; i < n; i++) emax = Math.max(emax, Math.abs(Math.hypot(S[2 * i] - cx, S[2 * i + 1] - cy) - r));
  return { cx, cy, r, emax };
}
// elips (Halir & Flusser, kuadrat terkecil langsung)
function fitEllipse(S) {
  const n = S.length / 2; if (n < 12) return null;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += S[2 * i]; my += S[2 * i + 1]; } mx /= n; my /= n;
  let sc = 0; for (let i = 0; i < n; i++) sc += Math.hypot(S[2 * i] - mx, S[2 * i + 1] - my); sc = sc / n || 1;
  const s1 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], s2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], s3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const x = (S[2 * i] - mx) / sc, y = (S[2 * i + 1] - my) / sc, d1 = [x * x, x * y, y * y], d2 = [x, y, 1];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { s1[a][b] += d1[a] * d1[b]; s2[a][b] += d1[a] * d2[b]; s3[a][b] += d2[a] * d2[b]; }
  }
  const inv3 = m => { const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, k] = m[2], A = e * k - f * h, B = -(d * k - f * g), Cc = d * h - e * g, det = a * A + b * B + c * Cc; if (Math.abs(det) < 1e-14) return null; return [[A / det, -(b * k - c * h) / det, (b * f - c * e) / det], [B / det, (a * k - c * g) / det, -(a * f - c * d) / det], [Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det]]; };
  const mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const tr = A => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
  const i3 = inv3(s3); if (!i3) return null;
  const T = mul(i3, tr(s2)).map(r => r.map(v => -v)), Mx = s1.map((r, a) => r.map((v, b) => v + mul(s2, T)[a][b]));
  const M = [[Mx[2][0] / 2, Mx[2][1] / 2, Mx[2][2] / 2], [-Mx[1][0], -Mx[1][1], -Mx[1][2]], [Mx[0][0] / 2, Mx[0][1] / 2, Mx[0][2] / 2]];
  // nilai eigen (kubik) → vektor eigen dengan 4ac − b² > 0
  const a2 = -(M[0][0] + M[1][1] + M[2][2]);
  const a1 = M[0][0] * M[1][1] - M[0][1] * M[1][0] + M[0][0] * M[2][2] - M[0][2] * M[2][0] + M[1][1] * M[2][2] - M[1][2] * M[2][1];
  const a0 = -(M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]));
  const roots = cubic(1, a2, a1, a0);
  let best = null;
  for (const l of roots) {
    const R = [[M[0][0] - l, M[0][1], M[0][2]], [M[1][0], M[1][1] - l, M[1][2]], [M[2][0], M[2][1], M[2][2] - l]];
    const cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    let v = cr(R[0], R[1]); const v2 = cr(R[0], R[2]), v3 = cr(R[1], R[2]);
    for (const w of [v2, v3]) if (Math.hypot(...w) > Math.hypot(...v)) v = w;
    if (4 * v[0] * v[2] - v[1] * v[1] > 0) { best = v; break; }
  }
  if (!best) return null;
  const [A, B, C] = best, D = T[0][0] * A + T[0][1] * B + T[0][2] * C, E = T[1][0] * A + T[1][1] * B + T[1][2] * C, F = T[2][0] * A + T[2][1] * B + T[2][2] * C;
  // konik → pusat, sumbu, sudut (koordinat ternormalisasi)
  const den = B * B - 4 * A * C; if (den >= 0) return null;
  const x0 = (2 * C * D - B * E) / den, y0 = (2 * A * E - B * D) / den;
  const F0 = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 + F;
  const th = 0.5 * Math.atan2(B, A - C), ct = Math.cos(th), st = Math.sin(th);
  const Ap = A * ct * ct + B * ct * st + C * st * st, Cp = A * st * st - B * ct * st + C * ct * ct;
  if (-F0 / Ap <= 0 || -F0 / Cp <= 0) return null;
  let ra = Math.sqrt(-F0 / Ap), rb = Math.sqrt(-F0 / Cp), ang = th;
  if (rb > ra) { [ra, rb] = [rb, ra]; ang += Math.PI / 2; }
  const cx = mx + x0 * sc, cy = my + y0 * sc; ra *= sc; rb *= sc;
  // galat geometrik (pendekatan parameter sudut)
  const ca = Math.cos(ang), sa = Math.sin(ang); let emax = 0;
  for (let i = 0; i < n; i++) {
    const dx = S[2 * i] - cx, dy = S[2 * i + 1] - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    let t = Math.atan2(v / rb, u / ra);
    for (let it = 0; it < 3; it++) { const ex = ra * Math.cos(t), ey = rb * Math.sin(t), fx = -ra * Math.sin(t), fy = rb * Math.cos(t), g = (ex - u) * fx + (ey - v) * fy, h = fx * fx + fy * fy + (ex - u) * (-ra * Math.cos(t)) + (ey - v) * (-rb * Math.sin(t)); if (Math.abs(h) > 1e-9) t -= g / h; }
    emax = Math.max(emax, Math.hypot(ra * Math.cos(t) - u, rb * Math.sin(t) - v));
  }
  return { cx, cy, ra, rb, ang, emax };
}
function cubic(a, b, c, d) {
  b /= a; c /= a; d /= a;
  const p = c - b * b / 3, q = 2 * b * b * b / 27 - b * c / 3 + d, D = q * q / 4 + p * p * p / 27, off = -b / 3;
  if (D > 1e-14) { const u = Math.cbrt(-q / 2 + Math.sqrt(D)), v = Math.cbrt(-q / 2 - Math.sqrt(D)); return [u + v + off]; }
  if (Math.abs(D) <= 1e-14) { const u = Math.cbrt(-q / 2); return [2 * u + off, -u + off]; }
  const r = Math.sqrt(-p * p * p / 27), phi = Math.acos(clamp(-q / (2 * r), -1, 1)), m = 2 * Math.cbrt(r);
  return [m * Math.cos(phi / 3) + off, m * Math.cos((phi + TAU) / 3) + off, m * Math.cos((phi + 2 * TAU) / 3) + off];
}
const SMOOTH = { // indeks kehalusan 0..4
  sigma: [0.7, 1.2, 1.8, 2.6, 3.6],
  tol: [0.35, 0.5, 0.7, 0.95, 1.3],
  corner: [28, 34, 40, 48, 58],
  k: [3, 4, 5, 6, 8],
};
// satu jalur → bentuk CAD (koordinat piksel, Y ke atas)
export function fitPath(P, H, o) {
  const sm = clamp(o.smooth ?? 2, 0, 4), si = Math.round(sm);
  const flip = []; for (let i = 0; i < P.p.length; i += 2) flip.push(P.p[i], H - P.p[i + 1]);
  const closed = !!P.closed;
  const Q = resample(flip, closed, 1);
  const n = Q.length / 2;
  if (n < 3) return null;
  const sig = SMOOTH.sigma[si] * (o.sigK || 1), tol = SMOOTH.tol[si] * (o.tolK || 1), k = SMOOTH.k[si], thr = SMOOTH.corner[si] * Math.PI / 180;
  const total = plen(Q) + (closed ? Math.hypot(Q[0] - Q[2 * n - 2], Q[1] - Q[2 * n - 1]) : 0);
  const style = o.style || 'arc';
  // lingkaran / elips (jalur tertutup tanpa sudut)
  const cs = findCorners(Q, closed, k, thr);
  if (closed && !cs.length && o.shapes !== false) {
    const S = smoothRun(Q, sig, true);
    const C = fitCircle(S);
    if (C && C.r >= 2 && C.emax <= Math.max(tol * 1.4, 0.02 * C.r)) return { t: 'circle', c: [C.cx, C.cy], r: C.r, len: total };
    const E = fitEllipse(S);
    if (E && E.rb / E.ra > 0.12 && E.emax <= Math.max(tol * 1.5, 0.018 * E.ra)) return { t: 'ellipse', c: [E.cx, E.cy], u: [E.ra * Math.cos(E.ang), E.ra * Math.sin(E.ang)], k: E.rb / E.ra, len: total };
  }
  // ruas di antara sudut
  const runs = [];
  if (closed && !cs.length) runs.push({ idx: [...Array(n).keys()], loop: true });
  else if (closed) { for (let j = 0; j < cs.length; j++) { const a = cs[j], b = cs[(j + 1) % cs.length], idx = []; for (let i = a; ; i = (i + 1) % n) { idx.push(i); if (i === b && idx.length > 1) break; if (idx.length > n + 1) break; } runs.push({ idx }); } }
  else {
    const br = [0, ...cs, n - 1];
    for (let j = 0; j < br.length - 1; j++) { const idx = []; for (let i = br[j]; i <= br[j + 1]; i++) idx.push(i); runs.push({ idx, f0: j === 0 && !P.snap?.[0], f1: j === br.length - 2 && !P.snap?.[1] }); }
  }
  const V = [];
  const dpSty = style === 'poly';
  for (const r of runs) {
    const R = new Float64Array(r.idx.length * 2); r.idx.forEach((q, t) => { R[2 * t] = Q[2 * q]; R[2 * t + 1] = Q[2 * q + 1]; });
    if (r.loop) {
      // loop tanpa sudut: mulai di titik 0, titik awal diulang di akhir → kurva tertutup mulus (singgung sama di sambungan)
      const S = smoothRun(R, sig, true), m = S.length / 2;
      const S2 = new Float64Array(S.length + 2); S2.set(S); S2[S.length] = S[0]; S2[S.length + 1] = S[1];
      const dx = S[4 % S.length] - S[2 * (m - 2)], dy = S[5 % S.length] - S[2 * (m - 2) + 1], l = Math.hypot(dx, dy) || 1, t0 = [dx / l, dy / l];
      r.S = S2;
      let Vr;
      if (dpSty) { const keep = new Uint8Array(m + 1); keep[0] = keep[m] = 1; dpIdx(S2, 0, m, tol, keep); Vr = []; for (let i = 0; i < m; i++) if (keep[i]) Vr.push({ x: S2[2 * i], y: S2[2 * i + 1], b: 0, si: i }); }
      else { Vr = fitRun(S2, tol, t0, t0); tidy(Vr, true, S, tol); }
      V.push(...Vr);
      continue;
    }
    const S = smoothRun(R, sig, false, r.f0, r.f1), m = S.length / 2;
    r.S = S;
    let Vr;
    if (dpSty) { const keep = new Uint8Array(m); keep[0] = keep[m - 1] = 1; dpIdx(S, 0, m - 1, tol, keep); Vr = []; for (let i = 0; i < m - 1; i++) if (keep[i]) Vr.push({ x: S[2 * i], y: S[2 * i + 1], b: 0, si: i }); }
    else {
      Vr = fitRun(S, tol, null, null);
      Vr.push({ x: S[2 * m - 2], y: S[2 * m - 1], b: 0, si: m - 1 });
      tidy(Vr, false, S, tol); Vr.pop();
    }
    V.push(...Vr);
  }
  if (!V.length) return null;
  if (!closed) { const S = runs[runs.length - 1].S, m = S.length / 2; V.push({ x: S[2 * m - 2], y: S[2 * m - 1], b: 0, si: 0 }); }
  // garis segaris lintas ruas (sudut palsu pada garis lurus)
  for (let guard = 0; guard < 3; guard++) {
    let ch = false;
    for (let i = closed ? 0 : 1; i < V.length - (closed ? 0 : 1) && V.length > (closed ? 3 : 2); i++) {
      const P0 = V[(i - 1 + V.length) % V.length], P1 = V[i], P2 = V[(i + 1) % V.length];
      if (P0.b || P1.b) continue;
      const L = Math.hypot(P2.x - P0.x, P2.y - P0.y);
      if (L > 1e-9 && segDist(P1.x, P1.y, P0.x, P0.y, P2.x, P2.y) < tol * 0.35) { V.splice(i, 1); i--; ch = true; }
    }
    if (!ch) break;
  }
  if (style === 'spline' && !dpSty) return splineOf(runs, closed, tol, total);
  // satu garis / satu busur → entitas sederhana
  if (!closed && V.length === 2) {
    if (!V[0].b) return { t: 'line', a: [V[0].x, V[0].y], b: [V[1].x, V[1].y], len: total };
    const A = arcOf(V[0].x, V[0].y, V[1].x, V[1].y, V[0].b);
    if (A) { const s0 = A.sw >= 0 ? A.sa : A.sa + A.sw; return { t: 'arc', c: [A.cx, A.cy], r: A.r, sa: s0, ea: s0 + Math.abs(A.sw), len: total }; }
  }
  return { t: 'pline', pts: V.map(v => [v.x, v.y, v.b]), closed, len: total };
}
function splineOf(runs, closed, tol, total) {
  const parts = [];
  for (const r of runs) {
    const S = r.S, m = S.length / 2; if (m < 2) continue;
    const keep = new Uint8Array(m); keep[0] = keep[m - 1] = 1; dpIdx(S, 0, m - 1, tol * 0.8, keep);
    // jarak titik fit tidak terlalu timpang (mencegah ayunan spline)
    let last = 0; for (let i = 1; i < m; i++) if (keep[i]) { if (i - last > 40) for (let j = last + 20; j < i - 10; j += 20) keep[j] = 1; last = i; }
    const f = []; for (let i = 0; i < m; i++) if (keep[i]) f.push([S[2 * i], S[2 * i + 1]]);
    if (r.loop) f.pop();
    if (f.length === 2) parts.push({ t: 'line', a: f[0], b: f[1] });
    else parts.push({ t: 'spline', fit: f, closed: !!r.loop });
  }
  if (parts.length === 1) return { ...parts[0], len: total };
  return { t: 'group', parts, len: total, closed };
}

// ---------- jalur utama ----------
export function traceImage(rgba, W, H, opt = {}, prog = () => { }) {
  const t0 = Date.now(), d = clamp(Math.round((opt.detail ?? 3) - 1), 0, 4), tm = {}; let tl = t0;
  const mark = k => { const t = Date.now(); tm[k] = t - tl; tl = t; };
  const lab = toLab(rgba, W, H); mark('lab');
  prog('Menganalisis gambar…', 0.08);
  const an = analyze(lab, W, H); mark('analyze');
  const mode = opt.mode && opt.mode !== 'auto' ? opt.mode : an.mode;
  prog(mode === 'line' ? 'Menipiskan goresan → garis tengah…' : mode === 'shape' ? 'Mencari kontur siluet…' : 'Mendeteksi tepi objek…', 0.2);
  let R;
  if (mode === 'line') R = traceLine(lab, W, H, an, d);
  else if (mode === 'shape') R = traceShape(lab, W, H, an, d);
  else R = tracePhoto(lab, W, H, an, d, opt, mark);
  mark('trace');
  prog('Menghaluskan & mencocokkan garis / busur…', 0.7);
  const fo = { smooth: (opt.smooth ?? 3) - 1, style: opt.style || 'arc', shapes: opt.shapes !== false, sigK: mode === 'photo' ? 1.15 : 1 };
  const shapes = [];
  let g = 0;
  for (const P of R.paths) {
    const s = fitPath(P, H, fo); if (!s) continue;
    const list = s.t === 'group' ? s.parts.map(q => ({ ...q, len: s.len / s.parts.length })) : [s];
    g++;
    for (const q of list) { q.g = g; if (P.w) q.w = P.w; if (P.outer) q.outer = true; shapes.push(q); }
  }
  mark('fit');
  const st = { mode, auto: an.mode, paths: R.paths.length, ms: Date.now() - t0, tm, W, H, wmed: R.wmed || 0, analysis: { eta: +an.eta.toFixed(3), flat: +an.flat.toFixed(3), frac: +an.frac.toFixed(3), width: +an.width.toFixed(2), uni: +an.uni.toFixed(2), uniInk: +an.uniInk.toFixed(2), sdL: +an.sdL.toFixed(1), sdC: +an.sdC.toFixed(1), contrast: +an.contrast.toFixed(1) } };
  for (const s of shapes) st[s.t] = (st[s.t] || 0) + 1;
  return { W, H, mode, auto: an.mode, shapes, stats: st };
}
// analisis cepat saja (mode otomatis) dari gambar kecil
export function quickAnalyze(rgba, W, H) { const an = analyze(toLab(rgba, W, H), W, H); return { mode: an.mode, eta: an.eta, flat: an.flat, frac: an.frac, width: an.width, uni: an.uni, contrast: an.contrast }; }
