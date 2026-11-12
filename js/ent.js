// Entitas: primitif render, snap, grip, transformasi, hit-test, operasi kurva.
import {
  TAU, D2R, R2D, add, sub, mul, dot, crs, len, dist, ang, polar, mid, unit, perp, lerp, an, sweepOf, onArc, cp, eq,
  M, bulgeArc, arcPts, ellPt, ellPts, ellParam, fitBez, bezSample, bsplineSample, clamp, polyArea, polyCentroid, inPoly,
  bbEmpty, bbAdd, segRectHit, ptInRect, segPolyHit, closestPrim, segsOf, arc3, rotP,
} from './geom.js';

// ---------- Warna ACI ----------
export const ACI = (() => {
  const t = new Array(256);
  const base = ['#000000', '#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FFFFFF', '#808080', '#C0C0C0'];
  base.forEach((c, i) => t[i] = c);
  const lv = [255, 165, 127, 76, 38];
  for (let i = 10; i < 250; i++) {
    const h = (Math.floor(i / 10) - 1) * 15, sub_ = i % 10, V = lv[sub_ >> 1], half = sub_ & 1;
    const f = (n) => { const k = (n + h / 60) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
    const ch = [f(5), f(3), f(1)].map(c => Math.round(V * (half ? 0.5 + 0.5 * c : c)));
    t[i] = '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  [51, 80, 105, 130, 190, 255].forEach((g, k) => t[250 + k] = '#' + g.toString(16).padStart(2, '0').repeat(3).toUpperCase());
  return t;
})();
export const COLOR_NAMES = { 1: 'Red', 2: 'Yellow', 3: 'Green', 4: 'Cyan', 5: 'Blue', 6: 'Magenta', 7: 'White', 256: 'ByLayer', 0: 'ByBlock' };
export const colorName = c => COLOR_NAMES[c] || ('Color ' + c);

// ---------- Linetype (acadiso.lin, mm) ----------
export const LTYPES = {
  Continuous: { d: 'Solid line', p: [] },
  DASHED: { d: 'Dashed __ __ __ __', p: [12.7, -6.35] },
  DASHED2: { d: 'Dashed (.5x) _ _ _ _', p: [6.35, -3.175] },
  DASHEDX2: { d: 'Dashed (2x) ____  ____', p: [25.4, -12.7] },
  HIDDEN: { d: 'Hidden __ __ __ __', p: [6.35, -3.175] },
  HIDDEN2: { d: 'Hidden (.5x) _ _ _ _', p: [3.175, -1.5875] },
  CENTER: { d: 'Center ____ _ ____ _', p: [31.75, -6.35, 6.35, -6.35] },
  CENTER2: { d: 'Center (.5x) ___ _ ___', p: [19.05, -3.175, 3.175, -3.175] },
  PHANTOM: { d: 'Phantom ____ _ _ ____', p: [31.75, -6.35, 6.35, -6.35, 6.35, -6.35] },
  DOT: { d: 'Dot . . . . . . .', p: [0, -6.35] },
  DASHDOT: { d: 'Dash dot __ . __ .', p: [12.7, -6.35, 0, -6.35] },
  BORDER: { d: 'Border __ __ . __ __ .', p: [12.7, -6.35, 12.7, -6.35, 0, -6.35] },
  DIVIDE: { d: 'Divide ____ . . ____', p: [12.7, -6.35, 0, -6.35, 0, -6.35] },
  ACAD_ISO02W100: { d: 'ISO dash __ __ __', p: [12, -3] },
  ACAD_ISO04W100: { d: 'ISO long-dash dot ____ .', p: [24, -3, 0.5, -3] },
  ACAD_ISO10W100: { d: 'ISO dash dot __ . __', p: [12, -3, 0.5, -3] },
};
export const LWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
export const lwName = w => w === -1 ? 'ByLayer' : w === -2 ? 'ByBlock' : w === -3 ? 'Default' : (w / 100).toFixed(2) + ' mm';

// ---------- Pola hatch (acadiso.pat, mm): [sudut, ox, oy, dx, dy, ...dash] ----------
const I = 25.4;
const sc = (rows, k) => rows.map(r => r.map((v, i) => i === 0 ? v : v * k));
export const PATTERNS = {
  SOLID: { d: 'Solid fill', f: [] },
  ANSI31: { d: 'ANSI Iron, Brick, Stone masonry', f: [[45, 0, 0, 0, 3.175]] },
  ANSI32: { d: 'ANSI Steel', f: [[45, 0, 0, 0, 9.525], [45, 4.49013, 0, 0, 9.525]] },
  ANSI33: { d: 'ANSI Bronze, Brass, Copper', f: [[45, 0, 0, 0, 6.35], [45, 4.49013, 0, 0, 6.35, 3.175, -1.5875]] },
  ANSI34: { d: 'ANSI Plastic, Rubber', f: [[45, 0, 0, 0, 19.05], [45, 4.49013, 0, 0, 19.05], [45, 8.98026, 0, 0, 19.05], [45, 13.4704, 0, 0, 19.05]] },
  ANSI37: { d: 'ANSI Lead, Zinc, Magnesium', f: [[45, 0, 0, 0, 3.175], [135, 0, 0, 0, 3.175]] },
  ANSI38: { d: 'ANSI Aluminum', f: [[45, 0, 0, 0, 3.175], [135, 0, 0, 6.35, 3.175, 7.9375, -4.7625]] },
  LINE: { d: 'Parallel horizontal lines', f: [[0, 0, 0, 0, 3.175]] },
  NET: { d: 'Horizontal / vertical grid', f: [[0, 0, 0, 0, 3.175], [90, 0, 0, 0, 3.175]] },
  NET3: { d: 'Network pattern 0-60-120', f: [[0, 0, 0, 0, 3.175], [60, 0, 0, 0, 3.175], [120, 0, 0, 0, 3.175]] },
  DOTS: { d: 'A series of dots', f: [[0, 0, 0, 0.79375, 1.5875, 0, -1.5875]] },
  SQUARE: { d: 'Small aligned squares', f: sc([[0, 0, 0, 0, .125, .125, -.125], [90, 0, 0, 0, .125, .125, -.125]], I) },
  BRICK: { d: 'Brick or masonry-type surface', f: sc([[0, 0, 0, 0, .25], [90, 0, 0, 0, .5, .25, -.25], [90, .25, 0, 0, .5, -.25, .25]], I) },
  'AR-B816': { d: '8x16 Block elevation stretcher bond', f: [[0, 0, 0, 0, 203.2], [90, 0, 0, 203.2, 203.2, 203.2, -203.2]] },
  'AR-BRSTD': { d: 'Standard brick elevation', f: [[0, 0, 0, 0, 67.7], [90, 0, 0, 67.7, 101.6, 67.7, -67.7]] },
  EARTH: { d: 'Earth or ground (subterranean)', f: sc([[0, 0, 0, .25, .25, .25, -.25], [0, 0, .09375, .25, .25, .25, -.25], [0, 0, .1875, .25, .25, .25, -.25], [90, .03125, .21875, .25, .25, .25, -.25], [90, .125, .21875, .25, .25, .25, -.25], [90, .21875, .21875, .25, .25, .25, -.25]], I) },
  CROSS: { d: 'A series of crosses', f: sc([[0, 0, 0, .25, .25, .125, -.375], [90, .0625, -.0625, .25, .25, .125, -.375]], I) },
  ZIGZAG: { d: 'Staircase effect', f: sc([[0, 0, 0, .125, .125, .125, -.125], [90, .125, 0, .125, .125, .125, -.125]], I) },
  STEEL: { d: 'Steel material', f: sc([[45, 0, 0, 0, .125], [45, 0, .0625, 0, .125]], I) },
  'AR-CONC': { d: 'Random dot and stone pattern', f: [[50, 0, 0, 104.896, -149.807, 19.05, -209.55], [355, 0, 0, -51.7604, 187.258, 15.24, -167.64], [100.4514, 15.182, -1.32825, 137.379, -114.016, 16.1925, -178.118], [46.1842, 0, 50.8, 157.874, -239.226, 28.575, -314.325], [96.6356, 22.5242, 47.9241, 191.849, -195.255, 30.48, -335.28], [351.1842, 0, 50.8, 157.874, 296.226, 22.86, -251.46], [21, 25.4, 38.1, 104.896, -149.807, 14.2875, -157.162], [326, 25.4, 38.1, -51.7604, 187.258, 11.43, -125.73], [71.4514, 38.0215, 29.2059, 137.379, -114.016, 12.1444, -133.588], [37.5, 0, 0, 53.5868, 30.3471, 0, -165.1, 0, -184.15, 0, -171.45], [7.5, 0, 0, 79.1585, 49.8421, 0, -133.35, 0, -114.3, 0, -127], [-32.5, -56.0, 0, 53.5868, 30.3471, 0, -165.1, 0, -158.75, 0, -140]] },
  'AR-SAND': { d: 'Random dot pattern', f: [[37.5, 0, 0, 28.5662, 15.2346, 0, -38.1, 0, -40.64, 0, -35.56], [7.5, 0, 0, 39.6075, 24.7618, 0, -30.48, 0, -27.94, 0, -33.02], [-32.5, -56.0, 0, 28.5662, 15.2346, 0, -38.1, 0, -33.02, 0, -27.94], [-37.5, -55.9, 33.5, 15.2346, 28.5662, 0, -30.48, 0, -38.1]] },
  HONEY: { d: 'Honeycomb pattern', f: sc([[0, 0, 0, .1875, .108253, .125, -.25], [120, 0, 0, .1875, .108253, .125, -.25], [60, .125, 0, .1875, .108253, .125, -.25]], I) },
  GRASS: { d: 'Grass area', f: sc([[90, 0, 0, .707107, .707107, .1875, -1.226713], [45, 0, 0, 0, 1, .1875, -.8125], [135, 0, 0, 0, 1, .1875, -.8125]], I) },
  TRIANG: { d: 'Equilateral triangles', f: sc([[60, 0, 0, .1875, .324760, .1875, -.1875], [120, 0, 0, .1875, .324760, .1875, -.1875], [0, -.09375, .162380, .1875, .324760, .1875, -.1875]], I) },
};

// ---------- Teks ----------
const mctx = document.createElement('canvas').getContext('2d');
export const FONT = 'Arial, Helvetica, sans-serif';
export const CAP = 0.716; // tinggi huruf kapital / em
const wcache = new Map();
export function textW(s, h, wf = 1) {
  let w = wcache.get(s);
  if (w === undefined) { mctx.font = `100px ${FONT}`; w = mctx.measureText(s).width / 100; if (wcache.size > 5000) wcache.clear(); wcache.set(s, w); }
  return w * h / CAP * wf;
}
export function decodeText(s) { // kode kontrol AutoCAD
  return String(s ?? '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%').replace(/%%[uUoO]/g, '');
}
// kotak teks (4 sudut) untuk primitif T
export function textBox(T) {
  const w = textW(T.s, T.h, T.wf || 1), h = T.h;
  const x0 = -(T.ha || 0) * w / 2;
  const by = [0, 0.3 * h, -h / 2, -h][T.va || 0];
  const y0 = by - 0.3 * h, y1 = by + h * 1.05;
  return [[x0, y0], [x0 + w, y0], [x0 + w, y1], [x0, y1]].map(([x, y]) => add(T.p, rotP({ x, y }, { x: 0, y: 0 }, T.rot || 0)));
}
export function mtextLines(e) {
  const out = [], h = e.h, W = e.w || 0;
  for (const para of decodeText(e.s).split('\n')) {
    if (!W) { out.push(para); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (line && textW(t, h) > W) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// ---------- Dimensi ----------
export const DIMDEF = { txt: 2.5, asz: 2.5, exo: 0.625, exe: 1.25, gap: 0.625, dec: 0, arrow: 'closed', scale: 1, lfac: 1, sep: ',', suffix: '', txtColor: 256, dle: 0, angDec: 0 };
export function fmtNum(v, dec, sep = '.') {
  let s = (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec);
  if (s === '-0' || /^-0[.,]0*$/.test(s)) s = s.slice(1);
  return sep === '.' ? s : s.replace('.', sep);
}
export function dimValue(e) {
  if (e.kind === 'lin') { const d = { x: Math.cos(e.rot || 0), y: Math.sin(e.rot || 0) }; return Math.abs(dot(sub(e.p2, e.p1), d)); }
  if (e.kind === 'ali') return dist(e.p1, e.p2);
  if (e.kind === 'rad') return e.r;
  if (e.kind === 'dia') return e.r * 2;
  if (e.kind === 'ang') { const s = angDimArc(e); return s.sw * R2D; }
  if (e.kind === 'arc') return e.r * sweepOf(e.sa, e.ea);
  if (e.kind === 'ord') return Math.abs(e.axis === 'x' ? e.p1.x - (e.o?.x || 0) : e.p1.y - (e.o?.y || 0));
  return 0;
}
function angDimArc(e) {
  const a1 = ang(e.c, e.p1), a2 = ang(e.c, e.p2), ad = ang(e.c, e.dl);
  let sa = a1, ea = a2;
  if (!onArc(ad, a1, a2)) { sa = a2; ea = a1; }
  return { sa, ea, sw: sweepOf(sa, ea), r: dist(e.c, e.dl) };
}
export function dimText(e, ds) {
  const v = dimValue(e);
  let m;
  if (e.kind === 'ang') m = fmtNum(v, ds.angDec, ds.sep) + '°';
  else m = fmtNum(v * (ds.lfac || 1), ds.dec, ds.sep) + (ds.suffix || '');
  if (e.kind === 'rad') m = 'R' + m;
  if (e.kind === 'dia') m = 'Ø' + m;
  if (e.kind === 'arc') m = '⌒' + m;
  return e.txt ? decodeText(e.txt.replace('<>', m)) : m;
}
const readable = a => { a = an(a); return (a > Math.PI / 2 + 1e-6 && a <= 3 * Math.PI / 2 + 1e-6) ? a - Math.PI : a; };
function arrow(out, tip, dir, ds) { // dir: arah badan panah dari ujung
  const s = ds.asz * ds.scale, u = unit(dir), n = perp(u);
  if (ds.arrow === 'tick') { const k = mul(unit(add(u, n)), s / 2); out.push({ t: 'L', a: sub(tip, k), b: add(tip, k), heavy: 1 }); return; }
  if (ds.arrow === 'dot') { out.push({ t: 'F', loops: [arcPts(tip, s / 4, 0, TAU)] }); return; }
  const b = add(tip, mul(u, s));
  if (ds.arrow === 'open') { out.push({ t: 'L', a: tip, b: add(b, mul(n, s / 6)) }, { t: 'L', a: tip, b: sub(b, mul(n, s / 6)) }); return; }
  out.push({ t: 'F', loops: [[tip, add(b, mul(n, s / 6)), sub(b, mul(n, s / 6))]] });
}
export function dimGeom(e, ds0) {
  const ds = { ...DIMDEF, ...ds0, ...(e.ds || {}) }, k = ds.scale, out = [];
  const th = ds.txt * k, gap = ds.gap * k, exo = ds.exo * k, exe = ds.exe * k;
  const txt = dimText(e, ds);
  const T = (p, rot, va = 1) => out.push({ t: 'T', p, h: th, rot, s: txt, ha: 1, va, dimtxt: 1 });
  if (e.kind === 'lin' || e.kind === 'ali') {
    const d = e.kind === 'lin' ? { x: Math.cos(e.rot || 0), y: Math.sin(e.rot || 0) } : unit(sub(e.p2, e.p1));
    const n = perp(d);
    const o1 = dot(sub(e.dl, e.p1), n), o2 = dot(sub(e.dl, e.p2), n);
    const q1 = add(e.p1, mul(n, o1)), q2 = add(e.p2, mul(n, o2));
    const ext = (p, o, q) => { const sg = Math.sign(o) || 1; if (Math.abs(o) > exo) out.push({ t: 'L', a: add(p, mul(n, sg * exo)), b: add(q, mul(n, sg * exe)) }); };
    ext(e.p1, o1, q1); ext(e.p2, o2, q2);
    const dd = unit(sub(q2, q1)), dle = ds.arrow === 'tick' ? (ds.dle || ds.exe) * k : 0;
    const L = dist(q1, q2), inside = L >= ds.asz * k * 2.2;
    if (L > 1e-9) {
      out.push({ t: 'L', a: sub(q1, mul(dd, dle)), b: add(q2, mul(dd, dle)) });
      arrow(out, q1, inside ? dd : mul(dd, -1), ds); arrow(out, q2, inside ? mul(dd, -1) : dd, ds);
      if (!inside && ds.arrow !== 'tick') { const s = ds.asz * k * 2; out.push({ t: 'L', a: sub(q1, mul(dd, s)), b: q1 }, { t: 'L', a: q2, b: add(q2, mul(dd, s)) }); }
    }
    const tr = readable(Math.atan2(dd.y, dd.x) || Math.atan2(d.y, d.x)), r = { x: Math.cos(tr), y: Math.sin(tr) }, up = perp(r);
    const tw = e.tp || !ds.tfit ? 0 : textW(txt, th);
    if (e.tp) T(e.tp, tr, 1);
    else if (ds.tfit && L > 1e-9 && tw + 2 * gap > L) { // tfit: teks tak muat di antara garis bantu → di perpanjangan garis ukuran, sisi kanan arah baca (ISO 129-1)
      const qe = dot(r, dd) >= 0 ? q2 : q1, s0 = (inside ? 0 : ds.asz * k) + 2 * gap;
      out.push({ t: 'L', a: qe, b: add(qe, mul(r, s0 + tw + gap)) });
      T(add(add(qe, mul(r, s0 + tw / 2)), mul(up, gap)), tr, 1);
    } else T(add(mid(q1, q2), mul(up, gap)), tr, 1);
  } else if (e.kind === 'rad' || e.kind === 'dia') {
    const a = ang(e.c, e.dl), p = polar(e.c, a, e.r), q = polar(e.c, a + Math.PI, e.r), dl = dist(e.c, e.dl);
    if (e.kind === 'dia') { out.push({ t: 'L', a: q, b: p }); arrow(out, q, sub(e.c, q), ds); }
    if (dl > e.r) { out.push({ t: 'L', a: e.kind === 'rad' ? p : p, b: e.dl }); arrow(out, p, sub(e.c, p), ds); }
    else { if (e.kind === 'rad') out.push({ t: 'L', a: e.c, b: p }); arrow(out, p, sub(e.c, p), ds); }
    const tr = readable(a), up = perp({ x: Math.cos(tr), y: Math.sin(tr) });
    const at = dl > e.r ? e.dl : (e.kind === 'dia' ? e.c : lerp(e.c, p, 0.5));
    T(e.tp || add(at, mul(up, gap)), tr, 1);
  } else if (e.kind === 'ang') {
    const A = angDimArc(e), r = A.r;
    const leg = (a, p) => { const r1 = dist(e.c, p); if (r > r1 + exo) out.push({ t: 'L', a: polar(e.c, a, r1 + exo), b: polar(e.c, a, r + exe) }); else if (r < r1 - exo) out.push({ t: 'L', a: polar(e.c, a, r1 - exo), b: polar(e.c, a, r - exe) }); };
    const pa = Math.abs(an(ang(e.c, e.p1) - A.sa)) < 1e-6 ? e.p1 : e.p2, pb = pa === e.p1 ? e.p2 : e.p1;
    leg(A.sa, pa); leg(A.ea, pb);
    out.push({ t: 'A', c: e.c, r, sa: A.sa, ea: A.ea });
    const s1 = polar(e.c, A.sa, r), s2 = polar(e.c, A.ea, r);
    arrow(out, s1, perp({ x: Math.cos(A.sa), y: Math.sin(A.sa) }), ds);
    arrow(out, s2, mul(perp({ x: Math.cos(A.ea), y: Math.sin(A.ea) }), -1), ds);
    const am = A.sa + A.sw / 2, tr = readable(am - Math.PI / 2);
    T(e.tp || polar(e.c, am, r + gap), tr, 1);
  } else if (e.kind === 'arc') {
    const r = dist(e.c, e.dl);
    out.push({ t: 'A', c: e.c, r, sa: e.sa, ea: e.ea });
    out.push({ t: 'L', a: polar(e.c, e.sa, e.r + exo), b: polar(e.c, e.sa, r + exe) }, { t: 'L', a: polar(e.c, e.ea, e.r + exo), b: polar(e.c, e.ea, r + exe) });
    arrow(out, polar(e.c, e.sa, r), perp({ x: Math.cos(e.sa), y: Math.sin(e.sa) }), ds);
    arrow(out, polar(e.c, e.ea, r), mul(perp({ x: Math.cos(e.ea), y: Math.sin(e.ea) }), -1), ds);
    const am = e.sa + sweepOf(e.sa, e.ea) / 2;
    T(e.tp || polar(e.c, am, r + gap), readable(am - Math.PI / 2), 1);
  } else if (e.kind === 'ord') {
    const ax = e.axis === 'x';
    out.push({ t: 'L', a: e.p1, b: e.dl });
    T(e.tp || add(e.dl, ax ? { x: 0, y: gap } : { x: gap, y: 0 }), ax ? Math.PI / 2 : 0, 2);
    if (!ax) out[out.length - 1].ha = 0; else { out[out.length - 1].ha = 0; }
  }
  return out;
}

// ---------- Leader ----------
function leaderGeom(e, ds0) {
  const ds = { ...DIMDEF, ...ds0 }, out = [], P = e.pts;
  for (let i = 0; i < P.length - 1; i++) out.push({ t: 'L', a: P[i], b: P[i + 1] });
  if (P.length > 1) arrow(out, P[0], sub(P[1], P[0]), ds);
  if (e.s) {
    const last = P[P.length - 1], prev = P[P.length - 2] || last, right = last.x >= prev.x;
    const h = e.h || ds.txt * ds.scale, land = h * 2;
    const le = add(last, { x: right ? land : -land, y: 0 });
    out.push({ t: 'L', a: last, b: le });
    const lines = decodeText(e.s).split('\n');
    lines.forEach((s, i) => out.push({ t: 'T', p: add(le, { x: right ? h * 0.4 : -h * 0.4, y: -i * h * 1.667 + (lines.length - 1) * h * 0.83 }), h, rot: 0, s, ha: right ? 0 : 2, va: 2 }));
  }
  return out;
}

// ---------- Hatch ----------
export function loopPts(loop, res = 0) {
  const out = [], n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    if (a.b && i < n) {
      const A = bulgeArc(a, b, a.b);
      let pts = arcPts(A.c, A.r, A.sa, A.ea, res);
      if (a.b < 0) pts = pts.reverse();
      out.push(...pts.slice(0, -1));
    } else out.push({ x: a.x, y: a.y });
  }
  return out;
}
export function hatchLines(loops, pat, scale = 1, rot = 0, org = { x: 0, y: 0 }, patDef = null) {
  const def = patDef ? { f: patDef } : PATTERNS[pat] || PATTERNS.ANSI31, segs = [];
  if (patDef) { scale = 1; rot = 0; org = { x: 0, y: 0 }; }
  let bb = bbEmpty(); loops.forEach(l => l.forEach(p => bbAdd(bb, p)));
  const edges = []; loops.forEach(l => { for (let i = 0; i < l.length; i++) edges.push([l[i], l[(i + 1) % l.length]]); });
  for (const f of def.f) {
    const th = f[0] * D2R + rot, u = { x: Math.cos(th), y: Math.sin(th) }, v = perp(u);
    const o = add(org, rotP({ x: f[1] * scale, y: f[2] * scale }, { x: 0, y: 0 }, rot));
    const dx = f[3] * scale, dy = f[4] * scale, dash = f.slice(5).map(x => x * scale);
    if (Math.abs(dy) < 1e-9) continue;
    const step = add(mul(u, dx), mul(v, dy));
    const cs = [{ x: bb.x1, y: bb.y1 }, { x: bb.x2, y: bb.y1 }, { x: bb.x2, y: bb.y2 }, { x: bb.x1, y: bb.y2 }].map(c => dot(sub(c, o), v));
    let k0 = Math.ceil(Math.min(...cs) / dy), k1 = Math.floor(Math.max(...cs) / dy);
    if (k0 > k1) [k0, k1] = [k1, k0];
    if (k1 - k0 > 6000) return null; // terlalu rapat
    const P = dash.reduce((s, x) => s + Math.abs(x), 0);
    for (let k = k0; k <= k1; k++) {
      const B = add(o, mul(step, k)), ss = [];
      for (const [a, b] of edges) {
        const va = dot(sub(a, B), v), vb = dot(sub(b, B), v);
        if ((va > 0) !== (vb > 0)) { const t = va / (va - vb); ss.push(dot(sub(a, B), u) + dot(sub(b, a), u) * t); }
      }
      ss.sort((x, y) => x - y);
      for (let i = 0; i + 1 < ss.length; i += 2) {
        const s0 = ss[i], s1 = ss[i + 1];
        if (!dash.length || P < 1e-9) { segs.push([add(B, mul(u, s0)), add(B, mul(u, s1))]); continue; }
        let s = Math.floor(s0 / P) * P, j = 0, guard = 0;
        while (s <= s1 && guard++ < 20000) {
          const L = dash[j];
          if (L > 0) { const a = Math.max(s, s0), b = Math.min(s + L, s1); if (b > a) segs.push([add(B, mul(u, a)), add(B, mul(u, b))]); }
          else if (L === 0 && s >= s0 && s <= s1) { const p = add(B, mul(u, s)); segs.push([p, p]); }
          s += Math.abs(L); j = (j + 1) % dash.length;
        }
      }
    }
  }
  return segs;
}

// ---------- Primitif render (dengan cache) ----------
const cache = new WeakMap();
export function plSegs(e) { // segmen polyline sebagai primitif geometri
  const P = e.pts, n = P.length, out = [], m = e.closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = P[i], b = P[(i + 1) % n];
    if (a.b && Math.abs(a.b) > 1e-12 && !eq(a, b)) { const A = bulgeArc(a, b, a.b); out.push({ t: 'A', c: A.c, r: A.r, sa: A.sa, ea: A.ea, i }); }
    else out.push({ t: 'L', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, i });
  }
  return out;
}
function wideSegs(e) {
  const out = [], w = e.w / 2;
  for (const s of plSegs(e)) {
    if (s.t === 'L') { const n = mul(perp(unit(sub(s.b, s.a))), w); out.push({ t: 'F', loops: [[add(s.a, n), add(s.b, n), sub(s.b, n), sub(s.a, n)]] }); }
    else { const o = arcPts(s.c, s.r + w, s.sa, s.ea), i_ = arcPts(s.c, Math.max(0, s.r - w), s.sa, s.ea).reverse(); out.push({ t: 'F', loops: [o.concat(i_)] }); }
  }
  return out;
}
export function splinePts(e) {
  if (e.cp && e.kn) return bsplineSample(e.cp, e.kn, e.deg || 3, e.w);
  return bezSample(fitBez(e.fit, e.closed), 16);
}
export function insMatrix(e, base = { x: 0, y: 0 }) {
  return M.mul(M.tr(e.p.x, e.p.y), M.mul(M.rot(e.rot || 0), M.mul(M.sc(e.sx ?? 1, { x: 0, y: 0 }, e.sy ?? e.sx ?? 1), M.tr(-base.x, -base.y))));
}
export function xformPrim(q, m) {
  const D = M.dec(m), uni = Math.abs(Math.abs(m.a * m.a + m.b * m.b) - Math.abs(m.c * m.c + m.d * m.d)) < 1e-9 && Math.abs(m.a * m.c + m.b * m.d) < 1e-9;
  const o = { ...q };
  if (q.t === 'L') { o.a = M.ap(m, q.a); o.b = M.ap(m, q.b); }
  else if (q.t === 'A') {
    if (!uni) return { ...q, t: 'P', pts: (q.full ? arcPts(q.c, q.r, 0, TAU) : arcPts(q.c, q.r, q.sa, q.ea)).map(p => M.ap(m, p)), closed: !!q.full };
    o.c = M.ap(m, q.c); o.r = q.r * D.s;
    if (!q.full) { if (D.mir) { o.sa = D.phi - q.ea; o.ea = D.phi - q.sa; } else { o.sa = q.sa + D.phi; o.ea = q.ea + D.phi; } }
  }
  else if (q.t === 'P') o.pts = q.pts.map(p => M.ap(m, p));
  else if (q.t === 'F') o.loops = q.loops.map(l => l.map(p => M.ap(m, p)));
  else if (q.t === 'T') {
    o.p = M.ap(m, q.p); o.h = q.h * Math.hypot(m.c, m.d);
    const dv = M.vec(m, { x: Math.cos(q.rot || 0), y: Math.sin(q.rot || 0) });
    o.rot = Math.atan2(dv.y, dv.x); o.wf = (q.wf || 1) * len(dv) / Math.hypot(m.c, m.d);
    if (D.mir) { o.rot += Math.PI; o.ha = 2 - (q.ha || 0); if (q.ha === 1) o.ha = 1; }
  }
  else if (q.t === 'D') o.p = M.ap(m, q.p);
  return o;
}
function rawPrims(e, doc, depth) {
  switch (e.type) {
    case 'line': return [{ t: 'L', a: e.p1, b: e.p2 }];
    case 'xline': return [{ t: 'L', a: e.p, b: add(e.p, e.dir), inf: 2 }];
    case 'ray': return [{ t: 'L', a: e.p, b: add(e.p, e.dir), inf: 1 }];
    case 'circle': return [{ t: 'A', c: e.c, r: e.r, sa: 0, ea: TAU, full: true }];
    case 'arc': return [{ t: 'A', c: e.c, r: e.r, sa: e.sa, ea: e.ea }];
    case 'ellipse': { const full = sweepOf(e.sp ?? 0, e.ep ?? TAU) >= TAU - 1e-9; return [{ t: 'P', pts: ellPts(e.c, e.u, e.k, e.sp ?? 0, e.ep ?? TAU, 128), closed: full }]; }
    case 'pline': return e.w > 0 ? wideSegs(e) : plSegs(e);
    case 'spline': return [{ t: 'P', pts: splinePts(e), closed: !!e.closed && !e.kn }];
    case 'point': return [{ t: 'D', p: e.p }];
    case 'text': return [{ t: 'T', p: e.p, h: e.h, rot: e.rot || 0, s: decodeText(e.s), ha: e.ha || 0, va: e.va || 0, wf: e.wf || 1 }];
    case 'mtext': {
      const lines = mtextLines(e), h = e.h, ls = h * 1.6667 * (e.ls || 1), at = e.at || 1;
      const col = (at - 1) % 3, row = Math.floor((at - 1) / 3), tot = (lines.length - 1) * ls + h;
      const y0 = row === 0 ? -h : row === 1 ? tot / 2 - h : tot - h;
      return lines.map((s, i) => ({ t: 'T', p: add(e.p, rotP({ x: 0, y: y0 - i * ls }, { x: 0, y: 0 }, e.rot || 0)), h, rot: e.rot || 0, s, ha: col, va: 0 }));
    }
    case 'solid': return [{ t: 'F', loops: [e.pts] }];
    case 'hatch': {
      const loops = e.loops.map(l => loopPts(l));
      if (e.pat === 'SOLID') return [{ t: 'F', loops }];
      const segs = hatchLines(loops, e.pat, e.sc || 1, e.ang || 0, e.org, e.patDef);
      if (!segs) return [{ t: 'F', loops, dense: 1 }];
      return segs.map(([a, b]) => ({ t: 'L', a, b, nosnap: 1 }));
    }
    case 'dim': return dimGeom(e, doc?.dim);
    case 'leader': return leaderGeom(e, doc?.dim);
    case 'insert': {
      const B = doc?.blocks?.[e.name]; if (!B || depth > 12) return [];
      const m = insMatrix(e, B.base), out = [];
      for (const c of B.ents) for (const q of prims(c, doc, depth + 1)) {
        const x = xformPrim(q, m); x.src = { e: q.src ? q.src.e : c, chain: [...(q.src ? q.src.chain : []), e] }; out.push(x);
      }
      return out;
    }
    case 'image': return [{ t: 'P', pts: imgCorners(e), closed: true }];
    case 'wipeout': return [{ t: 'F', loops: [e.pts], wipe: 1 }, { t: 'P', pts: e.pts, closed: true, frame: 1 }];
  }
  return [];
}
export function imgCorners(e) { const u = { x: Math.cos(e.rot || 0) * e.w, y: Math.sin(e.rot || 0) * e.w }, v = mul(perp(unit(u)), e.h); return [e.p, add(e.p, u), add(add(e.p, u), v), add(e.p, v)]; }
export function prims(e, doc, depth = 0) {
  const key = JSON.stringify(e) + (e.type === 'insert' ? '|' + (doc?.blocks?.[e.name]?.rev || 0) : e.type === 'dim' || e.type === 'leader' ? '|' + (doc?.dimRev || 0) : '');
  const c = cache.get(e);
  if (c && c.k === key) return c.p;
  const p = rawPrims(e, doc, depth);
  cache.set(e, { k: key, p, bb: null });
  return p;
}
export function primBBox(q, bb) {
  if (q.t === 'L') { bbAdd(bb, q.a); if (!q.inf) bbAdd(bb, q.b); }
  else if (q.t === 'A') { if (q.full) { bbAdd(bb, { x: q.c.x - q.r, y: q.c.y - q.r }); bbAdd(bb, { x: q.c.x + q.r, y: q.c.y + q.r }); } else { bbAdd(bb, polar(q.c, q.sa, q.r)); bbAdd(bb, polar(q.c, q.ea, q.r)); for (let k = 0; k < 4; k++) if (onArc(k * Math.PI / 2, q.sa, q.ea)) bbAdd(bb, polar(q.c, k * Math.PI / 2, q.r)); } }
  else if (q.t === 'P') q.pts.forEach(p => bbAdd(bb, p));
  else if (q.t === 'F') q.loops.forEach(l => l.forEach(p => bbAdd(bb, p)));
  else if (q.t === 'T') textBox(q).forEach(p => bbAdd(bb, p));
  else if (q.t === 'D') bbAdd(bb, q.p);
  return bb;
}
export function bbox(e, doc) {
  const p = prims(e, doc), c = cache.get(e);
  if (c.bb) return c.bb;
  const bb = bbEmpty(); p.forEach(q => primBBox(q, bb));
  if (e.type === 'hatch') e.loops.forEach(l => l.forEach(q => bbAdd(bb, q)));
  c.bb = bb; return bb;
}
// Primitif geometri (untuk snap, potong, offset)
export function gprims(e, doc) {
  if (e.type === 'pline') return plSegs(e);
  if (e.type === 'hatch') return e.loops.map(l => ({ t: 'P', pts: loopPts(l), closed: true }));
  return prims(e, doc).filter(q => (q.t === 'L' || q.t === 'A' || q.t === 'P') && !q.nosnap);
}
export function primSamples(q) {
  if (q.t === 'L') return [q.a, q.b];
  if (q.t === 'A') return q.full ? arcPts(q.c, q.r, 0, TAU) : arcPts(q.c, q.r, q.sa, q.ea);
  if (q.t === 'P') return q.closed ? [...q.pts, q.pts[0]] : q.pts;
  if (q.t === 'F') return q.loops[0] ? [...q.loops[0], q.loops[0][0]] : [];
  if (q.t === 'T') { const b = textBox(q); return [...b, b[0]]; }
  if (q.t === 'D') return [q.p];
  return [];
}

// ---------- Hit test & seleksi ----------
export function hit(e, p, tol, doc) {
  const bb = bbox(e, doc);
  const inf = e.type === 'xline' || e.type === 'ray';
  if (!inf && (p.x < bb.x1 - tol || p.x > bb.x2 + tol || p.y < bb.y1 - tol || p.y > bb.y2 + tol)) return false;
  if (e.type === 'hatch') {
    const loops = e.loops.map(l => loopPts(l)); let n = 0; loops.forEach(l => { if (inPoly(p, l)) n++; });
    if (n % 2) return true;
    return loops.some(l => dist(p, closestPrim(p, { t: 'P', pts: l, closed: true })) <= tol);
  }
  for (const q of prims(e, doc)) {
    if (q.t === 'T') { if (inPoly(p, textBox(q))) return true; continue; }
    if (q.t === 'F') { if (q.loops.some(l => inPoly(p, l))) return true; continue; }
    if (q.t === 'D') { if (dist(p, q.p) <= tol) return true; continue; }
    if (dist(p, closestPrim(p, q)) <= tol) return true;
  }
  if (e.type === 'image' && inPoly(p, imgCorners(e))) return true;
  return false;
}
export function inWindow(e, r, crossing, doc) {
  if (e.type === 'xline' || e.type === 'ray') { if (!crossing) return false; }
  else { const bb = bbox(e, doc); if (bb.x1 >= r.x1 && bb.x2 <= r.x2 && bb.y1 >= r.y1 && bb.y2 <= r.y2) return true; if (!crossing) return false; if (bb.x2 < r.x1 || bb.x1 > r.x2 || bb.y2 < r.y1 || bb.y1 > r.y2) return false; }
  const c = { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
  for (const q of prims(e, doc)) {
    if (q.t === 'L' && q.inf) { const big = 1e7, d = unit(sub(q.b, q.a)); if (segRectHit(q.inf === 2 ? sub(q.a, mul(d, big)) : q.a, add(q.a, mul(d, big)), r)) return true; continue; }
    const s = primSamples(q);
    if (s.length === 1 && ptInRect(s[0], r)) return true;
    for (let i = 0; i < s.length - 1; i++) if (segRectHit(s[i], s[i + 1], r)) return true;
    if ((q.t === 'F' && q.loops.some(l => inPoly(c, l))) || (q.t === 'T' && inPoly(c, textBox(q)))) return true;
  }
  if (e.type === 'hatch' && e.loops.some(l => inPoly(c, loopPts(l)))) return true;
  return false;
}
export function inPolygon(e, poly, crossing, doc) {
  if (e.type === 'xline' || e.type === 'ray') return false;
  const ps = prims(e, doc), all = [];
  for (const q of ps) all.push(...primSamples(q));
  if (e.type === 'hatch') e.loops.forEach(l => all.push(...loopPts(l)));
  if (all.length && all.every(p => inPoly(p, poly))) return true;
  if (!crossing) return false;
  for (const q of ps) { const s = primSamples(q); if (s.length === 1 && inPoly(s[0], poly)) return true; for (let i = 0; i < s.length - 1; i++) if (segPolyHit(s[i], s[i + 1], poly)) return true; }
  return false;
}
export function onFence(e, a, b, doc) {
  for (const q of prims(e, doc)) { const s = primSamples(q); for (let i = 0; i < s.length - 1; i++) { const r = segSegPar(s[i], s[i + 1], a, b); if (r) return true; } }
  return false;
}
function segSegPar(a1, a2, b1, b2) {
  const r = sub(a2, a1), s = sub(b2, b1), den = crs(r, s); if (Math.abs(den) < 1e-14) return false;
  const q = sub(b1, a1), t = crs(q, s) / den, u = crs(q, r) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ---------- Snap ----------
export function snaps(e, doc, depth = 0) {
  const S = [];
  const P = (k, p) => S.push({ k, p });
  switch (e.type) {
    case 'line': P('end', e.p1); P('end', e.p2); P('mid', mid(e.p1, e.p2)); break;
    case 'ray': P('end', e.p); break;
    case 'xline': P('mid', e.p); break;
    case 'circle': P('cen', e.c); for (let k = 0; k < 4; k++) P('qua', polar(e.c, k * Math.PI / 2, e.r)); break;
    case 'arc': { P('end', polar(e.c, e.sa, e.r)); P('end', polar(e.c, e.ea, e.r)); P('mid', polar(e.c, e.sa + sweepOf(e.sa, e.ea) / 2, e.r)); P('cen', e.c); for (let k = 0; k < 4; k++) if (onArc(k * Math.PI / 2, e.sa, e.ea)) P('qua', polar(e.c, k * Math.PI / 2, e.r)); break; }
    case 'ellipse': {
      P('cen', e.c); const sp = e.sp ?? 0, ep = e.ep ?? TAU, full = sweepOf(sp, ep) >= TAU - 1e-9;
      for (let k = 0; k < 4; k++) if (full || onArc(k * Math.PI / 2, sp, ep)) P('qua', ellPt(e.c, e.u, e.k, k * Math.PI / 2));
      if (!full) { P('end', ellPt(e.c, e.u, e.k, sp)); P('end', ellPt(e.c, e.u, e.k, ep)); }
      break;
    }
    case 'pline': {
      e.pts.forEach(p => P('end', p));
      for (const s of plSegs(e)) { if (s.t === 'L') P('mid', mid(s.a, s.b)); else { P('mid', polar(s.c, s.sa + sweepOf(s.sa, s.ea) / 2, s.r)); P('cen', s.c); } }
      if (e.closed && e.pts.length > 2) P('gcen', polyCentroid(loopPts(e.pts)));
      break;
    }
    case 'spline': { const f = e.fit || []; if (f.length) { P('end', f[0]); P('end', f[f.length - 1]); f.slice(1, -1).forEach(p => P('nod', p)); } else if (e.cp) { P('end', e.cp[0]); P('end', e.cp[e.cp.length - 1]); } break; }
    case 'point': P('nod', e.p); break;
    case 'text': case 'mtext': P('ins', e.p); break;
    case 'solid': e.pts.forEach(p => P('end', p)); break;
    case 'leader': e.pts.forEach(p => P('end', p)); break;
    case 'dim': if (e.p1) P('nod', e.p1); if (e.p2) P('nod', e.p2); break;
    case 'image': imgCorners(e).forEach(p => P('end', p)); P('ins', e.p); break;
    case 'insert': {
      P('ins', e.p);
      const B = doc?.blocks?.[e.name];
      if (B && depth < 4) { const m = insMatrix(e, B.base); for (const c of B.ents) for (const s of snaps(c, doc, depth + 1)) S.push({ k: s.k, p: M.ap(m, s.p) }); }
      break;
    }
  }
  return S;
}

// ---------- Grip ----------
export function grips(e, doc) {
  const G = [], g = (p, k, i) => G.push({ p, k, i });
  switch (e.type) {
    case 'line': g(e.p1, 'p1'); g(e.p2, 'p2'); g(mid(e.p1, e.p2), 'mv'); break;
    case 'xline': case 'ray': g(e.p, 'mv'); g(add(e.p, mul(e.dir, 1)), 'dir'); break;
    case 'circle': g(e.c, 'mv'); for (let k = 0; k < 4; k++) g(polar(e.c, k * Math.PI / 2, e.r), 'r'); break;
    case 'arc': g(polar(e.c, e.sa, e.r), 'sa'); g(polar(e.c, e.sa + sweepOf(e.sa, e.ea) / 2, e.r), 'am'); g(polar(e.c, e.ea, e.r), 'ea'); g(e.c, 'mv'); break;
    case 'ellipse': g(e.c, 'mv'); g(add(e.c, e.u), 'u'); g(sub(e.c, e.u), 'u'); g(add(e.c, mul(perp(e.u), e.k)), 'k'); g(sub(e.c, mul(perp(e.u), e.k)), 'k'); break;
    case 'pline': e.pts.forEach((p, i) => g(p, 'v', i)); plSegs(e).forEach(s => g(s.t === 'L' ? mid(s.a, s.b) : polar(s.c, s.sa + sweepOf(s.sa, s.ea) / 2, s.r), 'sm', s.i)); break;
    case 'spline': (e.fit || e.cp || []).forEach((p, i) => g(p, 'v', i)); break;
    case 'point': case 'text': case 'mtext': case 'insert': case 'image': g(e.p, 'mv'); break;
    case 'solid': e.pts.forEach((p, i) => g(p, 'v', i)); break;
    case 'leader': e.pts.forEach((p, i) => g(p, 'v', i)); break;
    case 'dim':
      if (e.p1) g(e.p1, 'p1'); if (e.p2) g(e.p2, 'p2'); if (e.c) g(e.c, 'c'); g(e.dl, 'dl');
      { const T = prims(e, doc).find(q => q.dimtxt); if (T) g(T.p, 'tp'); }
      break;
    case 'hatch': { const l = loopPts(e.loops[0] || []); if (l.length) g(polyCentroid(l), 'mv'); break; }
    case 'wipeout': e.pts.forEach((p, i) => g(p, 'v', i)); break;
  }
  return G;
}
export function gripMove(e, G, p, doc) {
  const d = sub(p, G.p);
  switch (G.k) {
    case 'mv': xform(e, M.tr(d.x, d.y)); return;
    case 'p1': e.p1 = cp(p); return;
    case 'p2': e.p2 = cp(p); return;
    case 'c': e.c = cp(p); return;
    case 'dl': e.dl = cp(p); if (e.tp) e.tp = add(e.tp, d); if (e.kind === 'ord') e.dl = cp(p); return;
    case 'tp': e.tp = cp(p); return;
    case 'r': e.r = Math.max(1e-6, dist(e.c, p)); return;
    case 'dir': e.dir = unit(sub(p, e.p)); return;
    case 'sa': case 'ea': case 'am': {
      const s = polar(e.c, e.sa, e.r), m = polar(e.c, e.sa + sweepOf(e.sa, e.ea) / 2, e.r), f = polar(e.c, e.ea, e.r);
      const A = arc3(G.k === 'sa' ? p : s, G.k === 'am' ? p : m, G.k === 'ea' ? p : f); if (A) Object.assign(e, A); return;
    }
    case 'u': { const v = sub(p, e.c), L = len(v), mn = len(e.u) * e.k; e.u = v; e.k = Math.min(1, mn / L) || e.k; return; }
    case 'k': { const r = Math.abs(dot(sub(p, e.c), unit(perp(e.u)))); e.k = Math.max(1e-3, Math.min(1, r / len(e.u))); return; }
    case 'v': {
      if (e.type === 'spline') { (e.fit || e.cp)[G.i] = cp(p); return; }
      const q = e.pts[G.i]; q.x = p.x; q.y = p.y; return;
    }
    case 'sm': {
      const n = e.pts.length, a = e.pts[G.i], b = e.pts[(G.i + 1) % n];
      if (a.b) { const A = arc3(a, p, b); if (A) { const ccw = crs(sub(p, a), sub(b, p)) < 0; const sw = sweepOf(A.sa, A.ea); a.b = Math.tan(sw / 4) * (ccw ? 1 : -1); } }
      else { a.x += d.x; a.y += d.y; b.x += d.x; b.y += d.y; }
      return;
    }
  }
}

// ---------- Transformasi ----------
export function xform(e, m) {
  const A = p => M.ap(m, p), D = M.dec(m);
  switch (e.type) {
    case 'line': e.p1 = A(e.p1); e.p2 = A(e.p2); break;
    case 'xline': case 'ray': e.p = A(e.p); e.dir = unit(M.vec(m, e.dir)); break;
    case 'circle': e.c = A(e.c); e.r *= D.s; break;
    case 'arc': e.c = A(e.c); e.r *= D.s; if (D.mir) { const s = e.sa; e.sa = an(D.phi - e.ea); e.ea = an(D.phi - s); } else { e.sa = an(e.sa + D.phi); e.ea = an(e.ea + D.phi); } break;
    case 'ellipse': e.c = A(e.c); e.u = M.vec(m, e.u); if (D.mir && e.sp !== undefined) { const s = e.sp; e.sp = an(-e.ep); e.ep = an(-s); } break;
    case 'pline': e.pts = e.pts.map(p => ({ ...A(p), b: D.mir ? -(p.b || 0) : (p.b || 0) })); if (e.w) e.w *= D.s; break;
    case 'spline': if (e.fit) e.fit = e.fit.map(A); if (e.cp) e.cp = e.cp.map(A); break;
    case 'point': e.p = A(e.p); break;
    case 'text': case 'mtext': {
      e.p = A(e.p); e.h *= D.s; if (e.w) e.w *= D.s;
      if (D.mir) { const dv = M.vec(m, { x: Math.cos(e.rot || 0), y: Math.sin(e.rot || 0) }); let r = Math.atan2(dv.y, dv.x); if (Math.cos(r) < -1e-9) r += Math.PI; e.rot = an(r); if (e.type === 'text' && e.ha !== 1) { const w = textW(decodeText(e.s), e.h, e.wf || 1); e.p = polar(e.p, e.rot + (e.ha === 2 ? 0 : Math.PI), w); } }
      else e.rot = an((e.rot || 0) + D.phi);
      break;
    }
    case 'solid': case 'wipeout': e.pts = e.pts.map(A); break;
    case 'leader': e.pts = e.pts.map(A); if (e.h) e.h *= D.s; break;
    case 'hatch': e.loops = e.loops.map(l => l.map(p => ({ ...A(p), b: D.mir ? -(p.b || 0) : (p.b || 0) }))); e.sc = (e.sc || 1) * D.s; e.ang = (e.ang || 0) + (D.mir ? -D.phi : D.phi); if (e.org) e.org = A(e.org); break;
    case 'dim':
      for (const k of ['p1', 'p2', 'dl', 'c', 'tp', 'o']) if (e[k]) e[k] = A(e[k]);
      if (e.r) e.r *= D.s; if (e.kind === 'lin') e.rot = an((e.rot || 0) + D.phi);
      if (e.kind === 'arc') { if (D.mir) { const s = e.sa; e.sa = an(D.phi - e.ea); e.ea = an(D.phi - s); } else { e.sa = an(e.sa + D.phi); e.ea = an(e.ea + D.phi); } }
      if (e.ds && D.s !== 1) { } break;
    case 'insert': {
      const sx = e.sx ?? 1, sy = e.sy ?? sx;
      e.p = A(e.p); e.sx = sx * D.s;
      if (D.mir) { e.rot = an(D.phi - (e.rot || 0)); e.sy = -sy * D.s; } else { e.rot = an((e.rot || 0) + D.phi); e.sy = sy * D.s; }
      break;
    }
    case 'image': e.p = A(e.p); e.w *= D.s; e.h *= D.s; e.rot = an((e.rot || 0) + D.phi); break;
  }
  return e;
}

// ---------- Kurva: parameter, titik, potong ----------
export function curve(e) {
  switch (e.type) {
    case 'line': return { t0: 0, t1: 1, closed: false, at: t => lerp(e.p1, e.p2, t), par: p => { const d = sub(e.p2, e.p1); return dot(sub(p, e.p1), d) / (dot(d, d) || 1); } };
    case 'xline': return { t0: -Infinity, t1: Infinity, closed: false, inf: 2, at: t => add(e.p, mul(e.dir, t)), par: p => dot(sub(p, e.p), e.dir) };
    case 'ray': return { t0: 0, t1: Infinity, closed: false, inf: 1, at: t => add(e.p, mul(e.dir, t)), par: p => dot(sub(p, e.p), e.dir) };
    case 'arc': { const sw = sweepOf(e.sa, e.ea); return { t0: 0, t1: sw, closed: false, at: t => polar(e.c, e.sa + t, e.r), par: p => { const a = an(ang(e.c, p) - e.sa); return a > sw + (TAU - sw) / 2 ? a - TAU : a; } }; }
    case 'circle': return { t0: 0, t1: TAU, closed: true, at: t => polar(e.c, t, e.r), par: p => an(ang(e.c, p)) };
    case 'ellipse': { const sp = e.sp ?? 0, sw = sweepOf(sp, e.ep ?? TAU), full = sw >= TAU - 1e-9; return { t0: 0, t1: sw, closed: full, at: t => ellPt(e.c, e.u, e.k, sp + t), par: p => { const a = an(ellParam(e.c, e.u, e.k, p) - sp); return !full && a > sw + (TAU - sw) / 2 ? a - TAU : a; } }; }
    case 'pline': {
      const segs = plSegs(e), n = segs.length;
      const segAt = (s, u) => s.t === 'L' ? lerp(s.a, s.b, u) : (() => { const a = e.pts[s.i]; return polar(s.c, a.b > 0 ? s.sa + sweepOf(s.sa, s.ea) * u : s.ea - sweepOf(s.sa, s.ea) * u, s.r); })();
      return {
        t0: 0, t1: n, closed: !!e.closed, segs,
        at: t => { const i = clamp(Math.floor(t), 0, n - 1); return segAt(segs[i], t - i); },
        par: p => {
          let best = 0, bd = Infinity;
          segs.forEach((s, i) => {
            let u;
            if (s.t === 'L') { const d = sub(s.b, s.a); u = clamp(dot(sub(p, s.a), d) / (dot(d, d) || 1), 0, 1); }
            else { const sw = sweepOf(s.sa, s.ea), a = ang(s.c, p); u = e.pts[s.i].b > 0 ? an(a - s.sa) / sw : an(s.ea - a) / sw; if (u > 1) u = (u - 1) * sw < (TAU - sw) / 2 ? 1 : 0; }
            const q = segAt(s, u), d = dist(p, q); if (d < bd) { bd = d; best = i + u; }
          });
          return best;
        },
      };
    }
    case 'spline': { const pts = splinePts(e); const pl = { type: 'pline', pts: pts.map(cp), closed: false }; return { ...curve(pl), approx: pl }; }
  }
  return null;
}
// Potongan dari t0 ke t1 (searah kurva). Mengembalikan entitas baru (props disalin).
export function piece(e, t0, t1) {
  const base = { ...e }; delete base.id;
  const C = curve(e);
  switch (e.type) {
    case 'line': return { ...base, p1: C.at(t0), p2: C.at(t1) };
    case 'xline': case 'ray': {
      if (isFinite(t0) && isFinite(t1)) { const r = { ...base, type: 'line', p1: C.at(t0), p2: C.at(t1) }; delete r.p; delete r.dir; return r; }
      if (isFinite(t0)) return { ...base, type: 'ray', p: C.at(t0), dir: e.dir };
      return { ...base, type: 'ray', p: C.at(t1), dir: mul(e.dir, -1) };
    }
    case 'arc': return { ...base, sa: an(e.sa + t0), ea: an(e.sa + t1) };
    case 'circle': { const r = { ...base, type: 'arc', sa: an(t0), ea: an(t1) }; return r; }
    case 'ellipse': return { ...base, sp: an((e.sp ?? 0) + t0), ep: an((e.sp ?? 0) + t1) };
    case 'pline': case 'spline': {
      const src = e.type === 'spline' ? C.approx : e, n = src.closed ? src.pts.length : src.pts.length - 1;
      if (t1 < t0) { const a = plPiece(src, t0, n), b = plPiece(src, 0, t1); a.pts.pop(); return { ...base, type: 'pline', pts: [...a.pts, ...b.pts], closed: false, fit: undefined, cp: undefined, kn: undefined }; }
      const r = plPiece(src, t0, t1); return { ...base, type: 'pline', pts: r.pts, closed: false, fit: undefined, cp: undefined, kn: undefined };
    }
  }
  return null;
}
function plPiece(e, t0, t1) {
  const P = e.pts, N = P.length, C = curve(e), out = [];
  const bulgePart = (i, u0, u1) => { const b = P[i].b || 0; if (!b) return 0; const sw = 4 * Math.atan(b); return Math.tan(sw * (u1 - u0) / 4); };
  let i = Math.floor(t0 + 1e-12); if (i >= (e.closed ? N : N - 1)) i = (e.closed ? N : N - 1) - 1;
  let t = t0;
  while (t < t1 - 1e-12) {
    const end = Math.min(t1, i + 1);
    out.push({ ...C.at(t), b: bulgePart(i % N, t - i, end - i) });
    t = end; i++;
  }
  out.push({ ...C.at(t1), b: 0 });
  return { pts: out };
}
export function curveLen(e) {
  if (e.type === 'line') return dist(e.p1, e.p2);
  if (e.type === 'arc') return e.r * sweepOf(e.sa, e.ea);
  if (e.type === 'circle') return TAU * e.r;
  if (e.type === 'pline') return plSegs(e).reduce((s, q) => s + (q.t === 'L' ? dist(q.a, q.b) : q.r * sweepOf(q.sa, q.ea)), 0);
  const P = prims(e).filter(q => q.t === 'P'); let L = 0;
  P.forEach(q => { const s = primSamples(q); for (let i = 0; i < s.length - 1; i++) L += dist(s[i], s[i + 1]); });
  return L;
}
// luas eksak polyline dengan bulge (poligon + segmen busur)
export function plArea(P) {
  let a = polyArea(P);
  for (let i = 0; i < P.length; i++) { const b = P[i].b || 0; if (!b) continue; const q = P[(i + 1) % P.length], d = dist(P[i], q), th = 4 * Math.atan(Math.abs(b)), r = d / (2 * Math.sin(th / 2)); a += Math.sign(b) * r * r * (th - Math.sin(th)) / 2; }
  return a;
}
export function entArea(e) {
  if (e.type === 'circle') return Math.PI * e.r * e.r;
  if (e.type === 'ellipse') return Math.PI * len(e.u) * len(e.u) * e.k;
  if (e.type === 'pline') return Math.abs(plArea(e.pts));
  if (e.type === 'hatch') return e.loops.reduce((s, l, i) => s + (i ? -1 : 1) * Math.abs(plArea(l)), 0);
  if (e.type === 'spline') return Math.abs(polyArea(splinePts(e)));
  if (e.type === 'solid') return Math.abs(polyArea(e.pts));
  return 0;
}
// Titik-titik pada kurva berjarak sama (DIVIDE/MEASURE/ARRAYPATH)
export function sampleCurve(e, n, byLen) {
  const C = curve(e); if (!C || !isFinite(C.t1)) return [];
  const N = 400, S = [], ts = [];
  for (let i = 0; i <= N; i++) { const t = C.t0 + (C.t1 - C.t0) * i / N; ts.push(t); S.push(C.at(t)); }
  const cum = [0]; for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + dist(S[i - 1], S[i]));
  const L = cum[N], out = [];
  const at = (d) => { let k = cum.findIndex(c => c >= d); if (k <= 0) k = 1; const f = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1); const p = lerp(S[k - 1], S[k], f); const tg = unit(sub(S[k], S[k - 1])); return { p, a: Math.atan2(tg.y, tg.x) }; };
  if (byLen) { for (let d = byLen; d < L - 1e-9; d += byLen) out.push(at(d)); }
  else { const m = C.closed ? n : n; for (let i = 1; i < m; i++) out.push(at(L * i / n)); if (C.closed) out.unshift(at(0)); }
  return out;
}

// ---------- Explode ----------
export function explode(e, doc) {
  const base = { layer: e.layer, color: e.color, lt: e.lt, lw: e.lw };
  if (e.type === 'pline') return plSegs(e).map(s => s.t === 'L' ? { ...base, type: 'line', p1: s.a, p2: s.b } : { ...base, type: 'arc', c: s.c, r: s.r, sa: s.sa, ea: s.ea });
  if (e.type === 'insert') {
    const B = doc.blocks[e.name]; if (!B) return [];
    const m = insMatrix(e, B.base), D = M.dec(m);
    const uni = Math.abs((e.sx ?? 1) - (e.sy ?? e.sx ?? 1)) < 1e-12 || Math.abs((e.sx ?? 1) + (e.sy ?? 1)) < 1e-12;
    return B.ents.map(c => {
      let n = JSON.parse(JSON.stringify(c)); delete n.id;
      if (!uni && (n.type === 'circle' || n.type === 'arc')) n = { ...n, type: 'pline', pts: (n.type === 'circle' ? arcPts(n.c, n.r, 0, TAU).slice(0, -1) : arcPts(n.c, n.r, n.sa, n.ea)).map(p => ({ ...p, b: 0 })), closed: n.type === 'circle' };
      if (!uni && n.type === 'pline') n.pts = loopPts(n.pts).map(p => ({ ...p, b: 0 }));
      xform(n, m);
      if (n.layer === '0') n.layer = e.layer; if (n.color === 0) n.color = e.color; if (n.lt === 'ByBlock') n.lt = e.lt; if (n.lw === -2) n.lw = e.lw;
      void D; return n;
    });
  }
  if (e.type === 'dim' || e.type === 'leader') return primsToEnts(prims(e, doc), base);
  if (e.type === 'mtext') return prims(e, doc).map(q => ({ ...base, type: 'text', p: q.p, h: q.h, rot: q.rot, s: q.s, ha: q.ha, va: 0 }));
  if (e.type === 'hatch' && e.pat !== 'SOLID') return primsToEnts(prims(e, doc), base);
  if (e.type === 'solid') { const P = e.pts; return P.map((p, i) => ({ ...base, type: 'line', p1: p, p2: P[(i + 1) % P.length] })); }
  return null;
}
export function primsToEnts(ps, base) {
  const out = [];
  for (const q of ps) {
    const b = { ...base };
    if (q.t === 'L') out.push({ ...b, type: 'line', p1: q.a, p2: q.b });
    else if (q.t === 'A') out.push(q.full ? { ...b, type: 'circle', c: q.c, r: q.r } : { ...b, type: 'arc', c: q.c, r: q.r, sa: q.sa, ea: q.ea });
    else if (q.t === 'P') out.push({ ...b, type: 'pline', pts: q.pts.map(p => ({ ...p, b: 0 })), closed: q.closed });
    else if (q.t === 'F') q.loops.forEach(l => out.push(l.length <= 4 ? { ...b, type: 'solid', pts: l } : { ...b, type: 'hatch', pat: 'SOLID', loops: [l.map(p => ({ ...p, b: 0 }))] }));
    else if (q.t === 'T') out.push({ ...b, type: 'text', p: q.p, h: q.h, rot: q.rot, s: q.s, ha: q.ha, va: q.va });
    else if (q.t === 'D') out.push({ ...b, type: 'point', p: q.p });
  }
  return out;
}
export const TYPE_NAMES = { line: 'Line', xline: 'Xline', ray: 'Ray', circle: 'Circle', arc: 'Arc', ellipse: 'Ellipse', pline: 'Polyline', spline: 'Spline', point: 'Point', text: 'Text', mtext: 'MText', solid: '2D Solid', hatch: 'Hatch', dim: 'Dimension', leader: 'Multileader', insert: 'Block Reference', image: 'Raster Image', wipeout: 'Wipeout' };
