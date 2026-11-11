// Plot & ekspor: PDF vektor (gambar kerja + kop), SVG, PNG, COLLADA (.dae untuk SketchUp).
import { TAU, M, D2R, polar, sweepOf, an, bbOk, polyArea, inPoly, dist } from './geom.js';
import { prims, xformPrim, textW, ACI, LTYPES, CAP, loopPts } from './ent.js';
import { walk, drawLayout, styleOf, imgSrc } from './render.js';
import { paperSize, fitVp, titleBlockEnts, layoutFrame, newLayout, PREF_SCALES, UNIT_MM } from './doc.js';

const hex2rgb = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
function plotStyle(st, opt) {
  let rgb;
  if (opt.mono) rgb = [0, 0, 0];
  else if (st.rgb) rgb = hex2rgb(st.rgb);
  else if (st.color === 7) rgb = [0, 0, 0];
  else if (opt.gray) { const c = hex2rgb(ACI[st.color] || '#000000'), g = Math.min(0.75, 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]); rgb = [g * 0.6, g * 0.6, g * 0.6]; }
  else rgb = hex2rgb(ACI[st.color] || '#000000');
  const lw = opt.lw === false ? 0.18 : Math.max(0.05, (st.lw < 0 ? 25 : st.lw) / 100);
  const L = LTYPES[st.lt];
  let dash = null;
  if (L && L.p.length) { const k = st.lts * (opt.ltk || 1); dash = L.p.map(x => x === 0 ? Math.max(0.15, lw) : Math.abs(x) * k); }
  return { rgb, lw, dash };
}
// Matriks model → kertas untuk viewport
export function vpMatrix(vp) { return M.mul(M.tr(vp.x + vp.w / 2, vp.y + vp.h / 2), M.mul(M.sc(vp.s), M.tr(-vp.cx, -vp.cy))); }

// Jalankan satu halaman ke "sink"
export function plotPage(L, doc, sink, opt = {}) {
  const [W, H] = paperSize(L), vp = fitVp(L, doc), m = vpMatrix(vp);
  sink.begin(W, H);
  sink.clip(vp.x, vp.y, vp.w, vp.h);
  if (sink.image) for (const e of doc.model) { // gambar raster (foto peta) di bawah garis
    if (e.type !== 'image') continue;
    const Ly = doc.layers[e.layer]; if (Ly && (!Ly.on || Ly.frz || Ly.plot === false)) continue;
    const src = imgSrc(e, doc); if (!src) continue;
    const r = e.rot || 0, P = M.ap(m, e.p), U = M.vec(m, { x: Math.cos(r) * e.w, y: Math.sin(r) * e.w }), V = M.vec(m, { x: -Math.sin(r) * e.h, y: Math.cos(r) * e.h });
    sink.image(src, P, U, V, e.fade || 0);
  }
  const sOpt = { ...opt, ltk: 1 / (doc.set.ltscale || 1) }; // PSLTSCALE=1: pola mengikuti ukuran kertas
  for (const { q, st } of walk(doc.model, doc, { plot: true })) {
    if (q.frame) continue;
    sink.prim(xformPrim(q, m), plotStyle(st, sOpt), q);
  }
  sink.unclip();
  if (!doc.layers.KOP) doc.addLayer('KOP', { color: 7 });
  const paperEnts = [...titleBlockEnts(L, doc), ...L.ents];
  for (const { q, st } of walk(paperEnts, doc, { plot: true })) sink.prim(q, plotStyle(st, sOpt), q);
  sink.end();
}

// ---------------- PDF ----------------
const PT = 72 / 25.4;
const f2 = v => (Math.round(v * 1000) / 1000).toString();
const WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
function pdfStr(s) {
  let o = '(';
  for (const ch of s) {
    let c = ch.codePointAt(0);
    if (c > 255) c = WIN[c] || 63;
    if (c === 40 || c === 41 || c === 92) o += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) o += '\\' + c.toString(8).padStart(3, '0');
    else o += String.fromCharCode(c);
  }
  return o + ')';
}
class PDFSink {
  constructor() { this.pages = []; }
  begin(W, H) { this.cur = { W, H, ops: ['1 J 1 j'] }; this.pages.push(this.cur); this.last = {}; }
  clip(x, y, w, h) { this.cur.ops.push('q', `${f2(x * PT)} ${f2(y * PT)} ${f2(w * PT)} ${f2(h * PT)} re W n`); this.last = {}; }
  unclip() { this.cur.ops.push('Q'); this.last = {}; }
  style(s, fill) {
    const o = this.cur.ops, L = this.last, col = s.rgb.map(f2).join(' ');
    if (fill) { if (L.fc !== col) { o.push(col + ' rg'); L.fc = col; } return; }
    if (L.sc !== col) { o.push(col + ' RG'); L.sc = col; }
    const w = f2(s.lw * PT); if (L.w !== w) { o.push(w + ' w'); L.w = w; }
    const d = s.dash ? '[' + s.dash.map(x => f2(x * PT)).join(' ') + '] 0 d' : '[] 0 d'; if (L.d !== d) { o.push(d); L.d = d; }
  }
  arcPath(c, r, sa, ea, move) {
    const o = this.cur.ops, sw = sweepOf(sa, ea), n = Math.max(1, Math.ceil(sw / (Math.PI / 2))), d = sw / n, k = 4 / 3 * Math.tan(d / 4);
    let a = sa; const P = (x, y) => `${f2(x * PT)} ${f2(y * PT)}`;
    if (move) o.push(P(c.x + r * Math.cos(a), c.y + r * Math.sin(a)) + ' m');
    for (let i = 0; i < n; i++) {
      const b = a + d, x0 = c.x + r * Math.cos(a), y0 = c.y + r * Math.sin(a), x3 = c.x + r * Math.cos(b), y3 = c.y + r * Math.sin(b);
      o.push(`${P(x0 - k * r * Math.sin(a), y0 + k * r * Math.cos(a))} ${P(x3 + k * r * Math.sin(b), y3 - k * r * Math.cos(b))} ${P(x3, y3)} c`); a = b;
    }
  }
  prim(q, s) {
    const o = this.cur.ops, P = p => `${f2(p.x * PT)} ${f2(p.y * PT)}`;
    if (q.t === 'L') { if (q.inf) return; this.style(s); if (q.a.x === q.b.x && q.a.y === q.b.y) { o.push(`${P(q.a)} m ${f2(q.a.x * PT + 0.01)} ${f2(q.a.y * PT)} l S`); return; } o.push(`${P(q.a)} m ${P(q.b)} l S`); }
    else if (q.t === 'A') { this.style(s); this.arcPath(q.c, q.r, q.full ? 0 : q.sa, q.full ? TAU : q.ea, true); o.push('S'); }
    else if (q.t === 'P') { if (q.pts.length < 2) return; this.style(s); o.push(P(q.pts[0]) + ' m'); for (let i = 1; i < q.pts.length; i++) o.push(P(q.pts[i]) + ' l'); o.push(q.closed ? 's' : 'S'); }
    else if (q.t === 'F') { if (q.wipe) { this.style({ rgb: [1, 1, 1] }, true); } else this.style(s, true); for (const l of q.loops) { l.forEach((p, i) => o.push(P(p) + (i ? ' l' : ' m'))); o.push('h'); } o.push('f*'); }
    else if (q.t === 'D') { this.style(s, true); o.push(`${f2(q.p.x * PT - 0.6)} ${f2(q.p.y * PT - 0.6)} 1.2 1.2 re f`); }
    else if (q.t === 'T') {
      if (!q.s) return;
      this.style(s, true);
      const fs = q.h / CAP * PT, w = textW(q.s, q.h, q.wf || 1), r = q.rot || 0, wf = q.wf || 1;
      const by = [0, 0.3 * q.h, -q.h / 2, -q.h][q.va || 0], dx = -(q.ha || 0) * w / 2;
      const x = q.p.x + Math.cos(r) * dx - Math.sin(r) * by, y = q.p.y + Math.sin(r) * dx + Math.cos(r) * by;
      const c = Math.cos(r), sn = Math.sin(r);
      o.push(`BT /F1 ${f2(fs)} Tf ${f2(c * wf)} ${f2(sn * wf)} ${f2(-sn)} ${f2(c)} ${f2(x * PT)} ${f2(y * PT)} Tm ${pdfStr(q.s)} Tj ET`);
    }
  }
  image(src, P, U, V, fade = 0) {
    this.imgs ||= []; let id = this.imgs.findIndex(x => x.src === src && x.fade === fade); if (id < 0) { this.imgs.push({ src, fade }); id = this.imgs.length - 1; }
    (this.cur.im ||= new Set()).add(id);
    this.cur.ops.push(`q ${f2(U.x * PT)} ${f2(U.y * PT)} ${f2(V.x * PT)} ${f2(V.y * PT)} ${f2(P.x * PT)} ${f2(P.y * PT)} cm /Im${id} Do Q`); this.last = {};
  }
  end() { }
  async build(meta = {}) {
    const objs = [], add = s => { objs.push(s); return objs.length; };
    const catalog = add(''), pagesId = add(''), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const enc = new TextEncoder(), kids = [], streams = [], imIds = [];
    for (const { src, fade } of this.imgs || []) { // XObject JPEG (DCTDecode); fade = dicampur putih
      try {
        const im = new Image(); im.src = src; await im.decode();
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0);
        if (fade > 0) { x.globalAlpha = Math.min(0.9, fade / 100); x.fillRect(0, 0, c.width, c.height); x.globalAlpha = 1; }
        const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)), data = new Uint8Array(await b.arrayBuffer());
        const id = add(null); streams.push({ id, data, filter: '', dict: `/Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` }); imIds.push(id);
      } catch { imIds.push(0); }
    }
    for (const pg of this.pages) {
      let data = enc.encode(pg.ops.join('\n')), filter = '';
      if (typeof CompressionStream !== 'undefined') { try { data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); filter = ' /Filter /FlateDecode'; } catch { } }
      const sid = add(null); streams.push({ id: sid, data, filter });
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f2(pg.W * PT)} ${f2(pg.H * PT)}] /Resources << /Font << /F1 ${font} 0 R >>${pg.im?.size ? ' /XObject << ' + [...pg.im].filter(i => imIds[i]).map(i => `/Im${i} ${imIds[i]} 0 R`).join(' ') + ' >>' : ''} >> /Contents ${sid} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Producer (Amatu CAD) /Creator (Amatu CAD) /Title ${pdfStr(meta.title || 'Gambar Kerja')} /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`);
    const parts = [], offs = []; let pos = 0;
    const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); pos += u.length; };
    push('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n');
    objs.forEach((o, i) => {
      offs[i] = pos;
      const st = streams.find(s => s.id === i + 1);
      if (st) { push(`${i + 1} 0 obj\n<< ${st.dict || ''}/Length ${st.data.length}${st.filter} >>\nstream\n`); push(st.data); push('\nendstream\nendobj\n'); }
      else push(`${i + 1} 0 obj\n${o}\nendobj\n`);
    });
    const xref = pos;
    push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
    push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }
}
export async function exportPDF(layouts, doc, opt = {}) {
  const sink = new PDFSink();
  for (const L of layouts) plotPage(L, doc, sink, opt);
  return sink.build({ title: opt.title || doc.name });
}

// ---------------- SVG ----------------
class SVGSink {
  constructor() { this.out = []; }
  begin(W, H) { this.W = W; this.H = H; this.out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/><g transform="translate(0 ${H}) scale(1 -1)" fill="none" stroke-linecap="round" stroke-linejoin="round">`); this.cid = 0; }
  clip(x, y, w, h) { const id = 'c' + (this.cid++); this.out.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><g clip-path="url(#${id})">`); }
  unclip() { this.out.push('</g>'); }
  st(s, fill) { const c = 'rgb(' + s.rgb.map(v => Math.round(v * 255)).join(',') + ')'; return fill ? `fill="${c}" stroke="none"` : `stroke="${c}" stroke-width="${f2(s.lw)}"${s.dash ? ` stroke-dasharray="${s.dash.map(f2).join(' ')}"` : ''}`; }
  prim(q, s) {
    const o = this.out;
    if (q.t === 'L' && !q.inf) o.push(`<line x1="${f2(q.a.x)}" y1="${f2(q.a.y)}" x2="${f2(q.b.x)}" y2="${f2(q.b.y)}" ${this.st(s)}/>`);
    else if (q.t === 'A') { if (q.full) o.push(`<circle cx="${f2(q.c.x)}" cy="${f2(q.c.y)}" r="${f2(q.r)}" ${this.st(s)}/>`); else { const a = polar(q.c, q.sa, q.r), b = polar(q.c, q.ea, q.r), sw = sweepOf(q.sa, q.ea); o.push(`<path d="M${f2(a.x)} ${f2(a.y)}A${f2(q.r)} ${f2(q.r)} 0 ${sw > Math.PI ? 1 : 0} 1 ${f2(b.x)} ${f2(b.y)}" ${this.st(s)}/>`); } }
    else if (q.t === 'P') o.push(`<${q.closed ? 'polygon' : 'polyline'} points="${q.pts.map(p => f2(p.x) + ',' + f2(p.y)).join(' ')}" ${this.st(s)}/>`);
    else if (q.t === 'F') o.push(`<path fill-rule="evenodd" d="${q.loops.map(l => 'M' + l.map(p => f2(p.x) + ' ' + f2(p.y)).join('L') + 'Z').join('')}" ${q.wipe ? 'fill="#fff" stroke="none"' : this.st(s, true)}/>`);
    else if (q.t === 'D') o.push(`<circle cx="${f2(q.p.x)}" cy="${f2(q.p.y)}" r="0.3" ${this.st(s, true)}/>`);
    else if (q.t === 'T') {
      const by = [0, 0.3 * q.h, -q.h / 2, -q.h][q.va || 0], r = (q.rot || 0) * 180 / Math.PI;
      const esc = q.s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      o.push(`<text transform="translate(${f2(q.p.x)} ${f2(q.p.y)}) rotate(${f2(r)}) scale(${f2(q.wf || 1)} -1)" x="0" y="${f2(-by)}" font-family="Arial, Helvetica, sans-serif" font-size="${f2(q.h / CAP)}" text-anchor="${['start', 'middle', 'end'][q.ha || 0]}" ${this.st(s, true)}>${esc}</text>`);
    }
  }
  image(src, P, U, V, fade = 0) { this.out.push(`<image opacity="${f2(1 - Math.min(0.9, fade / 100))}" href="${src}" width="1" height="1" preserveAspectRatio="none" transform="matrix(${f2(U.x)} ${f2(U.y)} ${f2(-V.x)} ${f2(-V.y)} ${f2(P.x + V.x)} ${f2(P.y + V.y)})"/>`); }
  end() { this.out.push('</g></svg>'); }
  build() { return new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + this.out.join('\n')], { type: 'image/svg+xml' }); }
}
export function exportSVG(L, doc, opt = {}) { const s = new SVGSink(); plotPage(L, doc, s, opt); return s.build(); }

// ---------------- PNG ----------------
export function renderPNG(L, doc, dpi = 200, opt = {}) {
  const [W, H] = paperSize(L), k = dpi / 25.4, c = document.createElement('canvas');
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  const ctx = c.getContext('2d');
  drawLayout(ctx, L, doc, { scale: k, ox: 0, oy: H * k, w: c.width, h: c.height }, { export: true, mono: opt.mono, lwt: opt.lw !== false });
  return new Promise(r => c.toBlob(r, 'image/png'));
}

// Layout sementara untuk area plot (Extents / Window / Display)
export function tempLayout(doc, o) {
  const L = newLayout('Plot', o.paper || 'A3'); L.orient = o.orient || 'L';
  L.tb = o.tb ? { ...o.tb } : { ...L.tb, on: o.tbOn !== false };
  const F = layoutFrame(L), w = F.vp.x2 - F.vp.x1, h = F.vp.y2 - F.vp.y1;
  const area = o.area, u = UNIT_MM[doc.set.units] || 1;
  let s = o.scale;
  if (!s) { const ew = Math.max(1e-6, (area.x2 - area.x1) * u), eh = Math.max(1e-6, (area.y2 - area.y1) * u); const N = o.fit ? Math.max(ew / (w * .95), eh / (h * .95)) : (PREF_SCALES.find(n => ew / n <= w * 0.92 && eh / n <= h * 0.92) || Math.ceil(Math.max(ew / w, eh / h))); s = u / N; }
  L.vp = { s, cx: (area.x1 + area.x2) / 2, cy: (area.y1 + area.y2) / 2, x: F.vp.x1, y: F.vp.y1, w, h };
  return L;
}

// ---------------- COLLADA (.dae) untuk SketchUp ----------------
function earClip(P) {
  const pts = P.slice(); if (polyArea(pts) < 0) pts.reverse();
  const idx = pts.map((_, i) => i), tris = []; let guard = 0;
  const cr = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = pts[idx[(i - 1 + idx.length) % idx.length]], b = pts[idx[i]], c = pts[idx[(i + 1) % idx.length]];
      if (cr(a, b, c) <= 1e-12) continue;
      let inside = false;
      for (const j of idx) { const p = pts[j]; if (p === a || p === b || p === c) continue; if (inPoly(p, [a, b, c])) { inside = true; break; } }
      if (inside) continue;
      tris.push([idx[(i - 1 + idx.length) % idx.length], idx[i], idx[(i + 1) % idx.length]]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([...idx]);
  return { pts, tris };
}
export function exportDAE(doc, opt = {}) {
  const u = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 }[doc.set.units] || 0.001;
  const H = opt.height || 0, faces = opt.faces !== false, wallsFromLines = !!opt.walls;
  const byLayer = new Map();
  const G = name => { if (!byLayer.has(name)) byLayer.set(name, { v: [], lines: [], tris: [] }); return byLayer.get(name); };
  const V = (g, p, z = 0) => { g.v.push(p.x, p.y, z); return g.v.length / 3 - 1; };
  const quad = (g, a, b) => { const i0 = V(g, a), i1 = V(g, b), i2 = V(g, b, H), i3 = V(g, a, H); g.tris.push(i0, i1, i2, i0, i2, i3); g.lines.push(i2, i3, i0, i3, i1, i2); };
  for (const { q, e } of walk(doc.model, doc, { plot: false })) {
    if (q.t === 'T' || q.t === 'D' || (q.t === 'L' && q.inf)) continue;
    const g = G(e.layer);
    const poly = q.t === 'L' ? [q.a, q.b] : q.t === 'A' ? (q.full ? Array.from({ length: 48 }, (_, i) => polar(q.c, i * TAU / 48, q.r)) : (() => { const sw = sweepOf(q.sa, q.ea), n = Math.max(4, Math.ceil(sw / (TAU / 48))); return Array.from({ length: n + 1 }, (_, i) => polar(q.c, q.sa + sw * i / n, q.r)); })()) : q.t === 'P' ? q.pts : null;
    const closed = q.t === 'A' ? !!q.full : q.t === 'P' ? !!q.closed : false;
    if (q.t === 'F') { if (!faces) continue; for (const l of q.loops) { const t = earClip(l), base = g.v.length / 3; t.pts.forEach(p => V(g, p)); t.tris.forEach(([a, b, c]) => g.tris.push(base + a, base + b, base + c)); } continue; }
    if (!poly || poly.length < 2) continue;
    const ids = poly.map(p => V(g, p));
    for (let i = 0; i < ids.length - 1; i++) g.lines.push(ids[i], ids[i + 1]);
    if (closed) g.lines.push(ids[ids.length - 1], ids[0]);
    const isClosedEnt = closed || (e.type === 'pline' && e.closed);
    if (H > 0 && (isClosedEnt || wallsFromLines)) { for (let i = 0; i < poly.length - 1; i++) quad(g, poly[i], poly[i + 1]); if (closed) quad(g, poly[poly.length - 1], poly[0]); }
    if (faces && isClosedEnt && poly.length >= 3 && e.type !== 'hatch') {
      const ring = closed ? poly : poly.slice(0, -1); const t = earClip(ring);
      for (const z of H > 0 ? [0, H] : [0]) { const base = g.v.length / 3; t.pts.forEach(p => V(g, p, z)); t.tris.forEach(([a, b, c]) => g.tris.push(base + a, base + b, base + c)); }
    }
  }
  const esc = s => String(s).replace(/[^A-Za-z0-9_.-]/g, '_');
  let geo = '', nodes = '';
  let k = 0;
  for (const [name, g] of byLayer) {
    if (!g.v.length) continue;
    const id = 'g' + (k++), n = g.v.length / 3;
    const col = (() => { const L = doc.layers[name]; const h = ACI[L?.color === 7 ? 8 : L?.color || 8] || '#808080'; return hex2rgb(h); })();
    geo += `<geometry id="${id}" name="${esc(name)}"><mesh><source id="${id}-p"><float_array id="${id}-pa" count="${g.v.length}">${g.v.map(x => +x.toFixed(5)).join(' ')}</float_array><technique_common><accessor source="#${id}-pa" count="${n}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="${id}-v"><input semantic="POSITION" source="#${id}-p"/></vertices>`;
    if (g.lines.length) geo += `<lines count="${g.lines.length / 2}" material="edge"><input semantic="VERTEX" source="#${id}-v" offset="0"/><p>${g.lines.join(' ')}</p></lines>`;
    if (g.tris.length) geo += `<triangles count="${g.tris.length / 3}" material="face"><input semantic="VERTEX" source="#${id}-v" offset="0"/><p>${g.tris.join(' ')}</p></triangles>`;
    geo += `</mesh></geometry>`;
    nodes += `<node id="n${id}" name="${esc(name)}"><instance_geometry url="#${id}"><bind_material><technique_common><instance_material symbol="edge" target="#m-edge"/><instance_material symbol="face" target="#m-face"/></technique_common></bind_material></instance_geometry></node>`;
    void col;
  }
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>Amatu CAD</authoring_tool></contributor><created>${new Date().toISOString()}</created><modified>${new Date().toISOString()}</modified><unit name="${doc.set.units}" meter="${u}"/><up_axis>Z_UP</up_axis></asset>
<library_effects><effect id="e-face"><profile_COMMON><technique sid="t"><lambert><diffuse><color>0.92 0.92 0.9 1</color></diffuse></lambert></technique></profile_COMMON></effect><effect id="e-edge"><profile_COMMON><technique sid="t"><constant><emission><color>0 0 0 1</color></emission></constant></technique></profile_COMMON></effect></library_effects>
<library_materials><material id="m-face" name="Face"><instance_effect url="#e-face"/></material><material id="m-edge" name="Edge"><instance_effect url="#e-edge"/></material></library_materials>
<library_geometries>${geo}</library_geometries>
<library_visual_scenes><visual_scene id="scene" name="${esc(doc.name)}"><node id="root" name="${esc(doc.name)}">${nodes}</node></visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>`;
  return new Blob([xml], { type: 'model/vnd.collada+xml' });
}

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
void D2R; void an; void bbOk; void dist; void loopPts; void styleOf; void prims;
