// Web Worker tracing: terima piksel tile (gaya trace) → klasifikasi ke peta kelas → vektorisasi.
// Lalu (opsional) foto satelit → gradien → jejak bangunan diselaraskan ke tepi atap → buang duplikat.
import { classify, traceClasses, clipRuns } from './trace.js';
import { gradField, refineBuildings, dedupe } from './refine.js';
let W = 0, H = 0, cls = null, photo = null;
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'init') { W = m.W; H = m.H; cls = new Uint8Array(W * H); self.postMessage({ type: 'ready' }); }
    else if (m.type === 'tile') classify(new Uint8ClampedArray(m.buf), m.w, m.h, cls, m.x, m.y, W);
    else if (m.type === 'run') { const r = traceClasses(cls, W, H, m.opt); cls = null; self.postMessage({ type: 'done', ...r }); }
    else if (m.type === 'photo') { photo = { rgba: new Uint8ClampedArray(m.buf), W: m.W, H: m.H }; self.postMessage({ type: 'ok' }); }
    else if (m.type === 'bld') { const r = buildings(m); photo = null; self.postMessage({ type: 'done', ...r }); }
  } catch (err) { self.postMessage({ type: 'error', msg: String(err?.message || err) }); }
};
// polys: [{pts:[x,y,…], src:'ob'|'g', conf}] bangunan dalam piksel bingkai (foto bila ada); lines: [{pts, closed, k}] jalan/air/hijau
// dari peta Google. Hasil: bangunan terpakai (urut prioritas) + garis yang ikut dikoreksi geser registrasi peta Google.
function buildings({ polys, lines = [], W: FW, H: FH, clip, opt }) {
  const t0 = performance.now(), res = polys.map(p => ({ pts: p.pts, score: 0, ok: false, moved: 0 })), glob = {};
  let linesOut = lines;
  if (photo && opt.snap && (polys.length || lines.length)) {
    const mg = (opt.Rg ?? 4) / opt.gsd + 40, wins = [...polys, ...lines].map(p => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < p.pts.length; i += 2) { x0 = Math.min(x0, p.pts[i]); x1 = Math.max(x1, p.pts[i]); y0 = Math.min(y0, p.pts[i + 1]); y1 = Math.max(y1, p.pts[i + 1]); } return { x0: x0 - mg, y0: y0 - mg, x1: x1 + mg, y1: y1 + mg }; });
    const F = gradField(photo.rgba, photo.W, photo.H, wins);
    photo.rgba = null;
    for (const src of ['ob', 'g']) { // tiap sumber punya pergeseran (registrasi) sendiri terhadap foto
      const idx = []; polys.forEach((p, i) => { if (p.src === src) idx.push(i); });
      // garis peta Google ikut menaksir geser peta Google (bobot kecil: lebar jalan di peta digambar per kelas, bukan lebar asli)
      const extra = src === 'g' ? lines.map(l => ({ pts: l.pts, open: !l.closed, lineOnly: true, wt: 0.3 })) : [];
      if (!idx.length && !extra.length) continue;
      const R = refineBuildings(F, [...idx.map(i => polys[i]), ...extra], { gsd: opt.gsd, perBuilding: idx.length <= (opt.maxRefine ?? 4000) });
      idx.forEach((i, k) => { res[i] = R.polys[k]; });
      if (extra.length) linesOut = lines.map((l, k) => ({ ...l, pts: R.polys[idx.length + k].pts }));
      glob[src] = R.global;
    }
    if (clip) linesOut = linesOut.flatMap(l => clipRuns(l.pts, l.closed, clip).map(r => ({ k: l.k, pts: r.pts, closed: r.closed })));
  }
  // data terbuka (per rumah) didahulukan; trace peta Google hanya mengisi yang belum ada
  const order = polys.map((_, i) => i).sort((a, b) => ((polys[a].src === 'ob' ? 0 : 1) - (polys[b].src === 'ob' ? 0 : 1)) || (res[b].score - res[a].score) || ((polys[b].conf || 0) - (polys[a].conf || 0)));
  const keep = dedupe(order.map(i => ({ pts: res[i].pts, maxOv: polys[i].src === 'ob' ? 0.5 : 0.3 })), FW, FH, opt.cell || 2);
  const out = keep.map(k => { const i = order[k]; return { pts: res[i].pts, src: polys[i].src, ok: res[i].ok, moved: res[i].moved }; });
  return { polys: out, lines: linesOut, glob, n: polys.length, ms: performance.now() - t0 };
}
