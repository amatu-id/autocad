// Penyelarasan jejak bangunan ke foto satelit: tepi poligon ditarik ke tepi atap yang terlihat di foto
// (gradien warna searah normal sisi), tanpa merusak bentuk: geser global → geser + putar kecil per bangunan
// → geser tiap sisi sejajar dirinya. Perubahan hanya diterima bila kecocokan tepi naik nyata.
// Lalu duplikat / tumpang tindih dibersihkan (rasterisasi). Modul murni (tanpa DOM): dipakai di Web Worker & Node.

const CAP = 255;
// Gradien Sobel per piksel dari kanal (R/G/B) dengan gradien terbesar, bertanda → Int16 gx, gy.
// wins: [{x0,y0,x1,y1}] area yang perlu; hanya blok 64 px yang tersentuh yang dihitung (hemat waktu & memori).
export function gradField(rgba, W, H, wins) {
  const gx = new Int16Array(W * H), gy = new Int16Array(W * H), BS = 64, bw = Math.ceil(W / BS), bh = Math.ceil(H / BS), need = new Uint8Array(bw * bh);
  if (wins) for (const r of wins) {
    const bx0 = Math.max(0, Math.floor(r.x0 / BS)), bx1 = Math.min(bw - 1, Math.floor(r.x1 / BS)), by0 = Math.max(0, Math.floor(r.y0 / BS)), by1 = Math.min(bh - 1, Math.floor(r.y1 / BS));
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) need[by * bw + bx] = 1;
  } else need.fill(1);
  const R4 = W * 4;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    if (!need[by * bw + bx]) continue;
    const ya = Math.max(1, by * BS), yb = Math.min(H - 1, by * BS + BS), xa = Math.max(1, bx * BS), xb = Math.min(W - 1, bx * BS + BS);
    for (let y = ya; y < yb; y++) {
      for (let x = xa, i = y * W + xa, p = i * 4; x < xb; x++, i++, p += 4) {
        let best = -1, sx = 0, sy = 0;
        for (let c = 0; c < 3; c++) {
          const q = p + c, a00 = rgba[q - R4 - 4], a01 = rgba[q - R4], a02 = rgba[q - R4 + 4], a10 = rgba[q - 4], a12 = rgba[q + 4], a20 = rgba[q + R4 - 4], a21 = rgba[q + R4], a22 = rgba[q + R4 + 4];
          const hx = a02 + 2 * a12 + a22 - a00 - 2 * a10 - a20, hy = a20 + 2 * a21 + a22 - a00 - 2 * a01 - a02, m = hx * hx + hy * hy;
          if (m > best) { best = m; sx = hx; sy = hy; }
        }
        gx[i] = sx; gy[i] = sy;
      }
    }
  }
  return { gx, gy, W, H };
}
// respons tepi |g·n| (bilinear atas nilai absolut, dibatasi CAP)
function resp(F, x, y, nx, ny) {
  const x0 = Math.floor(x), y0 = Math.floor(y), W = F.W;
  if (x0 < 1 || y0 < 1 || x0 >= W - 2 || y0 >= F.H - 2) return 0;
  const fx = x - x0, fy = y - y0, i = y0 * W + x0, gx = F.gx, gy = F.gy;
  const r00 = Math.abs(gx[i] * nx + gy[i] * ny), r01 = Math.abs(gx[i + 1] * nx + gy[i + 1] * ny), r10 = Math.abs(gx[i + W] * nx + gy[i + W] * ny), r11 = Math.abs(gx[i + W + 1] * nx + gy[i + W + 1] * ny);
  const v = (r00 + (r01 - r00) * fx) * (1 - fy) + (r10 + (r11 - r10) * fx) * fy;
  return v > CAP ? CAP : v;
}
// sisi poligon relatif titik berat: titik sampel (jarak ~1,5 px, 12 % tiap ujung dibuang) + normal
function prep(pts, open = false) {
  const n = pts.length / 2; let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += pts[2 * i]; cy += pts[2 * i + 1]; } cx /= n; cy /= n;
  const E = [];
  for (let i = 0; i < (open ? n - 1 : n); i++) {
    const j = (i + 1) % n, ax = pts[2 * i] - cx, ay = pts[2 * i + 1] - cy, bx = pts[2 * j] - cx, by = pts[2 * j + 1] - cy, L = Math.hypot(bx - ax, by - ay);
    const dx = L ? (bx - ax) / L : 1, dy = L ? (by - ay) / L : 0, m = L >= 5 ? Math.max(2, Math.floor(L * 0.76 / 1.5)) : 0, s = [];
    for (let k = 0; k < m; k++) { const t = L * (0.12 + 0.76 * (k + 0.5) / m); s.push(ax + dx * t, ay + dy * t); }
    E.push({ ax, ay, dx, dy, nx: dy, ny: -dx, L, s, w: m });
  }
  return { cx, cy, E, W: E.reduce((a, e) => a + e.w, 0) };
}
// profil rata-rata respons tiap sisi untuk offset normal t = -T … T (langkah h) setelah rotasi th & geser (ox, oy)
function profiles(F, P, th, ox, oy, T, h) {
  const c = Math.cos(th), s = Math.sin(th), K = Math.round(2 * T / h) + 1, out = [];
  for (const e of P.E) {
    const f = new Float32Array(K), nx = c * e.nx - s * e.ny, ny = s * e.nx + c * e.ny;
    if (e.w) {
      for (let q = 0; q < e.s.length; q += 2) {
        const bx = P.cx + ox + c * e.s[q] - s * e.s[q + 1], by = P.cy + oy + s * e.s[q] + c * e.s[q + 1];
        for (let k = 0; k < K; k++) { const t = -T + k * h; f[k] += resp(F, bx + nx * t, by + ny * t, nx, ny); }
      }
      for (let k = 0; k < K; k++) f[k] /= e.w;
    }
    out.push({ f, nx, ny, w: e.w });
  }
  return { pr: out, T, h, K };
}
const at = (Pr, e, t) => { const u = (t + Pr.T) / Pr.h, k = Math.floor(u); if (k < 0 || k >= Pr.K - 1) return 0; const f = Pr.pr[e].f; return f[k] + (f[k + 1] - f[k]) * (u - k); };
const rigidScore = (Pr, dx, dy, W) => { let S = 0; for (let e = 0; e < Pr.pr.length; e++) { const p = Pr.pr[e]; if (p.w) S += p.w * at(Pr, e, dx * p.nx + dy * p.ny); } return S / W; };
// poligon dari garis sisi (arah hasil rotasi, offset t per sisi)
function rebuild(P, th, ox, oy, Pr, t) {
  const c = Math.cos(th), s = Math.sin(th), n = P.E.length, L = [];
  for (let i = 0; i < n; i++) { const e = P.E[i], p = Pr.pr[i]; L.push({ x: P.cx + ox + c * e.ax - s * e.ay + p.nx * t[i], y: P.cy + oy + s * e.ax + c * e.ay + p.ny * t[i], dx: c * e.dx - s * e.dy, dy: s * e.dx + c * e.dy }); }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = L[(i - 1 + n) % n], B = L[i], den = A.dx * B.dy - A.dy * B.dx;
    if (Math.abs(den) < 0.05) { out.push(B.x, B.y); continue; } // sisi hampir segaris: pakai titik awal sisi B
    const u = ((B.x - A.x) * B.dy - (B.y - A.y) * B.dx) / den; out.push(A.x + A.dx * u, A.y + A.dy * u);
  }
  return out;
}
const area = p => { let s = 0; for (let i = 0, n = p.length; i < n; i += 2) { const j = (i + 2) % n; s += p[i] * p[j + 1] - p[j] * p[i + 1]; } return s / 2; };
function simple(p) { // tanpa sisi saling potong (cek O(n²), poligon bangunan kecil)
  const n = p.length / 2; if (n < 3) return false;
  const X = (a, b, c) => (p[2 * b] - p[2 * a]) * (p[2 * c + 1] - p[2 * a + 1]) - (p[2 * b + 1] - p[2 * a + 1]) * (p[2 * c] - p[2 * a]);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = i, b = (i + 1) % n, c = j, d = (j + 1) % n;
    if (X(a, b, c) * X(a, b, d) < 0 && X(c, d, a) * X(c, d, b) < 0) return false;
  }
  return true;
}

// polys: [{pts:[x,y,…] px foto, open?, lineOnly?, wt?}] → [{pts, score0, score, moved(px), ok}]
// lineOnly: garis (jalan/air) — ikut menaksir geser global (bobot wt) tetapi hanya digeser global, tidak diubah bentuknya.
// opt: { gsd (m/px), Rg, R, Re (m), thMax (°), perBuilding }
export function refineBuildings(F, polys, opt = {}) {
  const g = opt.gsd || 0.075, Rg = (opt.Rg ?? 4) / g, R = (opt.R ?? 0.9) / g, Re = (opt.Re ?? 0.5) / g, thMax = (opt.thMax ?? 4) * Math.PI / 180, h = 0.5;
  const Ps = polys.map(p => prep(p.pts, p.open));
  // 1) geser global (semua bangunan bersama → kokoh terhadap derau): profil θ = 0, cari d dalam radius Rg
  //    (area besar: cukup ≤ 600 bangunan sampel)
  const step = Math.max(1, Math.ceil(Ps.length / 600));
  const PrG = Ps.map((P, i) => P.W && i % step === 0 ? profiles(F, P, 0, 0, 0, Rg + 1, 1) : null);
  const base = (dx, dy) => { let S = 0, Wt = 0; Ps.forEach((P, i) => { if (PrG[i]) { const w = polys[i].wt ?? 1; S += w * rigidScore(PrG[i], dx, dy, 1); Wt += w * P.W; } }); return Wt ? S / Wt : 0; };
  let gd = [0, 0], gs0 = base(0, 0), gsb = gs0;
  for (let dy = -Math.floor(Rg); dy <= Rg; dy++) for (let dx = -Math.floor(Rg); dx <= Rg; dx++) { if (dx * dx + dy * dy > Rg * Rg) continue; const s = base(dx, dy); if (s > gsb) { gsb = s; gd = [dx, dy]; } }
  if (gsb < gs0 * 1.04) { gd = [0, 0]; gsb = gs0; } // perbaikan global tidak meyakinkan → tanpa geser
  // 2) per bangunan
  const out = [];
  for (let i = 0; i < Ps.length; i++) {
    const P = Ps[i], src = polys[i].pts;
    if (!P.W || opt.perBuilding === false || polys[i].lineOnly) { // garis / terlalu kecil / terlalu banyak bangunan: geser global saja
      const pts = gd[0] || gd[1] ? Array.from(src, (v, k) => v + gd[k & 1]) : src;
      out.push({ pts, score0: 0, score: 0, moved: Math.hypot(gd[0], gd[1]), ok: false }); continue;
    }
    const Pr0 = profiles(F, P, 0, 0, 0, 1, h), s0 = rigidScore(Pr0, 0, 0, P.W);
    let best = { s: -1 };
    const ths = []; for (let a = -thMax; a <= thMax + 1e-9; a += thMax / 4) ths.push(a);
    const tryTh = th => {
      const Pr = profiles(F, P, th, gd[0], gd[1], R + Re + 1, h);
      for (let dy = -R; dy <= R; dy += h) for (let dx = -R; dx <= R; dx += h) {
        if (dx * dx + dy * dy > R * R) continue;
        const s = rigidScore(Pr, dx, dy, P.W) - 0.6 * Math.hypot(dx, dy) * g; // sedikit penalti geser (≈ 0,6 per m)
        if (s > best.s) best = { s, th, dx, dy, Pr };
      }
    };
    for (const th of ths) tryTh(th);
    for (const d of [-0.5, 0.5]) tryTh(best.th + d * thMax / 4); // halus
    const { th, dx, dy, Pr } = best;
    // 3) geser tiap sisi sejajar dirinya (±Re) bila tepinya lebih jelas di sana
    const t = Pr.pr.map((p, e) => {
      const t0 = dx * p.nx + dy * p.ny; if (!p.w) return t0;
      const f0 = at(Pr, e, t0); let bt = t0, bf = f0;
      for (let u = -Re; u <= Re; u += h) { const v = at(Pr, e, t0 + u) - 4 * Math.abs(u) * g; if (v > bf) { bf = v; bt = t0 + u; } }
      return bf > f0 * 1.12 + 2 ? bt : t0;
    });
    let pts = rebuild(P, th, gd[0], gd[1], Pr, t);
    const A0 = Math.abs(area(src));
    let ok = simple(pts) && Math.sign(area(pts)) === Math.sign(area(src)) && Math.abs(area(pts)) > 0.6 * A0 && Math.abs(area(pts)) < 1.6 * A0;
    if (!ok) pts = rebuild(P, th, gd[0], gd[1], Pr, Pr.pr.map(p => dx * p.nx + dy * p.ny)); // cadangan: geser + putar saja
    const s1 = scoreOf(F, pts);
    const accept = s1 >= Math.max(s0 * 1.06, s0 + 2) && s1 >= 22;
    if (!accept) { // tidak ada bukti tepi: pakai jejak asli + geser global saja
      pts = gd[0] || gd[1] ? Array.from(src, (v, k) => v + gd[k & 1]) : src;
    }
    let mv = 0; for (let k = 0; k < Math.min(pts.length, src.length); k += 2) mv = Math.max(mv, Math.hypot(pts[k] - src[k], pts[k + 1] - src[k + 1]));
    out.push({ pts, score0: s0, score: accept ? s1 : scoreOf(F, pts), moved: pts.length === src.length ? mv : null, ok: accept });
  }
  return { polys: out, global: { dx: gd[0] * g, dy: gd[1] * g, s0: gs0, s: gsb } };
}
// skor kecocokan tepi rata-rata sebuah poligon (px foto)
export function scoreOf(F, pts) { const P = prep(pts); if (!P.W) return 0; return rigidScore(profiles(F, P, 0, 0, 0, 1, 0.5), 0, 0, P.W); }

// Buang duplikat / tumpang tindih: poligon diproses berurutan (prioritas), diraster ke grid sel `cell` px;
// poligon yang > maxOv luasnya sudah ditempati poligon sebelumnya dibuang. Hasil: indeks yang dipakai.
export function dedupe(polys, W, H, cell = 2) {
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell), grid = new Uint8Array(gw * gh), keep = [];
  for (let k = 0; k < polys.length; k++) {
    const { pts, maxOv = 0.5 } = polys[k], cells = rasterCells(pts, cell, gw, gh);
    if (!cells.length) continue;
    let occ = 0; for (const c of cells) occ += grid[c];
    if (occ > maxOv * cells.length) continue;
    for (const c of cells) grid[c] = 1;
    keep.push(k);
  }
  return keep;
}
function rasterCells(p, cell, gw, gh) { // scanline: pusat sel di dalam poligon
  let y0 = Infinity, y1 = -Infinity; for (let i = 1; i < p.length; i += 2) { y0 = Math.min(y0, p[i]); y1 = Math.max(y1, p[i]); }
  const out = [], n = p.length / 2;
  for (let gy = Math.max(0, Math.floor(y0 / cell)); gy <= Math.min(gh - 1, Math.floor(y1 / cell)); gy++) {
    const y = (gy + 0.5) * cell, xs = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ay = p[2 * i + 1], by = p[2 * j + 1]; if ((ay <= y) !== (by <= y)) xs.push(p[2 * i] + (y - ay) / (by - ay) * (p[2 * j] - p[2 * i])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let gx = Math.max(0, Math.ceil(xs[k] / cell - 0.5)); gx <= Math.min(gw - 1, Math.floor(xs[k + 1] / cell - 0.5)); gx++) out.push(gy * gw + gx);
  }
  return out;
}
