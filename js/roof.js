// Klik atap → garis bangunan dari foto satelit (perintah ATAP). Modul murni (tanpa DOM): dipakai di editor & Node.
// Region growing dari titik klik dalam ruang warna lawan (L, a = R−G, b = (R+G)/2 − B) dengan bobot terang kecil,
// jadi sisi atap yang terang & yang gelap (atap perisai/pelana) tetap satu atap, sedangkan halaman/jalan/bayangan
// (beda krominans) tidak ikut. Toleransi diturunkan bertahap; tiap hasil di-"opening" (memutus sambungan tipis ke
// halaman), lubang diisi, lalu dinilai: luas wajar, persegi (rectangularity) & padat (solidity), tidak menyentuh tepi
// jendela. Kandidat lolos dengan toleransi terbesar = seluruh atap sebelum bocor. Kontur → pelurusan + ortogonal.
import { contours, refinePoly, cleanPoly, dpClosed, signedArea } from './trace.js';

const WL = 0.35; // bobot terang relatif kromatisitas
// blur kotak separabel (jumlah geser), r piksel, di tempat
function boxBlur(C, W, H, r) {
  const T = new Float32Array(C.length), k = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W; let s = 0;
    for (let x = -r; x <= r; x++) s += C[o + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) { T[o + x] = s / k; s += C[o + Math.min(W - 1, x + r + 1)] - C[o + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += T[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) { C[y * W + x] = s / k; s += T[Math.min(H - 1, y + r + 1) * W + x] - T[Math.max(0, y - r) * W + x]; }
  }
}
function grow(L, A, B, W, H, seed, mu, tol, maxPx) {
  const m = new Uint8Array(W * H), q = new Int32Array(W * H), t2 = tol * tol;
  let qh = 0, qt = 0;
  const ok = i => { const dl = (L[i] - mu[0]) * WL, da = A[i] - mu[1], db = B[i] - mu[2]; return dl * dl + da * da + db * db <= t2; };
  m[seed] = 1; q[qt++] = seed;
  while (qh < qt) {
    const i = q[qh++], x = i % W;
    const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
    for (const j of nb) if (j >= 0 && !m[j] && ok(j)) { m[j] = 1; q[qt++] = j; if (qt > maxPx) return { m, over: true }; }
  }
  return { m, over: false };
}
// morfologi biner kotak (2r+1) separabel lewat jumlah prefiks; erode = semua 1, dilate = ada 1
function morph(m, W, H, r, dil) {
  const T = new Uint8Array(m.length), S = new Int32Array(Math.max(W, H) + 1), k = 2 * r + 1;
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) S[x + 1] = S[x] + m[o + x]; for (let x = 0; x < W; x++) { const s = S[Math.min(W, x + r + 1)] - S[Math.max(0, x - r)]; T[o + x] = dil ? (s > 0 ? 1 : 0) : (s === k ? 1 : 0); } }
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) S[y + 1] = S[y] + T[y * W + x]; for (let y = 0; y < H; y++) { const s = S[Math.min(H, y + r + 1)] - S[Math.max(0, y - r)]; m[y * W + x] = dil ? (s > 0 ? 1 : 0) : (s === k ? 1 : 0); } }
  return m;
}
// komponen 4-terhubung yang memuat (sx, sy) (atau piksel terdekat dalam radius rr)
function component(m, W, H, sx, sy, rr) {
  let s = -1, bd = Infinity;
  for (let y = Math.max(0, sy - rr); y <= Math.min(H - 1, sy + rr); y++) for (let x = Math.max(0, sx - rr); x <= Math.min(W - 1, sx + rr); x++) { const d = (x - sx) ** 2 + (y - sy) ** 2; if (m[y * W + x] && d < bd) { bd = d; s = y * W + x; } }
  if (s < 0) return null;
  const c = new Uint8Array(m.length), q = new Int32Array(m.length); let qh = 0, qt = 0; c[s] = 1; q[qt++] = s;
  while (qh < qt) { const i = q[qh++], x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1]) if (j >= 0 && m[j] && !c[j]) { c[j] = 1; q[qt++] = j; } }
  return c;
}
function fillHoles(m, W, H) { // latar yang tak terjangkau dari tepi = lubang
  const out = new Uint8Array(m.length), q = new Int32Array(m.length); let qh = 0, qt = 0;
  const push = i => { if (!m[i] && !out[i]) { out[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (qh < qt) { const i = q[qh++], x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < W * (H - 1)) push(i + W); }
  for (let i = 0; i < m.length; i++) if (!out[i]) m[i] = 1;
  return m;
}
function hull(p) { // rantai monoton
  const P = []; for (let i = 0; i < p.length; i += 2) P.push([p[i], p[i + 1]]); P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = P.length - 1; i >= 0; i--) { const q = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function minRect(h) { // persegi panjang pembungkus terkecil (rotating calipers sederhana) → { area, ux, uy }
  let best = { area: Infinity, ux: 1, uy: 0 };
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-9) continue;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of h) { const u = q[0] * ux + q[1] * uy, v = -q[0] * uy + q[1] * ux; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const ar = (u1 - u0) * (v1 - v0); if (ar < best.area) best = { area: ar, ux, uy };
  }
  return best;
}
// persegi panjang kokoh searah (ux, uy): tiap sisi = median titik kontur yang berada ≤ d dari sisi terluarnya
// (sudut yang membulat / tonjolan kecil tidak menggeser sisi)
function robustRect(p, ux, uy, d) {
  const U = [], V = []; for (let i = 0; i < p.length; i += 2) { U.push(p[i] * ux + p[i + 1] * uy); V.push(-p[i] * uy + p[i + 1] * ux); }
  const side = (A, hi) => { let ext = hi ? -Infinity : Infinity; for (const a of A) ext = hi ? Math.max(ext, a) : Math.min(ext, a); const s = A.filter(a => hi ? a > ext - d : a < ext + d).sort((x, y) => x - y); return s[s.length >> 1]; };
  const u0 = side(U, false), u1 = side(U, true), v0 = side(V, false), v1 = side(V, true), P = (u, v) => [u * ux - v * uy, u * uy + v * ux];
  return [...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v1)];
}

// sudut atap tajam: sisi pendek (< minLen) di antara dua sisi yang hampir tegak lurus → titik potong kedua sisi itu
// (sudut sempat membulat oleh blur / opening)
function squareCorners(p, minLen) {
  let P = []; for (let i = 0; i < p.length; i += 2) P.push([p[i], p[i + 1]]);
  for (let guard = 0; guard < 50 && P.length > 4; guard++) {
    let done = true;
    for (let i = 0; i < P.length && P.length > 4; i++) {
      const n = P.length, a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n];
      if (Math.hypot(c[0] - b[0], c[1] - b[1]) >= minLen) continue;
      const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - c[0], d[1] - c[1]], lu = Math.hypot(...u), lv = Math.hypot(...v);
      if (lu < minLen || lv < minLen) continue;
      const den = u[0] * v[1] - u[1] * v[0]; if (Math.abs(den) / (lu * lv) < 0.5) continue; // sejajar = tangga nyata
      const t = ((c[0] - a[0]) * v[1] - (c[1] - a[1]) * v[0]) / den, X = [a[0] + u[0] * t, a[1] + u[1] * t];
      if (Math.hypot(X[0] - (b[0] + c[0]) / 2, X[1] - (b[1] + c[1]) / 2) > 1.5 * minLen) continue;
      P.splice(i, 1, X); P.splice((P.indexOf(c) + P.length) % P.length, 1); done = false; break;
    }
    if (done) break;
  }
  return P.flat();
}

// rgba: piksel jendela W×H; (sx, sy): titik klik; gsd: m/piksel.
// Hasil { cands: [{ pts:[x,y,…] px jendela, area m², tol, rect, solid, touch }] (urut toleransi besar → kecil), pick: indeks pilihan } atau { err }
export function traceRoof(rgba, W, H, sx, sy, gsd, opt = {}) {
  // kromatisitas ternormalisasi (tak berubah oleh terang/gelap: sisi atap yang tersinar & yang teduh tetap sama);
  // +30 meredam derau krominans di piksel gelap (bayangan)
  const N = W * H, L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) { const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2], k = 300 / (r + g + b + 30); L[i] = 0.299 * r + 0.587 * g + 0.114 * b; A[i] = (r - g) * k; B[i] = (0.5 * (r + g) - b) * k; }
  const br = Math.max(1, Math.round(0.12 / gsd)); // ±12 cm: haluskan tekstur genteng & derau JPEG
  for (const C of [L, A, B]) boxBlur(C, W, H, br);
  sx = Math.round(sx); sy = Math.round(sy);
  if (sx < 2 || sy < 2 || sx >= W - 2 || sy >= H - 2) return { err: 'titik di luar foto' };
  const rs = Math.max(2, Math.round(0.3 / gsd)), V = [[], [], []]; // warna acuan: median ±30 cm di sekitar klik
  for (let y = sy - rs; y <= sy + rs; y++) for (let x = sx - rs; x <= sx + rs; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = y * W + x; V[0].push(L[i]); V[1].push(A[i]); V[2].push(B[i]); }
  const mu = V.map(a => { const s = [...a].sort((u, v) => u - v); return s[s.length >> 1]; });
  let sd = 0; for (let k = 0; k < V[0].length; k++) { const dl = (V[0][k] - mu[0]) * WL, da = V[1][k] - mu[1], db = V[2][k] - mu[2]; sd += dl * dl + da * da + db * db; } sd = Math.sqrt(sd / V[0].length);
  const px2 = gsd * gsd, minPx = (opt.minArea ?? 5) / px2, maxPx = Math.min(N * 0.6, (opt.maxArea ?? 5000) / px2);
  const base = Math.max(8, Math.min(24, 6 + 2.2 * sd)), ro = Math.max(1, Math.round((opt.open ?? 0.3) / gsd)), rc = Math.max(1, Math.round(0.4 / gsd));
  const fr = opt.free || {}; // sisi jendela yang merupakan tepi foto {l,t,r,b}
  // tepi atap di foto bergerigi (lisplang, bayangan, JPEG): luruskan dengan toleransi ±25 cm, tangga < 50 cm digabung
  const eps = Math.max(2, (opt.eps ?? 0.25) / gsd), jog = Math.max(3, (opt.jog ?? 0.5) / gsd);
  const cands = [];
  let prevN = -1;
  for (const f of [2.6, 2.2, 1.85, 1.55, 1.3, 1.1, 0.92, 0.78, 0.66, 0.56]) {
    const tol = base * f, g = grow(L, A, B, W, H, sy * W + sx, mu, tol, maxPx);
    if (g.over) continue; // bocor ke area sangat luas
    const m = component(morph(morph(g.m, W, H, ro, false), W, H, ro, true), W, H, sx, sy, 2 * ro);
    if (!m) continue;
    fillHoles(m, W, H);
    morph(morph(m, W, H, rc, true), W, H, rc, false); // closing ±40 cm: ratakan gerigi kecil di tepi atap
    // touch: menyentuh sisi jendela yang BUKAN tepi foto (atap mungkin berlanjut di luar jendela → perbesar jendela)
    let n = 0, touch = false;
    for (let i = 0; i < N; i++) if (m[i]) { n++; const x = i % W, y = (i / W) | 0; if ((x < 2 && !fr.l) || (y < 2 && !fr.t) || (x >= W - 2 && !fr.r) || (y >= H - 2 && !fr.b)) touch = true; }
    if (n < minPx || n > maxPx || n === prevN) continue; // terlalu kecil / besar / sama dengan kandidat sebelumnya
    prevN = n;
    const cs = contours(m, W, H).filter(c => c.area > 0).sort((a, b) => b.area - a.area); if (!cs.length) continue;
    const c = cs[0], h = hull(c.pts), hA = Math.abs(signedArea(h.flat())), mr = minRect(h), rect = c.area / mr.area, solid = c.area / hA;
    let pts = null;
    if (rect >= 0.86) { // hampir persegi panjang → persegi panjang kokoh (4 titik, siku)
      pts = robustRect(c.pts, mr.ux, mr.uy, Math.max(4, 0.6 / gsd));
      const r = Math.abs(signedArea(pts)) / c.area; if (r < 0.9 || r > 1.15) pts = null;
    }
    if (!pts) {
      pts = refinePoly(c.pts, eps, true, 12, jog);
      if (pts) { const r = Math.abs(signedArea(pts)) / c.area; if (r < 0.85 || r > 1.15) pts = null; }
      if (!pts) { const idx = dpClosed(c.pts, eps); pts = idx.length >= 3 ? cleanPoly(idx.flatMap(i => [c.pts[2 * i], c.pts[2 * i + 1]])) : null; }
      if (!pts) continue;
      pts = squareCorners(pts, Math.max(4, 0.8 / gsd));
    }
    cands.push({ pts, area: c.area * px2, tol, rect, solid, touch });
  }
  if (!cands.length) return { err: 'atap tidak terdeteksi (warna atap terlalu mirip sekitarnya)' };
  // pilih yang paling "seperti bangunan": persegi × padat, sedikit memihak yang lebih luas (seluruh atap, bukan satu sisi);
  // yang bocor (tidak persegi/padat) atau terpotong jendela kalah
  let pick = 0, bs = -1;
  cands.forEach((k, i) => { const s = (k.touch ? 0.3 : 1) * (k.rect >= 0.6 && k.solid >= 0.78 ? 1 : 0.5) * k.rect * k.solid * Math.pow(k.area, 0.15); if (s > bs) { bs = s; pick = i; } });
  return { cands, pick, seedSd: sd };
}
