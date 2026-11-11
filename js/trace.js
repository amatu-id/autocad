// Vektorisasi peta Google (gaya "trace"): klasifikasi warna per piksel → kontur marching squares
// → Douglas-Peucker → pelurusan tepi (fit garis kuadrat terkecil) → ortogonalisasi bangunan
// → koreksi offset atap 2.5D (atap digambar Google sedikit ke utara; tapak = atap digeser turun setebal dinding).
// Modul murni (tanpa DOM): dipakai di Web Worker (trace-worker.js) dan di Node untuk pengujian.

export const C = { BG: 0, ROOF: 1, WALL: 2, ROOF2: 3, WALL2: 4, ROAD: 5, WATER: 6, GREEN: 7 };
// Gaya tile untuk tracing: tanpa label, jalan biru murni, air cyan, taman hijau, transit disembunyikan.
export const TRACE_STYLE = 's.e:l|p.v:off,s.t:3|s.e:g|p.c:#ff0000ff,s.t:6|s.e:g|p.c:#ff00ffff,s.t:40|s.e:g|p.c:#ff00ff00,s.t:4|p.v:off';
const NEUTRAL = [
  [C.BG, 'f8f7f7 ffffff f1f3f4 efeff2 f5f5f5 f1f1f1 f4f4f4 f7f7f7'],
  [C.ROOF, 'e9eaef e8e9ed eaebf0 e9e9eb ebedf2 e8e8ec e9ebef e4e7ea e6eaec'],
  [C.WALL, 'dfe1e7 dadae2 dbdbe3 dedee6 dfdfe8 d8dae2 d4d8e5 dfe1e8 dfdfe6 d9d9e6 d3d7e2 dbdbe1 dee0e7 e0e0e8 d9dcdf dadddf d6dae4 e4e4eb d1d8df'],
  [C.ROOF2, 'faf5eb fbf6ec faf5ea fffaef'],
  [C.WALL2, 'f8f3e8 f8f1e8 f6f1e6 f8f3e7 f8f2e7'],
  [C.GREEN, 'a9eac2 aaeac2 a8eac1 c3f1d5 88d3b5 87d2b3 b5eacd'],
  [C.ROAD, 'aab9c9 a1b2c4'],          // warna jalan bawaan (cadangan bila gaya tidak diterapkan)
  [C.WATER, '90daee bfcfdf'],
].flatMap(([k, s]) => s.split(' ').map(h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), k]));

function classifyRGB(r, g, b) {
  // warna jenuh (gaya trace): skor ≈ cakupan anti-alias α; α ≥ 0,5 → kelas tersebut
  const sRoad = b - Math.max(r, g), sWater = Math.min(g, b) - r, sGreen = g - Math.max(r, b);
  let best = C.BG, sc = 0, S = null;
  if (sRoad > sc) { sc = sRoad; best = C.ROAD; S = [0, 0, 255]; }
  if (sWater > sc) { sc = sWater; best = C.WATER; S = [0, 255, 255]; }
  if (sGreen > sc && !(r > 120 && b > 150)) { sc = sGreen; best = C.GREEN; S = [0, 255, 0]; }
  const a = sc / 255;
  if (a >= 0.5) return best;
  if (a > 0.08 && S) { r = (r - a * S[0]) / (1 - a); g = (g - a * S[1]) / (1 - a); b = (b - a * S[2]) / (1 - a); } // lepas campuran tepi
  let k = C.BG, dm = 1e9;
  for (const P of NEUTRAL) { const d = (r - P[0]) ** 2 + (g - P[1]) ** 2 + (b - P[2]) ** 2; if (d < dm) { dm = d; k = P[3]; } }
  return dm > 45 * 45 ? C.BG : k;
}
// LUT 24-bit lazily (255 = belum dihitung)
let LUT = null;
export function classify(rgba, w, h, out, ox = 0, oy = 0, W = w) {
  LUT ||= new Uint8Array(1 << 24).fill(255);
  for (let y = 0; y < h; y++) {
    let i = y * w * 4, o = (oy + y) * W + ox;
    for (let x = 0; x < w; x++, i += 4, o++) {
      if (rgba[i + 3] < 128) { out[o] = C.BG; continue; }
      const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
      let k = LUT[key];
      if (k === 255) k = LUT[key] = classifyRGB(rgba[i], rgba[i + 1], rgba[i + 2]);
      out[o] = k;
    }
  }
}

// ---------- Kontur: marching squares pada mask biner (4-konektivitas foreground) ----------
// Titik kontur dalam koordinat piksel asli (pusat piksel (u,v) = (u+0.5, v+0.5)). Luar = luas positif, lubang = negatif.
const T = 0, R = 1, B = 2, L = 3;
const EXIT = new Int8Array(16 * 4).fill(-1);
[[1, L, B], [2, B, R], [3, L, R], [4, R, T], [5, R, T], [5, L, B], [6, B, T], [7, L, T], [8, T, L], [9, T, B], [10, T, L], [10, B, R], [11, T, R], [12, R, L], [13, R, B], [14, B, L]]
  .forEach(([c, a, b]) => { EXIT[c * 4 + a] = b; });

export function contours(mask, W, H, onBottom) {
  const PW = W + 2, PH = H + 2, P = new Uint8Array(PW * PH);
  for (let y = 0; y < H; y++) P.set(mask.subarray(y * W, y * W + W), (y + 1) * PW + 1);
  const vis = new Uint8Array(PW * PH); // bit1 = tepi H dikunjungi, bit2 = tepi V
  const out = [];
  for (let y = 1; y <= H; y++) {
    for (let x = 0; x <= W; x++) {
      const i = y * PW + x, a = P[i], b = P[i + 1];
      if (a === b || (vis[i] & 1)) continue;
      let cx = x, cy = y, e = T;
      if (!a) { cy = y - 1; e = B; }
      const sx = cx, sy = cy, se = e, pts = [];
      let samples = onBottom ? [] : null;
      for (let guard = 0; guard < 4e7; guard++) {
        const j = cy * PW + cx;
        const c = (P[j] << 3) | (P[j + 1] << 2) | (P[j + PW + 1] << 1) | P[j + PW];
        const ex = EXIT[c * 4 + e];
        if (ex < 0) break; // tidak mungkin pada mask valid
        if (ex === T) { vis[j] |= 1; pts.push(cx, cy - 0.5); cy--; e = B; }
        else if (ex === B) { vis[j + PW] |= 1; pts.push(cx, cy + 0.5); cy++; e = T; }
        else if (ex === L) {
          vis[j] |= 2; pts.push(cx - 0.5, cy);
          if (samples && P[j] && !P[j + PW]) samples.push(cx - 1, cy); // tepi bawah atap: piksel (u=cx-1, v=cy) di bawahnya
          cx--; e = R;
        } else {
          vis[j + 1] |= 2; pts.push(cx + 0.5, cy);
          if (samples && P[j + 1] && !P[j + PW + 1]) samples.push(cx, cy);
          cx++; e = L;
        }
        if (cx === sx && cy === sy && e === se) break;
      }
      if (pts.length >= 6) out.push({ pts, area: signedArea(pts), bottom: samples });
    }
  }
  return out;
}
export function signedArea(p) { let s = 0; const n = p.length; for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; s += p[i] * p[j + 1] - p[j] * p[i + 1]; } return s / 2; }

// ---------- Douglas–Peucker pada poligon tertutup → indeks verteks ----------
export function dpClosed(p, eps) {
  const n = p.length / 2; if (n <= 3) return [...Array(n).keys()];
  let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = (p[2 * i] - p[0]) ** 2 + (p[2 * i + 1] - p[1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n + 1); keep[0] = keep[far] = keep[n] = 1;
  const X = i => p[2 * (i % n)], Y = i => p[2 * (i % n) + 1];
  const st = [[0, far], [far, n]], e2 = eps * eps;
  while (st.length) {
    const [a, b] = st.pop(); if (b - a < 2) continue;
    const ax = X(a), ay = Y(a), dx = X(b) - ax, dy = Y(b) - ay, L2 = dx * dx + dy * dy;
    let mi = -1, md = -1;
    for (let i = a + 1; i < b; i++) {
      const px = X(i) - ax, py = Y(i) - ay;
      const d = L2 > 1e-12 ? (px * dy - py * dx) ** 2 / L2 : px * px + py * py;
      if (d > md) { md = d; mi = i; }
    }
    if (md > e2) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  const idx = []; for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  return idx;
}

// ---------- Fit garis + ortogonalisasi ----------
function fitLine(p, n, a, b, skip) { // titik kontur indeks a..b (melingkar), buang `skip` di tiap ujung
  let len = b - a; if (len < 0) len += n;
  let s = Math.min(skip, Math.floor((len - 1) / 3));
  if (s < 0) s = 0;
  let sx = 0, sy = 0, m = 0;
  for (let k = s; k <= len - s; k++) { const i = (a + k) % n; sx += p[2 * i]; sy += p[2 * i + 1]; m++; }
  if (m < 2) return null;
  const mx = sx / m, my = sy / m; let xx = 0, yy = 0, xy = 0;
  for (let k = s; k <= len - s; k++) { const i = (a + k) % n, dx = p[2 * i] - mx, dy = p[2 * i + 1] - my; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { mx, my, th, m, a, b, len };
}
const inter = (A, Bn) => { // perpotongan dua garis (titik + sudut)
  const c1 = Math.cos(A.th), s1 = Math.sin(A.th), c2 = Math.cos(Bn.th), s2 = Math.sin(Bn.th), den = c1 * s2 - s1 * c2;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((Bn.mx - A.mx) * s2 - (Bn.my - A.my) * c2) / den;
  return [A.mx + c1 * t, A.my + s1 * t];
};
// Pelurusan poligon: kembalikan array titik datar [x0,y0,...]
const DEG = Math.PI / 180;
const proj = (f, x, y) => { const c = Math.cos(f.th), s = Math.sin(f.th), t = (x - f.mx) * c + (y - f.my) * s; return [f.mx + c * t, f.my + s * t]; };
const lineDist = (f, x, y) => Math.abs(-(x - f.mx) * Math.sin(f.th) + (y - f.my) * Math.cos(f.th));
export function refinePoly(p, eps, ortho, snapDeg = 12, jog = 1.5) {
  const n = p.length / 2;
  const idx = dpClosed(p, eps);
  if (idx.length < 3) return null;
  const fitEdge = j => {
    const a = idx[j], b = idx[(j + 1) % idx.length];
    const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b], by = p[2 * b + 1], dir = Math.atan2(by - ay, bx - ax);
    let f = fitLine(p, n, a, b, 2);
    if (!f || f.m < 4) f = { mx: (ax + bx) / 2, my: (ay + by) / 2, th: dir, m: 2 };
    if (Math.cos(f.th - dir) < 0) f.th += Math.PI;
    f.L = Math.hypot(bx - ax, by - ay); return f;
  };
  let lines = idx.map((_, j) => fitEdge(j));
  // 1) gabungkan tepi berurutan yang segaris (patahan akibat derau anti-alias), bukan tonjolan nyata
  for (let guard = 0; guard < 2000 && idx.length > 3; guard++) {
    let best = -1, bd = Infinity;
    for (let j = 0; j < lines.length; j++) {
      const A = lines[j], Bn = lines[(j + 1) % lines.length], s = Math.abs(Math.sin(Bn.th - A.th));
      if (Math.cos(Bn.th - A.th) <= 0 || s > Math.sin(8 * DEG)) continue;
      if (Math.max(lineDist(A, Bn.mx, Bn.my), lineDist(Bn, A.mx, A.my)) > Math.max(1.2, eps * 1.4)) continue;
      if (s < bd) { bd = s; best = j; }
    }
    if (best < 0) break;
    const k = idx.length, rm = (best + 1) % k;
    idx.splice(rm, 1); lines.splice(rm, 1);
    const j0 = rm === 0 ? idx.length - 1 : rm - 1; lines[j0] = fitEdge(j0);
  }
  // 2) ortogonalisasi: arah dominan (rata-rata sudut ×4 berbobot panjang), tepi ±snapDeg diluruskan 0°/90°
  if (ortho) {
    let sx = 0, sy = 0; for (const f of lines) { sx += f.L * Math.sin(4 * f.th); sy += f.L * Math.cos(4 * f.th); }
    const dom = Math.atan2(sx, sy) / 4, tol = snapDeg * DEG;
    for (const f of lines) { let d = f.th - dom; d -= Math.round(d / (Math.PI / 2)) * (Math.PI / 2); if (Math.abs(d) < tol) { f.th -= d; f.snap = 1; } }
    // 2b) tepi tersnap yang kini sejajar & bergeser < jog → satu garis (tangga semu akibat derau, bukan tonjolan nyata)
    for (let guard = 0; guard < 2000 && idx.length > 3; guard++) {
      let best = -1, bo = Infinity;
      for (let j = 0; j < lines.length; j++) {
        const A = lines[j], Bn = lines[(j + 1) % lines.length];
        if (!A.snap || !Bn.snap || Math.abs(Math.sin(Bn.th - A.th)) > 1e-6 || Math.cos(Bn.th - A.th) < 0) continue;
        const off = lineDist(A, Bn.mx, Bn.my); if (off < jog && off < bo) { bo = off; best = j; }
      }
      if (best < 0) break;
      const k = idx.length, rm = (best + 1) % k, th = lines[best].th;
      idx.splice(rm, 1); lines.splice(rm, 1);
      const j0 = rm === 0 ? idx.length - 1 : rm - 1; lines[j0] = fitEdge(j0); lines[j0].th = th; lines[j0].snap = 1;
    }
  }
  // 3) verteks = perpotongan garis berurutan (sub-piksel); garis sejajar bertingkat → tambah tangga kecil
  const out = [], k = lines.length;
  for (let j = 0; j < k; j++) {
    const A = lines[(j - 1 + k) % k], Bn = lines[j], vi = idx[j], vx = p[2 * vi], vy = p[2 * vi + 1];
    const lim = Math.min(Math.max(3, 3 * eps), Math.max(1.5, 0.45 * Math.min(A.L, Bn.L))); // titik sudut hasil fit tak boleh jauh dari kontur
    if (Math.abs(Math.sin(Bn.th - A.th)) < 0.02) {
      const qa = proj(A, vx, vy), qb = proj(Bn, vx, vy);
      if (Math.hypot(qa[0] - qb[0], qa[1] - qb[1]) < 0.75) out.push((qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2); else out.push(...qa, ...qb);
      continue;
    }
    let q = inter(A, Bn);
    if (!q || Math.hypot(q[0] - vx, q[1] - vy) > lim) { const G = A.L >= Bn.L ? A : Bn, pq = proj(G, vx, vy); q = Math.hypot(pq[0] - vx, pq[1] - vy) < lim ? pq : [vx, vy]; }
    out.push(q[0], q[1]);
  }
  return cleanPoly(out);
}
export function cleanPoly(p) { // buang titik ganda & kolinear
  let pts = []; for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  for (let pass = 0; pass < 3 && pts.length > 3; pass++) {
    const o = [];
    for (let i = 0; i < pts.length; i++) {
      const a = o.length ? o[o.length - 1] : pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const abx = b[0] - a[0], aby = b[1] - a[1], bcx = c[0] - b[0], bcy = c[1] - b[1];
      const lab = Math.hypot(abx, aby), lbc = Math.hypot(bcx, bcy);
      if (lab < 0.05) continue;
      if (lab > 0 && lbc > 0 && (abx * bcx + aby * bcy) / (lab * lbc) < -0.96) continue; // paku (balik arah)
      if (lab > 0 && lbc > 0 && Math.abs(abx * bcy - aby * bcx) / (lab * lbc) < 0.012 && abx * bcx + aby * bcy > 0) continue;
      o.push(b);
    }
    if (o.length < 3) break;
    pts = o;
  }
  return pts.length >= 3 ? pts.flat() : null;
}

// ---------- Pemotongan polyline/poligon terhadap persegi (Liang–Barsky) ----------
export function clipRuns(p, closed, r) {
  const n = p.length / 2, inside = (x, y) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
  let allIn = true; for (let i = 0; i < n; i++) if (!inside(p[2 * i], p[2 * i + 1])) { allIn = false; break; }
  if (allIn) return [{ pts: p, closed }];
  const runs = []; let cur = null;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const x0 = p[2 * i], y0 = p[2 * i + 1], j = (i + 1) % n, x1 = p[2 * j], y1 = p[2 * j + 1];
    let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
    const clipT = (pp, q) => { if (Math.abs(pp) < 1e-12) return q >= 0; const t = q / pp; if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
    if (!(clipT(-dx, x0 - r.x1) && clipT(dx, r.x2 - x0) && clipT(-dy, y0 - r.y1) && clipT(dy, r.y2 - y0))) { if (cur) { runs.push(cur); cur = null; } continue; }
    const ax = x0 + dx * t0, ay = y0 + dy * t0, bx = x0 + dx * t1, by = y0 + dy * t1;
    if (!cur || t0 > 1e-9) { if (cur) runs.push(cur); cur = [ax, ay]; }
    cur.push(bx, by);
    if (t1 < 1 - 1e-9) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  // gabungkan run terakhir & pertama bila bersambung (poligon tertutup)
  if (closed && runs.length > 1) { const a = runs[0], z = runs[runs.length - 1]; if (Math.abs(z[z.length - 2] - a[0]) < 1e-9 && Math.abs(z[z.length - 1] - a[1]) < 1e-9) { runs[0] = z.concat(a.slice(2)); runs.pop(); } }
  return runs.filter(q => q.length >= 4).map(q => ({ pts: q, closed: false }));
}

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
// Opening biner 3×3 (erosi lalu dilatasi, separabel): buang serpih ≤ 2 px — campuran anti-alias garis tepi + latar
// berwarna persis seperti atap; tepi lurus tidak bergeser.
export function open3(m, W, H) {
  const t = new Uint8Array(m.length);
  for (let y = 0; y < H; y++) { const o = y * W; t[o] = 0; t[o + W - 1] = 0; for (let x = 1; x < W - 1; x++) t[o + x] = m[o + x - 1] & m[o + x] & m[o + x + 1]; }
  m.fill(0, 0, W); m.fill(0, (H - 1) * W);
  for (let y = 1; y < H - 1; y++) { const o = y * W; for (let x = 0; x < W; x++) m[o + x] = t[o - W + x] & t[o + x] & t[o + W + x]; }
  for (let y = 0; y < H; y++) { const o = y * W; t[o] = m[o] | m[o + 1]; t[o + W - 1] = m[o + W - 1] | m[o + W - 2]; for (let x = 1; x < W - 1; x++) t[o + x] = m[o + x - 1] | m[o + x] | m[o + x + 1]; }
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) m[o + x] = t[o + x] | (y > 0 ? t[o - W + x] : 0) | (y < H - 1 ? t[o + W + x] : 0); }
  return m;
}

// ---------- Jalur utama ----------
// cls: Uint8Array W×H hasil classify(). opt: { gsd (m/px), clip {x1,y1,x2,y2} px, want {bld, road, water, green}, ortho, eps }
export function traceClasses(cls, W, H, opt = {}) {
  const g = opt.gsd || 0.1, px2 = g * g, want = opt.want || { bld: 1, road: 1, water: 1, green: 1 };
  const eps = opt.eps ?? Math.max(0.6, 0.05 / g), epsB = opt.epsB ?? Math.max(1, 0.07 / g), clip = opt.clip || { x1: 0, y1: 0, x2: W, y2: H };
  const mask = new Uint8Array(W * H), out = [], stats = {};
  const make = test => { for (let i = 0; i < cls.length; i++) mask[i] = test(cls[i]) ? 1 : 0; return mask; };
  const wallRun = (u, v) => { let t = 0; while (v + t < H && t < 80) { const k = cls[(v + t) * W + u]; if (k === C.WALL || k === C.WALL2) t++; else break; } return t; };
  const jobs = [];
  if (want.bld) jobs.push(['bld', k => k === C.ROOF, 3], ['bld2', k => k === C.ROOF2, 3]);
  if (want.road) jobs.push(['road', k => k === C.ROAD, 4]);
  if (want.water) jobs.push(['water', k => k === C.WATER, 4]);
  if (want.green) jobs.push(['green', k => k === C.GREEN, 10]);
  const allT = [];
  for (const [name, test, minM2] of jobs) {
    const isB = name.startsWith('bld');
    make(test); if (isB || name === 'green') open3(mask, W, H);
    const cs = contours(mask, W, H, isB && opt.wallShift);
    let n = 0;
    const polys = [];
    for (const c of cs) {
      const am2 = Math.abs(c.area) * px2;
      if (am2 < (c.area < 0 ? minM2 * 0.6 : minM2)) continue;
      let t = 0;
      if (isB && c.bottom) {
        const s = []; for (let i = 0; i < c.bottom.length; i += 2) s.push(wallRun(c.bottom[i], c.bottom[i + 1]));
        const pos = s.filter(v => v > 0);
        c.tSamples = pos.length; c.tFrac = s.length ? pos.length / s.length : 0;
        t = pos.length >= 3 && c.tFrac >= 0.35 ? median(pos) : null;
        if (t != null) allT.push(t);
      }
      polys.push({ c, t });
    }
    const tGlobal = median(allT);
    for (const { c, t } of polys) {
      let pts = isB ? refinePoly(c.pts, epsB, opt.ortho !== false, 12, Math.max(1.5, 0.1 / g)) : null;
      if (!isB) { const idx = dpClosed(c.pts, eps); pts = idx.length >= 3 ? cleanPoly(idx.flatMap(i => [c.pts[2 * i], c.pts[2 * i + 1]])) : null; }
      if (isB && pts) { // pengaman: hasil pelurusan harus tetap mirip kontur aslinya
        const r = Math.abs(signedArea(pts)) / Math.abs(c.area);
        if (r < 0.88 || r > 1.12) { const idx = dpClosed(c.pts, epsB); pts = idx.length >= 3 ? cleanPoly(idx.flatMap(i => [c.pts[2 * i], c.pts[2 * i + 1]])) : null; }
      }
      if (!pts) continue;
      if (isB) {
        const dy = opt.wallShift ? (t ?? tGlobal) : 0; // default: atap = geometri asli Google (terverifikasi vs foto satelit & zoom 18)
        if (dy) for (let i = 1; i < pts.length; i += 2) pts[i] += dy;
        // bangunan: simpan utuh bila titik beratnya di dalam area
        let sx = 0, sy = 0; for (let i = 0; i < pts.length; i += 2) { sx += pts[i]; sy += pts[i + 1]; }
        const cx = sx / (pts.length / 2), cy = sy / (pts.length / 2);
        if (cx < clip.x1 || cx > clip.x2 || cy < clip.y1 || cy > clip.y2) continue;
        out.push({ k: name, hole: c.area < 0, closed: true, pts, area: Math.abs(signedArea(pts)) * px2 }); n++;
      } else {
        for (const r of clipRuns(pts, true, clip)) { out.push({ k: name, hole: c.area < 0, closed: r.closed, pts: r.pts }); n++; }
      }
    }
    stats[name] = n;
  }
  stats.wallPx = median(allT);
  return { polys: out, stats };
}
