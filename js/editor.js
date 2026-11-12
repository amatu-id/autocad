// Editor: tampilan, input mouse/keyboard/gesture, OSNAP, polar/otrack, seleksi, grip, prompt perintah.
import { TAU, D2R, R2D, add, sub, mul, dot, crs, len, dist, ang, polar, unit, perp, an, evalNum, rectOf, bbOk, inPoly, interPrim, closestPrim, onArc, M, eq } from './geom.js';
import { prims, gprims, snaps, grips, gripMove, hit, inWindow, inPolygon, onFence, bbox, xform, TYPE_NAMES } from './ent.js';
import { drawEntities, drawEnt, drawGrid, drawLayout, vpView, viewToVp, styleOf } from './render.js';
import { fitVp, layoutFrame, paperSize } from './doc.js';

export class Cancel extends Error { constructor() { super('*Cancel*'); } }
export const OSNAP_NAMES = { end: 'Endpoint', mid: 'Midpoint', cen: 'Center', gcen: 'Geometric Center', nod: 'Node', qua: 'Quadrant', int: 'Intersection', ext: 'Extension', ins: 'Insertion', per: 'Perpendicular', tan: 'Tangent', nea: 'Nearest', app: 'Apparent Intersection', par: 'Parallel' };
const OSNAP_PRI = { end: 1, int: 1, mid: 2, cen: 2, gcen: 2, qua: 2, nod: 1, ins: 1, per: 3, tan: 3, ext: 4, nea: 9 };

export class Editor {
  constructor(app, cv) {
    this.app = app; this.cv = cv; // {base, sel, over, wrap}
    this.T = { grid: true, snap: false, ortho: false, polar: true, osnap: true, otrack: true, dyn: true, lwt: false, qp: false, tp: false };
    this.os = new Set(['end', 'mid', 'cen', 'int', 'ext']);
    this.opt = { aperture: 10, pickbox: 5, cursor: 5, bg: '#212830', rightClick: 'menu', wheel: 'auto', gripSize: 5, polarInc: 90, polarExtra: [], snapX: 10, snapY: 10, gridX: 10, autosave: true };
    this.req = null; this.cmd = null; this.queue = []; this.lastCmd = null; this.lastPt = { x: 0, y: 0 };
    this.mouse = { sx: 0, sy: 0, in: false }; this.wpt = { x: 0, y: 0 }; this.spt = { x: 0, y: 0 }; this.snapInfo = null; this.track = null;
    this.acq = []; this.hover = null; this.win = null; this.lasso = null; this.tmpSel = new Set(); this.hotGrip = null;
    this.dirty = { base: true, sel: true, over: true };
    this.cmds = {}; this.alias = {};
    this.overrideSnap = null;
    this.bind();
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  get doc() { return this.app.doc; }
  get ui() { return this.app.ui; }
  get U() { return this.doc.ui; }
  get layout() { return this.U.space >= 0 ? this.doc.layouts[this.U.space] : null; }
  get ents() { const L = this.layout; return !L || this.U.ms ? this.doc.model : L.ents; }
  get sel() { return this.U.sel; }
  pv() { const L = this.layout; return this.U.pviews[L.name] ||= this.fitPaperView(L); }
  get view() {
    const L = this.layout, s = this.size();
    if (!L) return { ...this.U.view, w: s.w, h: s.h };
    const pv = { ...this.pv(), w: s.w, h: s.h };
    if (this.U.ms) { const vp = fitVp(L, this.doc); return { ...vpView(pv, vp), w: s.w, h: s.h }; }
    return pv;
  }
  setView(v) {
    const L = this.layout;
    if (!L) Object.assign(this.U.view, { scale: v.scale, ox: v.ox, oy: v.oy });
    else if (this.U.ms) { const vp = fitVp(L, this.doc); if (vp.lock) { this.msg('Viewport terkunci.'); return; } viewToVp(this.pv(), vp, v); }
    else Object.assign(this.pv(), { scale: v.scale, ox: v.ox, oy: v.oy });
    this.invalidate();
  }
  fitPaperView(L) { const s = this.size(), [W, H] = paperSize(L), k = Math.min(s.w / (W * 1.12), s.h / (H * 1.12)); return { scale: k, ox: s.w / 2 - W / 2 * k, oy: s.h / 2 + H / 2 * k }; }
  size() { const r = this.cv.wrap.getBoundingClientRect(); return { w: Math.max(10, r.width), h: Math.max(10, r.height) }; }
  s2w(sx, sy, v = this.view) { return { x: (sx - v.ox) / v.scale, y: (v.oy - sy) / v.scale }; }
  w2s(p, v = this.view) { return { x: v.ox + p.x * v.scale, y: v.oy - p.y * v.scale }; }
  invalidate(which = 'all') { if (which === 'all') this.dirty = { base: true, sel: true, over: true }; else this.dirty[which] = true; }
  regen() { this.invalidate(); }
  msg(s, cls) { this.ui?.print(s, cls); }

  // ---------- Render loop ----------
  resize() {
    const s = this.size(), d = devicePixelRatio || 1;
    if (Math.round(s.w * d) === this.cv.base.width && Math.round(s.h * d) === this.cv.base.height) return;
    for (const c of [this.cv.base, this.cv.sel, this.cv.over]) { c.width = Math.round(s.w * d); c.height = Math.round(s.h * d); c.style.width = s.w + 'px'; c.style.height = s.h + 'px'; }
    this.invalidate();
    if (!this.inFrame) this.frame();   // resizing cleared the canvases: redraw now, not a frame later
  }
  ctx(c) { const x = c.getContext('2d'), d = devicePixelRatio || 1; x.setTransform(d, 0, 0, d, 0, 0); return x; }
  frame() {
    if (!this.doc) return;
    this.inFrame = true;
    try { this.frameNow(); } finally { this.inFrame = false; }
  }
  frameNow() {
    const s = this.size();
    if (Math.round(s.w * (devicePixelRatio || 1)) !== this.cv.base.width || Math.round(s.h * (devicePixelRatio || 1)) !== this.cv.base.height) this.resize();
    if (this.dirty.base) { this.drawBase(); this.dirty.base = false; }
    if (this.dirty.sel) { this.drawSel(); this.dirty.sel = false; }
    if (this.dirty.over) { this.drawOver(); this.dirty.over = false; }
  }
  drawBase() {
    const c = this.ctx(this.cv.base), v = this.view, L = this.layout;
    c.save();
    if (!L) {
      c.fillStyle = this.opt.bg; c.fillRect(0, 0, v.w, v.h);
      if (this.T.grid) drawGrid(c, v, this.opt.gridX, { minor: 'rgba(255,255,255,0.045)', major: 'rgba(255,255,255,0.10)', ax: 'rgba(230,80,80,0.35)', ay: 'rgba(80,200,90,0.35)' });
      if (this.underlay) try { this.underlay(c, v); } catch (err) { console.warn(err); } // foto pemandu animasi Auto Trace
      drawEntities(c, this.visible(this.doc.model), this.doc, v, { bg: 'dark', lwt: this.T.lwt, bgColor: this.opt.bg });
    } else {
      c.fillStyle = '#3b4048'; c.fillRect(0, 0, v.w, v.h);
      drawLayout(c, L, this.doc, { ...this.pv(), w: v.w, h: v.h }, { lwt: this.T.lwt || true, vpActive: this.U.ms, mono: L.ctb === 'monochrome.ctb' && false });
    }
    c.restore();
    this.ui?.onRegen?.();
  }
  visible(list) {
    const I = this.app.isoSet, H = this.app.hideSet, A = this.animHide; // A: entitas yang belum "tergambar" oleh animasi Auto Trace
    const l = I ? list.filter(e => I.has(e)) : H ? list.filter(e => !H.has(e)) : list;
    return A?.size ? l.filter(e => !A.has(e)) : l;
  }
  drawSel() {
    const c = this.ctx(this.cv.sel), v = this.view;
    c.clearRect(0, 0, v.w, v.h);
    const bg = this.layout && !this.U.ms ? 'paper' : this.layout ? 'paper' : 'dark';
    const clip = this.vpClip(c);
    const set = new Set([...this.sel, ...this.tmpSel]);
    if (set.size) {
      c.globalAlpha = 0.9;
      for (const e of set) { if (!this.ents.includes(e)) continue; drawEnt(c, e, this.doc, v, { override: { color: bg === 'paper' ? '#1E6FFF' : '#6FB6FF', width: 3, dash: null }, bg }); }
      c.globalAlpha = 1;
      for (const e of set) { if (!this.ents.includes(e)) continue; drawEnt(c, e, this.doc, v, { override: { color: bg === 'paper' ? '#0B3FA8' : '#E8F3FF', width: 1, dash: [6, 3] }, bg }); }
    }
    if (clip) c.restore();
    // grip
    if (!this.req && this.sel.size && this.sel.size <= 200) {
      const g = this.opt.gripSize;
      for (const e of this.sel) for (const G of grips(e, this.doc)) {
        const s = this.w2s(G.p);
        const hot = this.hotGrip && eq(this.hotGrip.p, G.p);
        c.fillStyle = hot ? '#FF2A2A' : '#2E6BFF'; c.strokeStyle = '#0A1A40';
        c.fillRect(s.x - g, s.y - g, g * 2, g * 2); c.strokeRect(s.x - g + .5, s.y - g + .5, g * 2 - 1, g * 2 - 1);
      }
    }
  }
  vpClip(c) {
    const L = this.layout; if (!L || !this.U.ms) return false;
    const vp = fitVp(L, this.doc), pv = this.pv();
    c.save(); c.beginPath(); c.rect(pv.ox + vp.x * pv.scale, pv.oy - (vp.y + vp.h) * pv.scale, vp.w * pv.scale, vp.h * pv.scale); c.clip(); return true;
  }
  drawOver() {
    const c = this.ctx(this.cv.over), v = this.view, m = this.mouse;
    c.clearRect(0, 0, v.w, v.h);
    const paper = !!this.layout;
    const fg = paper ? '#111' : '#FFFFFF';
    // hover
    if (this.hover && !this.sel.has(this.hover) && this.ents.includes(this.hover)) drawEnt(c, this.hover, this.doc, v, { override: { color: paper ? '#1E6FFF' : '#9CCBFF', width: 2.5 }, bg: paper ? 'paper' : 'dark' });
    // pratinjau perintah
    const R = this.req;
    if (R && R.preview && m.in) {
      let list = []; try { list = R.preview(this.spt) || []; } catch (err) { console.warn(err); }
      for (const e of list) { if (!e) continue; if (!e.id) e.id = -1; this.doc.prep(e); drawEnt(c, e, this.doc, v, { bg: paper ? 'paper' : 'dark', lwt: this.T.lwt }); }
    }
    if (R && R.inplace) {
      const t = this.ui?.cmdValue?.() || '', q = R.inplace;
      const e = this.doc.prep({ id: -1, type: 'text', p: q.p, h: q.h, rot: q.rot, ha: q.ha, va: q.va, s: t + '|' });
      drawEnt(c, e, this.doc, v, { bg: paper ? 'paper' : 'dark' });
    }
    if (R && R.base && R.rubber && m.in) {
      const a = this.w2s(R.base), b = this.w2s(this.spt);
      c.strokeStyle = paper ? '#333' : '#DDD'; c.setLineDash(R.rubber === 'dash' ? [4, 4] : []); c.lineWidth = 1;
      c.beginPath();
      if (R.rubber === 'rect') { c.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
      else { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
      c.stroke(); c.setLineDash([]);
    }
    // jendela seleksi
    if (this.win && m.in) {
      const a = this.w2s(this.win.p), b = { x: m.sx, y: m.sy }, cross = b.x < a.x;
      c.fillStyle = cross ? 'rgba(40,200,90,0.16)' : 'rgba(40,110,255,0.16)'; c.strokeStyle = cross ? '#4BE38A' : '#6EA2FF';
      c.setLineDash(cross ? [5, 4] : []); c.lineWidth = 1;
      if (this.win.poly) { const P = [...this.win.poly.map(p => this.w2s(p)), b]; c.beginPath(); P.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); if (this.win.poly.mode !== 'F') { c.closePath(); c.fill(); } c.stroke(); }
      else { c.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); c.strokeRect(Math.min(a.x, b.x) + .5, Math.min(a.y, b.y) + .5, Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
      c.setLineDash([]);
    }
    if (this.lasso && this.lasso.pts.length > 1) {
      const cross = this.lasso.cross;
      c.fillStyle = cross ? 'rgba(40,200,90,0.16)' : 'rgba(40,110,255,0.16)'; c.strokeStyle = cross ? '#4BE38A' : '#6EA2FF'; c.setLineDash(cross ? [5, 4] : []);
      c.beginPath(); this.lasso.pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.fill(); c.stroke(); c.setLineDash([]);
    }
    // jalur tracking
    if (this.track && m.in) {
      c.strokeStyle = '#3EE07A'; c.setLineDash([2, 4]); c.lineWidth = 1; c.beginPath();
      for (const t of this.track.paths) { const a = this.w2s(t.o), d = { x: Math.cos(t.a), y: -Math.sin(t.a) }; const B = 4000; c.moveTo(t.ray ? a.x : a.x - d.x * B, t.ray ? a.y : a.y - d.y * B); c.lineTo(a.x + d.x * B, a.y + d.y * B); }
      c.stroke(); c.setLineDash([]);
      const s = this.w2s(this.spt); c.strokeStyle = '#3EE07A'; c.beginPath(); c.moveTo(s.x - 5, s.y - 5); c.lineTo(s.x + 5, s.y + 5); c.moveTo(s.x + 5, s.y - 5); c.lineTo(s.x - 5, s.y + 5); c.stroke();
    }
    for (const a of this.acq) { const s = this.w2s(a.p); c.strokeStyle = '#3EE07A'; c.lineWidth = 1; c.beginPath(); c.moveTo(s.x - 4, s.y); c.lineTo(s.x + 4, s.y); c.moveTo(s.x, s.y - 4); c.lineTo(s.x, s.y + 4); c.stroke(); }
    // marker OSNAP
    if (this.snapInfo && m.in) this.drawMarker(c, this.snapInfo);
    // crosshair
    if (m.in && !this.panning) {
      const snapS = this.req && this.req.type !== 'sel' && this.req.type !== 'ent' ? this.w2s(this.spt) : { x: m.sx, y: m.sy };
      const x = Math.round(snapS.x) + .5, y = Math.round(snapS.y) + .5;
      const pct = this.opt.cursor >= 100 ? 1e4 : Math.max(v.w, v.h) * this.opt.cursor / 100 / 2;
      const box = !this.req || this.req.type === 'sel' || this.req.type === 'ent';
      const pb = this.opt.pickbox;
      c.strokeStyle = paper ? '#222' : fg; c.lineWidth = 1; c.beginPath();
      if (this.req?.type === 'sel' || this.req?.type === 'ent' || !this.req || this.req.cross !== false) {
        c.moveTo(x - pct, y); c.lineTo(box ? x - pb : x, y); c.moveTo(box ? x + pb : x, y); c.lineTo(x + pct, y);
        c.moveTo(x, y - pct); c.lineTo(x, box ? y - pb : y); c.moveTo(x, box ? y + pb : y); c.lineTo(x, y + pct);
      }
      if (box) c.rect(x - pb, y - pb, pb * 2, pb * 2);
      c.stroke();
    }
    // ikon UCS
    this.drawUCS(c, v, paper);
    if (this.anim) try { this.anim(c, v); } catch (err) { console.warn(err); } // pena animasi Auto Trace
    this.ui?.onOver?.();
  }
  drawMarker(c, S) {
    const s = this.w2s(S.p), r = 6;
    c.save(); c.strokeStyle = '#7CFC00'; c.lineWidth = 2; c.beginPath();
    switch (S.k) {
      case 'end': c.rect(s.x - r, s.y - r, r * 2, r * 2); break;
      case 'mid': c.moveTo(s.x, s.y - r); c.lineTo(s.x + r, s.y + r * .8); c.lineTo(s.x - r, s.y + r * .8); c.closePath(); break;
      case 'cen': c.arc(s.x, s.y, r, 0, TAU); break;
      case 'gcen': c.arc(s.x, s.y, r, 0, TAU); c.moveTo(s.x - 2, s.y); c.lineTo(s.x + 2, s.y); break;
      case 'nod': c.arc(s.x, s.y, r, 0, TAU); c.moveTo(s.x - r * .7, s.y - r * .7); c.lineTo(s.x + r * .7, s.y + r * .7); c.moveTo(s.x + r * .7, s.y - r * .7); c.lineTo(s.x - r * .7, s.y + r * .7); break;
      case 'qua': c.moveTo(s.x, s.y - r); c.lineTo(s.x + r, s.y); c.lineTo(s.x, s.y + r); c.lineTo(s.x - r, s.y); c.closePath(); break;
      case 'int': c.moveTo(s.x - r, s.y - r); c.lineTo(s.x + r, s.y + r); c.moveTo(s.x + r, s.y - r); c.lineTo(s.x - r, s.y + r); break;
      case 'ins': c.rect(s.x - r, s.y - r, r, r); c.rect(s.x, s.y, r, r); break;
      case 'per': c.moveTo(s.x - r, s.y - r); c.lineTo(s.x - r, s.y + r); c.lineTo(s.x + r, s.y + r); c.moveTo(s.x - r, s.y); c.lineTo(s.x, s.y); c.lineTo(s.x, s.y + r); break;
      case 'tan': c.arc(s.x, s.y, r, 0, TAU); c.moveTo(s.x - r, s.y - r); c.lineTo(s.x + r, s.y - r); break;
      case 'nea': c.moveTo(s.x - r, s.y - r); c.lineTo(s.x + r, s.y - r); c.lineTo(s.x - r, s.y + r); c.lineTo(s.x + r, s.y + r); c.closePath(); break;
      case 'ext': c.moveTo(s.x - r, s.y); c.lineTo(s.x + r, s.y); c.moveTo(s.x - 2, s.y - 3); c.lineTo(s.x + 2, s.y - 3); break;
      default: c.rect(s.x - r, s.y - r, r * 2, r * 2);
    }
    c.stroke();
    const label = OSNAP_NAMES[S.k] + (S.extra ? ': ' + S.extra : '');
    c.font = '12px system-ui, sans-serif'; const w = c.measureText(label).width + 10;
    c.fillStyle = 'rgba(255,253,220,0.96)'; c.fillRect(s.x + 14, s.y + 14, w, 18); c.strokeStyle = '#8a8a6a'; c.lineWidth = 1; c.strokeRect(s.x + 14.5, s.y + 14.5, w - 1, 17);
    c.fillStyle = '#222'; c.fillText(label, s.x + 19, s.y + 27);
    c.restore();
  }
  drawUCS(c, v, paper) {
    const o = this.layout && !this.U.ms ? { x: 14, y: v.h - 14 } : { x: 30, y: v.h - 30 };
    c.save(); c.lineWidth = 2;
    if (this.layout && !this.U.ms) { c.strokeStyle = '#555'; c.beginPath(); c.moveTo(o.x, o.y - 30); c.lineTo(o.x, o.y); c.lineTo(o.x + 30, o.y); c.lineTo(o.x, o.y - 30); c.stroke(); c.restore(); return; }
    c.strokeStyle = '#E04A4A'; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x + 42, o.y); c.stroke();
    c.fillStyle = '#E04A4A'; c.beginPath(); c.moveTo(o.x + 48, o.y); c.lineTo(o.x + 40, o.y - 4); c.lineTo(o.x + 40, o.y + 4); c.fill();
    c.strokeStyle = '#4CC75A'; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x, o.y - 42); c.stroke();
    c.fillStyle = '#4CC75A'; c.beginPath(); c.moveTo(o.x, o.y - 48); c.lineTo(o.x - 4, o.y - 40); c.lineTo(o.x + 4, o.y - 40); c.fill();
    c.fillStyle = paper ? '#333' : '#CFD6DE'; c.font = 'bold 11px system-ui'; c.fillText('X', o.x + 50, o.y + 4); c.fillText('Y', o.x - 3, o.y - 52);
    c.fillStyle = '#9AA3AD'; c.fillRect(o.x - 3, o.y - 3, 6, 6);
    c.restore();
  }

  // ---------- Zoom/Pan ----------
  zoomAt(sx, sy, f) {
    const v = this.view, w = this.s2w(sx, sy, v);
    const scale = Math.min(1e8, Math.max(1e-8, v.scale * f));
    this.setView({ scale, ox: sx - w.x * scale, oy: sy + w.y * scale });
  }
  panBy(dx, dy) { const v = this.view; this.setView({ scale: v.scale, ox: v.ox + dx, oy: v.oy + dy }); }
  zoomRect(bb, pad = 1.08) {
    if (!bbOk(bb)) return;
    const v = this.view, w = Math.max(1e-9, bb.x2 - bb.x1), h = Math.max(1e-9, bb.y2 - bb.y1);
    let scale = Math.min(v.w / (w * pad), v.h / (h * pad));
    if (!isFinite(scale) || scale <= 0) scale = 1;
    if (w < 1e-6 && h < 1e-6) scale = v.scale;
    this.setView({ scale, ox: v.w / 2 - (bb.x1 + bb.x2) / 2 * scale, oy: v.h / 2 + (bb.y1 + bb.y2) / 2 * scale });
  }
  zoomExtents() {
    if (this.layout && !this.U.ms) { this.U.pviews[this.layout.name] = this.fitPaperView(this.layout); this.invalidate(); return; }
    const bb = this.doc.extents(this.ents);
    if (bbOk(bb)) this.zoomRect(bb); else { const v = this.view; this.setView({ scale: v.w / 420, ox: v.w * 0.05, oy: v.h * 0.95 }); }
  }
  pushView() { (this.U.vstack ||= []).push(JSON.stringify(this.view)); if (this.U.vstack.length > 20) this.U.vstack.shift(); }

  // ---------- Snap & tracking ----------
  nearEnts(w, tol, limit = 60) {
    const out = [];
    for (let i = this.ents.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.ents[i], L = this.doc.layers[e.layer];
      if (L && (!L.on || L.frz)) continue;
      if (e.type === 'xline' || e.type === 'ray') { if (gprims(e, this.doc).some(q => dist(w, closestPrim(w, q)) < tol)) out.push(e); continue; }
      const b = bbox(e, this.doc);
      if (w.x < b.x1 - tol || w.x > b.x2 + tol || w.y < b.y1 - tol || w.y > b.y2 + tol) continue;
      out.push(e);
    }
    return out;
  }
  computeSnap() {
    const v = this.view, R = this.req, w = this.s2w(this.mouse.sx, this.mouse.sy, v);
    this.wpt = w; this.snapInfo = null; this.track = null;
    let p = w;
    if (!R || R.type === 'sel' || R.type === 'ent' || R.noSnap) { this.spt = w; return; }
    const base = R.base, tol = this.opt.aperture / v.scale;
    const ov = this.overrideSnap, modes = ov ? new Set(ov === 'non' ? [] : [ov]) : (this.T.osnap ? this.os : new Set());
    let best = null;
    if (modes.size) {
      const near = this.nearEnts(w, tol), cand = [];
      for (const e of near) {
        if (e.type === 'hatch') continue;
        for (const s of snaps(e, this.doc)) if (modes.has(s.k) && dist(s.p, w) < tol) cand.push({ k: s.k, p: s.p, e });
      }
      if (modes.has('int')) {
        const G = near.slice(0, 30).map(e => gprims(e, this.doc).filter(q => q.t !== 'P' || q.pts.length < 400));
        for (let i = 0; i < G.length; i++) {
          for (let j = i; j < G.length; j++) for (const a of G[i]) for (const b of G[j]) {
            if (i === j && a === b) continue;
            if (i === j && near[i].type !== 'pline') continue;
            for (const x of interPrim(a, b)) if (dist(x, w) < tol) cand.push({ k: 'int', p: x });
          }
        }
      }
      if (base && (modes.has('per') || modes.has('tan'))) {
        for (const e of near) for (const q of gprims(e, this.doc)) {
          if (modes.has('per')) {
            if (q.t === 'L') { const d = sub(q.b, q.a), t = dot(sub(base, q.a), d) / dot(d, d), f = add(q.a, mul(d, t)); if (dist(f, w) < tol) cand.push({ k: 'per', p: f }); }
            if (q.t === 'A') { const f = polar(q.c, ang(q.c, base), q.r); if (dist(f, w) < tol) cand.push({ k: 'per', p: f }); }
          }
          if (modes.has('tan') && q.t === 'A') {
            const d = dist(base, q.c); if (d > q.r) { const a0 = ang(q.c, base), da = Math.acos(q.r / d); for (const a of [a0 + da, a0 - da]) { const f = polar(q.c, a, q.r); if (dist(f, w) < tol && (q.full || onArc(a, q.sa, q.ea))) cand.push({ k: 'tan', p: f }); } }
          }
        }
      }
      if (modes.has('nea') && !cand.length) {
        for (const e of near) for (const q of gprims(e, this.doc)) { const f = closestPrim(w, q); if (dist(f, w) < tol) cand.push({ k: 'nea', p: f }); }
      }
      if (cand.length) {
        cand.sort((a, b) => (OSNAP_PRI[a.k] - OSNAP_PRI[b.k]) * tol * 0.25 + dist(a.p, w) - dist(b.p, w));
        best = cand[0];
      }
    }
    if (best) {
      p = best.p; this.snapInfo = best;
      // akuisisi titik untuk OTRACK
      const key = best.k + Math.round(best.p.x * 1e4) + ',' + Math.round(best.p.y * 1e4);
      if (this._acqKey !== key) { this._acqKey = key; clearTimeout(this._acqT); if (this.T.otrack || this.os.has('ext')) this._acqT = setTimeout(() => this.acquire(best), 450); }
    } else {
      this._acqKey = null; clearTimeout(this._acqT);
      if (this.T.snap) { const sx = this.opt.snapX, sy = this.opt.snapY; p = { x: Math.round(w.x / sx) * sx, y: Math.round(w.y / sy) * sy }; }
      // jalur: otrack + ext + polar
      const paths = [];
      if (this.T.otrack) for (const a of this.acq) { paths.push({ o: a.p, a: 0, k: 'trk' }, { o: a.p, a: Math.PI / 2, k: 'trk' }); }
      if (this.os.has('ext') && this.T.osnap) for (const a of this.acq) if (a.dir != null) paths.push({ o: a.p, a: a.dir, k: 'ext', ray: true });
      if (base && this.T.polar && !this.T.ortho) {
        const incs = [this.opt.polarInc * D2R, ...this.opt.polarExtra.map(x => x * D2R)];
        for (const inc of incs) for (let a = 0; a < TAU - 1e-9; a += inc) paths.push({ o: base, a, k: 'polar', ray: true });
      }
      if (base && this.T.ortho) { const d = sub(w, base); p = Math.abs(d.x) >= Math.abs(d.y) ? { x: w.x, y: base.y } : { x: base.x, y: w.y }; }
      const hits = [];
      for (const t of paths) {
        const u = { x: Math.cos(t.a), y: Math.sin(t.a) }, s = dot(sub(w, t.o), u);
        if (t.ray && s < 0) continue;
        const f = add(t.o, mul(u, s));
        if (dist(f, w) < tol * 0.9) hits.push({ ...t, f, d: dist(f, w), u });
      }
      if (hits.length) {
        hits.sort((a, b) => a.d - b.d);
        let h = hits[0], q = h.f, used = [h];
        for (const g of hits.slice(1)) {
          if (Math.abs(crs(h.u, g.u)) < 1e-6) continue;
          const x = interPrim({ t: 'L', a: h.o, b: add(h.o, h.u), inf: 2 }, { t: 'L', a: g.o, b: add(g.o, g.u), inf: 2 })[0];
          if (x && dist(x, w) < tol) { q = x; used = [h, g]; break; }
        }
        p = q; this.track = { paths: used };
        if (h.k === 'ext') this.snapInfo = { k: 'ext', p: q, extra: '' };
        const ref = used.length === 1 ? used[0] : null;
        if (ref) this.track.label = (ref.k === 'polar' ? 'Polar: ' : ref.k === 'ext' ? 'Extension: ' : 'Track: ') + this.fmt(dist(ref.o, q)) + ' < ' + (an(ang(ref.o, q)) * R2D).toFixed(0) + '°';
        else this.track.label = 'Intersection';
      }
    }
    this.spt = p;
  }
  acquire(s) {
    const i = this.acq.findIndex(a => eq(a.p, s.p, 1e-9));
    if (i >= 0) this.acq.splice(i, 1);
    else {
      let dir = null;
      if (s.k === 'end' && s.e) {
        const q = gprims(s.e, this.doc).find(q => q.t === 'L' && (eq(q.a, s.p, 1e-7) || eq(q.b, s.p, 1e-7)));
        if (q) dir = eq(q.b, s.p, 1e-7) ? ang(q.a, q.b) : ang(q.b, q.a);
      }
      this.acq.push({ p: s.p, dir }); if (this.acq.length > 7) this.acq.shift();
    }
    this.invalidate('over');
  }
  fmt(v) { const p = this.doc.set.prec ?? 2; return (Math.round(v * 10 ** p) / 10 ** p).toFixed(p); }

  // ---------- Hit/seleksi ----------
  pick(sx, sy) {
    const w = this.s2w(sx, sy), tol = this.opt.pickbox / this.view.scale;
    for (let i = this.ents.length - 1; i >= 0; i--) {
      const e = this.ents[i], L = this.doc.layers[e.layer];
      if (L && (!L.on || L.frz)) continue;
      if (hit(e, w, tol, this.doc)) return e;
    }
    return null;
  }
  pickAll(sx, sy) { const w = this.s2w(sx, sy), tol = this.opt.pickbox / this.view.scale; return this.ents.filter(e => { const L = this.doc.layers[e.layer]; return (!L || (L.on && !L.frz)) && hit(e, w, tol, this.doc); }).reverse(); }
  selectable(e) { const L = this.doc.layers[e.layer]; return !L || (L.on && !L.frz); }
  windowSel(a, b, forceCross) {
    const r = rectOf(a, b), cross = forceCross ?? (this.w2s(b).x < this.w2s(a).x);
    return this.ents.filter(e => this.selectable(e) && inWindow(e, r, cross, this.doc));
  }
  polySel(poly, cross) { return this.ents.filter(e => this.selectable(e) && inPolygon(e, poly, cross, this.doc)); }
  fenceSel(pts) { const out = new Set(); for (let i = 0; i < pts.length - 1; i++) this.ents.forEach(e => { if (this.selectable(e) && onFence(e, pts[i], pts[i + 1], this.doc)) out.add(e); }); return [...out]; }
  setSel(list, mode = 'set') {
    if (mode === 'set') this.sel.clear();
    for (const e of list) { if (mode === 'remove') this.sel.delete(e); else this.sel.add(e); }
    this.hotGrip = null; this.invalidate('sel'); this.invalidate('over'); this.ui?.onSel?.();
  }
  clearSel() { this.setSel([]); }
  locked(e) { const L = this.doc.layers[e.layer]; return L && L.lck; }

  // ---------- Prompt ----------
  ask(req) {
    return new Promise((resolve, reject) => {
      this.req = { ...req, resolve, reject };
      this.acq = req.keepAcq ? this.acq : []; this.overrideSnap = null; this.win = null;
      this.ui?.prompt(this.req);
      this.computeSnap(); this.invalidate('over'); this.invalidate('sel');
      if (this.queue.length) { const q = this.queue.shift(); if (q !== '\\') setTimeout(() => this.submit(q), 0); }
    });
  }
  finish(val) { const R = this.req; if (!R) return; this.req = null; this.win = null; this.track = null; this.snapInfo = null; R.resolve(val); }
  cancelReq() { const R = this.req; if (!R) return; this.req = null; this.win = null; this.track = null; R.reject(new Cancel()); }
  kwMatch(s, kws) {
    if (!kws) return null; const u = s.toUpperCase().replace(/^_/, '');
    for (const k of kws) { const key = (k.match(/[A-Z0-9]/g) || []).join(''); if (u === key || u === k.toUpperCase()) return k; }
    for (const k of kws) if (k.toUpperCase().startsWith(u) && u.length) return k;
    return null;
  }
  parsePoint(s, base) {
    s = s.trim(); if (!s) return null;
    let rel = false, abs = false;
    if (s[0] === '#') { abs = true; s = s.slice(1); }
    else if (s[0] === '@') { rel = true; s = s.slice(1); if (!s) return { ...this.lastPt }; }
    if (!abs && !rel && base && this.T.dyn && this.req?.dynRel !== false) rel = true;
    const o = rel ? (base || this.lastPt) : { x: 0, y: 0 };
    let m = s.match(/^([^<]+)<([^<]+)$/);
    if (m) { const d = evalNum(m[1]), a = evalNum(m[2]); if (isFinite(d) && isFinite(a)) return polar(o, a * D2R, d); return null; }
    const parts = s.split(/\s*,\s*/);
    if (parts.length >= 2) { const x = evalNum(parts[0]), y = evalNum(parts[1]); if (isFinite(x) && isFinite(y)) return { x: o.x + x, y: o.y + y }; }
    return null;
  }
  // input teks dari command line / dyn
  submit(text) {
    text = String(text ?? '');
    const t = text.trim(), R = this.req;
    if (R) this.ui?.echo(R, t);
    if (!R) {
      if (!t) { if (this.lastCmd) this.run(this.lastCmd); return; }
      this.runText(t); return;
    }
    const kw = t ? this.kwMatch(t, R.kws) : null;
    // override osnap
    const osn = { END: 'end', ENDP: 'end', MID: 'mid', CEN: 'cen', GCE: 'gcen', NOD: 'nod', QUA: 'qua', INT: 'int', INS: 'ins', PER: 'per', TAN: 'tan', NEA: 'nea', EXT: 'ext', NON: 'non', NONE: 'non' };
    if (R.type === 'point' && !kw && osn[t.toUpperCase()]) { this.overrideSnap = osn[t.toUpperCase()]; this.msg(`  (override: ${OSNAP_NAMES[this.overrideSnap] || 'None'})`); return; }
    if (R.type === 'point' && /^(M2P|MTP)$/i.test(t)) { this.midBetween(); return; }
    if (R.type === 'point' && /^FROM$/i.test(t)) { this.fromPoint(); return; }
    if (kw) { this.finish(kw); return; }
    if (!t) { this.finish(R.def !== undefined ? R.def : null); return; }
    switch (R.type) {
      case 'point': {
        let p = this.parsePoint(t, R.base);
        if (!p && R.base) { const d = evalNum(t); if (isFinite(d)) { const a = this.dynAng ?? (eq(this.spt, R.base) ? 0 : ang(R.base, this.spt)); p = polar(R.base, a, d); } }
        if (!p && !R.base) { const d = evalNum(t); if (isFinite(d) && R.numOk) { this.finish(d); return; } }
        if (!p) { this.msg('Titik tidak valid atau kata kunci tidak dikenal.', 'err'); this.ui?.prompt(R); return; }
        this.lastPt = p; this.finish(p); return;
      }
      case 'dist': case 'num': case 'int': {
        const v = evalNum(t);
        if (!isFinite(v) || (R.type === 'int' && !Number.isInteger(v))) { this.msg(R.type === 'int' ? 'Masukkan bilangan bulat.' : 'Memerlukan angka atau dua titik.', 'err'); this.ui?.prompt(R); return; }
        if (R.min !== undefined && v < R.min) { this.msg('Nilai harus ≥ ' + R.min, 'err'); this.ui?.prompt(R); return; }
        this.finish(v); return;
      }
      case 'angle': { const v = evalNum(t); if (!isFinite(v)) { this.msg('Sudut tidak valid.', 'err'); return; } this.finish(v * D2R); return; }
      case 'str': this.finish(text); return;
      case 'kw': this.msg('Opsi tidak valid.', 'err'); this.ui?.prompt(R); return;
      case 'sel': this.selKeyword(t); return;
      case 'ent': this.msg('Pilih objek.', 'err'); return;
    }
  }
  async midBetween() {
    const R = this.req; this.req = null;
    try {
      const a = await this.getPoint('First point of mid:'); const b = await this.getPoint('Second point of mid:', { base: a, rubber: 'dash' });
      this.req = R; this.ui?.prompt(R); const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; this.lastPt = p; this.finish(p);
    } catch (e) { this.req = R; this.cancelReq(); }
  }
  async fromPoint() {
    const R = this.req; this.req = null;
    try {
      const b = await this.getPoint('Base point:'); const o = await this.getPoint('<Offset>:', { base: b, dynRel: true });
      this.req = R; this.ui?.prompt(R); this.lastPt = o; this.finish(o);
    } catch (e) { this.req = R; this.cancelReq(); }
  }
  // API untuk perintah
  getPoint(msg, o = {}) { return this.ask({ type: 'point', msg, ...o }); }
  getCorner(msg, base, o = {}) { return this.ask({ type: 'point', msg, base, rubber: 'rect', ...o }); }
  async getDist(msg, o = {}) {
    const r = await this.ask({ type: 'dist', msg, rubber: o.base ? 'dash' : null, ...o });
    return r;
  }
  getAngle(msg, o = {}) { return this.ask({ type: 'angle', msg, rubber: o.base ? 'dash' : null, ...o }); }
  getKw(msg, kws, def) { return this.ask({ type: 'kw', msg, kws, def }); }
  getStr(msg, o = {}) { return this.ask({ type: 'str', msg, ...o }); }
  getInt(msg, o = {}) { return this.ask({ type: 'int', msg, ...o }); }
  getNum(msg, o = {}) { return this.ask({ type: 'num', msg, ...o }); }
  getEnt(msg, o = {}) { return this.ask({ type: 'ent', msg, ...o }); }
  takePickfirst() { if (!this.sel.size) return null; const a = [...this.sel].filter(e => this.ents.includes(e)); this.sel.clear(); this.hotGrip = null; this.invalidate('sel'); this.ui?.onSel?.(); return a.length ? a : null; }
  async getSel(msg = 'Select objects:', o = {}) {
    if (o.pickfirst !== false) { const pf = this.takePickfirst(); if (pf) { const ok = o.filter ? pf.filter(o.filter) : pf; this.msg(`${ok.length} found`); return this.unlock(ok); } }
    this.tmpSel = new Set(); let remove = false;
    try {
      for (;;) {
        const r = await this.ask({ type: 'sel', msg: remove ? 'Remove objects:' : msg, kws: o.single ? null : ['Window', 'Last', 'Crossing', 'BOX', 'ALL', 'Fence', 'WPolygon', 'CPolygon', 'Previous', 'Add', 'Remove', 'Undo'], remove });
        if (r === null) break;
        if (r === 'Remove') { remove = true; continue; }
        if (r === 'Add') { remove = false; continue; }
        if (r?.ents) {
          let list = o.filter ? r.ents.filter(o.filter) : r.ents;
          const rm = remove || r.shift;
          const before = this.tmpSel.size;
          list.forEach(e => rm ? this.tmpSel.delete(e) : this.tmpSel.add(e));
          this.msg(`${list.length} found` + (rm ? `, ${before - this.tmpSel.size} removed` : (before + list.length !== this.tmpSel.size ? `, ${before + list.length - this.tmpSel.size} duplicate` : '')) + `, ${this.tmpSel.size} total`);
          this.invalidate('sel');
          if (o.single && this.tmpSel.size) break;
        }
      }
      const out = [...this.tmpSel];
      this.U.prevSel = out;
      return this.unlock(o.filter ? out.filter(o.filter) : out);
    } finally { this.tmpSel = new Set(); this.invalidate('sel'); }
  }
  unlock(list) { const ok = list.filter(e => !this.locked(e)); if (ok.length < list.length) this.msg(`${list.length - ok.length} objek berada di layer terkunci.`); return ok; }
  async selKeyword(t) {
    const R = this.req, u = t.toUpperCase();
    const k = this.kwMatch(t, R.kws);
    if (k === 'ALL') { this.finish({ ents: this.ents.filter(e => this.selectable(e)) }); return; }
    if (k === 'Last') { const e = [...this.ents].reverse().find(e => this.selectable(e)); this.finish({ ents: e ? [e] : [] }); return; }
    if (k === 'Previous') { this.finish({ ents: (this.U.prevSel || []).filter(e => this.ents.includes(e)) }); return; }
    if (k === 'Add' || k === 'Remove') { this.finish(k); return; }
    if (k === 'Window' || k === 'Crossing' || k === 'BOX') {
      const keep = this.req; this.req = null;
      try { const a = await this.getPoint('Specify first corner:', { noSnap: false }); const b = await this.getCorner('Specify opposite corner:', a); this.req = keep; this.finish({ ents: this.windowSel(a, b, k === 'Crossing' ? true : k === 'Window' ? false : undefined) }); }
      catch { this.req = keep; this.cancelReq(); }
      return;
    }
    if (k === 'Fence' || k === 'WPolygon' || k === 'CPolygon') {
      const keep = this.req; this.req = null; const pts = [];
      try {
        for (;;) {
          const p = await this.getPoint(pts.length ? 'Specify endpoint of line or [Undo]:' : (k === 'Fence' ? 'Specify first fence point:' : 'First polygon point:'), { base: pts[pts.length - 1], kws: ['Undo'], preview: q => [pts.length ? { type: 'pline', pts: [...pts, q].map(p => ({ ...p, b: 0 })), closed: k !== 'Fence', color: 3 } : null] });
          if (p === 'Undo') { pts.pop(); continue; }
          if (p === null) break; pts.push(p);
        }
        this.req = keep;
        this.finish({ ents: k === 'Fence' ? this.fenceSel(pts) : this.polySel(pts, k === 'CPolygon') });
      } catch { this.req = keep; this.cancelReq(); }
      return;
    }
    if (u === 'U' || k === 'Undo') { this.msg('Undo pilihan.'); return; }
    this.msg('*Invalid selection*  Expects a point or Window/Last/Crossing/BOX/ALL/Fence/WPolygon/CPolygon/Add/Remove/Previous/Undo', 'err');
  }

  // ---------- Menjalankan perintah ----------
  findCmd(name) {
    let n = name.toUpperCase().replace(/^[_.'-]+/, '');
    if (this.alias[n]) n = this.alias[n];
    return this.cmds[n] ? n : null;
  }
  runText(t) {
    const parts = t.trim().split(/\s+/), name = this.findCmd(parts[0]);
    if (!name) {
      // titik/angka saat idle tidak berarti apa-apa
      this.msg(`Unknown command "${parts[0].toUpperCase()}".  Press F1 for help.`, 'err'); return;
    }
    this.run(name, parts.slice(1));
  }
  async run(name, queue = []) {
    name = this.findCmd(name) || name;
    const C = this.cmds[name]; if (!C) return;
    const transparent = C.transparent;
    if (this.cmd && !transparent) { this.pending = { name, queue }; this.cancelReq(); return; }
    if (this.cmd && transparent) { // transparan: jalankan di dalam perintah aktif
      const keep = this.req; this.req = null;
      try { await C.fn(this); } catch (e) { if (!(e instanceof Cancel)) console.error(e); }
      this.req = keep; if (keep) { this.ui?.prompt(keep); } this.invalidate(); return;
    }
    this.cmd = name; this.queue = [...queue]; this.ui?.cmdStart?.(name);
    if (!C.noEcho) this.msg('Command: ' + (C.label || name), 'cmd');
    const doc = this.doc;
    if (!C.noUndo) doc.begin();
    let cancelled = false;
    try { await C.fn(this); }
    catch (e) { if (e instanceof Cancel) { cancelled = true; this.msg('*Cancel*'); } else { console.error(e); this.msg('Kesalahan: ' + e.message, 'err'); } }
    finally {
      if (!C.noUndo) { if (doc.commit()) this.app.onChange?.(); }
      this.req = null; this.cmd = null; this.queue = []; this.overrideSnap = null; this.track = null; this.snapInfo = null; this.win = null; this.acq = [];
      if (!C.noRepeat) this.lastCmd = name;
      this.ui?.prompt(null); this.ui?.cmdEnd?.(name); this.invalidate();
      void cancelled;
      const p = this.pending; this.pending = null;
      if (p) setTimeout(() => this.run(p.name, p.queue), 0);
    }
  }
  cancel() {
    if (this.req || this.cmd) { this.cancelReq(); return; }
    if (this.win || this.lasso) { this.win = null; this.lasso = null; this.invalidate('over'); return; }
    if (this.sel.size) this.clearSel();
    this.ui?.prompt(null);
  }
  // entitas
  add(e, list = this.ents) { this.doc.prep(e); list.push(e); this.invalidate(); return e; }
  remove(e) { for (const L of [this.doc.model, ...this.doc.layouts.map(l => l.ents)]) { const i = L.indexOf(e); if (i >= 0) { L.splice(i, 1); break; } } this.sel.delete(e); this.invalidate(); }
  replace(e, list) { const L = this.doc.findList(e.id) || this.ents, i = L.indexOf(e); if (i < 0) return; list.forEach(n => this.doc.prep(n)); L.splice(i, 1, ...list); this.sel.delete(e); this.invalidate(); }
  clone(e) { const n = JSON.parse(JSON.stringify(e)); delete n.id; return n; }

  // ---------- Event ----------
  bind() {
    const el = this.cv.over;
    el.addEventListener('contextmenu', ev => ev.preventDefault());
    el.addEventListener('pointerenter', () => { this.mouse.in = true; this.invalidate('over'); });
    el.addEventListener('pointerleave', () => { this.mouse.in = false; this.hover = null; this.invalidate('over'); this.ui?.dynHide?.(); });
    el.addEventListener('pointermove', ev => this.onMove(ev));
    el.addEventListener('pointerdown', ev => this.onDown(ev));
    el.addEventListener('pointerup', ev => this.onUp(ev));
    el.addEventListener('pointercancel', ev => { this.touches?.delete(ev.pointerId); });
    el.addEventListener('dblclick', ev => this.onDbl(ev));
    el.addEventListener('wheel', ev => this.onWheel(ev), { passive: false });
    // gesture Safari
    el.addEventListener('gesturestart', ev => { ev.preventDefault(); this._gs = 1; });
    el.addEventListener('gesturechange', ev => { ev.preventDefault(); const f = ev.scale / (this._gs || 1); this._gs = ev.scale; this.zoomAt(this.mouse.sx, this.mouse.sy, f); });
    this.touches = new Map();
  }
  pos(ev) { const r = this.cv.over.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  onMove(ev) {
    const p = this.pos(ev);
    if (ev.pointerType === 'touch' && this.touches.has(ev.pointerId)) {
      const t = this.touches.get(ev.pointerId); t.x = p.x; t.y = p.y;
      if (this.touches.size === 2) { this.pinchMove(); return; }
      if (this.touches.size === 1 && t.long) clearTimeout(t.long), t.long = null;
    }
    this.mouse.sx = p.x; this.mouse.sy = p.y; this.mouse.in = true;
    if (this.panning) { this.panBy(p.x - this.panning.x, p.y - this.panning.y); this.panning.x = p.x; this.panning.y = p.y; return; }
    if (this.zooming) { const dy = p.y - this.zooming.y; this.zooming.y = p.y; this.zoomAt(this.zooming.cx, this.zooming.cy, Math.exp(-dy * 0.01)); return; }
    if (this.down && !this.win && !this.lasso && this.down.btn === 0 && (!this.req || this.req.type === 'sel') && !this.down.ent && !this.down.grip) {
      if (Math.hypot(p.x - this.down.x, p.y - this.down.y) > 7) this.lasso = { pts: [{ x: this.down.x, y: this.down.y }], cross: false };
    }
    if (this.lasso) { this.lasso.pts.push(p); this.lasso.cross = p.x < this.lasso.pts[0].x && this.lasso.pts.length < 6 ? true : this.lasso.cross || (this.lasso.pts.length < 6 && p.x < this.lasso.pts[0].x); }
    this.computeSnap();
    if (!this.req || this.req.type === 'sel' || this.req.type === 'ent') {
      const h = this.win || this.lasso ? null : this.pick(p.x, p.y);
      if (h !== this.hover) { this.hover = h; }
    } else this.hover = null;
    this.invalidate('over');
    this.ui?.coords?.(this.req && this.req.type !== 'sel' ? this.spt : this.wpt);
    this.ui?.dyn?.(this);
  }
  onDown(ev) {
    const p = this.pos(ev);
    ev.preventDefault();
    this.ui?.focusCmd?.();
    this.mouse.sx = p.x; this.mouse.sy = p.y; this.mouse.in = true;
    if (ev.button === 0 && ev.pointerType !== 'touch') this.computeSnap();
    if (ev.pointerType === 'touch') {
      this.touches.set(ev.pointerId, { x: p.x, y: p.y, t: Date.now() });
      if (this.touches.size === 2) { this.pinchStart(); this.down = null; this.lasso = null; return; }
      const t = this.touches.get(ev.pointerId);
      t.long = setTimeout(() => { this.down = null; this.lasso = null; this.contextMenu(p.x, p.y, ev); }, 550);
      this.mouse.sx = p.x; this.mouse.sy = p.y; this.mouse.in = true; this.computeSnap();
    }
    this.cv.over.setPointerCapture?.(ev.pointerId);
    if (ev.button === 1 || (this.panMode && ev.button === 0) || (ev.button === 0 && ev.altKey && ev.metaKey)) {
      const now = Date.now();
      if (ev.button === 1 && now - (this._mmid || 0) < 350) { this.zoomExtents(); this._mmid = 0; return; }
      if (ev.button === 1) this._mmid = now;
      this.panning = { x: p.x, y: p.y }; this.cv.over.style.cursor = 'grabbing'; return;
    }
    if (this.zoomMode && ev.button === 0) { this.zooming = { y: p.y, cx: p.x, cy: p.y }; return; }
    if (ev.button === 2) { this.rdown = { x: p.x, y: p.y, t: Date.now(), shift: ev.shiftKey }; return; }
    if (ev.button !== 0) return;
    const R = this.req;
    this.down = { x: p.x, y: p.y, btn: 0, shift: ev.shiftKey };
    // seleksi jendela (klik kedua)
    if (this.win && (!R || R.type === 'sel')) {
      const b = this.s2w(p.x, p.y), list = this.win.poly ? [] : this.windowSel(this.win.p, b);
      this.win = null; this.down = null;
      if (R) this.finish({ ents: list, shift: ev.shiftKey }); else this.setSel(list, ev.shiftKey ? 'remove' : 'add');
      this.invalidate('over'); return;
    }
    if (!R) {
      // grip?
      const g = this.gripAt(p.x, p.y);
      if (g) { this.down.grip = g; this.hotGrip = g; this.invalidate('sel'); this.run('GRIPEDIT'); return; }
      const e = this.pick(p.x, p.y);
      if (e) { this.down.ent = e; if (ev.shiftKey) this.setSel([e], this.sel.has(e) ? 'remove' : 'add'); else this.setSel([e], 'add'); return; }
      return; // jendela dimulai saat pointerup bila tidak lasso
    }
    if (R.type === 'sel') {
      const e = this.pick(p.x, p.y);
      if (e) { this.down.ent = e; this.finish({ ents: [e], shift: ev.shiftKey }); }
      return;
    }
    if (R.type === 'ent') {
      const e = this.pick(p.x, p.y), w = this.s2w(p.x, p.y);
      if (e && (!R.filter || R.filter(e))) this.finish({ e, p: w, sx: p.x, sy: p.y });
      else this.msg(e ? 'Objek tidak sesuai.' : 'Nothing found.');
      return;
    }
    if (R.type === 'point' || R.type === 'dist' || R.type === 'angle') {
      this.computeSnap();
      const q = this.spt;
      if (R.type === 'point') { this.lastPt = q; this.finish(q); return; }
      if (R.base) { this.finish(R.type === 'dist' ? dist(R.base, q) : ang(R.base, q)); return; }
      // dua titik
      const keep = R; this.req = null;
      this.getPoint('Specify second point:', { base: q, rubber: 'dash' }).then(b => { this.req = keep; this.finish(keep.type === 'dist' ? dist(q, b) : ang(q, b)); }).catch(() => { this.req = keep; this.cancelReq(); });
    }
  }
  onUp(ev) {
    const p = this.pos(ev);
    if (ev.pointerType === 'touch') {
      const t = this.touches.get(ev.pointerId); if (t?.long) clearTimeout(t.long);
      this.touches.delete(ev.pointerId); if (this.pinch) { if (this.touches.size < 2) this.pinch = null; return; }
    }
    if (this.panning) { this.panning = null; this.cv.over.style.cursor = this.panMode ? 'grab' : 'none'; return; }
    if (this.zooming) { this.zooming = null; return; }
    if (ev.button === 2 && this.rdown) {
      const r = this.rdown; this.rdown = null;
      if (Math.hypot(p.x - r.x, p.y - r.y) < 6) this.contextMenu(p.x, p.y, ev, r.shift);
      return;
    }
    const d = this.down; this.down = null;
    if (!d) return;
    if (this.lasso) {
      const L = this.lasso; this.lasso = null;
      const poly = L.pts.map(q => this.s2w(q.x, q.y));
      const list = poly.length > 2 ? this.polySel(poly, L.cross) : [];
      if (this.req?.type === 'sel') this.finish({ ents: list, shift: d.shift });
      else if (!this.req) this.setSel(list, d.shift ? 'remove' : 'add');
      this.invalidate('over'); return;
    }
    if ((!this.req || this.req.type === 'sel') && !d.ent && !d.grip && Math.hypot(p.x - d.x, p.y - d.y) < 7) {
      this.win = { p: this.s2w(d.x, d.y) }; this.invalidate('over');
    }
  }
  gripAt(sx, sy) {
    if (!this.sel.size || this.sel.size > 200) return null;
    const g = this.opt.gripSize + 2;
    for (const e of this.sel) for (const G of grips(e, this.doc)) { const s = this.w2s(G.p); if (Math.abs(s.x - sx) <= g && Math.abs(s.y - sy) <= g) return { ...G, e }; }
    return null;
  }
  onDbl(ev) {
    if (this.req) return;
    const p = this.pos(ev);
    if (this.layout) {
      const L = this.layout, vp = fitVp(L, this.doc), w = this.s2w(p.x, p.y, { ...this.pv(), w: 0, h: 0 });
      const inside = w.x >= vp.x && w.x <= vp.x + vp.w && w.y >= vp.y && w.y <= vp.y + vp.h;
      if (!this.U.ms && inside && !this.pick(p.x, p.y)) { this.U.ms = true; this.msg('MSPACE'); this.clearSel(); this.ui?.refresh?.(); this.invalidate(); return; }
      if (this.U.ms && !inside) { this.U.ms = false; this.msg('PSPACE'); this.clearSel(); this.ui?.refresh?.(); this.invalidate(); return; }
    }
    const e = this.pick(p.x, p.y);
    if (!e) return;
    this.setSel([e]);
    this.ui?.editEntity?.(e);
  }
  onWheel(ev) {
    ev.preventDefault();
    const p = this.pos(ev);
    this.mouse.sx = p.x; this.mouse.sy = p.y;
    let dy = ev.deltaY, dx = ev.deltaX;
    if (ev.deltaMode === 1) { dy *= 33; dx *= 33; } else if (ev.deltaMode === 2) { dy *= 400; dx *= 400; }
    const now = performance.now();
    let pad = this.opt.wheel === 'pan';
    if (this.opt.wheel === 'auto') {
      const looksPad = ev.deltaMode === 0 && (dx !== 0 || (Math.abs(dy) < 50 && dy % 1 !== 0) || Math.abs(dy) < 4);
      if (looksPad) this._padT = now;
      pad = now - (this._padT || 0) < 400 && !ev.ctrlKey;
    }
    if (ev.ctrlKey) { this.zoomAt(p.x, p.y, Math.exp(-dy * 0.012)); }
    else if (pad && !ev.shiftKey) this.panBy(-dx, -dy);
    else this.zoomAt(p.x, p.y, Math.exp(-dy * 0.0019));
    this.computeSnap(); this.ui?.coords?.(this.spt);
  }
  pinchStart() { const [a, b] = [...this.touches.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
  pinchMove() {
    const [a, b] = [...this.touches.values()], P = this.pinch; if (!P) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    this.panBy(cx - P.cx, cy - P.cy); this.zoomAt(cx, cy, d / (P.d || d));
    Object.assign(P, { d, cx, cy });
  }
  contextMenu(x, y, ev, shift) {
    if (shift || ev?.shiftKey) { this.ui?.osnapMenu?.(x, y); return; }
    if (this.req && this.opt.rightClick === 'enter') { this.submit(''); return; }
    if (!this.req && this.opt.rightClick === 'enter' && !this.sel.size) { this.submit(''); return; }
    this.ui?.canvasMenu?.(x, y);
  }
}
