// Dokumen gambar: entitas model/layout, layer, blok, setelan, undo/redo, layout + kop gambar.
import { DIMDEF, bbox, LTYPES } from './ent.js';
import { bbEmpty, bbUnion, bbOk } from './geom.js';

export const PAPERS = {
  A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
  F4: [330, 215], Letter: [279.4, 215.9], Legal: [355.6, 215.9], 'Tabloid (ANSI B)': [431.8, 279.4], 'ANSI C': [558.8, 431.8], 'ANSI D': [863.6, 558.8],
};
export const PREF_SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
export const SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 10000];
export const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

export function newLayout(name, paper = 'A3') {
  return {
    name, paper, orient: 'L', ents: [], ctb: 'monochrome.ctb', lwPlot: true,
    vp: null, // diisi saat pertama dibuka (auto-fit)
    tb: { on: true, company: 'AMATU CAD STUDIO', project: 'NAMA PROYEK', location: 'LOKASI PROYEK', title: 'JUDUL GAMBAR', drawn: '', checked: '', approved: '', date: new Date().toLocaleDateString('id-ID'), no: 'A-01', sheet: '1 / 1', notes: 'Semua ukuran dalam milimeter kecuali dinyatakan lain.' },
  };
}

export class Doc {
  constructor(name = 'Drawing1') {
    this.name = name; this.file = null; this.handle = null; this.dirty = false;
    this.model = []; this.layouts = [newLayout('Layout1'), newLayout('Layout2', 'A4')];
    this.layers = {
      '0': { color: 7, lt: 'Continuous', lw: -3, on: true, frz: false, lck: false, plot: true, desc: '' },
      'Defpoints': { color: 7, lt: 'Continuous', lw: -3, on: true, frz: false, lck: false, plot: false, desc: '' },
    };
    this.clayer = '0';
    this.blocks = {}; this.ltypes = Object.keys(LTYPES).filter(k => ['Continuous', 'DASHED', 'HIDDEN', 'CENTER', 'PHANTOM', 'DOT', 'DASHDOT'].includes(k));
    this.set = { ltscale: 1, ccolor: 256, clt: 'ByLayer', clw: -1, cltscale: 1, textH: 2.5, units: 'mm', prec: 2, angPrec: 0, pdmode: 0, pdsize: 0, gridX: 10, snapX: 10, polarAng: 90, mirrtext: 0, hpName: 'ANSI31', hpScale: 1, hpAng: 0, filletR: 0, chamA: 0, chamB: 0, offsetD: 10, textStyle: 'Standard' };
    this.dim = { ...DIMDEF }; this.dimRev = 1;
    this.seq = 1; this.undoS = []; this.redoS = [];
    this.groups = {}; this.geo = null;
    this.imgs = {}; // data gambar raster (key → dataURL), di luar snapshot undo
  }
  newId() { return this.seq++; }
  allEnts() { return [this.model, ...this.layouts.map(l => l.ents)].flat(); }
  findList(id) { if (this.model.some(e => e.id === id)) return this.model; for (const l of this.layouts) if (l.ents.some(e => e.id === id)) return l.ents; return null; }
  addLayer(name, props = {}) { if (!this.layers[name]) this.layers[name] = { color: 7, lt: 'Continuous', lw: -3, on: true, frz: false, lck: false, plot: true, desc: '', ...props }; return this.layers[name]; }
  ensureLayer(name) { if (!this.layers[name]) this.addLayer(name); }
  prep(e) {
    if (!e.id) e.id = this.newId();
    if (!e.layer) e.layer = this.clayer;
    if (e.color === undefined) e.color = this.set.ccolor;
    if (e.lt === undefined) e.lt = this.set.clt;
    if (e.lw === undefined) e.lw = this.set.clw;
    this.ensureLayer(e.layer);
    return e;
  }
  // ---- Undo (snapshot per perintah) ----
  state() { return JSON.stringify({ model: this.model, layouts: this.layouts, layers: this.layers, clayer: this.clayer, blocks: this.blocks, set: this.set, dim: this.dim, ltypes: this.ltypes, seq: this.seq, groups: this.groups, geo: this.geo }); }
  load(s) {
    const o = typeof s === 'string' ? JSON.parse(s) : s;
    Object.assign(this, { model: o.model || [], layouts: o.layouts || [newLayout('Layout1')], layers: o.layers, clayer: o.clayer || '0', blocks: o.blocks || {}, set: { ...this.set, ...o.set }, dim: { ...DIMDEF, ...o.dim }, ltypes: o.ltypes || this.ltypes, seq: o.seq || 1, groups: o.groups || {}, geo: o.geo || null });
    if (o.imgs) Object.assign(this.imgs, o.imgs);
    if (!this.layers['0']) this.addLayer('0');
    this.dimRev++;
    for (const b of Object.values(this.blocks)) b.rev = (b.rev || 0) + 1;
  }
  begin() { this._snap = this.state(); }
  commit() {
    if (this._snap == null) return false;
    const now = this.state();
    if (now !== this._snap) { this.undoS.push(this._snap); if (this.undoS.length > 150) this.undoS.shift(); this.redoS = []; this.dirty = true; this._snap = null; return true; }
    this._snap = null; return false;
  }
  undo() { if (!this.undoS.length) return false; this.redoS.push(this.state()); this.load(this.undoS.pop()); this.dirty = true; return true; }
  redo() { if (!this.redoS.length) return false; this.undoS.push(this.state()); this.load(this.redoS.pop()); this.dirty = true; return true; }
  extents(list = this.model) {
    let bb = bbEmpty();
    for (const e of list) { if (e.type === 'xline' || e.type === 'ray') continue; const L = this.layers[e.layer]; if (L && (!L.on || L.frz)) continue; const b = bbox(e, this); if (bbOk(b)) bb = bbUnion(bb, b); }
    return bb;
  }
  imgKeys() { const s = new Set(); const scan = l => l.forEach(e => { if (e.type === 'image' && e.img) s.add(e.img); }); scan(this.model); this.layouts.forEach(L => scan(L.ents)); Object.values(this.blocks).forEach(b => scan(b.ents || [])); return [...s]; }
  toFile(opt = {}) {
    const o = { app: 'AmatuCAD', ver: 1, name: this.name, ...JSON.parse(this.state()) };
    if (!opt.noImgs) { const im = {}; for (const k of this.imgKeys()) if (this.imgs[k]) im[k] = this.imgs[k]; if (Object.keys(im).length) o.imgs = im; }
    return JSON.stringify(o);
  }
}

// ---------- Layout & kop gambar ----------
export function paperSize(L) { const [w, h] = PAPERS[L.paper] || PAPERS.A3; return L.orient === 'P' ? [Math.min(w, h), Math.max(w, h)] : [Math.max(w, h), Math.min(w, h)]; }
export function layoutFrame(L) {
  const [W, H] = paperSize(L), k = Math.max(0.6, Math.min(1.4, W / 420));
  const ml = 20 * Math.min(1, k + 0.2), m = 10 * Math.min(1, k + 0.2);
  const border = { x1: ml, y1: m, x2: W - m, y2: H - m };
  const tbw = L.tb?.on ? Math.round(68 * k) : 0;
  const tbx = border.x2 - tbw;
  const vp = { x1: border.x1 + 4, y1: border.y1 + 4, x2: (tbw ? tbx : border.x2) - 4, y2: border.y2 - 4 };
  return { W, H, k, border, tbx, tbw, vp };
}
export function scaleLabel(s, units = 'mm') {
  const n = UNIT_MM[units] / s;
  if (n >= 1) return '1 : ' + (Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) : n.toFixed(2));
  return (1 / n).toFixed(2).replace(/\.00$/, '') + ' : 1';
}
export function fitVp(L, doc, force) {
  const F = layoutFrame(L), w = F.vp.x2 - F.vp.x1, h = F.vp.y2 - F.vp.y1;
  if (!L.vp || force) {
    const ext = doc.extents(doc.model), u = UNIT_MM[doc.set.units] || 1;
    let s = 1 / 100, cx = 0, cy = 0;
    if (bbOk(ext)) {
      const ew = Math.max(1e-6, (ext.x2 - ext.x1) * u), eh = Math.max(1e-6, (ext.y2 - ext.y1) * u);
      const N = PREF_SCALES.find(n => ew / n <= w * 0.9 && eh / n <= h * 0.9) || Math.ceil(Math.max(ew / (w * .9), eh / (h * .9)));
      s = u / N; cx = (ext.x1 + ext.x2) / 2; cy = (ext.y1 + ext.y2) / 2;
    }
    L.vp = { s, cx, cy, lock: false };
  }
  L.vp.x = F.vp.x1; L.vp.y = F.vp.y1; L.vp.w = w; L.vp.h = h;
  return L.vp;
}
// Entitas kop (koordinat kertas, mm) – dibangkitkan dari data tb
export function titleBlockEnts(L, doc) {
  const F = layoutFrame(L), out = [], k = F.k, b = F.border;
  const ln = (x1, y1, x2, y2, lw = 25) => out.push({ type: 'line', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, layer: 'KOP', color: 7, lt: 'Continuous', lw });
  const tx = (x, y, s, h, ha = 0, bold) => out.push({ type: 'text', p: { x, y }, s: String(s ?? ''), h: h * k, ha, va: 2, rot: 0, layer: 'KOP', color: 7, lt: 'Continuous', lw: bold ? 35 : 18 });
  // bingkai ganda
  out.push({ type: 'pline', pts: [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 }, { x: b.x2, y: b.y2 }, { x: b.x1, y: b.y2 }], closed: true, layer: 'KOP', color: 7, lt: 'Continuous', lw: 70 });
  if (!L.tb?.on) return out;
  const T = L.tb, x = F.tbx, X2 = b.x2, W = X2 - x, cx = x + W / 2, pad = 2.5 * k;
  ln(x, b.y1, x, b.y2, 50);
  const H = b.y2 - b.y1;
  // baris dari atas: [label, nilai, tinggi relatif]
  const rows = [
    ['', T.company, 0.12, 'big'],
    ['PROYEK', T.project, 0.1],
    ['LOKASI', T.location, 0.08],
    ['JUDUL GAMBAR', T.title, 0.12, 'title'],
    ['SKALA', L.vp ? scaleLabel(L.vp.s, doc.set.units) : '-', 0.065, 'half', 'KERTAS', L.paper + (L.orient === 'P' ? ' Potrait' : ' Landscape')],
    ['DIGAMBAR', T.drawn, 0.065, 'sign'],
    ['DIPERIKSA', T.checked, 0.065, 'sign'],
    ['DISETUJUI', T.approved, 0.065, 'sign'],
    ['TANGGAL', T.date, 0.06, 'half', 'REVISI', T.rev || '-'],
    ['CATATAN', T.notes, 0.0, 'notes'],
    ['NO. GAMBAR', T.no, 0.09, 'half', 'LEMBAR', T.sheet],
  ];
  const fixed = rows.reduce((s, r) => s + r[2], 0);
  rows.find(r => r[3] === 'notes')[2] = Math.max(0.06, 1 - fixed);
  let y = b.y2;
  for (const r of rows) {
    const h = r[2] * H, y0 = y - h;
    if (r[3] === 'big') { tx(cx, y - h * 0.38, r[1], 3.2, 1, 1); tx(cx, y - h * 0.68, 'KONSULTAN PERENCANA', 1.8, 1); }
    else if (r[3] === 'half') {
      ln(cx, y, cx, y0, 18);
      tx(x + pad, y - 3 * k, r[0], 1.6); tx(x + pad, y - h * 0.62, r[1], 2.4, 0, 1);
      tx(cx + pad, y - 3 * k, r[4], 1.6); tx(cx + pad, y - h * 0.62, r[5], 2.4, 0, 1);
    } else if (r[3] === 'notes') {
      tx(x + pad, y - 3 * k, r[0], 1.6);
      const words = String(r[1] || '').split(' '); let line = '', yy = y - 7 * k; const maxc = Math.floor(W / (1.9 * k));
      for (const w of words) { if ((line + ' ' + w).trim().length > maxc) { tx(x + pad, yy, line.trim(), 1.9); yy -= 3.2 * k; line = w; } else line += ' ' + w; }
      if (line.trim()) tx(x + pad, yy, line.trim(), 1.9);
    } else if (r[3] === 'sign') {
      tx(x + pad, y - 3 * k, r[0], 1.6); tx(x + pad, y - h * 0.65, r[1], 2.2, 0, 1); ln(x + W * 0.55, y0 + h * 0.25, X2 - pad, y0 + h * 0.25, 13); tx(x + W * 0.55, y - 3 * k, 'PARAF', 1.4);
    } else {
      tx(x + pad, y - 3 * k, r[0], 1.6);
      const big = r[3] === 'title' ? 3.2 : 2.6;
      String(r[1] || '').split('\n').forEach((s, i) => tx(cx, y - h * 0.55 - i * big * 1.5 * k, s, big, 1, 1));
    }
    ln(x, y0, X2, y0, 25);
    y = y0;
  }
  return out;
}
