// Auto Trace (perintah AUTOTRACE; menu A, Insert › Reference, halaman Start, seret-lepas / tempel gambar):
// unggah gambar → garis CAD otomatis (garis, busur, lingkaran, elips, polyline halus atau spline) + animasi menggambar.
// Mesin di imgtrace.js (Web Worker). Panel opsi non-modal: mengubah jenis / detail / kehalusan langsung men-trace ulang
// dan MENGGANTI hasil sebelumnya (tetap satu langkah undo); ukuran objek bisa diubah tanpa trace ulang.
import { h, win, toast, sel, chk, closeWin, isOpen, $ } from './dom.js';
import { icon } from './icons.js';
import { bbox, splinePts } from './ent.js';
import { bbEmpty, bbUnion, bbOk, arcPts, ellPts, TAU } from './geom.js';

const LSK = 'amatucad-autotrace';
const DEF = { mode: 'auto', detail: 3, smooth: 3, style: 'arc', shapes: true, bg: true, weights: true, anim: true, keepImg: false, objW: 1000 };
const loadOpt = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(LSK) || '{}') }; } catch { return { ...DEF }; } };
const saveOpt = o => { try { localStorage.setItem(LSK, JSON.stringify(o)); } catch { } };
// sisi terpanjang gambar kerja per mode × detail (1–5)
const SIZES = { line: [900, 1300, 1700, 2100, 2500], photo: [700, 1000, 1300, 1600, 2000], shape: [800, 1100, 1400, 1800, 2200] };
const MODES = [['auto', 'Otomatis'], ['line', 'Garis / sketsa'], ['photo', 'Foto'], ['shape', 'Siluet']];
const MODE_NAME = { line: 'gambar garis / sketsa', photo: 'foto objek', shape: 'siluet / logo' };
const DET_L = ['Rendah', 'Sedang', 'Normal', 'Tinggi', 'Maksimum'], SM_L = ['Tajam', 'Sedikit halus', 'Halus', 'Sangat halus', 'Paling halus'];
const LAYER = 'AUTOTRACE', LAYER_IMG = 'AUTOTRACE-FOTO';
const MAXSRC = 2600;

let S = null; // sesi aktif (satu gambar sumber)
const NOP = { setStatus() { }, setStats() { }, setThumb() { }, setBadge() { }, setSize() { }, setAnim() { } };

// ---------- masuk ----------
export function autoTrace(app, file) {
  if (file) { start(app, file); return; }
  const i = $('#filein'); i.accept = 'image/*'; i.value = '';
  i.onchange = () => { const f = i.files[0]; if (f) start(app, f); };
  i.click();
}
// pilihan saat gambar diseret / ditempel ke kanvas
export function imageChoice(app, file) {
  const w = win({
    title: 'Gambar: ' + (file.name || 'dari clipboard'), width: 430, body: h('div', { class: 'col', style: { gap: '10px' } },
      h('button', { class: 'btn pri at-choice', onclick: () => { w.close(); start(app, file); } }, h('span', { html: icon('autotrace') }), h('span', {}, h('b', {}, 'Auto Trace — jadikan garis CAD'), h('small', {}, 'Garis digambar otomatis mengikuti gambar (halus & detail)'))),
      h('button', { class: 'btn at-choice', onclick: () => { w.close(); app.attachImage(file); } }, h('span', { html: icon('image') }), h('span', {}, h('b', {}, 'Sisipkan sebagai gambar'), h('small', {}, 'Foto raster biasa (IMAGEATTACH)')))),
  });
}
// Ctrl+V gambar dari clipboard sistem (bila clipboard CAD kosong)
export async function pasteImage(app) {
  try {
    if (!navigator.clipboard?.read) return false;
    for (const it of await navigator.clipboard.read()) {
      const t = it.types.find(x => x.startsWith('image/')); if (!t) continue;
      const b = await it.getType(t);
      imageChoice(app, new File([b], 'clipboard.' + (t.split('/')[1] || 'png'), { type: t }));
      return true;
    }
  } catch { }
  return false;
}

// ---------- gambar sumber ----------
async function loadSource(file) {
  let bmp = null;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { try { bmp = await createImageBitmap(file); } catch { } }
  let w, hh, draw;
  if (bmp) { w = bmp.width; hh = bmp.height; draw = (x, W, H) => x.drawImage(bmp, 0, 0, W, H); }
  else {
    const url = URL.createObjectURL(file);
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Gambar tidak dapat dibaca (format tidak didukung?)')); i.src = url; }); // bukan decode(): tak selesai di panel yang tak dirender
    w = im.naturalWidth; hh = im.naturalHeight; draw = (x, W, H) => x.drawImage(im, 0, 0, W, H);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  if (!w || !hh) throw new Error('Gambar kosong.');
  const k = Math.min(1, MAXSRC / Math.max(w, hh)), W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(hh * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.imageSmoothingQuality = 'high'; draw(x, W, H);
  bmp?.close?.();
  return { canvas: c, W, H, ow: w, oh: hh };
}
function scaled(src, maxSide, up) {
  const k = Math.min(up, maxSide / Math.max(src.width, src.height)), W = Math.max(8, Math.round(src.width * k)), H = Math.max(8, Math.round(src.height * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, W, H);
  return { c, W, H, data: x.getImageData(0, 0, W, H) };
}

// ---------- worker ----------
function worker() {
  if (S.wk) return S.wk;
  S.wk = new Worker(new URL('./imgtrace-worker.js?v=1', import.meta.url), { type: 'module' });
  S.wk.onmessage = e => { const m = e.data, p = S?.pend?.get(m.id); if (!p) return; if (m.type === 'progress') { p.prog?.(m.msg, m.f); return; } S.pend.delete(m.id); if (m.type === 'error') p.rej(new Error(m.msg)); else p.res(m); };
  S.wk.onerror = e => { for (const p of S.pend.values()) p.rej(new Error(e.message || 'Worker gagal')); S.pend.clear(); };
  return S.wk;
}
function call(msg, transfer, prog) {
  const wk = worker(), id = ++S.seq;
  return new Promise((res, rej) => { S.pend.set(id, { res, rej, prog }); wk.postMessage({ ...msg, id }, transfer); });
}
function killWorker() { if (!S?.wk) return; S.wk.terminate(); S.wk = null; for (const p of S.pend.values()) p.rej(Object.assign(new Error('dibatalkan'), { cancel: true })); S.pend.clear(); }

// ---------- sesi ----------
async function start(app, file) {
  const o = loadOpt();
  stopAnim(app, true);
  if (S) { killWorker(); }
  const ses = S = { app, doc: app.doc, o, name: file.name || 'gambar', pend: new Map(), seq: 0, wk: null, ents: [], ids: new Set(), img: null, frame: null, busy: 0 };
  const P = panel(app);
  P.setStatus('Membaca gambar…', 0.03);
  let src;
  try { src = await loadSource(file); }
  catch (e) { if (S === ses) { P.setStatus('Gagal: ' + e.message); app.ui.print('Auto Trace: ' + e.message, 'err'); } return; }
  if (S !== ses) return; // gambar lain dipilih sementara ini dibaca
  S.src = src;
  P.setThumb();
  // analisis cepat (jenis gambar) dari versi kecil
  try {
    const q = scaled(S.src.canvas, 640, 1);
    const a = await call({ type: 'analyze', W: q.W, H: q.H, buf: q.data.data.buffer }, [q.data.data.buffer]);
    if (S !== ses) return;
    S.auto = a;
  } catch (e) { if (S !== ses || e.cancel) return; S.auto = { mode: 'photo' }; console.warn(e); }
  P.setBadge();
  await run(app, { anim: S.o.anim, first: true });
}
const modeOf = () => S.o.mode === 'auto' ? (S.auto?.mode || 'photo') : S.o.mode;
// hasil trace yang masih ada di gambar — dilacak lewat id entitas (tetap sama setelah undo/redo, salinan COPY ber-id baru)
const live = doc => S.doc === doc ? doc.model.filter(e => S.ids.has(e.id)) : [];
async function run(app, { anim = false, first = false } = {}) {
  if (!S?.src) return;
  const ses = S, my = ++S.busy, P = S.P || NOP, o = S.o, mode = modeOf();
  stopAnim(app, true);
  killWorker(); // trace baru membatalkan yang masih berjalan
  const side = SIZES[mode][o.detail - 1], up = mode === 'photo' ? 1 : 2;
  const q = scaled(S.src.canvas, side, up);
  P.setStatus('Menyiapkan gambar…', 0.05);
  let r;
  const t0 = performance.now();
  try {
    r = await call({ type: 'trace', W: q.W, H: q.H, buf: q.data.data.buffer, opt: { mode, detail: o.detail, smooth: o.smooth, style: o.style, shapes: o.shapes, bg: o.bg } }, [q.data.data.buffer], (m, f) => { if (S === ses && my === ses.busy) P.setStatus(m, 0.05 + 0.85 * f); });
  } catch (e) { if (e.cancel || S !== ses || my !== ses.busy) return; P.setStatus('Gagal: ' + e.message); app.ui.print('Auto Trace gagal: ' + e.message, 'err'); console.error(e); return; }
  if (S !== ses || my !== ses.busy) return;
  if (!r.shapes.length) { P.setStatus('Tidak ada garis yang terdeteksi. Naikkan Detail atau pilih jenis gambar lain.'); P.setStats(''); return; }
  S.res = r; S.work = { W: q.W, H: q.H };
  place(app, first);
  let ents = build(r);
  if (first) { // lebar objek tepat sesuai isian (bbox entitas nyata, termasuk tonjolan busur)
    const bb = extOf(ents), w = bb.x2 - bb.x1, want = S.o.objW || 1000;
    if (w > 0 && Math.abs(w - want) > 1e-9) { const f = want / w, LL = { x: bb.x1, y: bb.y1 }; S.frame.k *= f; S.frame.O = { x: LL.x + (S.frame.O.x - LL.x) * f, y: LL.y + (S.frame.O.y - LL.y) * f }; ents = build(r); }
  }
  commit(app, ents);
  const ms = performance.now() - t0;
  const n = ents.length, c = r.stats;
  const parts = [['line', 'garis'], ['arc', 'busur'], ['circle', 'lingkaran'], ['ellipse', 'elips'], ['pline', 'polyline'], ['spline', 'spline']].filter(([k]) => c[k]).map(([k, l]) => `${c[k]} ${l}`);
  P.setStats(`${n} objek: ${parts.join(', ')} · ${(ms / 1000).toFixed(1).replace('.', ',')} dtk · gambar kerja ${q.W}×${q.H} px`);
  P.setStatus(`Selesai — ${MODE_NAME[r.mode] || r.mode}${S.o.mode === 'auto' ? ' (otomatis)' : ''}.`, null);
  (S.P || NOP).setSize();
  if (first || anim) zoomTo(app, extOf(ents));
  if (first) app.ui.print(`Auto Trace: ${n} objek digambar dari "${S.name}" (${MODE_NAME[r.mode] || r.mode}, layer ${LAYER}). Atur ukuran / detail di panel Auto Trace.`, 'ok');
  if (anim) await animate(app, ents);
}
// bingkai gambar sumber di gambar: O = posisi pojok kiri-bawah gambar sumber, k = satuan gambar per piksel sumber
function place(app, first) {
  const r = S.res, doc = app.doc, f = S.src.W / S.work.W; // piksel kerja → piksel sumber
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const s of r.shapes) { const b = shapeBB(s); x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]); x2 = Math.max(x2, b[2]); y2 = Math.max(y2, b[3]); }
  const bw = Math.max(1e-6, (x2 - x1) * f);
  if (!S.frame || first) {
    const k = Math.max(1e-9, S.o.objW || 1000) / bw;
    let P = { x: 0, y: 0 };
    const others = doc.model.filter(e => !(S.doc === doc && S.ids.has(e.id)));
    if (others.length) { const ext = doc.extents(others); if (bbOk(ext)) P = { x: ext.x2 + 0.15 * S.o.objW, y: ext.y1 }; }
    S.frame = { k, O: { x: P.x - x1 * f * k, y: P.y - y1 * f * k } };
  } else trackMove(app);
}
// bila hasil sebelumnya sudah dipindah (MOVE / grip), bingkai ikut bergeser
function trackMove(app) {
  const p = S.probe; if (!p || S.doc !== app.doc) return;
  const e = app.doc.model.find(x => x.id === p.id); if (!e) return;
  const q = refPt(e); if (!q) return;
  const dx = q.x - p.x, dy = q.y - p.y;
  if (Math.abs(dx) + Math.abs(dy) > 1e-9) { S.frame.O = { x: S.frame.O.x + dx, y: S.frame.O.y + dy }; }
}
const refPt = e => e.type === 'line' ? e.p1 : e.type === 'pline' ? e.pts[0] : e.type === 'spline' ? e.fit?.[0] : e.c;
function shapeBB(s) {
  const P = s.t === 'line' ? [s.a, s.b] : s.t === 'pline' ? s.pts : s.t === 'spline' ? s.fit : null;
  if (P) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of P) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); } return [a, b, c, d]; }
  const r = s.t === 'ellipse' ? Math.hypot(s.u[0], s.u[1]) : s.r;
  return [s.c[0] - r, s.c[1] - r, s.c[0] + r, s.c[1] + r];
}
// bentuk (piksel kerja, Y ke atas) → entitas CAD
function build(r) {
  const f = S.src.W / S.work.W, k = S.frame.k * f, O = S.frame.O;
  const T = (x, y) => ({ x: O.x + x * k, y: O.y + y * k });
  // ketebalan: goresan tebal (mode garis) atau kontur luar (foto) → 0,50 mm; lainnya ikut layer (0,25 mm)
  let thick = () => false;
  if (S.o.weights) {
    if (r.mode === 'line') {
      const ws = []; for (const s of r.shapes) if (s.w) for (let i = 0; i < Math.max(1, Math.round((s.len || 10) / 25)); i++) ws.push(s.w);
      ws.sort((a, b) => a - b);
      const lo = ws[Math.floor(ws.length * 0.1)] || 0, hi = ws[Math.floor(ws.length * 0.9)] || 0;
      if (lo > 0 && hi / lo >= 1.7) { const t = Math.sqrt(lo * hi); thick = s => (s.w || 0) >= t; }
    } else if (r.mode === 'photo') thick = s => !!s.outer;
  }
  const out = [];
  for (const s of r.shapes) {
    const base = { layer: LAYER, color: 256, lt: 'ByLayer', lw: thick(s) ? 50 : -1 };
    let e = null;
    if (s.t === 'line') e = { type: 'line', p1: T(...s.a), p2: T(...s.b) };
    else if (s.t === 'arc') e = { type: 'arc', c: T(...s.c), r: s.r * k, sa: s.sa, ea: s.ea };
    else if (s.t === 'circle') e = { type: 'circle', c: T(...s.c), r: s.r * k };
    else if (s.t === 'ellipse') e = { type: 'ellipse', c: T(...s.c), u: { x: s.u[0] * k, y: s.u[1] * k }, k: s.k, sp: 0, ep: TAU };
    else if (s.t === 'pline') e = { type: 'pline', pts: s.pts.map(([x, y, b]) => ({ ...T(x, y), b: b || 0 })), closed: !!s.closed };
    else if (s.t === 'spline') e = { type: 'spline', fit: s.fit.map(([x, y]) => T(x, y)), closed: !!s.closed };
    if (e) out.push(Object.assign(e, base));
  }
  return out;
}
function extOf(ents) { let bb = bbEmpty(); for (const e of ents) { const b = bbox(e, S.app.doc); if (bbOk(b)) bb = bbUnion(bb, b); } return bb; }
// ganti hasil sebelumnya; bila sejak trace terakhir tidak ada perubahan lain → tetap SATU langkah undo
function commit(app, ents) {
  const doc = app.doc, keep = S.o.keepImg;
  const prev = live(doc);
  const merge = prev.length && prev.length === S.ids.size && S.undoLen === doc.undoS.length && !doc.redoS.length && doc.undoS.length > 0;
  let img = null;
  if (keep) {
    const key = S.imgKey || (S.imgKey = 'img' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    if (!doc.imgs[key]) doc.imgs[key] = refURL();
    img = { type: 'image', p: { ...S.frame.O }, w: S.src.W * S.frame.k, h: S.src.H * S.frame.k, rot: 0, img: key, fade: 55, name: S.name, layer: LAYER_IMG, color: 256, lt: 'ByLayer', lw: -1 };
  }
  const apply = () => {
    if (S.doc === doc && S.ids.size) doc.model = doc.model.filter(e => !S.ids.has(e.id));
    doc.addLayer(LAYER, { color: 7, lw: 25, desc: 'Garis hasil Auto Trace' });
    if (img) { const L = doc.addLayer(LAYER_IMG, { color: 8, desc: 'Foto referensi Auto Trace (tidak dicetak)' }); L.plot = false; doc.prep(img); doc.model.unshift(img); }
    for (const e of ents) { doc.prep(e); doc.model.push(e); }
  };
  if (merge) { const snap = doc.undoS.pop(); doc._snap = snap; apply(); if (doc.commit()) app.onChange(); else doc.undoS.push(snap); app.ed.invalidate(); }
  else app.mutate(apply);
  for (const e of [...app.ed.sel]) if (!doc.model.includes(e)) app.ed.sel.delete(e);
  S.ents = ents; S.img = img; S.doc = doc; S.undoLen = doc.undoS.length;
  S.ids = new Set([...ents, img].filter(Boolean).map(e => e.id));
  S.probe = ents.length ? { id: ents[0].id, ...refPt(ents[0]) } : null;
  app.ui.refresh?.();
}
function refURL() { // foto referensi diperkecil (≤ 1600 px, JPEG) agar autosave ringan
  const q = scaled(S.src.canvas, 1600, 1);
  return q.c.toDataURL('image/jpeg', 0.86);
}
// ubah ukuran objek tanpa trace ulang: skala di sekitar pojok kiri-bawah hasil
function resize(app, newW) {
  if (!S?.res || !(newW > 0)) return;
  trackMove(app);
  const cur = extOf(live(app.doc).filter(e => e.type !== 'image'));
  const w0 = bbOk(cur) ? cur.x2 - cur.x1 : 0; if (!(w0 > 0)) return;
  const fct = newW / w0, LL = { x: cur.x1, y: cur.y1 };
  S.frame.k *= fct; S.frame.O = { x: LL.x + (S.frame.O.x - LL.x) * fct, y: LL.y + (S.frame.O.y - LL.y) * fct };
  S.o.objW = newW; saveOpt(S.o);
  commit(app, build(S.res));
  (S.P || NOP).setSize();
  zoomTo(app, extOf(live(app.doc).filter(e => e.type !== 'image')));
}
// zoom ke hasil di area kanvas yang tidak tertutup panel Auto Trace & command line
function zoomTo(app, bb) {
  const ed = app.ed; if (!bbOk(bb) || ed.layout) return;
  const v = ed.view, c = ed.cv.wrap.getBoundingClientRect();
  let right = 0, bottom = 0;
  const pw = document.querySelector('.at-win')?.getBoundingClientRect();
  if (pw && pw.left > c.left + c.width * 0.45 && pw.left < c.right) right = c.right - pw.left + 6;
  else if (pw && pw.top > c.top + c.height * 0.25 && pw.top < c.bottom) bottom = c.bottom - pw.top + 6; // HP: panel di bawah
  const cm = document.getElementById('cmd')?.getBoundingClientRect();
  if (cm && cm.height && cm.top < c.bottom && cm.top > c.top + c.height * 0.5) bottom = Math.max(bottom, c.bottom - cm.top + 4);
  const W = Math.max(100, v.w - right), H = Math.max(100, v.h - bottom), bw = Math.max(1e-9, bb.x2 - bb.x1), bh = Math.max(1e-9, bb.y2 - bb.y1);
  const scale = Math.min(W / (bw * 1.14), H / (bh * 1.14));
  ed.pushView?.();
  ed.setView({ scale, ox: W / 2 - (bb.x1 + bb.x2) / 2 * scale, oy: H / 2 + (bb.y1 + bb.y2) / 2 * scale });
}

// ---------- animasi menggambar ----------
let A = null;
function sampleEnt(e) {
  switch (e.type) {
    case 'line': return [e.p1, e.p2];
    case 'arc': return arcPts(e.c, e.r, e.sa, e.ea);
    case 'circle': return arcPts(e.c, e.r, 0, TAU);
    case 'ellipse': return ellPts(e.c, e.u, e.k, e.sp ?? 0, e.ep ?? TAU, 120);
    case 'spline': return splinePts(e);
    case 'pline': {
      const P = e.pts, n = P.length, m = e.closed ? n : n - 1, out = [P[0]];
      for (let i = 0; i < m; i++) {
        const a = P[i], b = P[(i + 1) % n], bu = a.b || 0;
        if (!bu) { out.push(b); continue; }
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d < 1e-12) continue;
        const ux = dx / d, uy = dy / d, kk = d * (1 - bu * bu) / (4 * bu), cx = (a.x + b.x) / 2 - uy * kk, cy = (a.y + b.y) / 2 + ux * kk, r = d * (1 + bu * bu) / (4 * Math.abs(bu));
        const sa = Math.atan2(a.y - cy, a.x - cx), sw = 4 * Math.atan(bu), q = Math.max(4, Math.ceil(Math.abs(sw) * 14));
        for (let j = 1; j <= q; j++) { const t = sa + sw * j / q; out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }); }
      }
      return out;
    }
  }
  return [];
}
const plLen = P => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); return s; };
// urutan seperti tangan menggambar: garis terpanjang dulu, lalu yang terdekat dari ujung pena
function order(items) {
  if (items.length < 2) return items;
  if (items.length > 1600) return items.sort((a, b) => b.L - a.L);
  const left = new Set(items), out = [];
  let cur = items.reduce((a, b) => b.L > a.L ? b : a);
  left.delete(cur); out.push(cur);
  while (left.size) {
    const p = cur.P[cur.P.length - 1]; let best = null, bd = Infinity, rev = false;
    for (const it of left) {
      const a = it.P[0], z = it.P[it.P.length - 1], d1 = (a.x - p.x) ** 2 + (a.y - p.y) ** 2, d2 = (z.x - p.x) ** 2 + (z.y - p.y) ** 2;
      if (d1 < bd) { bd = d1; best = it; rev = false; }
      if (d2 < bd) { bd = d2; best = it; rev = true; }
    }
    if (rev) best.P = [...best.P].reverse();
    left.delete(best); out.push(best); cur = best;
  }
  return out;
}
function animate(app, ents) {
  const ed = app.ed;
  stopAnim(app, true);
  let items = ents.map(e => { const P = sampleEnt(e); return { e, P, L: plLen(P) }; }).filter(it => it.P.length >= 2);
  if (!items.length) return Promise.resolve();
  items = order(items);
  const n = items.length, mean = items.reduce((s, it) => s + it.L, 0) / n;
  const D = Math.min(6.5, Math.max(2, 1.6 + 0.9 * Math.log2(1 + n / 8))) * 1000;
  let acc = 0; for (const it of items) { it.t0 = acc; acc += it.L + 0.25 * mean; it.t1 = acc; }
  for (const it of items) { it.t0 *= D / acc; it.t1 *= D / acc; }
  const dark = (() => { const c = (ed.opt.bg || '#212830').replace('#', ''), v = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16); return ((v >> 16 & 255) * 0.3 + (v >> 8 & 255) * 0.59 + (v & 255) * 0.11) < 128; })();
  const col = dark ? '#EEF3F8' : '#151a20';
  const hide = new Set(ents); ed.animHide = hide;
  const src = S?.src?.canvas, fr = S?.frame ? { ...S.frame, W: S.src.W, H: S.src.H } : null;
  const UL = dark ? 0.3 : 0.4; let ulA = UL; // foto pemandu dibuat redup agar garis yang sedang digambar kontras
  ed.underlay = src && fr ? (c, v) => {
    if (ulA <= 0.005 || ed.layout) return;
    const a = ed.w2s({ x: fr.O.x, y: fr.O.y + fr.H * fr.k }), w = fr.W * fr.k * v.scale, hh = fr.H * fr.k * v.scale;
    c.save(); c.globalAlpha = ulA; c.drawImage(src, a.x, a.y, w, hh); c.restore();
  } : null;
  let shown = 0, cur = 0, curF = 0;
  const strokeTo = (c, P, upto) => {
    c.beginPath(); let s = 0, q = ed.w2s(P[0]); c.moveTo(q.x, q.y);
    for (let i = 1; i < P.length; i++) {
      const L = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
      if (s + L >= upto) { const t = L > 0 ? (upto - s) / L : 1, x = P[i - 1].x + (P[i].x - P[i - 1].x) * t, y = P[i - 1].y + (P[i].y - P[i - 1].y) * t; q = ed.w2s({ x, y }); c.lineTo(q.x, q.y); c.stroke(); return q; }
      s += L; q = ed.w2s(P[i]); c.lineTo(q.x, q.y);
    }
    c.stroke(); return q;
  };
  ed.anim = (c) => {
    c.save(); c.strokeStyle = col; c.lineWidth = 1.3; c.lineJoin = 'round'; c.lineCap = 'round';
    for (let i = shown; i < cur && i < n; i++) strokeTo(c, items[i].P, Infinity);
    let tip = null;
    if (cur < n) { c.strokeStyle = '#F2C94C'; c.lineWidth = 1.8; tip = strokeTo(c, items[cur].P, items[cur].L * curF); }
    if (tip) { c.shadowColor = 'rgba(242,201,76,.9)'; c.shadowBlur = 10; c.fillStyle = '#F2C94C'; c.beginPath(); c.arc(tip.x, tip.y, 3.6, 0, TAU); c.fill(); }
    c.restore();
  };
  return new Promise(resolve => {
    const t0 = performance.now();
    let lastReveal = t0, fade = null;
    const finish = () => { if (!A) return; A = null; ed.animHide = null; ed.anim = null; if (ed.underlay === under) ed.underlay = null; ed.invalidate(); window.removeEventListener('keydown', esc, true); S?.P?.setAnim(false); resolve(); };
    const esc = e => { if (e.key === 'Escape') { skip(); } };
    const skip = () => { cur = n; shown = n; hide.clear(); ulA = 0; finish(); };
    const under = ed.underlay;
    A = { skip, finish };
    window.addEventListener('keydown', esc, true);
    S?.P?.setAnim(true);
    const tick = now => {
      if (!A || A.skip !== skip) return;
      const t = now - t0;
      if (cur < n) {
        while (cur < n && items[cur].t1 <= t) cur++;
        curF = cur < n ? Math.max(0, Math.min(1, (t - items[cur].t0) / Math.max(1, items[cur].t1 - items[cur].t0))) : 1;
        if (now - lastReveal > 110 || cur >= n) { for (let i = shown; i < cur; i++) hide.delete(items[i].e); if (cur > shown) { shown = cur; ed.invalidate('base'); } lastReveal = now; }
        ed.invalidate('over');
      } else {
        if (fade == null) { fade = now; hide.clear(); ed.invalidate('base'); }
        const k = (now - fade) / 600; ulA = UL * Math.max(0, 1 - k); ed.invalidate('base'); ed.invalidate('over');
        if (k >= 1) { finish(); return; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function stopAnim(app, instant) { if (A) A.skip(); void app; void instant; }

// ---------- panel ----------
function panel(app) {
  closeWin('autotrace');
  const o = S.o;
  const thumb = h('canvas', { class: 'at-thumb', width: 300, height: 170 });
  const badge = h('div', { class: 'at-badge' }, 'Menganalisis…');
  const fname = h('div', { class: 'at-name', title: S.name }, S.name);
  const status = h('div', { class: 'gm-status hint' }), bar = h('div', { class: 'gm-bar' }, h('i')), stats = h('div', { class: 'hint at-stats' });
  const seg = (items, curV, fn) => { const box = h('div', { class: 'gm-seg at-seg' }); const draw = v => { box.innerHTML = ''; items.forEach(([k, l]) => box.append(h('button', { class: k === v ? 'on' : '', onclick: () => { fn(k); draw(k); } }, l))); }; draw(curV); return box; };
  let deb = 0;
  const changed = (rerun = true) => { saveOpt(o); if (!rerun) return; clearTimeout(deb); deb = setTimeout(() => run(app, { anim: false }), 380); };
  const range = (k, labels) => {
    const lab = h('b', {}, labels[o[k] - 1]);
    const r = h('input', { type: 'range', min: 1, max: 5, step: 1, value: o[k], oninput: e => { o[k] = +e.target.value; lab.textContent = labels[o[k] - 1]; }, onchange: () => changed() });
    return [r, lab];
  };
  const [dR, dL] = range('detail', DET_L), [sR, sL] = range('smooth', SM_L);
  const styleSel = sel([['arc', 'Polyline halus (garis + busur)'], ['spline', 'Spline (kurva bebas)'], ['poly', 'Polyline lurus (segmen)']], o.style, v => { o.style = v; changed(); });
  const O = (k, l, rerun = true, title) => Object.assign(chk(l, o[k], v => { o[k] = v; if (k === 'keepImg') { if (S.res) commit(app, build(S.res)); saveOpt(o); return; } changed(rerun); }), title ? { title } : {});
  const units = () => app.doc.set.units || 'mm';
  const wIn = h('input', { type: 'number', step: 'any', min: 0, class: 'at-num', onchange: e => resize(app, parseFloat(e.target.value)) });
  const hIn = h('input', { type: 'number', step: 'any', min: 0, class: 'at-num', onchange: e => { const bb = extOf(live(app.doc).filter(x => x.type !== 'image')); const ww = bb.x2 - bb.x1, hh = bb.y2 - bb.y1; const v = parseFloat(e.target.value); if (v > 0 && hh > 0) resize(app, ww * v / hh); } });
  const uL = h('span', { class: 'hint' }, units());
  const bRun = h('button', { class: 'btn pri', onclick: () => run(app, { anim: o.anim }) }, h('span', { html: icon('autotrace') }), ' Trace ulang');
  const bSkip = h('button', { class: 'btn', style: { display: 'none' }, onclick: () => stopAnim(app) }, 'Lewati animasi');
  const bMove = h('button', { class: 'btn', title: 'Pindahkan hasil trace (MOVE)', onclick: () => { const L = live(app.doc).filter(e => e.type !== 'image'); if (!L.length) return; stopAnim(app); app.ed.setSel(L); app.exec('MOVE'); } }, 'Pindahkan');
  const body = h('div', { class: 'at' },
    h('div', { class: 'at-top' }, thumb, badge),
    h('div', { class: 'row at-file' }, fname, h('button', { class: 'btn sm', onclick: () => autoTrace(app) }, 'Ganti gambar…')),
    h('div', { class: 'at-lbl' }, 'Jenis gambar'), seg(MODES, o.mode, k => { o.mode = k; S.P?.setBadge(); changed(); }),
    h('div', { class: 'at-rng' }, h('span', {}, 'Detail'), dR, dL),
    h('div', { class: 'at-rng' }, h('span', {}, 'Kehalusan'), sR, sL),
    h('div', { class: 'grid2 at-g' }, 'Hasil:', styleSel),
    h('div', { class: 'col at-chk' },
      O('shapes', 'Kenali lingkaran & elips'),
      O('weights', 'Tebal garis mengikuti gambar', true, 'Goresan tebal (gambar garis) atau kontur luar (foto) diberi lineweight 0,50 mm, lainnya 0,25 mm.'),
      O('bg', 'Abaikan latar polos & bayangan (foto)'),
      O('anim', 'Animasi menggambar', false),
      O('keepImg', 'Simpan foto referensi di bawah garis', false, 'Foto diletakkan di layer AUTOTRACE-FOTO (pudar, tidak ikut dicetak).')),
    h('div', { class: 'at-lbl' }, 'Ukuran objek hasil trace'),
    h('div', { class: 'row at-size' }, 'L', wIn, '×', 'T', hIn, uL),
    h('div', { class: 'row at-btns' }, bRun, bSkip, bMove),
    h('div', {}, status, bar), stats,
    h('div', { class: 'hint at-tip' }, 'Tips: foto dengan latar polos & objek kontras memberi hasil paling rapi. Sketsa difoto pun bisa (bayangan kertas dikoreksi). Undo (Ctrl+Z) menghapus seluruh hasil sekaligus.'));
  const rb = document.getElementById('ribbon')?.getBoundingClientRect(), top = Math.round(Math.min(innerHeight * 0.3, (rb?.bottom || 90) + 34));
  const w = win({ title: 'Auto Trace — gambar → garis CAD', body, id: 'autotrace', modal: false, width: 340, left: Math.max(8, innerWidth - 356), top, onClose: () => { clearTimeout(deb); stopAnim(app); killWorker(); if (S) S.P = null; } });
  w.el.classList.add('at-win');
  const P = S.P = {
    setStatus(t, f) { status.textContent = t; bar.style.display = f == null ? 'none' : ''; if (f != null) bar.firstChild.style.width = Math.round(Math.min(1, f) * 100) + '%'; },
    setStats(t) { stats.textContent = t; },
    setThumb() {
      const ph = matchMedia('(max-width: 640px)').matches, c = S.src.canvas, k = Math.min((ph ? 220 : 300) / c.width, (ph ? 84 : 170) / c.height), W = Math.max(1, Math.round(c.width * k)), H = Math.max(1, Math.round(c.height * k));
      thumb.width = W * 2; thumb.height = H * 2; thumb.style.width = W + 'px'; thumb.style.height = H + 'px';
      const x = thumb.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, thumb.width, thumb.height);
      fname.textContent = S.name; fname.title = `${S.name} — ${S.src.ow}×${S.src.oh} px`;
    },
    setBadge() { const m = modeOf(); badge.textContent = (o.mode === 'auto' ? 'Terdeteksi: ' : 'Mode: ') + (MODE_NAME[m] || m); },
    setSize() { const bb = extOf(live(app.doc).filter(e => e.type !== 'image')); if (!bbOk(bb)) return; wIn.value = +(bb.x2 - bb.x1).toFixed(2); hIn.value = +(bb.y2 - bb.y1).toFixed(2); uL.textContent = units(); },
    setAnim(on) { bSkip.style.display = on ? '' : 'none'; bMove.style.display = on ? 'none' : ''; },
  };
  return P;
}
export const autoTraceOpen = () => isOpen('autotrace');
void toast;
