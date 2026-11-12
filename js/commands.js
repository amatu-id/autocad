// Perintah gaya AutoCAD: Draw, Modify, Annotate, Inquiry, Block, Utilities.
import {
  TAU, D2R, R2D, add, sub, mul, dot, crs, len, dist, ang, polar, mid, unit, perp, lerp, an, sweepOf, onArc, eq, cp, M,
  bulgeArc, arc3, circ3, interPrim, closestPrim, polyArea, rectOf, bbOk, ellParam, inPoly, segSeg,
} from './geom.js';
import {
  prims, gprims, bbox, xform, curve, piece, explode, plSegs, loopPts, curveLen, entArea, sampleCurve, insMatrix,
  TYPE_NAMES, textW, decodeText, dimValue, fmtNum, PATTERNS, colorName, lwName, hit,
} from './ent.js';
import { findBoundary } from './boundary.js';

export const CMDS = {}, ALIAS = {};
const def = (name, fn, o = {}) => { CMDS[name] = { fn, ...o }; (o.alias || []).forEach(a => ALIAS[a] = name); };
const clone = e => { const n = JSON.parse(JSON.stringify(e)); delete n.id; return n; };
const P0 = p => ({ x: p.x, y: p.y, b: 0 });
const ghost = (list, m) => list.slice(0, 400).map(e => xform(clone(e), m));
const kwStr = k => k.length ? ` [${k.join('/')}]` : '';
const fmt = (ed, v) => ed.fmt(v);
const deg = a => (an(a) * R2D).toFixed(Math.max(0, ed0()?.doc.set.angPrec || 0));
let ED = null; const ed0 = () => ED;

// ============ DRAW ============
def('LINE', async ed => {
  let p0 = await ed.getPoint('Specify first point:');
  if (p0 === null) p0 = ed.lastLineEnd || ed.lastPt;
  const pts = [p0], made = [];
  for (;;) {
    const base = pts[pts.length - 1], k = pts.length >= 3 ? ['Close', 'Undo'] : ['Undo'];
    const p = await ed.getPoint('Specify next point or' + kwStr(k) + ':', { base, kws: k, preview: q => [{ type: 'line', p1: base, p2: q }] });
    if (p === null) break;
    if (p === 'Undo') { if (made.length) { ed.remove(made.pop()); pts.pop(); } else ed.msg('All segments already undone.'); continue; }
    if (p === 'Close') { made.push(ed.add({ type: 'line', p1: base, p2: cp(pts[0]) })); pts.push(pts[0]); break; }
    made.push(ed.add({ type: 'line', p1: cp(base), p2: cp(p) })); pts.push(p);
  }
  ed.lastLineEnd = pts[pts.length - 1];
}, { alias: ['L'] });

function tangentAtEnd(pts) {
  const n = pts.length; if (n < 2) return null;
  const a = pts[n - 2], b = pts[n - 1];
  return ang(a, b) + 2 * Math.atan(a.b || 0);
}
const normA = a => { a = an(a); return a > Math.PI ? a - TAU : a; };
def('PLINE', async ed => {
  const p0 = await ed.getPoint('Specify start point:');
  const s = p0 === null ? ed.lastPt : p0;
  ed.msg(`Current line-width is ${fmt(ed, ed.plW || 0)}`);
  const pts = [P0(s)]; let arcMode = false, w = ed.plW || 0, ent = null, lastTan = ed.lastTan ?? 0;
  const sync = () => { if (pts.length >= 2) { if (!ent) ent = ed.add({ type: 'pline', pts: [], closed: false }); ent.pts = pts.map(p => ({ ...p })); ent.w = w; ed.invalidate(); } else if (ent) { ed.remove(ent); ent = null; } };
  const bulgeTo = (from, p) => { const t = tangentAtEnd(pts) ?? lastTan; return Math.tan(normA(ang(from, p) - t) / 2); };
  for (;;) {
    const base = pts[pts.length - 1];
    const k = arcMode ? ['Angle', 'CEnter', 'CLose', 'Direction', 'Halfwidth', 'Line', 'Radius', 'Second pt', 'Undo', 'Width'] : ['Arc', 'Close', 'Halfwidth', 'Length', 'Undo', 'Width'];
    const p = await ed.getPoint((arcMode ? 'Specify endpoint of arc or' : 'Specify next point or') + kwStr(k) + ':', {
      base, kws: k,
      preview: q => [{ type: 'pline', pts: [{ ...base, b: arcMode ? bulgeTo(base, q) : 0 }, P0(q)], w }],
    });
    if (p === null) break;
    if (p === 'Arc') { arcMode = true; continue; }
    if (p === 'Line') { arcMode = false; continue; }
    if (p === 'Undo') { if (pts.length > 1) { pts.pop(); pts[pts.length - 1].b = 0; sync(); } continue; }
    if (p === 'Close' || p === 'CLose') {
      if (pts.length < 2) { ed.msg('Diperlukan minimal 2 titik.'); continue; }
      if (arcMode) pts[pts.length - 1].b = bulgeTo(base, pts[0]);
      sync(); ent.closed = true; ed.invalidate(); break;
    }
    if (p === 'Width' || p === 'Halfwidth') {
      const f = p === 'Halfwidth' ? 2 : 1;
      const a = await ed.getDist(`Specify starting ${p === 'Width' ? 'width' : 'half-width'} <${fmt(ed, w / f)}>:`, { def: w / f, base });
      await ed.getDist(`Specify ending ${p === 'Width' ? 'width' : 'half-width'} <${fmt(ed, a)}>:`, { def: a, base });
      w = a * f; ed.plW = w; sync(); continue;
    }
    if (p === 'Length') {
      const L = await ed.getDist('Specify length of line:', { base });
      const t = tangentAtEnd(pts) ?? lastTan; const q = polar(base, t, L); pts.push(P0(q)); sync(); continue;
    }
    if (p === 'Second pt') {
      const m = await ed.getPoint('Specify second point on arc:', { base });
      const e = await ed.getPoint('Specify end point of arc:', { base: m, preview: q => { const A = arc3(base, m, q); return A ? [{ type: 'arc', ...A }] : []; } });
      const A = arc3(base, m, e); if (A) { const sw = sweepOf(A.sa, A.ea), ccw = crs(sub(m, base), sub(e, m)) > 0; pts[pts.length - 1].b = Math.tan(sw / 4) * (ccw ? 1 : -1); pts.push(P0(e)); sync(); }
      continue;
    }
    if (p === 'CEnter' || p === 'Radius' || p === 'Angle' || p === 'Direction') {
      if (p === 'CEnter') {
        const c = await ed.getPoint('Specify center point of arc:', { base });
        const e = await ed.getPoint('Specify end point of arc or [Angle/Length]:', { base: c, preview: q => [{ type: 'arc', c, r: dist(c, base), sa: ang(c, base), ea: ang(c, q) }] });
        const sw = sweepOf(ang(c, base), ang(c, e)), q = polar(c, ang(c, e), dist(c, base));
        pts[pts.length - 1].b = Math.tan(sw / 4); pts.push(P0(q)); sync(); continue;
      }
      if (p === 'Angle') {
        const A = await ed.getAngle('Specify included angle:', { base });
        const e = await ed.getPoint('Specify endpoint of arc:', { base, preview: q => [{ type: 'pline', pts: [{ ...base, b: Math.tan(A / 4) }, P0(q)] }] });
        pts[pts.length - 1].b = Math.tan(A / 4); pts.push(P0(e)); sync(); continue;
      }
      if (p === 'Radius') {
        const r = await ed.getDist('Specify radius of arc:', { base });
        const e = await ed.getPoint('Specify endpoint of arc:', { base });
        const d = dist(base, e); if (d > 2 * r) { ed.msg('Jari-jari terlalu kecil.'); continue; }
        const sw = 2 * Math.asin(d / (2 * r)); pts[pts.length - 1].b = Math.tan(sw / 4); pts.push(P0(e)); sync(); continue;
      }
      if (p === 'Direction') {
        const d = await ed.getAngle('Specify the tangent direction for the start point of arc:', { base }); lastTan = d;
        const e = await ed.getPoint('Specify endpoint of the arc:', { base });
        pts[pts.length - 1].b = Math.tan(normA(ang(base, e) - d) / 2); pts.push(P0(e)); sync(); continue;
      }
    }
    if (typeof p === 'object') { if (arcMode) pts[pts.length - 1].b = bulgeTo(base, p); pts.push(P0(p)); sync(); }
  }
  if (pts.length >= 2) ed.lastTan = tangentAtEnd(pts);
  ed.lastLineEnd = pts[pts.length - 1];
}, { alias: ['PL'] });

async function tangentEnt(ed, msg) { return ed.getEnt(msg, { filter: e => ['line', 'circle', 'arc', 'pline'].includes(e.type) }); }
function ttr(ed, A, B, r) {
  const off = (S) => {
    const q = gprims(S.e, ed.doc).map(q => ({ q, d: dist(S.p, closestPrim(S.p, q)) })).sort((a, b) => a.d - b.d)[0]?.q; if (!q) return [];
    if (q.t === 'L') { const n = mul(perp(unit(sub(q.b, q.a))), r); return [{ t: 'L', a: add(q.a, n), b: add(q.b, n), inf: 2 }, { t: 'L', a: sub(q.a, n), b: sub(q.b, n), inf: 2 }]; }
    if (q.t === 'A') return [{ t: 'A', c: q.c, r: q.r + r, sa: 0, ea: TAU, full: true }, ...(q.r > r ? [{ t: 'A', c: q.c, r: q.r - r, sa: 0, ea: TAU, full: true }] : [])];
    return [];
  };
  const cands = [];
  for (const a of off(A)) for (const b of off(B)) cands.push(...interPrim(a, b, true, true));
  cands.sort((x, y) => dist(x, A.p) + dist(x, B.p) - dist(y, A.p) - dist(y, B.p));
  return cands[0];
}
def('CIRCLE', async ed => {
  const k = ['3P', '2P', 'Ttr'];
  let c = await ed.getPoint('Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:', { kws: k });
  if (c === '2P') {
    const a = await ed.getPoint('Specify first end point of circle\'s diameter:');
    const b = await ed.getPoint('Specify second end point of circle\'s diameter:', { base: a, preview: q => [{ type: 'circle', c: mid(a, q), r: dist(a, q) / 2 }] });
    ed.add({ type: 'circle', c: mid(a, b), r: dist(a, b) / 2 }); return;
  }
  if (c === '3P') {
    const a = await ed.getPoint('Specify first point on circle:');
    const b = await ed.getPoint('Specify second point on circle:', { base: a });
    const d = await ed.getPoint('Specify third point on circle:', { base: b, preview: q => { const K = circ3(a, b, q); return K ? [{ type: 'circle', ...K }] : []; } });
    const K = circ3(a, b, d); if (K) ed.add({ type: 'circle', ...K }); else ed.msg('Titik segaris.'); return;
  }
  if (c === 'Ttr') {
    const A = await tangentEnt(ed, 'Specify point on object for first tangent of circle:');
    const B = await tangentEnt(ed, 'Specify point on object for second tangent of circle:');
    const r = await ed.getDist(`Specify radius of circle <${fmt(ed, ed.lastR || 10)}>:`, { def: ed.lastR || 10 });
    const C = ttr(ed, A, B, r); if (!C) { ed.msg('Circle does not exist.'); return; }
    ed.lastR = r; ed.add({ type: 'circle', c: C, r }); return;
  }
  if (c === null) return;
  const dr = ed.lastR || 10;
  let r = await ed.getDist(`Specify radius of circle or [Diameter] <${fmt(ed, dr)}>:`, { base: c, kws: ['Diameter'], def: dr, preview: q => [{ type: 'circle', c, r: dist(c, q) }] });
  if (r === 'Diameter') r = (await ed.getDist(`Specify diameter of circle <${fmt(ed, dr * 2)}>:`, { base: c, def: dr * 2, preview: q => [{ type: 'circle', c, r: dist(c, q) / 2 }] })) / 2;
  ed.lastR = r; ed.add({ type: 'circle', c, r });
}, { alias: ['C'] });

def('ARC', async ed => {
  let s = await ed.getPoint('Specify start point of arc or [Center]:', { kws: ['Center'] });
  const addArc = A => { if (A && A.r > 1e-9) ed.add({ type: 'arc', ...A }); };
  if (s === 'Center') {
    const c = await ed.getPoint('Specify center point of arc:');
    s = await ed.getPoint('Specify start point of arc:', { base: c, rubber: 'dash' });
    const r = dist(c, s), sa = ang(c, s);
    const e = await ed.getPoint('Specify end point of arc (hold Ctrl to switch direction) or [Angle/chord Length]:', { base: c, kws: ['Angle', 'chord Length'], preview: q => [{ type: 'arc', c, r, sa, ea: ang(c, q) }] });
    if (e === 'Angle') { const A = await ed.getAngle('Specify included angle:', { base: c }); addArc(A >= 0 ? { c, r, sa, ea: sa + A } : { c, r, sa: sa + A, ea: sa }); return; }
    if (e === 'chord Length') { const L = await ed.getDist('Specify length of chord:', { base: s }); const A = 2 * Math.asin(Math.min(1, L / (2 * r))); addArc({ c, r, sa, ea: sa + A }); return; }
    addArc({ c, r, sa, ea: ang(c, e) }); return;
  }
  const p2 = await ed.getPoint('Specify second point of arc or [Center/End]:', { base: s, kws: ['Center', 'End'] });
  if (p2 === 'Center') {
    const c = await ed.getPoint('Specify center point of arc:', { base: s, rubber: 'dash' });
    const r = dist(c, s), sa = ang(c, s);
    const e = await ed.getPoint('Specify end point of arc or [Angle/chord Length]:', { base: c, kws: ['Angle', 'chord Length'], preview: q => [{ type: 'arc', c, r, sa, ea: ang(c, q) }] });
    if (e === 'Angle') { const A = await ed.getAngle('Specify included angle:', { base: c }); addArc({ c, r, sa, ea: sa + A }); return; }
    if (e === 'chord Length') { const L = await ed.getDist('Specify length of chord:', { base: s }); addArc({ c, r, sa, ea: sa + 2 * Math.asin(Math.min(1, L / (2 * r))) }); return; }
    addArc({ c, r, sa, ea: ang(c, e) }); return;
  }
  if (p2 === 'End') {
    const e = await ed.getPoint('Specify end point of arc:', { base: s });
    const o = await ed.getPoint('Specify center point of arc or [Angle/Direction/Radius]:', { base: e, kws: ['Angle', 'Direction', 'Radius'], preview: q => [{ type: 'arc', c: q, r: dist(q, s), sa: ang(q, s), ea: ang(q, e) }] });
    const d = dist(s, e);
    if (o === 'Radius') { const r = await ed.getDist('Specify radius of arc:', { base: e }); if (d > 2 * r) { ed.msg('Jari-jari terlalu kecil.'); return; } const h = Math.sqrt(r * r - d * d / 4), c = add(mid(s, e), mul(perp(unit(sub(e, s))), h)); addArc({ c, r, sa: ang(c, s), ea: ang(c, e) }); return; }
    if (o === 'Angle') { const A = await ed.getAngle('Specify included angle:', { base: s }); const b = Math.tan(A / 4), K = bulgeArc(s, e, b); addArc(K); return; }
    if (o === 'Direction') { const t = await ed.getAngle('Specify tangent direction for the start point of arc:', { base: s }); const b = Math.tan(normA(ang(s, e) - t) / 2); addArc(bulgeArc(s, e, b)); return; }
    addArc({ c: o, r: dist(o, s), sa: ang(o, s), ea: ang(o, e) }); return;
  }
  const e = await ed.getPoint('Specify end point of arc:', { base: p2, preview: q => { const A = arc3(s, p2, q); return A ? [{ type: 'arc', ...A }] : []; } });
  addArc(arc3(s, p2, e));
}, { alias: ['A'] });

function rectPts(a, b, o = {}) {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  let pts = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
  if (o.rot) { const c = a; pts = [a, polar(a, o.rot, b.x - a.x), add(polar(a, o.rot, b.x - a.x), polar({ x: 0, y: 0 }, o.rot + Math.PI / 2, b.y - a.y)), polar(a, o.rot + Math.PI / 2, b.y - a.y)]; void c; }
  const f = o.fillet || 0, ch = o.chamfer || 0;
  if (f > 0 || ch > 0) {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const p = pts[i], prev = pts[(i + 3) % 4], next = pts[(i + 1) % 4], d = f || ch;
      out.push({ ...polar(p, ang(p, prev), d), b: f ? Math.tan(Math.PI / 8) : 0 }, { ...polar(p, ang(p, next), d), b: 0 });
    }
    return out;
  }
  return pts.map(P0);
}
def('RECTANG', async ed => {
  const o = { fillet: ed.recF || 0, chamfer: ed.recC || 0, w: ed.recW || 0, rot: 0 };
  let a;
  for (;;) {
    a = await ed.getPoint('Specify first corner point or [Chamfer/Elevation/Fillet/Thickness/Width]:', { kws: ['Chamfer', 'Elevation', 'Fillet', 'Thickness', 'Width'] });
    if (a === 'Fillet') { o.fillet = ed.recF = await ed.getDist(`Specify fillet radius for rectangles <${fmt(ed, o.fillet)}>:`, { def: o.fillet }); o.chamfer = ed.recC = 0; continue; }
    if (a === 'Chamfer') { o.chamfer = ed.recC = await ed.getDist(`Specify first chamfer distance for rectangles <${fmt(ed, o.chamfer)}>:`, { def: o.chamfer }); await ed.getDist(`Specify second chamfer distance for rectangles <${fmt(ed, o.chamfer)}>:`, { def: o.chamfer }); o.fillet = ed.recF = 0; continue; }
    if (a === 'Width') { o.w = ed.recW = await ed.getDist(`Specify line width for rectangles <${fmt(ed, o.w)}>:`, { def: o.w }); continue; }
    if (a === 'Elevation' || a === 'Thickness') { await ed.getDist(`Specify ${a.toLowerCase()} for rectangles <0>:`, { def: 0 }); continue; }
    if (a === null) return;
    break;
  }
  for (;;) {
    const b = await ed.getPoint('Specify other corner point or [Area/Dimensions/Rotation]:', { base: a, kws: ['Area', 'Dimensions', 'Rotation'], preview: q => [{ type: 'pline', pts: rectPts(a, q, o), closed: true, w: o.w }] });
    if (b === 'Rotation') { o.rot = await ed.getAngle('Specify rotation angle or [Pick points] <0>:', { base: a, def: 0 }); continue; }
    if (b === 'Dimensions') {
      const L = await ed.getDist(`Specify length for rectangles <${fmt(ed, ed.recL || 10)}>:`, { def: ed.recL || 10 }); ed.recL = L;
      const W = await ed.getDist(`Specify width for rectangles <${fmt(ed, ed.recWi || 10)}>:`, { def: ed.recWi || 10 }); ed.recWi = W;
      const q = await ed.getPoint('Specify other corner point:', { base: a, preview: q => [{ type: 'pline', pts: rectPts(a, { x: a.x + Math.sign(q.x - a.x || 1) * L, y: a.y + Math.sign(q.y - a.y || 1) * W }, o), closed: true, w: o.w }] });
      ed.add({ type: 'pline', pts: rectPts(a, { x: a.x + Math.sign(q.x - a.x || 1) * L, y: a.y + Math.sign(q.y - a.y || 1) * W }, o), closed: true, w: o.w }); return;
    }
    if (b === 'Area') {
      const A = await ed.getNum('Enter area of rectangle in current units <100>:', { def: 100 });
      const L = await ed.getDist('Enter rectangle length <10>:', { def: 10 });
      ed.add({ type: 'pline', pts: rectPts(a, { x: a.x + L, y: a.y + A / L }, o), closed: true, w: o.w }); return;
    }
    if (b === null) return;
    const q = o.rot ? { x: dot(sub(b, a), { x: Math.cos(o.rot), y: Math.sin(o.rot) }) + a.x, y: dot(sub(b, a), { x: -Math.sin(o.rot), y: Math.cos(o.rot) }) + a.y } : b;
    ed.add({ type: 'pline', pts: rectPts(a, q, o), closed: true, w: o.w }); return;
  }
}, { alias: ['REC', 'RECTANGLE'] });

function polyPts(c, n, r, a0, circ) { const R = circ ? r / Math.cos(Math.PI / n) : r; const out = []; for (let i = 0; i < n; i++) out.push(P0(polar(c, a0 + (circ ? Math.PI / n : 0) + i * TAU / n, R))); return out; }
def('POLYGON', async ed => {
  const n = await ed.getInt(`Enter number of sides <${ed.polyN || 4}>:`, { def: ed.polyN || 4, min: 3 }); ed.polyN = n;
  const c = await ed.getPoint('Specify center of polygon or [Edge]:', { kws: ['Edge'] });
  if (c === 'Edge') {
    const a = await ed.getPoint('Specify first endpoint of edge:');
    const b = await ed.getPoint('Specify second endpoint of edge:', { base: a, preview: q => [edgePoly(a, q, n)] });
    ed.add(edgePoly(a, b, n)); return;
  }
  const t = await ed.getKw('Enter an option [Inscribed in circle/Circumscribed about circle] <' + (ed.polyT || 'I') + '>:', ['Inscribed in circle', 'Circumscribed about circle'], ed.polyT === 'C' ? 'Circumscribed about circle' : 'Inscribed in circle');
  const circ = t.startsWith('C'); ed.polyT = circ ? 'C' : 'I';
  const r = await ed.getPoint('Specify radius of circle:', { base: c, numOk: true, preview: q => [{ type: 'pline', pts: polyPts(c, n, dist(c, q), ang(c, q) - (circ ? Math.PI / n : 0), circ), closed: true }] });
  if (typeof r === 'number') ed.add({ type: 'pline', pts: polyPts(c, n, r, Math.PI / 2 - (circ ? Math.PI / n : 0), circ), closed: true });
  else ed.add({ type: 'pline', pts: polyPts(c, n, dist(c, r), ang(c, r) - (circ ? Math.PI / n : 0), circ), closed: true });
}, { alias: ['POL'] });
function edgePoly(a, b, n) { const L = dist(a, b), R = L / (2 * Math.sin(Math.PI / n)), m = mid(a, b), h = L / (2 * Math.tan(Math.PI / n)), c = add(m, mul(perp(unit(sub(b, a))), h)); return { type: 'pline', pts: polyPts(c, n, R, ang(c, a), false), closed: true }; }

def('ELLIPSE', async ed => {
  let a = await ed.getPoint('Specify axis endpoint of ellipse or [Arc/Center]:', { kws: ['Arc', 'Center'] });
  let isArc = false;
  if (a === 'Arc') { isArc = true; a = await ed.getPoint('Specify axis endpoint of elliptical arc or [Center]:', { kws: ['Center'] }); }
  let c, u;
  if (a === 'Center') {
    c = await ed.getPoint('Specify center of ellipse:');
    const e = await ed.getPoint('Specify endpoint of axis:', { base: c, rubber: 'line' }); u = sub(e, c);
  } else {
    const b = await ed.getPoint('Specify other endpoint of axis:', { base: a, rubber: 'line' });
    c = mid(a, b); u = sub(b, c);
  }
  const L = len(u);
  let d = await ed.getPoint('Specify distance to other axis or [Rotation]:', { base: c, kws: ['Rotation'], numOk: true, preview: q => [{ type: 'ellipse', c, u, k: Math.min(1, Math.abs(dot(sub(q, c), unit(perp(u)))) / L) || 0.01 }] });
  let k;
  if (d === 'Rotation') { const r = await ed.getAngle('Specify rotation around major axis:', { base: c }); k = Math.abs(Math.cos(r)); }
  else k = typeof d === 'number' ? d / L : Math.abs(dot(sub(d, c), unit(perp(u)))) / L;
  if (k > 1) { u = mul(perp(u), k); k = 1 / k; }
  k = Math.max(1e-4, Math.min(1, k));
  if (!isArc) { ed.add({ type: 'ellipse', c, u, k }); return; }
  const s = await ed.getPoint('Specify start angle or [Parameter]:', { base: c, kws: ['Parameter'], preview: q => [{ type: 'line', p1: c, p2: q }] });
  const sp = typeof s === 'object' ? ellParam(c, u, k, s) : 0;
  const e = await ed.getPoint('Specify end angle or [Parameter/Included angle]:', { base: c, kws: ['Parameter', 'Included angle'], preview: q => [{ type: 'ellipse', c, u, k, sp, ep: ellParam(c, u, k, q) }] });
  if (e === 'Included angle') { const A = await ed.getAngle('Specify included angle for arc <180>:', { base: c, def: Math.PI }); ed.add({ type: 'ellipse', c, u, k, sp, ep: an(sp + A) }); return; }
  ed.add({ type: 'ellipse', c, u, k, sp, ep: typeof e === 'object' ? ellParam(c, u, k, e) : an(sp + Math.PI) });
}, { alias: ['EL'] });

def('SPLINE', async ed => {
  ed.msg('Current settings: Method=Fit  Knots=Chord');
  const f0 = await ed.getPoint('Specify first point or [Method/Knots/Object]:', { kws: ['Method', 'Knots', 'Object'] });
  if (f0 === 'Object') {
    const S = await ed.getSel('Select objects to convert to splines:', { filter: e => e.type === 'pline' });
    for (const e of S) ed.replace(e, [{ ...clone(e), type: 'spline', fit: e.pts.map(cp), closed: e.closed, pts: undefined }]); return;
  }
  if (typeof f0 !== 'object' || !f0) return;
  const fit = [f0];
  for (;;) {
    const k = fit.length >= 3 ? ['end Tangency', 'tolerance', 'Undo', 'Close'] : ['end Tangency', 'tolerance', 'Undo'];
    const p = await ed.getPoint('Enter next point or' + kwStr(k) + ':', { base: fit[fit.length - 1], kws: k, preview: q => [{ type: 'spline', fit: [...fit, q] }] });
    if (p === null) break;
    if (p === 'Undo') { if (fit.length > 1) fit.pop(); continue; }
    if (p === 'Close') { if (fit.length >= 3) { ed.add({ type: 'spline', fit, closed: true }); return; } continue; }
    if (typeof p === 'object') fit.push(p);
  }
  if (fit.length >= 2) ed.add({ type: 'spline', fit });
}, { alias: ['SPL'] });

def('POINT', async ed => {
  ed.msg(`Current point modes:  PDMODE=${ed.doc.set.pdmode}  PDSIZE=${ed.doc.set.pdsize}`);
  for (;;) { const p = await ed.getPoint('Specify a point:'); if (!p) break; ed.add({ type: 'point', p }); if (!ed.multiPt) break; }
}, { alias: ['PO'] });
def('MULTIPLEPOINT', async ed => { ed.multiPt = true; try { await CMDS.POINT.fn(ed); } finally { ed.multiPt = false; } }, { alias: ['MPOINT'] });

def('XLINE', async ed => {
  let p = await ed.getPoint('Specify a point or [Hor/Ver/Ang/Bisect/Offset]:', { kws: ['Hor', 'Ver', 'Ang', 'Bisect', 'Offset'] });
  if (p === 'Hor' || p === 'Ver') { const dir = p === 'Hor' ? { x: 1, y: 0 } : { x: 0, y: 1 }; for (;;) { const q = await ed.getPoint('Specify through point:', { preview: q => [{ type: 'xline', p: q, dir }] }); if (!q) return; ed.add({ type: 'xline', p: q, dir }); } }
  if (p === 'Ang') { const a = await ed.getAngle('Enter angle of xline (0) or [Reference]:', { def: 0 }); const dir = { x: Math.cos(a), y: Math.sin(a) }; for (;;) { const q = await ed.getPoint('Specify through point:', { preview: q => [{ type: 'xline', p: q, dir }] }); if (!q) return; ed.add({ type: 'xline', p: q, dir }); } }
  if (p === 'Bisect') { const v = await ed.getPoint('Specify angle vertex point:'); const a = await ed.getPoint('Specify angle start point:', { base: v }); for (;;) { const b = await ed.getPoint('Specify angle end point:', { base: v, preview: q => [{ type: 'xline', p: v, dir: unit(add(unit(sub(a, v)), unit(sub(q, v)))) }] }); if (!b) return; ed.add({ type: 'xline', p: v, dir: unit(add(unit(sub(a, v)), unit(sub(b, v)))) }); } }
  if (p === 'Offset') { await CMDS.OFFSET.fn(ed); return; }
  if (!p) return;
  for (;;) { const q = await ed.getPoint('Specify through point:', { base: p, preview: q => eq(q, p) ? [] : [{ type: 'xline', p, dir: unit(sub(q, p)) }] }); if (!q) return; if (!eq(q, p)) ed.add({ type: 'xline', p, dir: unit(sub(q, p)) }); }
}, { alias: ['XL'] });
def('RAY', async ed => {
  const p = await ed.getPoint('Specify start point:'); if (!p) return;
  for (;;) { const q = await ed.getPoint('Specify through point:', { base: p, preview: q => eq(q, p) ? [] : [{ type: 'ray', p, dir: unit(sub(q, p)) }] }); if (!q) return; if (!eq(q, p)) ed.add({ type: 'ray', p, dir: unit(sub(q, p)) }); }
});
def('DONUT', async ed => {
  const di = await ed.getDist(`Specify inside diameter of donut <${fmt(ed, ed.dnI ?? 5)}>:`, { def: ed.dnI ?? 5 }); ed.dnI = di;
  const dO = await ed.getDist(`Specify outside diameter of donut <${fmt(ed, ed.dnO ?? 10)}>:`, { def: ed.dnO ?? 10 }); ed.dnO = dO;
  const w = (dO - di) / 2, r = (dO + di) / 4;
  const mk = c => ({ type: 'pline', pts: [{ x: c.x - r, y: c.y, b: 1 }, { x: c.x + r, y: c.y, b: 1 }], closed: true, w: Math.max(w, 1e-9) });
  for (;;) { const c = await ed.getPoint('Specify center of donut or <exit>:', { preview: q => [mk(q)] }); if (!c) break; ed.add(mk(c)); }
}, { alias: ['DO', 'DOUGHNUT'] });

function cloudify(pts, closed, arcLen) {
  const out = [], n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n], L = dist(a, b), k = Math.max(1, Math.round(L / arcLen));
    for (let j = 0; j < k; j++) out.push({ ...lerp(a, b, j / k), b: -0.55 });
  }
  if (!closed) out.push(P0(pts[n - 1]));
  return out;
}
def('REVCLOUD', async ed => {
  const al = ed.rcLen || 15;
  ed.msg(`Minimum arc length: ${fmt(ed, al)}   Style: Normal   Type: Rectangular`);
  let a = await ed.getPoint('Specify first corner point or [Arc length/Object/Rectangular/Polygonal/Freehand/Style/Modify] <Object>:', { kws: ['Arc length', 'Object', 'Rectangular', 'Polygonal', 'Freehand', 'Style', 'Modify'] });
  if (a === 'Arc length') { ed.rcLen = await ed.getDist(`Specify minimum length of arc <${fmt(ed, al)}>:`, { def: al }); a = await ed.getPoint('Specify first corner point:'); }
  if (a === 'Object' || a === null) {
    const r = await ed.getEnt('Select object:', { filter: e => e.type === 'pline' || e.type === 'circle' });
    const e = r.e, pts = e.type === 'circle' ? Array.from({ length: 24 }, (_, i) => polar(e.c, i * TAU / 24, e.r)) : loopPts(e.pts);
    ed.replace(e, [{ ...clone(e), type: 'pline', pts: cloudify(pts, e.type === 'circle' || e.closed, ed.rcLen || 15), closed: e.type === 'circle' || e.closed, c: undefined, r: undefined }]); return;
  }
  if (a === 'Polygonal' || a === 'Freehand') {
    const pts = [await ed.getPoint('Specify start point:')];
    for (;;) { const p = await ed.getPoint('Specify next point:', { base: pts[pts.length - 1], preview: q => [{ type: 'pline', pts: cloudify([...pts, q], true, ed.rcLen || 15), closed: true }] }); if (!p) break; pts.push(p); }
    if (pts.length > 2) ed.add({ type: 'pline', pts: cloudify(pts, true, ed.rcLen || 15), closed: true }); return;
  }
  if (typeof a !== 'object') a = await ed.getPoint('Specify first corner point:');
  const b = await ed.getPoint('Specify opposite corner:', { base: a, preview: q => [{ type: 'pline', pts: cloudify(rectPts(a, q), true, ed.rcLen || 15), closed: true }] });
  ed.add({ type: 'pline', pts: cloudify(rectPts(a, b), true, ed.rcLen || 15), closed: true });
});
def('WIPEOUT', async ed => {
  const pts = [await ed.getPoint('Specify first point or [Frames/Polyline] <Polyline>:')];
  for (;;) { const p = await ed.getPoint('Specify next point or [Undo]:', { base: pts[pts.length - 1], kws: ['Undo'], preview: q => [{ type: 'pline', pts: [...pts, q].map(P0), closed: true }] }); if (!p) break; if (p === 'Undo') { pts.length > 1 && pts.pop(); continue; } pts.push(p); }
  if (pts.length > 2) { const w = ed.add({ type: 'wipeout', pts }); ed.ents.splice(ed.ents.indexOf(w), 1); ed.ents.push(w); }
});

// ---------- Hatch / Boundary ----------
def('HATCH', async ed => {
  const s = ed.doc.set;
  ed.ui?.hatchPanel?.(true);
  const made = [];
  try {
    for (;;) {
      ed.msg(`Pattern: ${s.hpName}   Scale: ${s.hpScale}   Angle: ${(s.hpAng || 0)}`);
      const p = await ed.getPoint('Pick internal point or [Select objects/Undo/seTtings]:', { kws: ['Select objects', 'Undo', 'seTtings'], noSnap: true });
      if (p === null) break;
      if (p === 'seTtings') { await ed.ui?.hatchDialog?.(); continue; }
      if (p === 'Undo') { const h = made.pop(); if (h) ed.remove(h); continue; }
      let loops = null;
      if (p === 'Select objects') {
        const S = await ed.getSel('Select objects:', { filter: e => (e.type === 'pline' && e.closed) || e.type === 'circle' || e.type === 'ellipse' || (e.type === 'spline' && e.closed) });
        loops = S.map(e => e.type === 'pline' ? e.pts.map(q => ({ ...q })) : e.type === 'circle' ? [{ x: e.c.x - e.r, y: e.c.y, b: 1 }, { x: e.c.x + e.r, y: e.c.y, b: 1 }] : prims(e, ed.doc)[0].pts.slice(0, -1).map(P0));
        if (!loops.length) continue;
      } else {
        ed.msg('Analyzing the selected data...');
        loops = findBoundary(ed, p);
        if (!loops) { ed.msg('Valid hatch boundary not found.', 'err'); ed.ui?.alert?.('Boundary Definition Error', 'Valid hatch boundary not found. Pastikan area tertutup rapat.'); continue; }
      }
      const h = ed.add({ type: 'hatch', pat: s.hpName, sc: s.hpScale, ang: (s.hpAng || 0) * D2R, loops, org: { x: 0, y: 0 }, color: s.hpColor ?? ed.doc.set.ccolor, layer: s.hpLayer || ed.doc.clayer });
      // skala otomatis bila pola terlalu rapat (mis. gambar dalam mm)
      const fam = PATTERNS[h.pat]?.f || [], dy = Math.min(...fam.map(f => Math.abs(f[4]) || Infinity));
      if (isFinite(dy) && !s.hpScaleSet) {
        const bb = bbox(h, ed.doc), diag = Math.hypot(bb.x2 - bb.x1, bb.y2 - bb.y1);
        if (diag / (dy * h.sc) > 160) { const raw = diag / (dy * 60), e10 = 10 ** Math.floor(Math.log10(raw)), nice = [1, 2, 5, 10].map(k => k * e10).find(v => v >= raw) || raw; h.sc = s.hpScale = nice; ed.msg(`Pola terlalu rapat — skala hatch otomatis disetel ke ${nice} (ubah di tab Hatch Creation).`); ed.ui?.buildRibbon?.(); }
      }
      ed.ents.splice(ed.ents.indexOf(h), 1); ed.ents.unshift(h); // di belakang (draw order)
      made.push(h);
    }
  } finally { ed.ui?.hatchPanel?.(false); }
}, { alias: ['H', 'BH', 'BHATCH'] });
def('GRADIENT', async ed => { const s = ed.doc.set, keep = s.hpName; s.hpName = 'SOLID'; try { await CMDS.HATCH.fn(ed); } finally { s.hpName = keep; } }, { alias: ['GD'] });
def('BOUNDARY', async ed => {
  for (;;) {
    const p = await ed.getPoint('Pick internal point:', { noSnap: true }); if (!p) break;
    const loops = findBoundary(ed, p);
    if (!loops) { ed.msg('Valid hatch boundary not found.', 'err'); continue; }
    loops.forEach(l => ed.add({ type: 'pline', pts: l, closed: true }));
    ed.msg(`BOUNDARY created ${loops.length} polyline${loops.length > 1 ? 's' : ''}`);
  }
}, { alias: ['BO', 'BPOLY'] });

// ---------- Text ----------
def('TEXT', async ed => {
  const s = ed.doc.set;
  ed.msg(`Current text style:  "${s.textStyle}"  Text height:  ${fmt(ed, s.textH)}  Annotative:  No  Justify:  ${ed.tJust || 'Left'}`);
  let p = await ed.getPoint('Specify start point of text or [Justify/Style]:', { kws: ['Justify', 'Style'] });
  const J = { Left: [0, 0], Center: [1, 0], Right: [2, 0], Middle: [1, 2], TL: [0, 3], TC: [1, 3], TR: [2, 3], ML: [0, 2], MC: [1, 2], MR: [2, 2], BL: [0, 1], BC: [1, 1], BR: [2, 1] };
  if (p === 'Justify') { ed.tJust = await ed.getKw('Enter an option [Left/Center/Right/Align/Middle/Fit/TL/TC/TR/ML/MC/MR/BL/BC/BR]:', ['Left', 'Center', 'Right', 'Align', 'Middle', 'Fit', 'TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'], 'Left'); if (!J[ed.tJust]) ed.tJust = 'Left'; p = await ed.getPoint('Specify ' + (ed.tJust === 'Left' ? 'start' : ed.tJust.toLowerCase()) + ' point of text:'); }
  if (p === 'Style') { await ed.getStr('Enter style name or [?] <Standard>:'); p = await ed.getPoint('Specify start point of text:'); }
  if (!p || typeof p !== 'object') return;
  const h = await ed.getDist(`Specify height <${fmt(ed, s.textH)}>:`, { base: p, def: s.textH }); s.textH = h;
  const r = await ed.getAngle('Specify rotation angle of text <0>:', { base: p, def: 0 });
  const [ha, va] = J[ed.tJust || 'Left'];
  let pos = p;
  for (;;) {
    const t = await ed.ask({ type: 'str', msg: 'Enter text:', spaces: true, inplace: { p: pos, h, rot: r, ha, va } });
    if (!t) break;
    ed.add({ type: 'text', p: pos, s: t, h, rot: r, ha, va });
    pos = polar(pos, r - Math.PI / 2, h * 1.6667);
  }
}, { alias: ['DT', 'DTEXT'] });
def('MTEXT', async ed => {
  const s = ed.doc.set;
  ed.msg(`Current text style:  "${s.textStyle}"  Text height:  ${fmt(ed, s.textH)}  Annotative:  No`);
  const a = await ed.getPoint('Specify first corner:');
  let h = s.textH, rot = 0, at = 1;
  let b;
  for (;;) {
    b = await ed.getPoint('Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:', { base: a, rubber: 'rect', kws: ['Height', 'Justify', 'Line spacing', 'Rotation', 'Style', 'Width', 'Columns'] });
    if (b === 'Height') { h = s.textH = await ed.getDist(`Specify height <${fmt(ed, h)}>:`, { def: h, base: a }); continue; }
    if (b === 'Rotation') { rot = await ed.getAngle('Specify rotation angle <0>:', { def: 0, base: a }); continue; }
    if (b === 'Justify') { const k = await ed.getKw('Enter justification [TL/TC/TR/ML/MC/MR/BL/BC/BR] <TL>:', ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'], 'TL'); at = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'].indexOf(k) + 1; continue; }
    if (b === 'Width') { const w = await ed.getDist('Specify width:', { base: a }); b = { x: a.x + w, y: a.y - h * 3 }; break; }
    if (typeof b === 'object' && b) break;
    if (b === null) return;
  }
  const w = Math.abs(b.x - a.x), top = Math.max(a.y, b.y), left = Math.min(a.x, b.x);
  const txt = await ed.ui.textEditor({ p: { x: left, y: top }, w, h, rot, s: '' });
  if (txt && txt.trim()) ed.add({ type: 'mtext', p: { x: left, y: top }, w, h, s: txt, rot, at });
}, { alias: ['T', 'MT'] });
def('TEXTEDIT', async ed => {
  for (;;) {
    const r = await ed.getEnt('Select an annotation object or [Undo/Mode]:', { filter: e => ['text', 'mtext', 'dim', 'leader'].includes(e.type) });
    if (!r || typeof r !== 'object') return;
    await editText(ed, r.e);
  }
}, { alias: ['ED', 'DDEDIT'] });
export async function editText(ed, e) {
  if (e.type === 'dim') { const t = await ed.ui.textEditor({ p: e.dl, w: 0, h: (ed.doc.dim.txt || 2.5) * (ed.doc.dim.scale || 1), s: e.txt || '<>' }); if (t !== null) { e.txt = t === '<>' ? '' : t; ed.invalidate(); } return; }
  const pos = e.type === 'text' ? e.p : e.type === 'leader' ? e.pts[e.pts.length - 1] : e.p;
  const t = await ed.ui.textEditor({ p: pos, w: e.w || 0, h: e.h || 2.5, rot: e.rot || 0, s: e.s || '', single: e.type === 'text' });
  if (t !== null && t !== undefined) { e.s = e.type === 'text' ? t.replace(/\n/g, ' ') : t; ed.invalidate(); ed.app.onChange?.(); }
}

// ============ MODIFY ============
def('ERASE', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  ed.lastErased = S.map(e => ({ e, list: ed.doc.findList(e.id) }));
  S.forEach(e => ed.remove(e));
}, { alias: ['E', 'DELETE'] });
def('OOPS', async ed => { (ed.lastErased || []).forEach(({ e, list }) => (list || ed.ents).push(e)); ed.lastErased = null; ed.invalidate(); });

async function basePts(ed, S, verb) {
  let b = await ed.getPoint('Specify base point or [Displacement] <Displacement>:', { kws: ['Displacement'] });
  if (b === 'Displacement' || b === null) {
    const d = await ed.getPoint(`Specify displacement <${fmt(ed, ed.lastDisp?.x || 0)}, ${fmt(ed, ed.lastDisp?.y || 0)}>:`, { dynRel: false, def: ed.lastDisp || { x: 0, y: 0 } });
    ed.lastDisp = d; return { d };
  }
  const p = await ed.getPoint(`Specify second point or <use first point as displacement>:`, { base: b, preview: q => ghost(S, M.tr(q.x - b.x, q.y - b.y)), rubber: 'line' });
  const d = p === null ? b : sub(p, b); ed.lastDisp = d; void verb; return { d, b, p };
}
def('MOVE', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  const { d } = await basePts(ed, S, 'move');
  S.forEach(e => xform(e, M.tr(d.x, d.y))); ed.invalidate();
}, { alias: ['M'] });
def('COPY', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  ed.msg('Current settings:  Copy mode = Multiple');
  let b = await ed.getPoint('Specify base point or [Displacement/mOde] <Displacement>:', { kws: ['Displacement', 'mOde'] });
  let single = false;
  if (b === 'mOde') { single = (await ed.getKw('Enter a copy mode option [Single/Multiple] <Multiple>:', ['Single', 'Multiple'], 'Multiple')) === 'Single'; b = await ed.getPoint('Specify base point:'); }
  if (b === 'Displacement' || b === null) { const d = await ed.getPoint('Specify displacement <0,0>:', { dynRel: false, def: { x: 0, y: 0 } }); S.forEach(e => ed.add(xform(clone(e), M.tr(d.x, d.y)), ed.doc.findList(e.id) || ed.ents)); return; }
  let first = true;
  for (;;) {
    const p = await ed.getPoint(`Specify second point or [Array]${first ? ' <use first point as displacement>' : ' [Exit/Undo] <Exit>'}:`, { base: b, kws: first ? ['Array'] : ['Array', 'Exit', 'Undo'], preview: q => ghost(S, M.tr(q.x - b.x, q.y - b.y)) });
    if (p === null) { if (first) S.forEach(e => ed.add(xform(clone(e), M.tr(b.x, b.y)))); break; }
    if (p === 'Exit') break;
    if (p === 'Undo') { (ed._copyStack || []).pop()?.forEach(e => ed.remove(e)); continue; }
    if (p === 'Array') {
      const n = await ed.getInt('Enter number of items to array:', { min: 2 });
      const q = await ed.getPoint('Specify second point or [Fit]:', { base: b, kws: ['Fit'], preview: q => { const out = []; for (let i = 1; i < n; i++) out.push(...ghost(S, M.tr((q.x - b.x) * i, (q.y - b.y) * i))); return out; } });
      let fit = false, qq = q; if (q === 'Fit') { fit = true; qq = await ed.getPoint('Specify second point:', { base: b }); }
      for (let i = 1; i < n; i++) { const f = fit ? i / (n - 1) : i; S.forEach(e => ed.add(xform(clone(e), M.tr((qq.x - b.x) * f, (qq.y - b.y) * f)))); }
      break;
    }
    const made = S.map(e => ed.add(xform(clone(e), M.tr(p.x - b.x, p.y - b.y))));
    (ed._copyStack ||= []).push(made); first = false;
    if (single) break;
  }
  ed._copyStack = [];
}, { alias: ['CO', 'CP'] });
def('ROTATE', async ed => {
  ed.msg('Current positive angle in UCS:  ANGDIR=counterclockwise  ANGBASE=0');
  const S = await ed.getSel(); if (!S.length) return;
  const b = await ed.getPoint('Specify base point:');
  let copy = false;
  for (;;) {
    let a = await ed.getAngle(`Specify rotation angle or [Copy/Reference] <${deg(ed.lastRot || 0)}>:`, { base: b, kws: ['Copy', 'Reference'], def: ed.lastRot || 0, preview: q => ghost(S, M.rot(ang(b, q), b)) });
    if (a === 'Copy') { copy = true; ed.msg('Rotating a copy of the selected objects.'); continue; }
    if (a === 'Reference') {
      const r1 = await ed.getAngle(`Specify the reference angle <0>:`, { def: 0 });
      const r2 = await ed.getAngle('Specify the new angle or [Points] <0>:', { base: b, def: 0, preview: q => ghost(S, M.rot(ang(b, q) - r1, b)) });
      a = r2 - r1;
    }
    ed.lastRot = a;
    S.forEach(e => copy ? ed.add(xform(clone(e), M.rot(a, b))) : xform(e, M.rot(a, b)));
    break;
  }
  ed.invalidate();
}, { alias: ['RO'] });
def('SCALE', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  const b = await ed.getPoint('Specify base point:');
  let copy = false, f;
  for (;;) {
    f = await ed.getDist(`Specify scale factor or [Copy/Reference] <${ed.lastSc || 1}>:`, { base: b, kws: ['Copy', 'Reference'], def: ed.lastSc || 1, preview: q => { const k = dist(b, q) / (ed.view.w / ed.view.scale / 10); return k > 1e-9 ? ghost(S, M.sc(k, b)) : []; } });
    if (f === 'Copy') { copy = true; ed.msg('Scaling a copy of the selected objects.'); continue; }
    if (f === 'Reference') {
      const r = await ed.getDist(`Specify reference length <1>:`, { def: 1 });
      const n = await ed.getDist('Specify new length or [Points] <1>:', { base: b, def: 1 }); f = n / r;
    }
    break;
  }
  if (!(f > 0)) { ed.msg('Faktor skala harus > 0.'); return; }
  ed.lastSc = f;
  S.forEach(e => copy ? ed.add(xform(clone(e), M.sc(f, b))) : xform(e, M.sc(f, b))); ed.invalidate();
}, { alias: ['SC'] });
def('MIRROR', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  const a = await ed.getPoint('Specify first point of mirror line:');
  const b = await ed.getPoint('Specify second point of mirror line:', { base: a, rubber: 'line', preview: q => eq(q, a) ? [] : ghost(S, M.mirror(a, q)) });
  const k = await ed.getKw('Erase source objects? [Yes/No] <No>:', ['Yes', 'No'], 'No');
  const m = M.mirror(a, b);
  S.forEach(e => { const n = xform(clone(e), m); if (k === 'Yes') ed.replace(e, [n]); else ed.add(n, ed.doc.findList(e.id) || ed.ents); });
}, { alias: ['MI'] });

// ---------- Offset ----------
function offsetEnt(e, d, side, doc) {
  const n = clone(e);
  if (e.type === 'line') { const nn = mul(perp(unit(sub(e.p2, e.p1))), d * side); n.p1 = add(e.p1, nn); n.p2 = add(e.p2, nn); return n; }
  if (e.type === 'xline' || e.type === 'ray') { n.p = add(e.p, mul(perp(e.dir), d * side)); return n; }
  if (e.type === 'circle' || e.type === 'arc') { const r = e.r + d * side; if (r <= 1e-9) return null; n.r = r; return n; }
  if (e.type === 'pline' || e.type === 'spline' || e.type === 'ellipse') {
    if (e.type !== 'pline') { const pts = prims(e, doc)[0].pts; const closed = e.type === 'ellipse' ? sweepOf(e.sp ?? 0, e.ep ?? TAU) >= TAU - 1e-9 : !!e.closed; const src = { pts: (closed ? pts.slice(0, -1) : pts).map(P0), closed }; const r = offsetPl(src, d, side); return r ? { ...n, type: 'pline', pts: r.pts, closed, fit: undefined, cp: undefined, kn: undefined, c: undefined, u: undefined, k: undefined } : null; }
    const r = offsetPl(e, d, side); if (!r) return null; n.pts = r.pts; return n;
  }
  return null;
}
function offsetPl(e, d, side) {
  const segs = plSegs({ pts: e.pts, closed: e.closed }), o = [];
  for (const s of segs) {
    const a = e.pts[s.i], b = e.pts[(s.i + 1) % e.pts.length];
    if (s.t === 'L') { const nn = mul(perp(unit(sub(b, a))), d * side); o.push({ a: add(a, nn), b: add(b, nn), bul: 0 }); }
    else { const ccw = (a.b || 0) > 0, r = s.r + (ccw ? -1 : 1) * d * side; if (r <= 1e-9) continue; o.push({ a: polar(s.c, ang(s.c, a), r), b: polar(s.c, ang(s.c, b), r), bul: a.b, c: s.c }); }
  }
  if (!o.length) return null;
  const pts = [];
  const join = (A, B) => {
    if (!A.bul && !B.bul) { const x = interPrim({ t: 'L', a: A.a, b: A.b, inf: 2 }, { t: 'L', a: B.a, b: B.b, inf: 2 }, true, true)[0]; if (x) return [x]; }
    if (eq(A.b, B.a, 1e-6)) return [A.b];
    return [A.b, B.a];
  };
  const n = o.length;
  if (e.closed) {
    for (let i = 0; i < n; i++) { const J = join(o[(i - 1 + n) % n], o[i]); J.forEach((p, k) => pts.push({ ...p, b: k === J.length - 1 ? o[i].bul : 0 })); }
  } else {
    pts.push({ ...o[0].a, b: o[0].bul });
    for (let i = 1; i < n; i++) { const J = join(o[i - 1], o[i]); J.forEach((p, k) => pts.push({ ...p, b: k === J.length - 1 ? o[i].bul : 0 })); }
    pts.push({ ...o[n - 1].b, b: 0 });
  }
  return { pts };
}
function sideOf(e, p, doc) {
  if (e.type === 'circle' || e.type === 'arc') return dist(e.c, p) > e.r ? 1 : -1;
  if (e.type === 'xline' || e.type === 'ray') return Math.sign(crs(e.dir, sub(p, e.p))) || 1;
  const C = curve(e); if (!C) return 1;
  const t = C.par(p), q = C.at(t), q2 = C.at(Math.min(C.t1, t + 1e-4)), q1 = C.at(Math.max(C.t0, t - 1e-4));
  return Math.sign(crs(sub(q2, q1), sub(p, q))) || 1;
}
def('OFFSET', async ed => {
  const s = ed.doc.set;
  ed.msg('Current settings: Erase source=No  Layer=Source  OFFSETGAPTYPE=0');
  let d = await ed.getDist(`Specify offset distance or [Through/Erase/Layer] <${s.offThrough ? 'Through' : fmt(ed, s.offsetD)}>:`, { kws: ['Through', 'Erase', 'Layer'], def: s.offThrough ? 'Through' : s.offsetD });
  let through = d === 'Through';
  if (!through) { s.offsetD = d; s.offThrough = false; } else s.offThrough = true;
  const made = [];
  for (;;) {
    const r = await ed.getEnt('Select object to offset or [Exit/Undo] <Exit>:', { kws: ['Exit', 'Undo'], filter: e => ['line', 'xline', 'ray', 'circle', 'arc', 'pline', 'spline', 'ellipse'].includes(e.type) });
    if (!r || r === 'Exit') break;
    if (r === 'Undo') { const m = made.pop(); if (m) ed.remove(m); continue; }
    const e = r.e;
    ed.setSel([e]);
    for (;;) {
      const p = await ed.getPoint(through ? 'Specify through point or [Exit/Multiple/Undo] <Exit>:' : 'Specify point on side to offset or [Exit/Multiple/Undo] <Exit>:', { kws: ['Exit', 'Multiple', 'Undo'], preview: q => { const dd = through ? distTo(e, q, ed.doc) : s.offsetD; return [offsetEnt(e, dd, sideOf(e, q, ed.doc), ed.doc)]; } });
      if (p === null || p === 'Exit') { ed.clearSel(); if (p === 'Exit') return; break; }
      if (p === 'Undo') { const m = made.pop(); if (m) ed.remove(m); continue; }
      if (p === 'Multiple') { ed.msg('Multiple mode aktif.'); continue; }
      const dd = through ? distTo(e, p, ed.doc) : s.offsetD;
      const n = offsetEnt(e, dd, sideOf(e, p, ed.doc), ed.doc);
      if (n) made.push(ed.add(n)); else ed.msg('Cannot offset that object.');
      ed.clearSel(); break;
    }
  }
}, { alias: ['O'] });
function distTo(e, p, doc) { let d = Infinity; for (const q of gprims(e, doc)) d = Math.min(d, dist(p, closestPrim(p, q))); return d; }

// ---------- Trim / Extend / Break ----------
function cutParams(e, cutters, doc) {
  const C = curve(e); if (!C) return [];
  const src = e.type === 'spline' ? C.approx : e;
  const gp = src.type === 'pline' ? plSegs(src) : gprims(src, doc), ts = [];
  for (const k of cutters) {
    if (k === e || k.type === 'text' || k.type === 'mtext' || k.type === 'point' || k.type === 'hatch') continue;
    for (const q of gprims(k, doc)) for (const a of gp) for (const x of interPrim(a, q)) ts.push(C.par(x));
  }
  if (e.type === 'pline' || e.type === 'spline') { // perpotongan diri
    for (let i = 0; i < gp.length; i++) for (let j = i + 2; j < gp.length; j++) { if (C.closed && i === 0 && j === gp.length - 1) continue; for (const x of interPrim(gp[i], gp[j])) ts.push(C.par(x)); }
  }
  ts.sort((a, b) => a - b);
  const out = []; for (const t of ts) if (!out.length || Math.abs(t - out[out.length - 1]) > 1e-7) out.push(t);
  return C.closed ? out.map(t => t >= C.t1 - 1e-9 ? C.t0 : t).sort((a, b) => a - b) : out.filter(t => t > C.t0 + 1e-7 && t < C.t1 - 1e-7);
}
function trimAt(ed, e, p, cutters, eraseIfNone = true) {
  const C = curve(e); if (!C) { ed.msg('Objek ini tidak dapat di-trim.'); return false; }
  const ts = cutParams(e, cutters, ed.doc), tp = C.par(p);
  if (!ts.length) { if (eraseIfNone) { ed.remove(e); return true; } return false; }
  if (C.closed) {
    if (ts.length < 2 && e.type === 'circle') { ed.msg('Circle must intersect twice.'); return false; }
    let lo = ts.filter(t => t <= tp).pop(), hi = ts.find(t => t > tp);
    if (lo === undefined) lo = ts[ts.length - 1]; if (hi === undefined) hi = ts[0];
    if (ts.length === 1) { const n = piece(e, hi, hi + (C.t1 - C.t0) - 1e-9 > C.t1 ? lo : lo); void n; }
    const n = piece(e, hi, lo === hi ? lo - 1e-9 : lo);
    ed.replace(e, n ? [n] : []); return true;
  }
  const lo = ts.filter(t => t < tp).pop() ?? C.t0, hi = ts.find(t => t > tp) ?? C.t1;
  const out = [];
  if (lo > C.t0 + 1e-9 || (!isFinite(C.t0) && isFinite(lo))) out.push(piece(e, C.t0, lo));
  if (hi < C.t1 - 1e-9 || (!isFinite(C.t1) && isFinite(hi))) out.push(piece(e, hi, C.t1));
  ed.replace(e, out.filter(Boolean)); return true;
}
function extendAt(ed, e, p, bounds) {
  const B = bounds.filter(b => b !== e).flatMap(b => gprims(b, ed.doc));
  const lineExt = (a, b) => { // perpanjang dari b keluar
    const d = unit(sub(b, a)); let best = null, bd = Infinity;
    for (const q of B) for (const x of interPrim({ t: 'L', a: b, b: add(b, d), inf: 1 }, q)) { const s = dot(sub(x, b), d); if (s > 1e-7 && s < bd) { bd = s; best = x; } }
    return best;
  };
  if (e.type === 'line') {
    const endB = dist(p, e.p2) < dist(p, e.p1);
    const x = endB ? lineExt(e.p1, e.p2) : lineExt(e.p2, e.p1);
    if (!x) return false; if (endB) e.p2 = x; else e.p1 = x; ed.invalidate(); return true;
  }
  if (e.type === 'arc') {
    const atEnd = dist(p, polar(e.c, e.ea, e.r)) < dist(p, polar(e.c, e.sa, e.r));
    let best = null, bd = Infinity;
    for (const q of B) for (const x of interPrim({ t: 'A', c: e.c, r: e.r, sa: 0, ea: TAU, full: true }, q)) {
      const a = ang(e.c, x), dd = atEnd ? an(a - e.ea) : an(e.sa - a);
      if (dd > 1e-7 && dd < bd && dd < TAU - sweepOf(e.sa, e.ea)) { bd = dd; best = a; }
    }
    if (best === null) return false; if (atEnd) e.ea = an(best); else e.sa = an(best); ed.invalidate(); return true;
  }
  if (e.type === 'pline' && !e.closed && e.pts.length >= 2) {
    const n = e.pts.length, atEnd = dist(p, e.pts[n - 1]) < dist(p, e.pts[0]);
    const [a, b] = atEnd ? [e.pts[n - 2], e.pts[n - 1]] : [e.pts[1], e.pts[0]];
    if ((atEnd ? a.b : e.pts[0].b)) { ed.msg('Ujung busur polyline tidak didukung.'); return false; }
    const x = lineExt(a, b); if (!x) return false; b.x = x.x; b.y = x.y; ed.invalidate(); return true;
  }
  ed.msg('Objek tidak dapat di-extend.'); return false;
}
async function trimExtend(ed, mode) {
  ed.msg(`Current settings: Projection=UCS, Edge=None, Mode=Quick`);
  const trimKw = mode === 'trim' ? ['cuTting edges', 'Crossing', 'mOde', 'Project', 'eRase'] : ['Boundary edges', 'Crossing', 'mOde', 'Project'];
  let edges = null; const hist = [];
  for (;;) {
    const msg = mode === 'trim' ? 'Select object to trim or shift-select to extend or' : 'Select object to extend or shift-select to trim or';
    const r = await ed.ask({ type: 'sel', msg: msg + kwStr([...trimKw, 'Undo']) + ':', kws: [...trimKw, 'Fence', 'Undo'] });
    if (r === null) break;
    if (r === 'cuTting edges' || r === 'Boundary edges') { edges = await ed.getSel('Select objects or <select all>:', { pickfirst: false }); if (!edges.length) edges = null; continue; }
    if (r === 'mOde') { await ed.getKw('Enter a trim mode option [Quick/Standard] <Quick>:', ['Quick', 'Standard'], 'Quick'); continue; }
    if (r === 'Project') { await ed.getKw('Enter a projection option [None/Ucs/View] <Ucs>:', ['None', 'Ucs', 'View'], 'Ucs'); continue; }
    if (r === 'eRase') { const S = await ed.getSel('Select objects to erase or <exit>:', { pickfirst: false }); S.forEach(e => ed.remove(e)); continue; }
    if (r === 'Undo') { const s = hist.pop(); if (s) { ed.doc.load(s); ed.invalidate(); } continue; }
    let targets = [];
    if (r === 'Fence' || r === 'Crossing') {
      const a = await ed.getPoint(r === 'Fence' ? 'Specify first fence point:' : 'Specify first corner:');
      const b = await ed.getPoint(r === 'Fence' ? 'Specify next fence point:' : 'Specify opposite corner:', { base: a, rubber: r === 'Fence' ? 'line' : 'rect' });
      const list = r === 'Fence' ? ed.fenceSel([a, b]) : ed.windowSel(a, b, true);
      for (const e of list) {
        const G = gprims(e, ed.doc); let best = null;
        for (const q of G) for (const x of interPrim(q, { t: 'L', a, b })) { best = x; break; }
        targets.push({ e, p: best || mid(a, b) });
      }
    } else if (r?.ents) {
      const w = ed.wpt; targets = r.ents.slice(0, 1).map(e => ({ e, p: w, shift: r.shift }));
    }
    if (!targets.length) continue;
    hist.push(ed.doc.state());
    const all = edges || ed.ents.filter(e => ed.selectable(e));
    for (const t of targets) {
      if (!ed.ents.includes(t.e) || ed.locked(t.e)) continue;
      const doTrim = (mode === 'trim') !== !!t.shift;
      if (doTrim) trimAt(ed, t.e, t.p, all, !edges); else extendAt(ed, t.e, t.p, all);
    }
  }
}
def('TRIM', ed => trimExtend(ed, 'trim'), { alias: ['TR'] });
def('EXTEND', ed => trimExtend(ed, 'extend'), { alias: ['EX'] });
def('BREAK', async ed => {
  const r = await ed.getEnt('Select object:', { filter: e => !!curve(e) });
  let a = r.p;
  let b = await ed.getPoint('Specify second break point or [First point]:', { kws: ['First point'] });
  if (b === 'First point') { a = await ed.getPoint('Specify first break point:'); b = await ed.getPoint('Specify second break point:'); }
  breakEnt(ed, r.e, a, b ?? a);
}, { alias: ['BR'] });
function breakEnt(ed, e, a, b) {
  const C = curve(e); let t1 = C.par(a), t2 = C.par(b);
  if (C.closed) {
    if (Math.abs(t1 - t2) < 1e-9) { ed.msg('Objek tertutup tidak dapat dipotong di satu titik.'); return; }
    if (e.type === 'circle') { ed.replace(e, [piece(e, t2, t1)]); return; }
    ed.replace(e, [piece(e, t2, t1)]); return;
  }
  if (t1 > t2) [t1, t2] = [t2, t1];
  const out = [];
  if (t1 > C.t0 + 1e-9 || !isFinite(C.t0)) out.push(piece(e, C.t0, t1));
  if (t2 < C.t1 - 1e-9 || !isFinite(C.t1)) out.push(piece(e, t2, C.t1));
  ed.replace(e, out.filter(Boolean));
}
def('BREAKATPOINT', async ed => {
  const r = await ed.getEnt('Select object:', { filter: e => !!curve(e) });
  const p = await ed.getPoint('Specify break point:');
  const C = curve(r.e), t = C.par(p);
  if (C.closed) { ed.msg('Objek tertutup: gunakan BREAK dua titik.'); return; }
  ed.replace(r.e, [piece(r.e, C.t0, t), piece(r.e, t, C.t1)].filter(Boolean));
});
def('LENGTHEN', async ed => {
  let mode = ed.lenMode || 'Total', val = ed.lenVal ?? 10;
  for (;;) {
    const r = await ed.getEnt(`Select an object to measure or [DElta/Percent/Total/DYnamic] <${mode}>:`, { kws: ['DElta', 'Percent', 'Total', 'DYnamic'] });
    if (r === null) break;
    if (typeof r === 'string') { mode = ed.lenMode = r; if (r !== 'DYnamic') { val = ed.lenVal = await ed.getDist(r === 'Percent' ? 'Enter percentage length <100>:' : `Enter ${r === 'Total' ? 'total length' : 'delta length'} <${fmt(ed, val)}>:`, { def: val }); } break; }
    ed.msg(`Current length: ${fmt(ed, curveLen(r.e))}`);
  }
  for (;;) {
    const r = await ed.getEnt('Select an object to change or [Undo]:', { kws: ['Undo'], filter: e => e.type === 'line' || e.type === 'arc' });
    if (!r || typeof r !== 'object') break;
    const e = r.e, L0 = curveLen(e);
    let L = mode === 'DElta' ? L0 + val : mode === 'Percent' ? L0 * val / 100 : mode === 'Total' ? val : null;
    if (mode === 'DYnamic') { const q = await ed.getPoint('Specify new endpoint:'); L = null; if (e.type === 'line') { const atB = dist(r.p, e.p2) < dist(r.p, e.p1), d = unit(sub(e.p2, e.p1)); if (atB) e.p2 = add(e.p1, mul(d, dot(sub(q, e.p1), d))); else e.p1 = sub(e.p2, mul(d, dot(sub(e.p2, q), d))); } ed.invalidate(); continue; }
    if (!(L > 0)) continue;
    if (e.type === 'line') { const atB = dist(r.p, e.p2) < dist(r.p, e.p1), d = unit(sub(e.p2, e.p1)); if (atB) e.p2 = add(e.p1, mul(d, L)); else e.p1 = sub(e.p2, mul(d, L)); }
    else { const sw = L / e.r; if (sw >= TAU) continue; const atEnd = dist(r.p, polar(e.c, e.ea, e.r)) < dist(r.p, polar(e.c, e.sa, e.r)); if (atEnd) e.ea = an(e.sa + sw); else e.sa = an(e.ea - sw); }
    ed.invalidate();
  }
}, { alias: ['LEN'] });

// ---------- Fillet / Chamfer ----------
function lineInfo(e, p) { return { e, a: e.p1, b: e.p2, p }; }
function corner(L1, L2, mode, d1, d2) {
  const X = interPrim({ t: 'L', a: L1.a, b: L1.b, inf: 2 }, { t: 'L', a: L2.a, b: L2.b, inf: 2 }, true, true)[0];
  if (!X) return null;
  const side = L => { const d = unit(sub(L.b, L.a)), s = dot(sub(L.p, X), d); return s >= 0 ? d : mul(d, -1); };
  const u1 = side(L1), u2 = side(L2);
  const keep = (L, u) => dot(sub(L.a, X), u) > dot(sub(L.b, X), u) ? L.a : L.b;
  const k1 = keep(L1, u1), k2 = keep(L2, u2);
  if (mode === 'fillet' && d1 > 0) {
    const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    if (th < 1e-6 || Math.abs(th - Math.PI) < 1e-6) return null;
    const t = d1 / Math.tan(th / 2), T1 = add(X, mul(u1, t)), T2 = add(X, mul(u2, t));
    const c = add(X, mul(unit(add(u1, u2)), d1 / Math.sin(th / 2)));
    let sa = ang(c, T1), ea = ang(c, T2); if (an(ea - sa) > Math.PI) [sa, ea] = [ea, sa];
    return { X, T1, T2, k1, k2, arc: { c, r: d1, sa, ea } };
  }
  if (mode === 'chamfer') return { X, T1: add(X, mul(u1, d1)), T2: add(X, mul(u2, d2)), k1, k2 };
  return { X, T1: X, T2: X, k1, k2 };
}
async function filletCmd(ed, mode) {
  const s = ed.doc.set;
  ed.msg(mode === 'fillet' ? `Current settings: Mode = TRIM, Radius = ${fmt(ed, s.filletR)}` : `(TRIM mode) Current chamfer Dist1 = ${fmt(ed, s.chamA)}, Dist2 = ${fmt(ed, s.chamB)}`);
  let multiple = false;
  const kw = mode === 'fillet' ? ['Undo', 'Polyline', 'Radius', 'Trim', 'Multiple'] : ['Undo', 'Polyline', 'Distance', 'Angle', 'Trim', 'mEthod', 'Multiple'];
  do {
    let A;
    for (;;) {
      A = await ed.getEnt('Select first ' + (mode === 'fillet' ? 'object' : 'line') + ' or' + kwStr(kw) + ':', { kws: kw, filter: e => e.type === 'line' || e.type === 'pline' });
      if (A === 'Radius') { s.filletR = await ed.getDist(`Specify fillet radius <${fmt(ed, s.filletR)}>:`, { def: s.filletR }); continue; }
      if (A === 'Distance') { s.chamA = await ed.getDist(`Specify first chamfer distance <${fmt(ed, s.chamA)}>:`, { def: s.chamA }); s.chamB = await ed.getDist(`Specify second chamfer distance <${fmt(ed, s.chamA)}>:`, { def: s.chamA }); continue; }
      if (A === 'Angle') { const L = await ed.getDist('Specify chamfer length on the first line <0>:', { def: 0 }); const a = await ed.getAngle('Specify chamfer angle from the first line <0>:', { def: 0 }); s.chamA = L; s.chamB = L * Math.tan(a); continue; }
      if (A === 'Multiple') { multiple = true; continue; }
      if (A === 'Trim' || A === 'mEthod') { await ed.getKw('Enter Trim mode option [Trim/No trim] <Trim>:', ['Trim', 'No trim'], 'Trim'); continue; }
      if (A === 'Undo') continue;
      if (A === 'Polyline') {
        const r = await ed.getEnt('Select 2D polyline:', { filter: e => e.type === 'pline' });
        const n = plCorners(r.e, mode, mode === 'fillet' ? s.filletR : s.chamA, s.chamB);
        ed.msg(`${n} lines were ${mode === 'fillet' ? 'filleted' : 'chamfered'}`); ed.invalidate(); A = null; break;
      }
      break;
    }
    if (!A) { if (multiple) continue; return; }
    if (A.e.type === 'pline') { ed.msg('Gunakan opsi Polyline untuk polyline.'); continue; }
    const B = await ed.getEnt('Select second ' + (mode === 'fillet' ? 'object' : 'line') + ' or shift-select to apply corner:', { filter: e => e.type === 'line' && e !== A.e });
    const L1 = lineInfo(A.e, A.p), L2 = lineInfo(B.e, B.p);
    const R = corner(L1, L2, ed.shiftDown ? 'corner' : mode, mode === 'fillet' ? s.filletR : s.chamA, s.chamB);
    if (!R) { ed.msg('Lines are parallel'); continue; }
    A.e.p1 = R.k1; A.e.p2 = R.T1; B.e.p1 = R.k2; B.e.p2 = R.T2;
    if (R.arc) ed.add({ type: 'arc', ...R.arc, layer: A.e.layer });
    else if (mode === 'chamfer' && !eq(R.T1, R.T2)) ed.add({ type: 'line', p1: R.T1, p2: R.T2, layer: A.e.layer });
    ed.invalidate();
  } while (multiple);
}
function plCorners(e, mode, d1, d2) {
  const P = e.pts, n = P.length, out = []; let cnt = 0;
  const m = e.closed ? n : n;
  for (let i = 0; i < m; i++) {
    const prev = P[(i - 1 + n) % n], cur = P[i], next = P[(i + 1) % n];
    const inner = e.closed || (i > 0 && i < n - 1);
    if (!inner || prev.b || cur.b || d1 <= 0) { out.push({ ...cur }); continue; }
    const u1 = unit(sub(prev, cur)), u2 = unit(sub(next, cur)), th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    if (th < 1e-6 || Math.abs(th - Math.PI) < 1e-6) { out.push({ ...cur }); continue; }
    const t = mode === 'fillet' ? d1 / Math.tan(th / 2) : d1, t2 = mode === 'fillet' ? t : (d2 || d1);
    if (t > dist(prev, cur) || t2 > dist(next, cur)) { out.push({ ...cur }); continue; }
    const T1 = add(cur, mul(u1, t)), T2 = add(cur, mul(u2, t2));
    const sw = Math.PI - th, ccw = crs(sub(cur, prev), sub(next, cur)) > 0;
    out.push({ ...T1, b: mode === 'fillet' ? Math.tan(sw / 4) * (ccw ? 1 : -1) : 0 }, { ...T2, b: 0 }); cnt++;
  }
  e.pts = out; return cnt;
}
def('FILLET', ed => filletCmd(ed, 'fillet'), { alias: ['F'] });
def('CHAMFER', ed => filletCmd(ed, 'chamfer'), { alias: ['CHA'] });

// ---------- Array ----------
def('ARRAYRECT', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  const bb = S.map(e => bbox(e, ed.doc)).reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }));
  let cols = 4, rows = 3, dx = (bb.x2 - bb.x1) * 1.5 || 10, dy = (bb.y2 - bb.y1) * 1.5 || 10;
  const pv = () => { const out = []; for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (i || j) out.push(...ghost(S, M.tr(i * dx, j * dy))); return out.slice(0, 1500); };
  ed.msg('Type = Rectangular  Associative = No');
  for (;;) {
    const k = await ed.ask({ type: 'kw', msg: `Select grip to edit array or [COUnt/Spacing/COLumns/Rows/eXit] <eXit>:`, kws: ['COUnt', 'Spacing', 'COLumns', 'Rows', 'eXit'], def: 'eXit', preview: pv });
    if (k === 'eXit') break;
    if (k === 'COUnt') { cols = await ed.getInt(`Enter the number of columns or [Expression] <${cols}>:`, { def: cols, min: 1, preview: pv }); rows = await ed.getInt(`Enter the number of rows or [Expression] <${rows}>:`, { def: rows, min: 1, preview: pv }); }
    if (k === 'Spacing') { dx = await ed.getDist(`Specify the distance between columns or [Unit cell] <${fmt(ed, dx)}>:`, { def: dx, preview: pv }); dy = await ed.getDist(`Specify the distance between rows <${fmt(ed, dy)}>:`, { def: dy, preview: pv }); }
    if (k === 'COLumns') { cols = await ed.getInt(`Enter the number of columns <${cols}>:`, { def: cols, min: 1 }); dx = await ed.getDist(`Specify the distance between columns <${fmt(ed, dx)}>:`, { def: dx }); }
    if (k === 'Rows') { rows = await ed.getInt(`Enter the number of rows <${rows}>:`, { def: rows, min: 1 }); dy = await ed.getDist(`Specify the distance between rows <${fmt(ed, dy)}>:`, { def: dy }); }
  }
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (i || j) S.forEach(e => ed.add(xform(clone(e), M.tr(i * dx, j * dy))));
}, { alias: ['AR', 'ARRAY', 'ARRAYCLASSIC'] });
def('ARRAYPOLAR', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  ed.msg('Type = Polar  Associative = No');
  const c = await ed.getPoint('Specify center point of array or [Base point/Axis of rotation]:');
  let n = 6, fill = TAU, rot = true;
  const step = () => Math.abs(fill - TAU) < 1e-9 ? fill / n : fill / Math.max(1, n - 1);
  const pv = () => { const out = []; for (let i = 1; i < n; i++) out.push(...ghost(S, rot ? M.rot(step() * i, c) : M.tr(...Object.values(sub(polar(c, ang(c, bbCenter(S, ed)) + step() * i, dist(c, bbCenter(S, ed))), bbCenter(S, ed)))))); return out.slice(0, 1500); };
  for (;;) {
    const k = await ed.ask({ type: 'kw', msg: 'Select grip to edit array or [Items/Angle between/Fill angle/ROTate items/eXit] <eXit>:', kws: ['Items', 'Angle between', 'Fill angle', 'ROTate items', 'eXit'], def: 'eXit', preview: pv });
    if (k === 'eXit') break;
    if (k === 'Items') n = await ed.getInt(`Enter number of items in array <${n}>:`, { def: n, min: 2 });
    if (k === 'Fill angle') fill = await ed.getAngle(`Specify the angle to fill (+=ccw, -=cw) <${(fill * R2D).toFixed(0)}>:`, { def: fill });
    if (k === 'Angle between') { const a = await ed.getAngle('Specify angle between items <60>:', { def: Math.PI / 3 }); fill = a * (n - 1); }
    if (k === 'ROTate items') rot = (await ed.getKw('Rotate arrayed items? [Yes/No] <Yes>:', ['Yes', 'No'], 'Yes')) === 'Yes';
  }
  const bc = bbCenter(S, ed);
  for (let i = 1; i < n; i++) { const m = rot ? M.rot(step() * i, c) : (() => { const q = polar(c, ang(c, bc) + step() * i, dist(c, bc)); return M.tr(q.x - bc.x, q.y - bc.y); })(); S.forEach(e => ed.add(xform(clone(e), m))); }
}, { alias: ['ARRAYPOLAR'] });
function bbCenter(S, ed) { const bb = S.map(e => bbox(e, ed.doc)).reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) })); return { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 }; }
def('ARRAYPATH', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  const r = await ed.getEnt('Select path curve:', { filter: e => !!curve(e) && !['xline', 'ray'].includes(e.type) });
  const b = await ed.getPoint('Specify base point or <use path start>:') ?? curve(r.e).at(curve(r.e).t0);
  let n = await ed.getInt('Enter number of items along path <6>:', { def: 6, min: 2 });
  const align = (await ed.getKw('Align arrayed items to the path? [Yes/No] <Yes>:', ['Yes', 'No'], 'Yes')) === 'Yes';
  const C = curve(r.e), pts = [{ p: C.at(C.t0), a: ang(C.at(C.t0), C.at(C.t0 + (C.t1 - C.t0) * 1e-3)) }, ...sampleCurve(r.e, n - 1)];
  if (!C.closed) pts.push({ p: C.at(C.t1), a: ang(C.at(C.t1 - (C.t1 - C.t0) * 1e-3), C.at(C.t1)) });
  const a0 = pts[0].a;
  pts.forEach((q, i) => { if (!i && eq(q.p, b)) return; const m = M.mul(M.tr(q.p.x - b.x, q.p.y - b.y), align ? M.rot(q.a - a0, b) : M.id()); S.forEach(e => ed.add(xform(clone(e), m))); });
});

// ---------- Stretch ----------
def('STRETCH', async ed => {
  ed.msg('Select objects to stretch by crossing-window or crossing-polygon...');
  const a = await ed.getPoint('Specify first corner:', { noSnap: true });
  const c = await ed.getPoint('Specify opposite corner:', { base: a, rubber: 'rect', noSnap: true });
  const R = rectOf(a, c), list = ed.windowSel(a, c, true).filter(e => !ed.locked(e));
  ed.msg(`${list.length} found`);
  if (!list.length) return;
  const inR = p => p && p.x >= R.x1 && p.x <= R.x2 && p.y >= R.y1 && p.y <= R.y2;
  const apply = (e, d) => {
    const bb = bbox(e, ed.doc);
    if (bb.x1 >= R.x1 && bb.x2 <= R.x2 && bb.y1 >= R.y1 && bb.y2 <= R.y2) return xform(e, M.tr(d.x, d.y));
    const mv = p => inR(p) ? add(p, d) : p;
    if (e.type === 'line') { e.p1 = mv(e.p1); e.p2 = mv(e.p2); }
    else if (e.type === 'pline' || e.type === 'solid' || e.type === 'wipeout' || e.type === 'leader') e.pts = e.pts.map(p => inR(p) ? { ...p, x: p.x + d.x, y: p.y + d.y } : p);
    else if (e.type === 'arc') { const s = polar(e.c, e.sa, e.r), m = polar(e.c, e.sa + sweepOf(e.sa, e.ea) / 2, e.r), f = polar(e.c, e.ea, e.r); if (inR(s) || inR(f)) { const A = arc3(mv(s), (inR(s) && inR(f)) ? add(m, d) : m, mv(f)); if (A) Object.assign(e, A); } }
    else if (e.type === 'dim') { for (const k of ['p1', 'p2', 'c']) if (e[k] && inR(e[k])) e[k] = add(e[k], d); if (inR(e.dl)) e.dl = add(e.dl, d); }
    else if (e.type === 'spline' && e.fit) e.fit = e.fit.map(mv);
    else if (e.type === 'hatch') e.loops = e.loops.map(l => l.map(p => inR(p) ? { ...p, x: p.x + d.x, y: p.y + d.y } : p));
    return e;
  };
  const b = await ed.getPoint('Specify base point or [Displacement] <Displacement>:', { kws: ['Displacement'] });
  let d;
  if (b === 'Displacement' || b === null) d = await ed.getPoint('Specify displacement <0,0>:', { dynRel: false, def: { x: 0, y: 0 } });
  else { const p = await ed.getPoint('Specify second point or <use first point as displacement>:', { base: b, preview: q => list.slice(0, 300).map(e => apply(clone(e), sub(q, b))) }); d = p ? sub(p, b) : b; }
  list.forEach(e => apply(e, d)); ed.invalidate();
}, { alias: ['S'] });

def('EXPLODE', async ed => {
  const S = await ed.getSel(); let n = 0;
  for (const e of S) { const r = explode(e, ed.doc); if (r && r.length) { ed.replace(e, r); n++; } else ed.msg(`${TYPE_NAMES[e.type]} tidak dapat di-explode.`); }
  if (n) ed.msg(`${n} objek di-explode.`);
}, { alias: ['X'] });

// ---------- Join ----------
function toSeq(e) {
  if (e.type === 'line') return [P0(e.p1), P0(e.p2)];
  if (e.type === 'arc') { const sw = sweepOf(e.sa, e.ea); return [{ ...polar(e.c, e.sa, e.r), b: Math.tan(sw / 4) }, P0(polar(e.c, e.ea, e.r))]; }
  if (e.type === 'pline' && !e.closed) return e.pts.map(p => ({ ...p }));
  return null;
}
function revSeq(s) { const n = s.length, out = []; for (let i = n - 1; i >= 0; i--) out.push({ x: s[i].x, y: s[i].y, b: i > 0 ? -(s[i - 1].b || 0) : 0 }); return out; }
export function joinEnts(list, tol = 1e-6) {
  // garis kolinear → satu garis
  if (list.length > 1 && list.every(e => e.type === 'line')) {
    const d = unit(sub(list[0].p2, list[0].p1)), o = list[0].p1;
    if (list.every(e => Math.abs(crs(d, sub(e.p1, o))) < tol * 10 && Math.abs(crs(d, sub(e.p2, o))) < tol * 10)) {
      const ts = list.flatMap(e => [dot(sub(e.p1, o), d), dot(sub(e.p2, o), d)]);
      return [{ ...list[0], id: undefined, p1: add(o, mul(d, Math.min(...ts))), p2: add(o, mul(d, Math.max(...ts))) }];
    }
  }
  // busur sepusat
  if (list.length > 1 && list.every(e => e.type === 'arc') && list.every(e => eq(e.c, list[0].c, tol) && Math.abs(e.r - list[0].r) < tol)) {
    const sorted = [...list].sort((a, b) => a.sa - b.sa); let sa = sorted[0].sa, ea = sorted[0].ea;
    for (const a of sorted.slice(1)) if (Math.abs(an(a.sa - ea)) < 1e-6 || an(a.sa - ea) > TAU - 1e-6) ea = a.ea;
    return [{ ...list[0], id: undefined, sa, ea }];
  }
  const seqs = list.map(e => ({ e, s: toSeq(e) })).filter(x => x.s);
  const out = [];
  while (seqs.length) {
    const first = seqs.shift(); let chain = first.s;
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < seqs.length; i++) {
        const s = seqs[i].s, A = chain[0], Z = chain[chain.length - 1];
        let add_ = null;
        if (eq(Z, s[0], tol)) add_ = ['end', s]; else if (eq(Z, s[s.length - 1], tol)) add_ = ['end', revSeq(s)];
        else if (eq(A, s[s.length - 1], tol)) add_ = ['start', s]; else if (eq(A, s[0], tol)) add_ = ['start', revSeq(s)];
        if (!add_) continue;
        if (add_[0] === 'end') { chain[chain.length - 1].b = add_[1][0].b; chain = chain.concat(add_[1].slice(1)); }
        else chain = add_[1].slice(0, -1).concat(chain);
        seqs.splice(i, 1); grew = true; break;
      }
    }
    let closed = false;
    if (chain.length > 2 && eq(chain[0], chain[chain.length - 1], tol)) { chain.pop(); closed = true; }
    out.push({ ...first.e, id: undefined, type: 'pline', pts: chain, closed, p1: undefined, p2: undefined, c: undefined, r: undefined, sa: undefined, ea: undefined });
  }
  return out;
}
def('JOIN', async ed => {
  const S = await ed.getSel('Select source object or multiple objects to join at once:'); if (S.length < 1) return;
  const ok = S.filter(e => toSeq(e)); if (ok.length < 2) { ed.msg('Diperlukan minimal 2 objek yang dapat digabung.'); return; }
  const res = joinEnts(ok);
  const list = ed.doc.findList(ok[0].id) || ed.ents, i = list.indexOf(ok[0]);
  ok.forEach(e => ed.remove(e));
  res.forEach(r => { Object.keys(r).forEach(k => r[k] === undefined && delete r[k]); ed.doc.prep(r); list.splice(Math.max(0, i), 0, r); });
  ed.msg(`${ok.length} objects converted to ${res.length} ${res[0]?.type === 'line' ? 'line' : res[0]?.type === 'arc' ? 'arc' : 'polyline'}${res.length > 1 ? 's' : ''}`); ed.invalidate();
}, { alias: ['J'] });

def('PEDIT', async ed => {
  const r = await ed.getEnt('Select polyline or [Multiple]:', { kws: ['Multiple'], filter: e => ['pline', 'line', 'arc'].includes(e.type) });
  let e = r.e;
  if (e.type !== 'pline') {
    const k = await ed.getKw('Object selected is not a polyline\nDo you want to turn it into one? <Y>', ['Yes', 'No'], 'Yes');
    if (k !== 'Yes') return; const n = joinEnts([e])[0]; ed.replace(e, [n]); e = n;
  }
  for (;;) {
    const k = await ed.getKw(`Enter an option [${e.closed ? 'Open' : 'Close'}/Join/Width/Edit vertex/Fit/Spline/Decurve/Ltype gen/Reverse/Undo]:`, [e.closed ? 'Open' : 'Close', 'Join', 'Width', 'Edit vertex', 'Fit', 'Spline', 'Decurve', 'Ltype gen', 'Reverse', 'Undo'], null);
    if (!k) break;
    if (k === 'Close') e.closed = true;
    if (k === 'Open') e.closed = false;
    if (k === 'Width') e.w = await ed.getDist('Specify new width for all segments:');
    if (k === 'Decurve') e.pts.forEach(p => p.b = 0);
    if (k === 'Reverse') e.pts = revSeq(e.pts);
    if (k === 'Fit' || k === 'Spline') { const n = { ...clone(e), type: 'spline', fit: e.pts.map(cp), closed: e.closed }; delete n.pts; ed.replace(e, [n]); return; }
    if (k === 'Join') { const S = await ed.getSel('Select objects:', { pickfirst: false }); const res = joinEnts([e, ...S.filter(x => toSeq(x))]); if (res.length) { S.forEach(x => x !== e && ed.remove(x)); ed.replace(e, [res[0]]); e = res[0]; ed.msg(`${S.length} segments added to polyline`); } }
    ed.invalidate();
  }
}, { alias: ['PE'] });

def('ALIGN', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  const s1 = await ed.getPoint('Specify first source point:'); const d1 = await ed.getPoint('Specify first destination point:', { base: s1, rubber: 'line' });
  const s2 = await ed.getPoint('Specify second source point:'); if (!s2) { S.forEach(e => xform(e, M.tr(d1.x - s1.x, d1.y - s1.y))); return; }
  const d2 = await ed.getPoint('Specify second destination point:', { base: s2, rubber: 'line' });
  await ed.getPoint('Specify third source point or <continue>:');
  const sc = (await ed.getKw('Scale objects based on alignment points? [Yes/No] <N>:', ['Yes', 'No'], 'No')) === 'Yes';
  let m = M.mul(M.rot(ang(d1, d2) - ang(s1, s2), d1), M.tr(d1.x - s1.x, d1.y - s1.y));
  if (sc) m = M.mul(M.sc(dist(d1, d2) / dist(s1, s2), d1), m);
  S.forEach(e => xform(e, m)); ed.invalidate();
}, { alias: ['AL'] });

def('MATCHPROP', async ed => {
  const r = await ed.getEnt('Select source object:');
  const src = r.e;
  ed.msg('Current active settings:  Color Layer Ltype Ltscale Lineweight Text Dim Hatch Polyline');
  for (;;) {
    const s = await ed.ask({ type: 'sel', msg: 'Select destination object(s) or [Settings]:', kws: ['Settings'] });
    if (s === null) break; if (!s?.ents) continue;
    for (const e of s.ents) {
      if (e === src || ed.locked(e)) continue;
      e.layer = src.layer; e.color = src.color; e.lt = src.lt; e.lw = src.lw; if (src.lts) e.lts = src.lts;
      if ((e.type === 'text' || e.type === 'mtext') && (src.type === 'text' || src.type === 'mtext')) e.h = src.h;
      if (e.type === 'hatch' && src.type === 'hatch') { e.pat = src.pat; e.sc = src.sc; e.ang = src.ang; }
      if (e.type === 'dim' && src.type === 'dim') e.ds = src.ds ? { ...src.ds } : undefined;
      if (e.type === 'pline' && src.type === 'pline') e.w = src.w;
    }
    ed.invalidate();
  }
}, { alias: ['MA', 'PAINTER'] });

// ============ ANNOTATE ============
const lastDim = ed => [...ed.ents].reverse().find(e => e.type === 'dim' && (e.kind === 'lin' || e.kind === 'ali' || e.kind === 'ang'));
async function dimOrigins(ed) {
  let p1 = await ed.getPoint('Specify first extension line origin or <select object>:');
  if (p1 === null) {
    const r = await ed.getEnt('Select object to dimension:', { filter: e => ['line', 'arc', 'circle', 'pline'].includes(e.type) });
    const e = r.e;
    if (e.type === 'line') return [e.p1, e.p2];
    if (e.type === 'arc') return [polar(e.c, e.sa, e.r), polar(e.c, e.ea, e.r)];
    if (e.type === 'circle') return [polar(e.c, Math.PI, e.r), polar(e.c, 0, e.r)];
    if (e.type === 'pline') { const C = curve(e), t = Math.floor(C.par(r.p)); return [C.at(t), C.at(Math.min(C.t1, t + 1))]; }
  }
  const p2 = await ed.getPoint('Specify second extension line origin:', { base: p1, rubber: 'dash' });
  return [p1, p2];
}
function autoRot(p1, p2, q) {
  const x1 = Math.min(p1.x, p2.x), x2 = Math.max(p1.x, p2.x), y1 = Math.min(p1.y, p2.y), y2 = Math.max(p1.y, p2.y);
  const dxo = Math.max(0, x1 - q.x, q.x - x2), dyo = Math.max(0, y1 - q.y, q.y - y2);
  return dyo >= dxo ? 0 : Math.PI / 2;
}
async function dimText(ed, d) {
  const t = await ed.getStr(`Enter dimension text <${fmtNum(dimValue(d) * (ed.doc.dim.lfac || 1), d.kind === 'ang' ? ed.doc.dim.angDec : ed.doc.dim.dec, ed.doc.dim.sep)}>:`, { spaces: true });
  if (t && t.trim()) d.txt = t;
}
def('DIMLINEAR', async ed => {
  const [p1, p2] = await dimOrigins(ed);
  let rot = null; const d = { type: 'dim', kind: 'lin', p1, p2, dl: p2, rot: 0 };
  for (;;) {
    const q = await ed.getPoint('Specify dimension line location or [Mtext/Text/Angle/Horizontal/Vertical/Rotated]:', { kws: ['Mtext', 'Text', 'Angle', 'Horizontal', 'Vertical', 'Rotated'], preview: q => [{ ...d, dl: q, rot: rot ?? autoRot(p1, p2, q) }] });
    if (q === 'Horizontal') { rot = 0; continue; } if (q === 'Vertical') { rot = Math.PI / 2; continue; }
    if (q === 'Rotated') { rot = await ed.getAngle('Specify angle of dimension line <0>:', { def: 0 }); continue; }
    if (q === 'Text' || q === 'Mtext') { await dimText(ed, d); continue; }
    if (q === 'Angle') { await ed.getAngle('Specify angle of dimension text:'); continue; }
    if (!q) return;
    d.dl = q; d.rot = rot ?? autoRot(p1, p2, q); break;
  }
  ed.add(d); ed.msg(`Dimension text = ${fmtNum(dimValue(d), ed.doc.dim.dec, ed.doc.dim.sep)}`);
}, { alias: ['DLI', 'DIMLIN'] });
def('DIMALIGNED', async ed => {
  const [p1, p2] = await dimOrigins(ed); const d = { type: 'dim', kind: 'ali', p1, p2, dl: p2 };
  for (;;) {
    const q = await ed.getPoint('Specify dimension line location or [Mtext/Text/Angle]:', { kws: ['Mtext', 'Text', 'Angle'], preview: q => [{ ...d, dl: q }] });
    if (q === 'Text' || q === 'Mtext') { await dimText(ed, d); continue; } if (q === 'Angle') continue; if (!q) return;
    d.dl = q; break;
  }
  ed.add(d); ed.msg(`Dimension text = ${fmtNum(dimValue(d), ed.doc.dim.dec, ed.doc.dim.sep)}`);
}, { alias: ['DAL', 'DIMALI'] });
async function radialDim(ed, kind) {
  const r = await ed.getEnt('Select arc or circle:', { filter: e => e.type === 'circle' || e.type === 'arc' || (e.type === 'pline') });
  let c = r.e.c, rad = r.e.r;
  if (r.e.type === 'pline') { const s = plSegs(r.e).find(s => s.t === 'A' && Math.abs(dist(s.c, r.p) - s.r) < ed.opt.pickbox * 2 / ed.view.scale); if (!s) { ed.msg('Pilih segmen busur.'); return; } c = s.c; rad = s.r; }
  ed.msg(`Dimension text = ${fmtNum((kind === 'dia' ? 2 : 1) * rad, ed.doc.dim.dec, ed.doc.dim.sep)}`);
  const d = { type: 'dim', kind, c, r: rad, dl: r.p };
  for (;;) {
    const q = await ed.getPoint('Specify dimension line location or [Mtext/Text/Angle]:', { kws: ['Mtext', 'Text', 'Angle'], preview: q => [{ ...d, dl: q }] });
    if (q === 'Text' || q === 'Mtext') { await dimText(ed, d); continue; } if (q === 'Angle') continue; if (!q) return;
    d.dl = q; break;
  }
  ed.add(d);
}
def('DIMRADIUS', ed => radialDim(ed, 'rad'), { alias: ['DRA', 'DIMRAD'] });
def('DIMDIAMETER', ed => radialDim(ed, 'dia'), { alias: ['DDI', 'DIMDIA'] });
def('DIMANGULAR', async ed => {
  const r = await ed.getEnt('Select arc, circle, line, or <specify vertex>:', { kws: [], filter: e => ['arc', 'circle', 'line'].includes(e.type) });
  let d;
  if (r === null) {
    const c = await ed.getPoint('Specify angle vertex:'); const a = await ed.getPoint('Specify first angle endpoint:', { base: c, rubber: 'dash' }); const b = await ed.getPoint('Specify second angle endpoint:', { base: c, rubber: 'dash' });
    d = { type: 'dim', kind: 'ang', c, p1: a, p2: b, dl: b };
  } else if (r.e.type === 'arc') { const e = r.e; d = { type: 'dim', kind: 'ang', c: e.c, p1: polar(e.c, e.sa, e.r), p2: polar(e.c, e.ea, e.r), dl: polar(e.c, e.sa + sweepOf(e.sa, e.ea) / 2, e.r * 1.2) }; }
  else if (r.e.type === 'circle') { const e = r.e; const b = await ed.getPoint('Specify second angle endpoint:', { base: e.c, rubber: 'dash' }); d = { type: 'dim', kind: 'ang', c: e.c, p1: polar(e.c, ang(e.c, r.p), e.r), p2: b, dl: b }; }
  else {
    const r2 = await ed.getEnt('Select second line:', { filter: e => e.type === 'line' && e !== r.e });
    const X = interPrim({ t: 'L', a: r.e.p1, b: r.e.p2, inf: 2 }, { t: 'L', a: r2.e.p1, b: r2.e.p2, inf: 2 }, true, true)[0];
    if (!X) { ed.msg('Lines are parallel.'); return; }
    d = { type: 'dim', kind: 'ang', c: X, p1: dist(X, r.e.p1) > dist(X, r.e.p2) ? r.e.p1 : r.e.p2, p2: dist(X, r2.e.p1) > dist(X, r2.e.p2) ? r2.e.p1 : r2.e.p2, dl: X };
    // gunakan titik pilih sebagai acuan sisi
    d.p1 = closestPrim(r.p, { t: 'L', a: X, b: d.p1, inf: 1 }); d.p2 = closestPrim(r2.p, { t: 'L', a: X, b: d.p2, inf: 1 });
  }
  const q = await ed.getPoint('Specify dimension arc line location or [Mtext/Text/Angle/Quadrant]:', { kws: ['Mtext', 'Text', 'Angle', 'Quadrant'], preview: q => [{ ...d, dl: q }] });
  if (q && typeof q === 'object') d.dl = q;
  ed.add(d); ed.msg(`Dimension text = ${fmtNum(dimValue(d), ed.doc.dim.angDec, ed.doc.dim.sep)}°`);
}, { alias: ['DAN', 'DIMANG'] });
def('DIMARC', async ed => {
  const r = await ed.getEnt('Select arc or polyline arc segment:', { filter: e => e.type === 'arc' });
  const e = r.e, d = { type: 'dim', kind: 'arc', c: e.c, r: e.r, sa: e.sa, ea: e.ea, dl: polar(e.c, e.sa + sweepOf(e.sa, e.ea) / 2, e.r * 1.15) };
  const q = await ed.getPoint('Specify arc length dimension location or [Mtext/Text/Angle/Partial/Leader]:', { kws: ['Mtext', 'Text', 'Angle', 'Partial', 'Leader'], preview: q => [{ ...d, dl: q }] });
  if (q && typeof q === 'object') d.dl = q; ed.add(d);
}, { alias: ['DAR'] });
def('DIMORDINATE', async ed => {
  const p = await ed.getPoint('Specify feature location:');
  const q = await ed.getPoint('Specify leader endpoint or [Xdatum/Ydatum/Mtext/Text/Angle]:', { base: p, kws: ['Xdatum', 'Ydatum', 'Mtext', 'Text', 'Angle'], preview: q => [{ type: 'dim', kind: 'ord', p1: p, dl: q, axis: Math.abs(q.x - p.x) < Math.abs(q.y - p.y) ? 'x' : 'y' }] });
  if (!q || typeof q !== 'object') return;
  ed.add({ type: 'dim', kind: 'ord', p1: p, dl: q, axis: Math.abs(q.x - p.x) < Math.abs(q.y - p.y) ? 'x' : 'y' });
}, { alias: ['DOR'] });
def('DIM', async ed => {
  for (;;) {
    const r = await ed.ask({ type: 'point', msg: 'Select objects or specify first extension line origin or [Angular/Baseline/Continue/Ordinate/aliGn/Distribute/Layer/Undo]:', kws: ['Angular', 'Baseline', 'Continue', 'Ordinate', 'aliGn', 'Distribute', 'Layer', 'Undo'] });
    if (r === null) return;
    if (r === 'Angular') { await CMDS.DIMANGULAR.fn(ed); continue; }
    if (r === 'Baseline') { await CMDS.DIMBASELINE.fn(ed); continue; }
    if (r === 'Continue') { await CMDS.DIMCONTINUE.fn(ed); continue; }
    if (r === 'Ordinate') { await CMDS.DIMORDINATE.fn(ed); continue; }
    if (typeof r !== 'object') continue;
    const e = ed.snapInfo ? null : ed.pick(ed.w2s(r).x, ed.w2s(r).y);
    if (e && (e.type === 'circle' || e.type === 'arc')) {
      const d = { type: 'dim', kind: e.type === 'circle' ? 'dia' : 'rad', c: e.c, r: e.r, dl: r };
      const q = await ed.getPoint(`Specify ${e.type === 'circle' ? 'diameter' : 'radius'} dimension location or [Radius/Diameter/Angle/Mtext/Text]:`, { kws: ['Radius', 'Diameter', 'Angle', 'Mtext', 'Text'], preview: q => [{ ...d, dl: q }] });
      if (q === 'Radius') d.kind = 'rad'; if (q === 'Diameter') d.kind = 'dia'; if (q && typeof q === 'object') d.dl = q; ed.add(d); continue;
    }
    let p1 = r, p2;
    if (e && e.type === 'line') { p1 = e.p1; p2 = e.p2; }
    else p2 = await ed.getPoint('Specify second extension line origin:', { base: p1, rubber: 'dash' });
    const d = { type: 'dim', kind: 'lin', p1, p2, dl: p2, rot: 0 };
    const q = await ed.getPoint('Specify dimension line location or [Mtext/Text/Angle/Undo]:', { kws: ['Mtext', 'Text', 'Angle', 'Undo'], preview: q => [e && e.type === 'line' && !isAxis(p1, p2) ? { ...d, kind: 'ali', dl: q } : { ...d, dl: q, rot: autoRot(p1, p2, q) }] });
    if (!q || typeof q !== 'object') continue;
    if (e && e.type === 'line' && !isAxis(p1, p2)) ed.add({ ...d, kind: 'ali', dl: q }); else ed.add({ ...d, dl: q, rot: autoRot(p1, p2, q) });
  }
});
const isAxis = (a, b) => Math.abs(a.x - b.x) < 1e-9 || Math.abs(a.y - b.y) < 1e-9;
async function chainDim(ed, mode) {
  let base = lastDim(ed);
  if (!base) { const r = await ed.getEnt(`Select ${mode === 'cont' ? 'continued' : 'base'} dimension:`, { filter: e => e.type === 'dim' && (e.kind === 'lin' || e.kind === 'ali') }); base = r.e; }
  const ds = ed.doc.dim, sp = 3.75 * (ds.scale || 1);
  for (;;) {
    const q = await ed.getPoint('Specify a second extension line origin or [Select/Undo] <Select>:', { kws: ['Select', 'Undo'], preview: q => [mk(q)] });
    if (q === null) break;
    if (q === 'Select') { const r = await ed.getEnt('Select dimension:', { filter: e => e.type === 'dim' && (e.kind === 'lin' || e.kind === 'ali') }); base = r.e; continue; }
    if (q === 'Undo') continue;
    base = ed.add(mk(q));
  }
  function mk(q) {
    const d = { ...clone(base), id: undefined };
    if (mode === 'cont') { d.p1 = base.p2; d.p2 = q; d.dl = base.dl; }
    else {
      const dir = base.kind === 'lin' ? { x: Math.cos(base.rot || 0), y: Math.sin(base.rot || 0) } : unit(sub(base.p2, base.p1)), n = perp(dir);
      const sg = Math.sign(dot(sub(base.dl, base.p1), n)) || 1;
      d.p1 = base.p1; d.p2 = q; d.dl = add(base.dl, mul(n, sg * sp));
    }
    delete d.tp; delete d.txt; return d;
  }
}
def('DIMCONTINUE', ed => chainDim(ed, 'cont'), { alias: ['DCO', 'DIMCONT'] });
def('DIMBASELINE', ed => chainDim(ed, 'base'), { alias: ['DBA', 'DIMBASE'] });
def('MLEADER', async ed => {
  const pts = [await ed.getPoint('Specify leader arrowhead location or [leader Landing first/Content first/Options] <Options>:', { kws: ['leader Landing first', 'Content first', 'Options'] })];
  if (typeof pts[0] !== 'object' || !pts[0]) return;
  const p = await ed.getPoint('Specify leader landing location:', { base: pts[0], preview: q => [{ type: 'leader', pts: [pts[0], q], s: '' }] });
  pts.push(p);
  const t = await ed.ui.textEditor({ p, w: 0, h: (ed.doc.dim.txt || 2.5) * (ed.doc.dim.scale || 1), s: '' });
  ed.add({ type: 'leader', pts, s: t || '', h: (ed.doc.dim.txt || 2.5) * (ed.doc.dim.scale || 1) });
}, { alias: ['MLD', 'LEADER', 'LE', 'QLEADER'] });
def('CENTERMARK', async ed => {
  for (;;) {
    const r = await ed.getEnt('Select circle or arc to add centermark:', { filter: e => e.type === 'circle' || e.type === 'arc' }); if (!r) return;
    const e = r.e, x = e.r * 1.2, s = e.r * 0.15;
    ed.doc.addLayer('CENTER', { color: 1, lt: 'CENTER' }); if (!ed.doc.ltypes.includes('CENTER')) ed.doc.ltypes.push('CENTER');
    [[-x, 0, -s, 0], [s, 0, x, 0], [0, -x, 0, -s], [0, s, 0, x], [-s, 0, s, 0], [0, -s, 0, s]].forEach(([a, b, c, d]) => ed.add({ type: 'line', p1: { x: e.c.x + a, y: e.c.y + b }, p2: { x: e.c.x + c, y: e.c.y + d }, layer: 'CENTER', color: 256, lt: 'ByLayer' }));
  }
}, { alias: ['CM'] });

// ============ INQUIRY ============
def('DIST', async ed => {
  const a = await ed.getPoint('Specify first point:'); const b = await ed.getPoint('Specify second point or [Multiple points]:', { base: a, rubber: 'dash' });
  const d = sub(b, a);
  ed.msg(`Distance = ${fmt(ed, dist(a, b))},  Angle in XY Plane = ${deg(ang(a, b))}°,  Angle from XY Plane = 0`);
  ed.msg(`Delta X = ${fmt(ed, d.x)},  Delta Y = ${fmt(ed, d.y)},   Delta Z = 0`);
}, { alias: ['DI'] });
def('ID', async ed => { const p = await ed.getPoint('Specify point:'); ed.msg(`X = ${fmt(ed, p.x)}     Y = ${fmt(ed, p.y)}     Z = 0`); });
def('AREA', async ed => {
  let tot = 0, mode = 1;
  for (;;) {
    let p = await ed.getPoint(`Specify first corner point or [Object/Add area/Subtract area] <Object>:`, { kws: ['Object', 'Add area', 'Subtract area'] });
    if (p === 'Add area') { mode = 1; continue; } if (p === 'Subtract area') { mode = -1; continue; }
    if (p === 'Object' || p === null) {
      const r = await ed.getEnt('Select objects:', { filter: e => entArea(e) > 0 || e.type === 'pline' });
      const A = entArea(r.e), L = curveLen(r.e); tot += mode * A;
      ed.msg(`Area = ${fmt(ed, A)}, ${r.e.type === 'circle' ? 'Circumference' : 'Perimeter'} = ${fmt(ed, L)}`); if (mode === -1 || tot !== A) ed.msg(`Total area = ${fmt(ed, tot)}`);
      return;
    }
    const pts = [p];
    for (;;) { const q = await ed.getPoint('Specify next point or [Arc/Length/Undo/Total] <Total>:', { base: pts[pts.length - 1], kws: ['Arc', 'Length', 'Undo', 'Total'], preview: q => [{ type: 'pline', pts: [...pts, q].map(P0), closed: true, color: 3 }] }); if (q === null || q === 'Total') break; if (q === 'Undo') { pts.length > 1 && pts.pop(); continue; } if (typeof q === 'object') pts.push(q); }
    const A = Math.abs(polyArea(pts)); let L = 0; pts.forEach((q, i) => L += dist(q, pts[(i + 1) % pts.length]));
    tot += mode * A; ed.msg(`Area = ${fmt(ed, A)}, Perimeter = ${fmt(ed, L)}`); ed.msg(`Total area = ${fmt(ed, tot)}`); ed.ui?.toast?.(`Luas = ${fmt(ed, A)}  ·  Keliling = ${fmt(ed, L)}`);
    return;
  }
}, { alias: ['AA'] });
def('MEASUREGEOM', async ed => {
  const k = await ed.getKw('Enter an option [Distance/Radius/Angle/ARea/Volume] <Distance>:', ['Distance', 'Radius', 'Angle', 'ARea', 'Volume'], 'Distance');
  if (k === 'Distance') return CMDS.DIST.fn(ed);
  if (k === 'ARea') return CMDS.AREA.fn(ed);
  if (k === 'Radius') { const r = await ed.getEnt('Select arc or circle:', { filter: e => e.type === 'circle' || e.type === 'arc' }); ed.msg(`Radius = ${fmt(ed, r.e.r)}\nDiameter = ${fmt(ed, r.e.r * 2)}`); return; }
  if (k === 'Angle') { const a = await ed.getEnt('Select arc, circle, line, or <specify vertex>:', { filter: e => e.type === 'line' || e.type === 'arc' }); if (a.e.type === 'arc') { ed.msg(`Angle = ${(sweepOf(a.e.sa, a.e.ea) * R2D).toFixed(2)}°`); return; } const b = await ed.getEnt('Select second line:', { filter: e => e.type === 'line' }); const u = unit(sub(a.e.p2, a.e.p1)), v = unit(sub(b.e.p2, b.e.p1)); ed.msg(`Angle = ${(Math.acos(Math.abs(dot(u, v))) * R2D).toFixed(2)}°`); }
}, { alias: ['MEA'] });
def('LIST', async ed => {
  const S = await ed.getSel(); const lines = [];
  for (const e of S) {
    lines.push(`                  ${TYPE_NAMES[e.type].toUpperCase()}       Layer: "${e.layer}"`, `                            Space: ${ed.doc.model.includes(e) ? 'Model space' : 'Paper space'}`, `                   Color: ${colorName(e.color)}    Linetype: ${e.lt}    Lineweight: ${lwName(e.lw)}`, `                   Handle = ${e.id.toString(16).toUpperCase()}`);
    if (e.type === 'line') lines.push(`              from point, X=${fmt(ed, e.p1.x)}  Y=${fmt(ed, e.p1.y)}`, `                to point, X=${fmt(ed, e.p2.x)}  Y=${fmt(ed, e.p2.y)}`, `          Length = ${fmt(ed, dist(e.p1, e.p2))},  Angle in XY Plane = ${deg(ang(e.p1, e.p2))}`);
    if (e.type === 'circle') lines.push(`            center point, X=${fmt(ed, e.c.x)}  Y=${fmt(ed, e.c.y)}`, `            radius ${fmt(ed, e.r)}`, `     circumference ${fmt(ed, TAU * e.r)}`, `              area ${fmt(ed, Math.PI * e.r * e.r)}`);
    if (e.type === 'arc') lines.push(`            center point, X=${fmt(ed, e.c.x)}  Y=${fmt(ed, e.c.y)}`, `            radius ${fmt(ed, e.r)}`, `       start angle ${deg(e.sa)}`, `         end angle ${deg(e.ea)}`, `            length ${fmt(ed, curveLen(e))}`);
    if (e.type === 'pline') lines.push(`              ${e.closed ? 'Closed' : 'Open'}`, `    Constant width ${fmt(ed, e.w || 0)}`, `              area ${fmt(ed, entArea(e))}`, `            length ${fmt(ed, curveLen(e))}`, ...e.pts.map(p => `          at point  X=${fmt(ed, p.x)}  Y=${fmt(ed, p.y)}${p.b ? '  bulge ' + p.b.toFixed(4) : ''}`));
    if (e.type === 'text' || e.type === 'mtext') lines.push(`                    Contents: ${e.s}`, `                    height ${fmt(ed, e.h)}`);
    if (e.type === 'hatch') lines.push(`                    Pattern: ${e.pat}  Scale: ${e.sc}  Area: ${fmt(ed, entArea(e))}`);
    if (e.type === 'insert') lines.push(`                    Block Name: "${e.name}"`, `                    at point, X=${fmt(ed, e.p.x)}  Y=${fmt(ed, e.p.y)}`);
    if (e.type === 'dim') lines.push(`                    Measurement: ${fmt(ed, dimValue(e))}`);
  }
  lines.forEach(l => ed.msg(l)); ed.ui?.textWindow?.(true);
}, { alias: ['LI', 'LS'] });
async function divMeasure(ed, byLen) {
  const r = await ed.getEnt(`Select object to ${byLen ? 'measure' : 'divide'}:`, { filter: e => !!curve(e) && !['xline', 'ray'].includes(e.type) });
  let blk = null;
  let v = byLen ? await ed.getDist('Specify length of segment or [Block]:', { kws: ['Block'] }) : await ed.getInt('Enter the number of segments or [Block]:', { kws: ['Block'], min: 2 });
  if (v === 'Block') { blk = await ed.getStr('Enter name of block to insert:'); if (!ed.doc.blocks[blk]) { ed.msg('Block tidak ditemukan.'); return; } v = byLen ? await ed.getDist('Specify length of segment:') : await ed.getInt('Enter the number of segments:', { min: 2 }); }
  const pts = byLen ? sampleCurve(r.e, 0, v) : sampleCurve(r.e, v);
  pts.forEach(q => ed.add(blk ? { type: 'insert', name: blk, p: q.p, rot: q.a, sx: 1, sy: 1 } : { type: 'point', p: q.p }));
  if (!blk && !ed.doc.set.pdmode) { ed.doc.set.pdmode = 3; ed.msg('PDMODE diset ke 3 agar titik terlihat.'); }
}
def('DIVIDE', ed => divMeasure(ed, false), { alias: ['DIV'] });
def('MEASURE', ed => divMeasure(ed, true), { alias: ['ME'] });

// ============ BLOCK ============
def('BLOCK', async ed => {
  const info = await ed.ui.blockDialog();
  if (!info) return;
  let base = info.base;
  if (!base) base = await ed.getPoint('Specify insertion base point:');
  let S = info.sel;
  if (!S) S = await ed.getSel();
  if (!S.length) { ed.msg('Tidak ada objek dipilih.'); return; }
  const name = info.name;
  ed.doc.blocks[name] = { base: cp(base), ents: S.map(e => clone(e)), rev: (ed.doc.blocks[name]?.rev || 0) + 1, desc: info.desc || '' };
  ed.doc.blocks[name].ents.forEach((e, i) => e.id = i + 1);
  if (info.mode === 'convert') { const list = ed.doc.findList(S[0].id) || ed.ents, i = list.indexOf(S[0]); S.forEach(e => ed.remove(e)); const ins = ed.doc.prep({ type: 'insert', name, p: cp(base), sx: 1, sy: 1, rot: 0 }); list.splice(Math.max(0, i), 0, ins); }
  else if (info.mode === 'delete') S.forEach(e => ed.remove(e));
  ed.msg(`Block "${name}" dibuat (${S.length} objek).`); ed.invalidate();
}, { alias: ['B', 'BMAKE'] });
def('INSERT', async ed => {
  const name = ed.insertName || await ed.ui.insertDialog(); ed.insertName = null;
  if (!name || !ed.doc.blocks[name]) return;
  let sc = 1, rot = 0;
  for (;;) {
    const p = await ed.getPoint('Specify insertion point or [Basepoint/Scale/Rotate]:', { kws: ['Basepoint', 'Scale', 'Rotate'], preview: q => [{ type: 'insert', name, p: q, sx: sc, sy: sc, rot }] });
    if (p === 'Scale') { sc = await ed.getNum('Specify scale factor for XYZ axes <1>:', { def: 1 }); continue; }
    if (p === 'Rotate') { rot = await ed.getAngle('Specify rotation angle <0>:', { def: 0 }); continue; }
    if (!p || typeof p !== 'object') return;
    ed.add({ type: 'insert', name, p, sx: sc, sy: sc, rot }); break;
  }
}, { alias: ['I', 'DDINSERT', 'CLASSICINSERT'] });
def('WBLOCK', async ed => { const S = await ed.getSel(); if (!S.length) return; await ed.app.exportDXF(S, 'wblock'); }, { alias: ['W'] });
def('PURGE', async ed => {
  const used = new Set(), lay = new Set(['0', 'Defpoints', ed.doc.clayer]);
  const scan = l => l.forEach(e => { lay.add(e.layer); if (e.type === 'insert') { if (!used.has(e.name)) { used.add(e.name); scan(ed.doc.blocks[e.name]?.ents || []); } } });
  scan(ed.doc.allEnts());
  let nb = 0, nl = 0;
  for (const b of Object.keys(ed.doc.blocks)) if (!used.has(b)) { delete ed.doc.blocks[b]; nb++; }
  for (const l of Object.keys(ed.doc.layers)) if (!lay.has(l) && l !== 'KOP') { delete ed.doc.layers[l]; nl++; }
  ed.msg(`Purged ${nb} block(s), ${nl} layer(s).`); ed.ui?.refresh?.();
}, { alias: ['PU'] });
def('OVERKILL', async ed => {
  const S = await ed.getSel(); const seen = new Map(); let n = 0;
  for (const e of S) { const k = JSON.stringify({ ...e, id: 0 }, (k, v) => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v); if (seen.has(k)) { ed.remove(e); n++; } else seen.set(k, e); }
  ed.msg(`${n} duplicate(s) deleted`);
});
def('DRAWORDER', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  const k = await ed.getKw('Enter object ordering option [Above objects/Under objects/Front/Back] <Back>:', ['Above objects', 'Under objects', 'Front', 'Back'], 'Back');
  const list = ed.doc.findList(S[0].id) || ed.ents;
  S.forEach(e => list.splice(list.indexOf(e), 1));
  if (k === 'Front' || k === 'Above objects') list.push(...S); else list.unshift(...S);
  ed.invalidate();
}, { alias: ['DR'] });
def('TEXTTOFRONT', async ed => { const list = ed.ents, t = list.filter(e => ['text', 'mtext', 'dim', 'leader'].includes(e.type)); t.forEach(e => list.splice(list.indexOf(e), 1)); list.push(...t); ed.msg(`${t.length} object(s) brought to front.`); ed.invalidate(); });
def('HATCHTOBACK', async ed => { const list = ed.ents, t = list.filter(e => e.type === 'hatch'); t.forEach(e => list.splice(list.indexOf(e), 1)); list.unshift(...t); ed.msg(`${t.length} hatch object(s) sent to back.`); ed.invalidate(); });
def('HATCHEDIT', async ed => { const r = await ed.getEnt('Select hatch object:', { filter: e => e.type === 'hatch' }); await ed.ui.hatchDialog(r.e); ed.invalidate(); }, { alias: ['HE'] });

// ============ CLIPBOARD ============
const CLIP = 'amatucad-clip';
function setClip(ed, S, base) { const bb = S.map(e => bbox(e, ed.doc)).reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) })); const data = { base: base || { x: bb.x1, y: bb.y1 }, ents: S.map(clone), blocks: ed.doc.blocks, layers: ed.doc.layers }; try { localStorage.setItem(CLIP, JSON.stringify(data)); } catch { } ed._clip = data; }
function getClip(ed) { try { return JSON.parse(localStorage.getItem(CLIP)) || ed._clip; } catch { return ed._clip; } }
def('COPYCLIP', async ed => { const S = await ed.getSel(); if (S.length) { setClip(ed, S); ed.msg(`${S.length} objek disalin ke clipboard.`); } }, { noRepeat: true });
def('CUTCLIP', async ed => { const S = await ed.getSel(); if (S.length) { setClip(ed, S); S.forEach(e => ed.remove(e)); } });
def('COPYBASE', async ed => { const b = await ed.getPoint('Specify base point:'); const S = await ed.getSel(); if (S.length) setClip(ed, S, b); });
async function paste(ed, asBlock, orig) {
  const C = getClip(ed); if (!C || !C.ents?.length) { if (!asBlock && !orig && await ed.app.pasteImage?.()) return; ed.msg('Clipboard kosong.'); return; }
  for (const [k, b] of Object.entries(C.blocks || {})) if (!ed.doc.blocks[k]) ed.doc.blocks[k] = b;
  for (const [k, l] of Object.entries(C.layers || {})) if (!ed.doc.layers[k]) ed.doc.layers[k] = l;
  let p = orig ? C.base : await ed.getPoint('Specify insertion point:', { preview: q => C.ents.slice(0, 400).map(e => xform(clone(e), M.tr(q.x - C.base.x, q.y - C.base.y))) });
  if (!p) return;
  if (asBlock) { const name = 'A$C' + Math.random().toString(16).slice(2, 10).toUpperCase(); ed.doc.blocks[name] = { base: C.base, ents: C.ents.map((e, i) => ({ ...e, id: i + 1 })), rev: 1 }; ed.add({ type: 'insert', name, p, sx: 1, sy: 1, rot: 0 }); return; }
  const made = C.ents.map(e => ed.add(xform(clone(e), M.tr(p.x - C.base.x, p.y - C.base.y))));
  ed.setSel(made);
}
def('PASTECLIP', ed => paste(ed, false), { noRepeat: true });
def('PASTEBLOCK', ed => paste(ed, true));
def('PASTEORIG', ed => paste(ed, false, true));

// ============ SELECTION ============
def('SELECT', async ed => { const S = await ed.getSel('Select objects:', { pickfirst: false }); ed.setSel(S); }, { noUndo: true });
def('SELECTSIMILAR', async ed => {
  const S = await ed.getSel(); if (!S.length) return;
  const keys = new Set(S.map(e => e.type + '|' + e.layer + '|' + (e.name || '')));
  ed.setSel(ed.ents.filter(e => keys.has(e.type + '|' + e.layer + '|' + (e.name || '')) && ed.selectable(e)));
  ed.msg(`${ed.sel.size} objects selected.`);
}, { noUndo: true });
def('QSELECT', ed => ed.ui.qselectDialog(), { noUndo: true });
def('AI_SELALL', async ed => { ed.setSel(ed.ents.filter(e => ed.selectable(e))); }, { noUndo: true, noEcho: true });

// ============ VIEW ============
def('ZOOM', async ed => {
  const k = await ed.getPoint('Specify corner of window, enter a scale factor (nX or nXP), or\n[All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:', { kws: ['All', 'Center', 'Dynamic', 'Extents', 'Previous', 'Scale', 'Window', 'Object'], noSnap: true, numOk: true });
  ed.pushView();
  if (k === 'All' || k === 'Extents') { ed.zoomExtents(); return; }
  if (k === 'Previous') { const s = ed.U.vstack?.pop(); ed.U.vstack?.pop(); if (s) ed.setView(JSON.parse(s)); return; }
  if (k === 'Object') { const S = await ed.getSel(); if (S.length) ed.zoomRect(S.map(e => bbox(e, ed.doc)).reduce((a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }))); return; }
  if (k === 'Center') { const c = await ed.getPoint('Specify center point:'); const h = await ed.getDist(`Enter magnification or height <${fmt(ed, ed.view.h / ed.view.scale)}>:`, { def: ed.view.h / ed.view.scale }); const v = ed.view, sc = v.h / h; ed.setView({ scale: sc, ox: v.w / 2 - c.x * sc, oy: v.h / 2 + c.y * sc }); return; }
  if (k === 'Scale') { const s = await ed.getStr('Enter a scale factor (nX or nXP):'); const f = parseFloat(s); if (f > 0) ed.zoomAt(ed.view.w / 2, ed.view.h / 2, f); return; }
  if (k === 'Window' || k === 'Dynamic' || (k && typeof k === 'object')) {
    const a = typeof k === 'object' ? k : await ed.getPoint('Specify first corner:', { noSnap: true });
    const b = await ed.getCorner('Specify opposite corner:', a, { noSnap: true });
    ed.zoomRect(rectOf(a, b), 1); return;
  }
  if (typeof k === 'number') { ed.zoomAt(ed.view.w / 2, ed.view.h / 2, k); return; }
  // real time
  ed.zoomMode = true; ed.cv.over.style.cursor = 'ns-resize';
  try { await ed.getKw('Press ESC or ENTER to exit, or right-click to display shortcut menu.', [], 'x'); } catch { } finally { ed.zoomMode = false; ed.cv.over.style.cursor = 'none'; }
}, { alias: ['Z'], transparent: true, noUndo: true });
def('PAN', async ed => {
  ed.panMode = true; ed.cv.over.style.cursor = 'grab';
  try { await ed.getKw('Press ESC or ENTER to exit, or right-click to display shortcut menu.', [], 'x'); } catch { } finally { ed.panMode = false; ed.cv.over.style.cursor = 'none'; }
}, { alias: ['P'], transparent: true, noUndo: true });
def('ZOOMEXTENTS', async ed => ed.zoomExtents(), { alias: ['ZE'], transparent: true, noUndo: true, noEcho: true });
def('REGEN', async ed => { ed.invalidate(); ed.msg('Regenerating model.'); }, { alias: ['RE', 'REGENALL', 'REA', 'REDRAW', 'R', 'RA'], noUndo: true });

// ============ UTILITIES ============
def('U', async ed => { if (ed.doc.undo()) { ed.clearSel(); ed.msg('Undo'); ed.app.onChange?.(); } else ed.msg('Everything has been undone'); ed.invalidate(); }, { alias: ['UNDO'], noUndo: true });
def('MREDO', async ed => { if (ed.doc.redo()) { ed.clearSel(); ed.msg('Redo'); ed.app.onChange?.(); } else ed.msg('Nothing to redo'); ed.invalidate(); }, { alias: ['REDO'], noUndo: true });
def('LTSCALE', async ed => { const v = await ed.getNum(`Enter new linetype scale factor <${ed.doc.set.ltscale}>:`, { def: ed.doc.set.ltscale }); ed.doc.set.ltscale = v; ed.msg('Regenerating model.'); ed.invalidate(); }, { alias: ['LTS'] });
def('PDMODE', async ed => { ed.doc.set.pdmode = await ed.getInt(`Enter new value for PDMODE <${ed.doc.set.pdmode}>:`, { def: ed.doc.set.pdmode }); ed.invalidate(); });
def('PDSIZE', async ed => { ed.doc.set.pdsize = await ed.getNum(`Enter new value for PDSIZE <${ed.doc.set.pdsize}>:`, { def: ed.doc.set.pdsize }); ed.invalidate(); });
def('DIMSCALE', async ed => { ed.doc.dim.scale = await ed.getNum(`Enter new value for DIMSCALE <${ed.doc.dim.scale}>:`, { def: ed.doc.dim.scale }); ed.doc.dimRev++; ed.invalidate(); });
def('TEXTSIZE', async ed => { ed.doc.set.textH = await ed.getNum(`Enter new value for TEXTSIZE <${ed.doc.set.textH}>:`, { def: ed.doc.set.textH }); });
def('FILLETRAD', async ed => { ed.doc.set.filletR = await ed.getNum(`Enter new value for FILLETRAD <${ed.doc.set.filletR}>:`, { def: ed.doc.set.filletR }); });
for (const [n, k, al] of [['ORTHO', 'ortho', []], ['GRID', 'grid', []], ['SNAP', 'snap', ['SN']], ['OSMODE', 'osnap', []], ['LWDISPLAY', 'lwt', []]]) {
  def(n, async ed => { const v = await ed.getKw(`Enter mode [ON/OFF] <${ed.T[k] ? 'ON' : 'OFF'}>:`, ['ON', 'OFF'], ed.T[k] ? 'ON' : 'OFF'); ed.T[k] = v === 'ON'; ed.ui?.refresh?.(); ed.invalidate(); }, { alias: al, noUndo: true, transparent: true });
}
def('BACKGROUND', async ed => ed.ui.optionsDialog(), { noUndo: true });
// perintah yang membuka dialog/palet (UI)
const uiCmd = (name, fn, o = {}) => def(name, async ed => fn(ed), { noUndo: o.undo ? false : true, ...o });
uiCmd('LAYER', ed => ed.ui.layerManager(), { alias: ['LA', 'LAYERPALETTE', 'DDLMODES'], undo: true });
uiCmd('PROPERTIES', ed => ed.ui.togglePalette('props', true), { alias: ['PR', 'PROPS', 'CH', 'MO', 'DDMODIFY'] });
uiCmd('PROPERTIESCLOSE', ed => ed.ui.togglePalette('props', false), { alias: ['PRCLOSE'] });
uiCmd('DSETTINGS', ed => ed.ui.draftingDialog('snap'), { alias: ['DS', 'SE', 'DDRMODES'] });
uiCmd('OSNAP', ed => ed.ui.draftingDialog('osnap'), { alias: ['OS', 'DDOSNAP'] });
uiCmd('UNITS', ed => ed.ui.unitsDialog(), { alias: ['UN', 'DDUNITS'], undo: true });
uiCmd('OPTIONS', ed => ed.ui.optionsDialog(), { alias: ['OP', 'PREFERENCES', 'CONFIG'] });
uiCmd('DIMSTYLE', ed => ed.ui.dimStyleDialog(), { alias: ['D', 'DST', 'DDIM', 'DIMSTY'], undo: true });
uiCmd('STYLE', ed => ed.ui.textStyleDialog(), { alias: ['ST', 'DDSTYLE'], undo: true });
uiCmd('COLOR', ed => ed.ui.colorDialog(null, c => { ed.doc.set.ccolor = c; ed.ui.refresh(); }), { alias: ['COL', 'COLOUR', 'DDCOLOR'] });
uiCmd('LINETYPE', ed => ed.ui.linetypeDialog(), { alias: ['LT', 'LTYPE', 'DDLTYPE'], undo: true });
uiCmd('LWEIGHT', ed => ed.ui.lweightDialog(), { alias: ['LW', 'LINEWEIGHT'] });
uiCmd('QUICKCALC', ed => ed.ui.quickCalc(), { alias: ['QC', 'QCC'] });
uiCmd('HELP', ed => ed.ui.help(), { alias: ['?'] });
uiCmd('TEXTSCR', ed => ed.ui.textWindow(), {});
uiCmd('PLOT', ed => ed.app.plotDialog(), { alias: ['PRINT', 'EXPORTPDF', 'PUBLISH'] });
uiCmd('PAGESETUP', ed => ed.app.pageSetupDialog(), { undo: true });
uiCmd('EXPORT', ed => ed.app.exportDialog(), { alias: ['EXP', 'DXFOUT', 'SAVEDXF', 'EXPORTSKP', 'EXPORTDWG'] });
uiCmd('QSAVE', ed => ed.app.save(), { alias: ['SAVE'] });
uiCmd('SAVEAS', ed => ed.app.saveAs(), {});
uiCmd('OPEN', ed => ed.app.open(), { alias: ['DXFIN', 'IMPORT'] });
uiCmd('NEW', ed => ed.app.newDoc(), { alias: ['QNEW'] });
uiCmd('CLOSE', ed => ed.app.closeDoc(), {});
uiCmd('CLEANSCREENON', ed => ed.ui.cleanScreen(), { alias: ['CLEANSCREENOFF'] });
uiCmd('COMMANDLINE', ed => ed.ui.toggleCmd(), { alias: ['COMMANDLINEHIDE'] });
uiCmd('INSERTPALETTE', ed => ed.ui.insertDialog().then(n => { if (n) { ed.insertName = n; ed.run('INSERT'); } }), { alias: ['BLOCKSPALETTE'] });
uiCmd('IMAGEATTACH', ed => ed.app.attachImage(), { alias: ['IAT', 'ATTACH'], undo: true });
uiCmd('FIND', ed => ed.ui.findDialog(), { undo: true });
uiCmd('MSPACE', ed => { if (ed.layout) { ed.U.ms = true; ed.ui.refresh(); ed.invalidate(); } }, { alias: ['MS'] });
uiCmd('PSPACE', ed => { if (ed.layout) { ed.U.ms = false; ed.ui.refresh(); ed.invalidate(); } }, { alias: ['PS'] });
uiCmd('VPMAX', ed => ed.ui.setSpace(-1), {});

// Grip edit (multifungsi: STRETCH → MOVE → ROTATE → SCALE → MIRROR)
def('GRIPEDIT', async ed => {
  const G = ed.hotGrip; if (!G) return;
  const S = [...ed.sel];
  const modes = ['STRETCH', 'MOVE', 'ROTATE', 'SCALE', 'MIRROR'];
  let mi = 0, copy = false, base = G.p;
  ed.sel.clear();
  const stretchList = q => S.map(e => { const n = clone(e); for (const g of (G.e === e ? [G] : [])) { const gg = gripsAt(n, ed, base); void g; gg.forEach(x => gripMoveImport(n, x, q, ed.doc)); } if (G.e !== e) gripsAt(n, ed, base).forEach(x => gripMoveImport(n, x, q, ed.doc)); return n; });
  const mat = (m, q) => {
    if (m === 'MOVE') return M.tr(q.x - base.x, q.y - base.y);
    if (m === 'ROTATE') return M.rot(ang(base, q), base);
    if (m === 'SCALE') { const k = dist(base, q) / (ed.view.w / ed.view.scale / 10); return M.sc(Math.max(1e-6, k), base); }
    if (m === 'MIRROR') return eq(base, q) ? M.id() : M.mirror(base, q);
  };
  try {
    for (;;) {
      const m = modes[mi];
      const kws = m === 'STRETCH' ? ['Base point', 'Copy', 'Undo', 'eXit'] : m === 'MIRROR' || m === 'MOVE' ? ['Base point', 'Copy', 'Undo', 'eXit'] : ['Base point', 'Copy', 'Undo', 'Reference', 'eXit'];
      const what = m === 'STRETCH' ? 'stretch point' : m === 'MOVE' ? 'move point' : m === 'ROTATE' ? 'rotation angle' : m === 'SCALE' ? 'scale factor' : 'second point';
      const r = await ed.ask({ type: 'point', msg: `** ${m}${copy ? ' (multiple)' : ''} **\nSpecify ${what} or${kwStr(kws)}:`, kws, base, numOk: m === 'ROTATE' || m === 'SCALE', preview: q => m === 'STRETCH' ? stretchList(q) : ghost(S, mat(m, q)) });
      if (r === null) { mi = (mi + 1) % modes.length; continue; }
      if (r === 'eXit') break;
      if (r === 'Copy') { copy = true; continue; }
      if (r === 'Base point') { base = await ed.getPoint('Specify base point:'); continue; }
      if (r === 'Undo') continue;
      if (r === 'Reference') continue;
      let mm;
      if (typeof r === 'number') mm = m === 'ROTATE' ? M.rot(r * D2R, base) : M.sc(r, base);
      if (m === 'STRETCH' && typeof r === 'object') {
        const res = stretchList(r);
        if (copy) res.forEach(n => ed.add(n)); else S.forEach((e, i) => { Object.keys(e).forEach(k => k !== 'id' && delete e[k]); Object.assign(e, res[i], { id: e.id }); });
      } else {
        mm ||= mat(m, r);
        S.forEach(e => copy ? ed.add(xform(clone(e), mm)) : xform(e, mm));
      }
      ed.invalidate();
      if (!copy) break;
    }
  } finally { ed.hotGrip = null; S.forEach(e => ed.ents.includes(e) && ed.sel.add(e)); ed.invalidate(); ed.ui?.onSel?.(); }
}, { noEcho: true, noRepeat: true });
import { grips as gripsOf, gripMove as gripMoveImport } from './ent.js';
function gripsAt(e, ed, p) { return gripsOf(e, ed.doc).filter(g => eq(g.p, p, 1e-9)).slice(0, 1); }

export function setEditorRef(ed) { ED = ed; }
export { hit };
