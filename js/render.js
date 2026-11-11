// Renderer kanvas: entitas → layar, grid, layout kertas, viewport.
import { prims, bbox, textBox, textW, ACI, LTYPES, FONT, CAP } from './ent.js';
import { TAU } from './geom.js';
import { layoutFrame, titleBlockEnts, fitVp, paperSize } from './doc.js';

// Gaya terselesaikan untuk entitas (dengan rantai blok)
export function styleOf(e, chain, doc) {
  let color = e.color ?? 256, layer = e.layer, lt = e.lt ?? 'ByLayer', lw = e.lw ?? -1;
  for (const ins of chain || []) {
    if (color === 0) color = ins.color ?? 256;
    if (lt === 'ByBlock') lt = ins.lt ?? 'ByLayer';
    if (lw === -2) lw = ins.lw ?? -1;
    if (layer === '0') layer = ins.layer;
  }
  const L = doc.layers[layer] || doc.layers['0'];
  if (color === 256 || color === 0) color = L.color;
  if (lt === 'ByLayer' || lt === 'ByBlock') lt = L.lt;
  if (lw === -1 || lw === -2) lw = L.lw;
  return { color, lt, lw: lw < 0 ? 25 : lw, lts: (e.lts || 1) * (doc.set.ltscale || 1), layer: L, lname: layer, rgb: e.rgb };
}
export function cssColor(st, bg) {
  if (st.rgb) return st.rgb;
  const c = st.color;
  if (c === 7) return bg === 'paper' ? '#000000' : '#FFFFFF';
  return ACI[c] || '#FFFFFF';
}
// iterasi primitif dengan gaya (untuk ekspor). filterLayer(L) → bool
export function* walk(list, doc, opt = {}) {
  for (const e of list) {
    const L0 = doc.layers[e.layer];
    if (L0 && (!L0.on || L0.frz)) continue;
    if (opt.plot && L0 && !L0.plot) continue;
    const base = styleOf(e, null, doc);
    for (const q of prims(e, doc)) {
      let st = base;
      if (q.src) {
        st = styleOf(q.src.e, q.src.chain, doc);
        if (!st.layer.on || st.layer.frz || (opt.plot && !st.layer.plot)) continue;
      }
      yield { q, st, e };
    }
  }
}

export function vpView(pv, vp) {
  return { scale: pv.scale * vp.s, ox: pv.ox + pv.scale * (vp.x + vp.w / 2 - vp.cx * vp.s), oy: pv.oy - pv.scale * (vp.y + vp.h / 2 - vp.cy * vp.s), w: pv.w, h: pv.h };
}
export function viewToVp(pv, vp, v) {
  vp.s = v.scale / pv.scale;
  vp.cx = (pv.ox + pv.scale * (vp.x + vp.w / 2) - v.ox) / v.scale;
  vp.cy = (v.oy - pv.oy + pv.scale * (vp.y + vp.h / 2)) / v.scale;
}
const W2S = (v, p) => [v.ox + p.x * v.scale, v.oy - p.y * v.scale];

function dashFor(st, v, pxPerUnit) {
  const L = LTYPES[st.lt];
  if (!L || !L.p.length) return null;
  const k = st.lts * pxPerUnit;
  const d = L.p.map(x => x > 0 ? Math.max(1, x * k) : x === 0 ? 1 : Math.max(1, -x * k));
  const tot = d.reduce((a, b) => a + b, 0);
  return tot < 4 || tot > 1e5 ? null : d;
}
// Gambar primitif ke ctx (koordinat CSS px)
export function drawPrim(ctx, q, v, opt = {}) {
  if (q.t === 'L') {
    let [x1, y1] = W2S(v, q.a), [x2, y2] = W2S(v, q.b);
    if (q.inf) { const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, B = 1e5; if (q.inf === 2) { x1 -= dx / l * B; y1 -= dy / l * B; } x2 = x1 + dx / l * B * (q.inf === 2 ? 2 : 1); y2 = y1 + dy / l * B * (q.inf === 2 ? 2 : 1); }
    if (x1 === x2 && y1 === y2) { ctx.moveTo(x1 - 0.5, y1); ctx.lineTo(x1 + 0.5, y1); return; }
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  } else if (q.t === 'A') {
    const [cx, cy] = W2S(v, q.c), r = q.r * v.scale;
    if (q.full) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
    else { ctx.moveTo(cx + r * Math.cos(q.sa), cy - r * Math.sin(q.sa)); ctx.arc(cx, cy, r, -q.sa, -q.ea, true); }
  } else if (q.t === 'P') {
    const P = q.pts; if (!P.length) return;
    let [x, y] = W2S(v, P[0]); ctx.moveTo(x, y);
    for (let i = 1; i < P.length; i++) { [x, y] = W2S(v, P[i]); ctx.lineTo(x, y); }
    if (q.closed) ctx.closePath();
  }
}
function fillPrim(ctx, q, v) {
  ctx.beginPath();
  for (const l of q.loops) { l.forEach((p, i) => { const [x, y] = W2S(v, p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
  ctx.fill('evenodd');
}
export function drawText(ctx, q, v, color) {
  const fs = q.h * v.scale / CAP;
  const [x, y] = W2S(v, q.p);
  if (fs < 1.6) { // greeking
    if (fs < 0.3) return;
    const w = textW(q.s, q.h, q.wf || 1) * v.scale;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-(q.rot || 0)); ctx.fillStyle = color; ctx.globalAlpha *= 0.5;
    const gy = -[0, 0.3 * q.h, -q.h / 2, -q.h][q.va || 0] * v.scale;
    ctx.fillRect(-(q.ha || 0) * w / 2, gy - fs * 0.7, w, Math.max(0.5, fs * 0.6)); ctx.restore(); return;
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(-(q.rot || 0)); if (q.wf && q.wf !== 1) ctx.scale(q.wf, 1);
  ctx.font = `${fs}px ${FONT}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  ctx.textAlign = ['left', 'center', 'right'][q.ha || 0];
  const by = [0, 0.3 * q.h, -q.h / 2, -q.h][q.va || 0] * v.scale;
  ctx.fillText(q.s, 0, -by); // sumbu-y layar terbalik terhadap dunia
  ctx.restore();
}
function drawPoint(ctx, q, v, doc, color) {
  const [x, y] = W2S(v, q.p), m = doc.set.pdmode || 0;
  let s = doc.set.pdsize || 0; s = s > 0 ? s * v.scale : s < 0 ? -s / 100 * v.h : v.h * 0.025;
  ctx.beginPath();
  const b = m & 7;
  if (b === 0) { ctx.fillStyle = color; ctx.fillRect(x - 1, y - 1, 2, 2); }
  if (b === 2) { ctx.moveTo(x - s / 2, y); ctx.lineTo(x + s / 2, y); ctx.moveTo(x, y - s / 2); ctx.lineTo(x, y + s / 2); }
  if (b === 3) { ctx.moveTo(x - s / 2, y - s / 2); ctx.lineTo(x + s / 2, y + s / 2); ctx.moveTo(x + s / 2, y - s / 2); ctx.lineTo(x - s / 2, y + s / 2); }
  if (b === 4) { ctx.moveTo(x, y); ctx.lineTo(x, y - s / 2); }
  if (m & 32) { ctx.moveTo(x + s / 2, y); ctx.arc(x, y, s / 2, 0, TAU); }
  if (m & 64) ctx.rect(x - s / 2, y - s / 2, s, s);
  ctx.stroke();
}

// Gambar daftar entitas. opt: {bg:'dark'|'paper', lwt, mono, plot, px (px/mm untuk lw di kertas), cull, override:{color,width,alpha}}
export function drawEntities(ctx, list, doc, v, opt = {}) {
  const bg = opt.bg || 'dark', vw = { x1: -50, y1: -50, x2: v.w + 50, y2: v.h + 50 };
  for (const e of list) {
    const L0 = doc.layers[e.layer];
    if (L0 && (!L0.on || L0.frz)) continue;
    if (opt.plot && L0 && !L0.plot) continue;
    if (opt.cull !== false && e.type !== 'xline' && e.type !== 'ray') {
      const bb = bbox(e, doc);
      const sx1 = v.ox + bb.x1 * v.scale, sx2 = v.ox + bb.x2 * v.scale, sy1 = v.oy - bb.y2 * v.scale, sy2 = v.oy - bb.y1 * v.scale;
      if (sx2 < vw.x1 || sx1 > vw.x2 || sy2 < vw.y1 || sy1 > vw.y2) continue;
    }
    drawEnt(ctx, e, doc, v, opt, bg);
  }
}
export function drawEnt(ctx, e, doc, v, opt = {}, bg = opt.bg || 'dark') {
  const base = styleOf(e, null, doc), ps = prims(e, doc);
  const ov = opt.override;
  let cur = null;
  const flush = () => { if (cur) { ctx.stroke(); cur = null; } };
  const apply = (st) => {
    const col = ov?.color || (opt.mono ? '#000000' : cssColor(st, bg));
    let w = 1;
    if (opt.lwt) w = opt.px ? Math.max(0.6, st.lw / 100 * opt.px) : (st.lw <= 25 ? 1 : st.lw / 25);
    if (ov?.width) w = Math.max(w, ov.width);
    const dash = ov?.dash || dashFor(st, v, opt.ltpx || v.scale);
    const key = col + '|' + w + '|' + (dash ? dash.join(',') : '');
    return { col, w, dash, key };
  };
  let lastKey = null, baseS = null;
  for (const q of ps) {
    const st = q.src ? styleOf(q.src.e, q.src.chain, doc) : base;
    if (q.src && (!st.layer.on || st.layer.frz)) continue;
    if (q.src && opt.plot && !st.layer.plot) continue;
    const S = q.src ? apply(st) : (baseS ||= apply(base));
    if (q.t === 'T') { flush(); drawText(ctx, q, v, S.col); lastKey = null; continue; }
    if (q.t === 'F') {
      flush(); ctx.fillStyle = q.wipe ? (bg === 'paper' ? '#FFFFFF' : opt.bgColor || '#212830') : S.col;
      if (q.dense) { ctx.globalAlpha *= 0.25; fillPrim(ctx, q, v); ctx.globalAlpha /= 0.25; } else fillPrim(ctx, q, v);
      lastKey = null; continue;
    }
    if (q.t === 'D') { flush(); ctx.strokeStyle = S.col; ctx.lineWidth = 1; ctx.setLineDash([]); drawPoint(ctx, q, v, doc, S.col); lastKey = null; continue; }
    if (q.frame && opt.plot) continue;
    if (S.key !== lastKey) { flush(); ctx.strokeStyle = S.col; ctx.lineWidth = S.w * (q.heavy ? 1 : 1); ctx.setLineDash(S.dash || []); ctx.beginPath(); cur = 1; lastKey = S.key; }
    if (!cur) { ctx.beginPath(); cur = 1; }
    drawPrim(ctx, q, v);
  }
  flush();
  if (e.type === 'image' && (e.src || e.img)) drawImage(ctx, e, v, doc);
  ctx.setLineDash([]);
}
const imgCache = new Map();
export const imgSrc = (e, doc) => e.img ? doc?.imgs?.[e.img] : e.src;
function drawImage(ctx, e, v, doc) {
  const src = imgSrc(e, doc); if (!src) return;
  let im = imgCache.get(src);
  if (!im) { im = new Image(); im.src = src; imgCache.set(src, im); im.onload = () => window.dispatchEvent(new Event('cad-regen')); }
  if (!im.complete || !im.naturalWidth) return;
  const [x, y] = W2S(v, e.p);
  ctx.save(); ctx.globalAlpha *= (e.fade ? 1 - e.fade / 100 : 1);
  const sw = e.w * v.scale, sh = e.h * v.scale;
  if (!e.rot && v.w && (sw > 4 * v.w || sh > 4 * v.h)) { // zoom dekat: gambar hanya bagian yang terlihat (hemat & aman untuk kanvas)
    const sx = x, sy = y - sh, x1 = Math.max(sx, 0), y1 = Math.max(sy, 0), x2 = Math.min(sx + sw, v.w), y2 = Math.min(sy + sh, v.h);
    if (x2 > x1 && y2 > y1) { const kx = im.naturalWidth / sw, ky = im.naturalHeight / sh; ctx.drawImage(im, (x1 - sx) * kx, (y1 - sy) * ky, (x2 - x1) * kx, (y2 - y1) * ky, x1, y1, x2 - x1, y2 - y1); }
    ctx.restore(); return;
  }
  ctx.translate(x, y); ctx.rotate(-(e.rot || 0));
  ctx.drawImage(im, 0, -sh, sw, sh); ctx.restore();
}

// Grid adaptif gaya AutoCAD
export function drawGrid(ctx, v, step0, colors) {
  let g = step0;
  while (g * v.scale < 9) g *= 5;
  while (g * v.scale > 90) g /= 5;
  const major = g * 5;
  const x0 = Math.floor((-v.ox / v.scale) / g) * g, x1 = (v.w - v.ox) / v.scale;
  const y0 = Math.floor(((v.oy - v.h) / v.scale) / g) * g, y1 = v.oy / v.scale;
  const lines = (maj) => {
    ctx.beginPath();
    for (let x = x0; x <= x1; x += g) { const isM = Math.abs(x / major - Math.round(x / major)) < 1e-6; if (isM !== maj) continue; const sx = Math.round(v.ox + x * v.scale) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, v.h); }
    for (let y = y0; y <= y1; y += g) { const isM = Math.abs(y / major - Math.round(y / major)) < 1e-6; if (isM !== maj) continue; const sy = Math.round(v.oy - y * v.scale) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(v.w, sy); }
    ctx.stroke();
  };
  ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.strokeStyle = colors.minor; lines(false);
  ctx.strokeStyle = colors.major; lines(true);
  // sumbu
  ctx.strokeStyle = colors.ax; ctx.beginPath(); const oy = Math.round(v.oy) + .5, ox = Math.round(v.ox) + .5;
  ctx.moveTo(0, oy); ctx.lineTo(v.w, oy); ctx.stroke();
  ctx.strokeStyle = colors.ay; ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, v.h); ctx.stroke();
}

// Layout: kertas, kop, viewport model
export function drawLayout(ctx, L, doc, pv, opt = {}) {
  const [W, H] = paperSize(L), F = layoutFrame(L), vp = fitVp(L, doc);
  const [px, py] = W2S(pv, { x: 0, y: H });
  const pw = W * pv.scale, ph = H * pv.scale;
  if (!opt.export) {
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(px + 5, py + 5, pw, ph);
  }
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(px, py, pw, ph);
  if (!opt.export) {
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    const m = 5 * pv.scale; ctx.strokeRect(px + m, py + m, pw - 2 * m, ph - 2 * m); ctx.setLineDash([]);
  }
  const lwOpt = { bg: 'paper', lwt: opt.lwt ?? true, px: pv.scale, mono: opt.mono, plot: opt.export };
  // viewport
  const mv = vpView(pv, vp);
  const [vx, vy] = W2S(pv, { x: vp.x, y: vp.y + vp.h });
  ctx.save(); ctx.beginPath(); ctx.rect(vx, vy, vp.w * pv.scale, vp.h * pv.scale); ctx.clip();
  drawEntities(ctx, doc.model, doc, { ...mv, w: pv.w, h: pv.h }, { ...lwOpt, px: pv.scale, ltpx: pv.scale / (doc.set.ltscale || 1) });
  if (opt.vpExtra) opt.vpExtra(mv);
  ctx.restore();
  if (!opt.export) { ctx.strokeStyle = opt.vpActive ? '#2F6FE0' : 'rgba(0,0,0,.35)'; ctx.lineWidth = opt.vpActive ? 2 : 1; ctx.strokeRect(vx, vy, vp.w * pv.scale, vp.h * pv.scale); }
  const tb = titleBlockEnts(L, doc);
  if (!doc.layers.KOP) doc.addLayer('KOP', { color: 7 });
  drawEntities(ctx, tb, doc, pv, { ...lwOpt, cull: false });
  drawEntities(ctx, L.ents, doc, pv, lwOpt);
  return { mv, F };
}
export { textBox };
