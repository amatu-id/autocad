// Google Maps di Amatu CAD: peta interaktif, cari lokasi / tempel link Google Maps, seleksi area atau batas lahan,
// capture foto peta → diplot ke gambar dengan skala riil (WGS84 → bidang lokal ENU, galat matematis < 1 mm),
// tracing otomatis (bangunan, jalan, air, hijau) dari peta Google, batas lahan + ukuran riil, luas, tabel koordinat.
import { h, win, toast, sel, chk } from './dom.js';
import { icon } from './icons.js';
import { ll2px, px2ll, gsd, makeENU, geoXform, utm, tm3, fmtLat, fmtLon, azimuth, fmtAz, parseLoc, gmapsUrl } from './geo.js';
import { TRACE_STYLE } from './trace.js';
import { fgbBBox } from './fgb.js';
import { traceRoof } from './roof.js';
import { LIBRARY } from './library.js';
import { PREF_SCALES, UNIT_MM, fitVp } from './doc.js';

const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };
const g4 = (x, y) => (x + y) & 3;
export const SRC = {
  sat: { n: 'Satelit', max: 21, ts: 1, url: (x, y, z) => `https://mt${g4(x, y)}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}` },
  hyb: { n: 'Hybrid', max: 21, ts: 2, url: (x, y, z, s = 2) => `https://mt${g4(x, y)}.google.com/vt/lyrs=y&hl=id&x=${x}&y=${y}&z=${z}&scale=${s}` },
  map: { n: 'Peta', max: 22, ts: 2, url: (x, y, z, s = 2) => `https://mt${g4(x, y)}.google.com/vt/lyrs=m&hl=id&x=${x}&y=${y}&z=${z}&scale=${s}` },
  esri: { n: 'Esri', max: 19, ts: 1, url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}` },
};
const traceUrl = (x, y, z) => `https://mt${g4(x, y)}.google.com/vt/lyrs=m&x=${x}&y=${y}&z=${z}&scale=2&apistyle=${encodeURIComponent(TRACE_STYLE)}`;
// Jejak bangunan terbuka per negara: Google Open Buildings v3 + Microsoft + OSM (gabungan VIDA, source.coop), FlatGeobuf ber-indeks spasial
const OB_URL = c => `https://data.source.coop/vida/google-microsoft-osm-open-buildings/flatgeobuf/by_country/country_iso=${c}/${c}.fgb`;
const ISO3 = Object.fromEntries(('AD AND,AE ARE,AF AFG,AG ATG,AI AIA,AL ALB,AM ARM,AO AGO,AR ARG,AS ASM,AT AUT,AU AUS,AW ABW,AX ALA,AZ AZE,BA BIH,BB BRB,BD BGD,BE BEL,BF BFA,BG BGR,BH BHR,BI BDI,BJ BEN,BL BLM,BM BMU,BN BRN,BO BOL,BQ BES,BR BRA,BS BHS,BT BTN,BW BWA,BY BLR,BZ BLZ,CA CAN,CC CCK,CD COD,CF CAF,CG COG,CH CHE,CI CIV,CK COK,CL CHL,CM CMR,CN CHN,CO COL,CR CRI,CU CUB,CV CPV,CW CUW,CX CXR,CY CYP,CZ CZE,DE DEU,DJ DJI,DK DNK,DM DMA,DO DOM,DZ DZA,EC ECU,EE EST,EG EGY,EH ESH,ER ERI,ES ESP,ET ETH,FI FIN,FJ FJI,FK FLK,FM FSM,FO FRO,FR FRA,GA GAB,GB GBR,GD GRD,GE GEO,GF GUF,GG GGY,GH GHA,GI GIB,GL GRL,GM GMB,GN GIN,GP GLP,GQ GNQ,GR GRC,GT GTM,GU GUM,GW GNB,GY GUY,HK HKG,HN HND,HR HRV,HT HTI,HU HUN,ID IDN,IE IRL,IL ISR,IM IMN,IN IND,IQ IRQ,IR IRN,IS ISL,IT ITA,JE JEY,JM JAM,JO JOR,JP JPN,KE KEN,KG KGZ,KH KHM,KI KIR,KM COM,KN KNA,KP PRK,KR KOR,KW KWT,KY CYM,KZ KAZ,LA LAO,LB LBN,LC LCA,LI LIE,LK LKA,LR LBR,LS LSO,LT LTU,LU LUX,LV LVA,LY LBY,MA MAR,MC MCO,MD MDA,ME MNE,MF MAF,MG MDG,MH MHL,MK MKD,ML MLI,MM MMR,MN MNG,MO MAC,MP MNP,MQ MTQ,MR MRT,MS MSR,MT MLT,MU MUS,MV MDV,MW MWI,MX MEX,MY MYS,MZ MOZ,NA NAM,NC NCL,NE NER,NF NFK,NG NGA,NI NIC,NL NLD,NO NOR,NP NPL,NR NRU,NU NIU,NZ NZL,OM OMN,PA PAN,PE PER,PF PYF,PG PNG,PH PHL,PK PAK,PL POL,PM SPM,PR PRI,PS PSE,PT PRT,PW PLW,PY PRY,QA QAT,RE REU,RO ROU,RS SRB,RU RUS,RW RWA,SA SAU,SB SLB,SC SYC,SD SDN,SE SWE,SG SGP,SH SHN,SI SVN,SK SVK,SL SLE,SM SMR,SN SEN,SO SOM,SR SUR,SS SSD,ST STP,SV SLV,SX SXM,SY SYR,SZ SWZ,TC TCA,TD TCD,TG TGO,TH THA,TJ TJK,TL TLS,TM TKM,TN TUN,TO TON,TR TUR,TT TTO,TV TUV,TW TWN,TZ TZA,UA UKR,UG UGA,US USA,UY URY,UZ UZB,VC VCT,VE VEN,VG VGB,VI VIR,VN VNM,VU VUT,WS WSM,YE YEM,YT MYT,ZA ZAF,ZM ZMB,ZW ZWE').split(',').map(s => s.split(' ')));
async function openBuildings(bb, revJ, signal) {
  const t0 = performance.now(); let cc = null;
  try { const j = await Promise.race([revJ, new Promise(r => setTimeout(r, 3000))]); cc = ISO3[String(j?.features?.[0]?.properties?.countrycode || '').toUpperCase()] || null; } catch { }
  if (!cc && bb.c.lat > -11.2 && bb.c.lat < 6.3 && bb.c.lon > 94.8 && bb.c.lon < 141.1) cc = 'IDN'; // tanpa geocoder: kotak Indonesia
  if (!cc) throw new Error('negara lokasi tidak dikenali');
  const r = await fgbBBox(OB_URL(cc), { minX: bb.w, minY: bb.s, maxX: bb.e, maxY: bb.n }, { signal, maxFeat: 12000 });
  r.ms = performance.now() - t0; r.cc = cc; return r;
}
const LAY = {
  'PETA-FOTO': { color: 8, lw: -3 }, 'SITE-BATAS': { color: 1, lw: 50, lt: 'PHANTOM' }, 'SITE-BANGUNAN': { color: 7, lw: 35 },
  'SITE-JALAN': { color: 8, lw: 25 }, 'SITE-AIR': { color: 5, lw: 25 }, 'SITE-HIJAU': { color: 3, lw: 18 },
  'SITE-DIMENSI': { color: 3, lw: 18 }, 'SITE-TEKS': { color: 7, lw: 25 }, 'SITE-KOORDINAT': { color: 6, lw: 18 }, 'SITE-SIMBOL': { color: 7, lw: 25 },
};
// garis dari alat Ukur: merah tebal; dimensinya merah tipis (garis ukuran = garis tipis, ISO 128)
const MLAY = { 'SITE-UKUR': { color: 1, lw: 50 }, 'SITE-UKUR-DIM': { color: 1, lw: 18 } };
// gaya dimensi ISO-25 (ISO 129-1): teks 2,5 mm sejajar & di atas garis ukuran (terbaca dari bawah / kanan), panah tertutup terisi 2,5 mm,
// garis bantu mulai 0,625 mm dari titik ukur & lewat 1,25 mm dari garis ukuran, desimal koma; teks yang tidak muat pindah ke perpanjangan garis ukuran
const ISO25 = { txt: 2.5, asz: 2.5, exo: 0.625, exe: 1.25, gap: 0.625, arrow: 'closed', sep: ',', dle: 0, tfit: 1 };
const MCOL = '#ff3b30'; // warna garis ukur di peta = warna hasil plot

function loadImg(url, tries = 2) {
  return new Promise(res => {
    let n = 0;
    const go = () => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => (++n < tries ? setTimeout(go, 250 * n) : res(null)); im.src = url; };
    go();
  });
}
async function pool(items, n, fn) { let i = 0; const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }; await Promise.all(Array.from({ length: Math.min(n, items.length) }, run)); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtM = (v, d = 2) => { const [a, b] = Math.abs(v).toFixed(d).split('.'); return (v < 0 ? '-' : '') + a.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (b ? ',' + b : ''); };

// ukuran bentuk (m, m²) dihitung di bidang ENU lokal
export function shapeMetrics(pts, closed) {
  if (!pts.length) return { edges: [], per: 0, area: 0 };
  const E = makeENU(pts[0].lat, pts[0].lon), q = pts.map(p => E.fwd(p.lat, p.lon)), edges = [];
  const m = closed ? q.length : q.length - 1;
  let per = 0; for (let i = 0; i < m; i++) { const a = q[i], b = q[(i + 1) % q.length], d = Math.hypot(b.e - a.e, b.n - a.n); edges.push(d); per += d; }
  let ar = 0; if (closed) for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; ar += a.e * b.n - b.e * a.n; }
  return { edges, per, area: Math.abs(ar) / 2, enu: q };
}

// ================= Peta interaktif =================
class GeoView {
  constructor(box, st, onChange) {
    this.box = box; this.onChange = onChange;
    this.cv = h('canvas', { tabindex: 0 }); box.append(this.cv);
    this.ctx = this.cv.getContext('2d');
    this.src = SRC[st.src] ? st.src : 'sat'; this.zoom = st.zoom ?? 17;
    const p = ll2px(st.lat ?? -6.2, st.lon ?? 106.82, 0); this.cx = p.x; this.cy = p.y;
    this.cache = new Map(); this.mode = 'pan'; this.shape = null; this.ptr = new Map(); this.mouse = null; this.marks = [];
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(box);
    this.bind(); this.resize();
  }
  destroy() { this.ro.disconnect(); this.dead = true; this.cache.clear(); }
  get W() { return this.box.clientWidth; } get H() { return this.box.clientHeight; }
  resize() { const d = devicePixelRatio || 1, W = Math.max(10, this.W), H = Math.max(10, this.H); this.cv.width = Math.round(W * d); this.cv.height = Math.round(H * d); this.draw(true); this.onChange?.(); }
  center() { return px2ll(this.cx, this.cy, 0); }
  // area yang sedang terlihat di peta sebagai seleksi persegi (dipakai Capture bila belum ada seleksi)
  viewShape() { const a = this.s2ll(0, 0), b = this.s2ll(this.W, this.H); return { kind: 'rect', auto: true, a, pts: [a, { lat: a.lat, lon: b.lon }, b, { lat: b.lat, lon: a.lon }] }; }
  ll2s(lat, lon) { const p = ll2px(lat, lon, this.zoom), k = 2 ** this.zoom; return { x: p.x - this.cx * k + this.W / 2, y: p.y - this.cy * k + this.H / 2 }; }
  s2ll(x, y) { const k = 2 ** this.zoom; return px2ll(this.cx * k + x - this.W / 2, this.cy * k + y - this.H / 2, this.zoom); }
  setView(lat, lon, zoom = this.zoom) { const p = ll2px(lat, lon, 0); this.cx = p.x; this.cy = p.y; this.zoom = clamp(zoom, 2, 22); this.draw(); this.onChange?.(); }
  fit(pts) {
    if (!pts.length) return;
    let n = -90, s = 90, e = -180, w = 180; for (const p of pts) { n = Math.max(n, p.lat); s = Math.min(s, p.lat); e = Math.max(e, p.lon); w = Math.min(w, p.lon); }
    let z = 21; for (; z > 3; z--) { const a = ll2px(n, w, z), b = ll2px(s, e, z); if (b.x - a.x < this.W * 0.8 && b.y - a.y < this.H * 0.8) break; }
    this.setView((n + s) / 2, (e + w) / 2, z);
  }
  zoomAt(sx, sy, nz) {
    const ll = this.s2ll(sx, sy); this.zoom = clamp(nz, 2, 22);
    const p = ll2px(ll.lat, ll.lon, this.zoom), k = 2 ** this.zoom;
    this.cx = (p.x - sx + this.W / 2) / k; this.cy = (p.y - sy + this.H / 2) / k; this.draw(); this.onChange?.();
  }
  tile(z, x, y, hd) {
    const S = SRC[this.src], key = `${this.src}/${z}/${x}/${y}/${hd}`;
    let t = this.cache.get(key);
    if (!t) {
      t = { st: 0 }; this.cache.set(key, t);
      if (this.cache.size > 900) { const it = this.cache.keys(); for (let i = 0; i < 200; i++) this.cache.delete(it.next().value); }
      loadImg(S.url(x, y, z, hd ? 2 : 1), 1).then(im => { t.img = im; t.st = im ? 1 : 2; if (!this.dead) this.draw(); });
    }
    return t;
  }
  draw(now) {
    if (this.dead) return;
    if (!now) { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(true); }); return; }
    const c = this.ctx, d = devicePixelRatio || 1, W = this.W, H = this.H, S = SRC[this.src];
    c.setTransform(d, 0, 0, d, 0, 0); c.fillStyle = '#d8dadd'; c.fillRect(0, 0, W, H);
    const zt = clamp(Math.round(this.zoom), 1, S.max), f = 2 ** (this.zoom - zt), ts = 256 * f, n = 2 ** zt, hd = S.ts === 2 && d > 1.3 ? 1 : 0;
    const left = this.cx * 2 ** this.zoom - W / 2, top = this.cy * 2 ** this.zoom - H / 2;
    const x0 = Math.floor(left / ts), x1 = Math.floor((left + W) / ts), y0 = Math.max(0, Math.floor(top / ts)), y1 = Math.min(n - 1, Math.floor((top + H) / ts));
    c.imageSmoothingQuality = 'high';
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const X = ((tx % n) + n) % n, dx = tx * ts - left, dy = ty * ts - top;
      const t = this.tile(zt, X, ty, hd);
      if (t.st === 1) { c.drawImage(t.img, dx, dy, ts + 0.5, ts + 0.5); continue; }
      for (let up = 1; up <= 5 && zt - up >= 0; up++) { // tile induk sebagai pengganti sementara
        const k = 2 ** up, P = this.cache.get(`${this.src}/${zt - up}/${X >> up}/${ty >> up}/${hd}`);
        if (P?.st === 1) { const sw = P.img.naturalWidth / k; c.drawImage(P.img, (X % k) * sw, (ty % k) * sw, sw, sw, dx, dy, ts + 0.5, ts + 0.5); break; }
      }
    }
    this.drawOverlay(c, W, H);
  }
  drawOverlay(c, W, H) {
    // penanda gambar CAD yang sudah bergeolokasi
    for (const m of this.marks) {
      if (m.poly) { c.beginPath(); m.poly.forEach((p, i) => { const s = this.ll2s(p.lat, p.lon); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.closePath(); c.setLineDash([6, 4]); c.strokeStyle = '#F2C94C'; c.lineWidth = 1.5; c.stroke(); c.setLineDash([]); }
      if (m.pt) { const s = this.ll2s(m.pt.lat, m.pt.lon); c.fillStyle = '#F2C94C'; c.beginPath(); c.arc(s.x, s.y, 4, 0, 7); c.fill(); }
    }
    if (this.hl) { // area otomatis (yang terlihat) yang akan / sedang di-capture
      c.save(); c.beginPath(); this.hl.pts.forEach((p, i) => { const s = this.ll2s(p.lat, p.lon); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y); }); c.closePath();
      c.fillStyle = 'rgba(47,140,255,.12)'; c.fill(); c.setLineDash([10, 6]); c.strokeStyle = '#2f8cff'; c.lineWidth = 4; c.stroke(); c.restore();
    }
    const S = this.shape;
    if (S && S.pts.length) {
      const P = S.pts.map(p => this.ll2s(p.lat, p.lon)), closed = S.kind === 'rect' || S.closed;
      c.beginPath(); P.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
      if (!closed && this.mouse && S.kind !== 'rect' && !S.done && this.mode === S.kind) c.lineTo(this.mouse.x, this.mouse.y);
      if (closed) { c.closePath(); c.fillStyle = S.kind === 'measure' ? 'rgba(255,59,48,.13)' : 'rgba(47,140,255,.16)'; c.fill(); }
      c.strokeStyle = S.kind === 'measure' ? MCOL : '#2f8cff'; c.lineWidth = 2.2; c.stroke();
      const M = shapeMetrics(S.pts, closed);
      c.font = '600 11px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      M.edges.forEach((L, i) => {
        const a = P[i], b = P[(i + 1) % P.length]; if (Math.hypot(b.x - a.x, b.y - a.y) < 46) return;
        const t = fmtM(L) + ' m', w = c.measureText(t).width + 10, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        c.fillStyle = 'rgba(20,26,34,.82)'; c.beginPath(); c.roundRect?.(mx - w / 2, my - 9, w, 18, 9); c.fill(); c.fillStyle = '#fff'; c.fillText(t, mx, my + 0.5);
      });
      P.forEach((p, i) => { c.fillStyle = '#fff'; c.strokeStyle = S.kind === 'measure' ? MCOL : '#2f8cff'; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, i === this.hotV ? 6.5 : 4.5, 0, 7); c.fill(); c.stroke(); });
    }
    // skala grafis
    const ll = this.center(), mpp = gsd(ll.lat, this.zoom);
    let L = 1; const nice = [1, 2, 5]; outer: for (let e = -1; e < 7; e++) for (const k of nice) { const v = k * 10 ** e; if (v / mpp > 70) { L = v; break outer; } }
    const bw = L / mpp; c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(10, H - 30, bw + 16, 22);
    c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(18, H - 22); c.lineTo(18, H - 14); c.lineTo(18 + bw, H - 14); c.lineTo(18 + bw, H - 22); c.stroke();
    c.fillStyle = '#111'; c.font = '600 10.5px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(L >= 1000 ? L / 1000 + ' km' : L + ' m', 18 + bw / 2, H - 22);
    c.textAlign = 'right'; c.fillStyle = 'rgba(255,255,255,.85)'; const at = this.src === 'esri' ? 'Citra © Esri, Maxar' : 'Peta © Google'; c.fillRect(W - c.measureText(at).width - 14, H - 18, c.measureText(at).width + 14, 18); c.fillStyle = '#333'; c.fillText(at, W - 7, H - 8);
  }
  bind() {
    const cv = this.cv, pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const vHit = p => { const S = this.shape; if (!S) return -1; for (let i = 0; i < S.pts.length; i++) { const s = this.ll2s(S.pts[i].lat, S.pts[i].lon); if (Math.hypot(s.x - p.x, s.y - p.y) < 9) return i; } return -1; };
    cv.addEventListener('pointerdown', e => {
      cv.focus(); cv.setPointerCapture(e.pointerId); const p = pos(e); this.ptr.set(e.pointerId, p);
      if (this.ptr.size === 2) { const [a, b] = [...this.ptr.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom }; this.drag = null; return; }
      const vi = e.button === 0 ? vHit(p) : -1;
      this.drag = { x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, vi, btn: e.button, tol: e.pointerType === 'touch' ? 10 : 6 };
      if (this.mode === 'rect' && e.button === 0 && vi < 0) { const ll = this.s2ll(p.x, p.y); this.shape = { kind: 'rect', a: ll, pts: [ll, ll, ll, ll] }; this.drag.rect = true; }
    });
    cv.addEventListener('pointermove', e => {
      const p = pos(e); this.mouse = p;
      if (this.ptr.has(e.pointerId)) this.ptr.set(e.pointerId, p);
      if (this.pinch && this.ptr.size === 2) { const [a, b] = [...this.ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y); this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, this.pinch.z + Math.log2(d / this.pinch.d)); return; }
      const D = this.drag;
      if (D) {
        if (Math.hypot(p.x - D.sx, p.y - D.sy) > D.tol) D.moved = true; // klik di trackpad/layar sentuh sering bergeser beberapa px
        if (D.rect) { const b = this.s2ll(p.x, p.y), a = this.shape.a; this.shape.pts = [a, { lat: a.lat, lon: b.lon }, b, { lat: b.lat, lon: a.lon }]; this.onChange?.(); }
        else if (D.vi >= 0 && this.shape) {
          const ll = this.s2ll(p.x, p.y), S = this.shape;
          if (S.kind === 'rect') { const o = S.pts[(D.vi + 2) % 4]; S.pts = [o, { lat: o.lat, lon: ll.lon }, ll, { lat: ll.lat, lon: o.lon }]; D.vi = 2; } else S.pts[D.vi] = ll;
          this.onChange?.();
        } else if (D.moved) { const k = 2 ** this.zoom; this.cx -= (p.x - D.x) / k; this.cy -= (p.y - D.y) / k; this.onChange?.(); }
        D.x = p.x; D.y = p.y;
      } else { const vi = vHit(p); if (vi !== this.hotV) { this.hotV = vi; } cv.style.cursor = vi >= 0 ? 'move' : this.mode === 'pan' ? 'grab' : 'crosshair'; }
      this.draw(); this.onMove?.(this.s2ll(p.x, p.y));
    });
    const up = e => {
      this.ptr.delete(e.pointerId); if (this.ptr.size < 2) this.pinch = null;
      const D = this.drag; this.drag = null; if (!D) return;
      const p = pos(e);
      if (D.rect) { const M = shapeMetrics(this.shape.pts, true); if (M.area < 1) this.shape = null; this.onChange?.(); this.draw(); return; }
      if (!D.moved && D.btn === 0 && D.vi < 0 && (this.mode === 'poly' || this.mode === 'measure')) {
        const ll = this.s2ll(p.x, p.y);
        if (!this.shape || this.shape.kind !== this.mode || this.shape.closed || this.shape.done) this.shape = { kind: this.mode, pts: [] }; // ukur yang sudah selesai → ukur baru
        const S = this.shape;
        if (S.pts.length >= 3) { const f = this.ll2s(S.pts[0].lat, S.pts[0].lon); if (Math.hypot(f.x - p.x, f.y - p.y) < 10) { S.closed = true; this.onChange?.(); this.draw(); return; } }
        S.pts.push(ll); this.onChange?.(); this.draw();
      } else if (!D.moved && D.vi === 0 && this.shape && !this.shape.closed && this.shape.pts.length >= 3 && this.mode !== 'rect') { this.shape.closed = true; this.onChange?.(); this.draw(); }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.mouse = null; this.draw(); });
    cv.addEventListener('dblclick', e => {
      e.preventDefault(); const p = pos(e);
      if ((this.mode === 'poly' || this.mode === 'measure') && this.shape && !this.shape.closed) {
        const S = this.shape, n = S.pts.length;
        if (n > 1) { // buang titik ganda dari klik kedua saja; biasanya klik kedua mengenai titik barunya (geser titik), jadi tidak ada titik ganda
          const a = this.ll2s(S.pts[n - 1].lat, S.pts[n - 1].lon), b = this.ll2s(S.pts[n - 2].lat, S.pts[n - 2].lon);
          if (Math.hypot(a.x - b.x, a.y - b.y) < 4) S.pts.pop();
        }
        if (this.mode === 'poly' && S.pts.length >= 3) S.closed = true; else if (this.mode === 'measure') S.done = true;
        this.onChange?.(); this.draw(); return;
      }
      this.zoomAt(p.x, p.y, Math.round(this.zoom) + 1);
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); const dz = -e.deltaY * (e.deltaMode ? 0.05 : e.ctrlKey ? 0.012 : 0.0028); this.zoomAt(p.x, p.y, this.zoom + clamp(dz, -1, 1)); }, { passive: false });
    cv.addEventListener('keydown', e => {
      const S = this.shape;
      if (e.key === 'Escape' && S && !S.closed && S.kind !== 'rect' && S.pts.length) { e.stopPropagation(); this.shape = null; this.onChange?.(); this.draw(); return; }
      if (e.key === 'Enter' && S && !S.closed && S.pts.length >= 3 && S.kind === 'poly') { S.closed = true; this.onChange?.(); this.draw(); }
      if (e.key === 'Enter' && S && !S.closed && S.pts.length >= 2 && S.kind === 'measure') { S.done = true; this.onChange?.(); this.draw(); }
      if (e.key === 'Backspace' && S && !S.closed && S.pts.length) { S.pts.pop(); S.done = false; this.onChange?.(); this.draw(); }
      const k = 2 ** this.zoom, st = 80 / k;
      if (e.key === '+' || e.key === '=') this.zoomAt(this.W / 2, this.H / 2, this.zoom + 1);
      if (e.key === '-') this.zoomAt(this.W / 2, this.H / 2, this.zoom - 1);
      if (e.key.startsWith('Arrow')) { e.preventDefault(); if (e.key === 'ArrowLeft') this.cx -= st; if (e.key === 'ArrowRight') this.cx += st; if (e.key === 'ArrowUp') this.cy -= st; if (e.key === 'ArrowDown') this.cy += st; this.draw(); this.onChange?.(); }
    });
  }
}

// ================= Panel =================
export function openGeoMap(app, opt = {}) {
  const ed = app.ed, doc = app.doc;
  const saved = LS.get('amatucad-geomap', { lat: -6.1754, lon: 106.8272, zoom: 16, src: 'sat' });
  const o = Object.assign({ photo: 'sat', bld: true, obData: true, snap: true, road: true, water: true, green: true, boundary: true, meas: true, dims: true, table: true, notes: true, coord: 'utm', detail: 'std', dec: 2 }, LS.get('amatucad-geomap-opt', {}));
  const geo = doc.geo;
  const mapBox = h('div', { class: 'gm-map' });
  const info = h('div', { class: 'gm-info hint' });
  const coordEl = h('div', { class: 'gm-coord' });
  let view;
  const status = h('div', { class: 'gm-status hint' }), bar = h('div', { class: 'gm-bar' }, h('i')), log = h('div', { class: 'gm-log' });
  const setProg = (t, f) => { status.textContent = t; bar.style.display = f == null ? 'none' : ''; if (f != null) bar.firstChild.style.width = Math.round(f * 100) + '%'; };
  // --- cari ---
  const q = h('input', { class: 'gm-q', placeholder: 'Cari tempat, alamat, koordinat (-6.2, 106.8) atau tempel link Google Maps…', autocomplete: 'off' });
  const res = h('div', { class: 'gm-res', hidden: true });
  const go = async () => {
    const s = q.value.trim(); if (!s) return;
    const p = parseLoc(s);
    if (p) { res.hidden = true; view.setView(p.lat, p.lon, Math.max(p.zoom, 17)); view.marks = view.marks.filter(m => !m.search).concat({ search: 1, pt: p }); view.draw(); return; }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(s)) { toast('Link pendek Google Maps tidak bisa dibaca dari web. Buka linknya, lalu salin URL lengkap dari address bar (yang berisi @lat,lng).', 6000); return; }
    res.hidden = false; res.innerHTML = ''; res.append(h('div', { class: 'hint' }, 'Mencari…'));
    try {
      const c = view.center();
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(s)}&limit=7&lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`).then(x => x.json());
      res.innerHTML = '';
      const F = r.features || [];
      if (!F.length) res.append(h('div', { class: 'hint' }, 'Tidak ditemukan. Coba tempel link/koordinat dari Google Maps.'));
      for (const f of F) {
        const P = f.properties, [lon, lat] = f.geometry.coordinates, nm = P.name || P.street || '';
        res.append(h('div', { onclick: () => { res.hidden = true; q.value = nm; if (P.extent) view.fit([{ lat: P.extent[1], lon: P.extent[0] }, { lat: P.extent[3], lon: P.extent[2] }]); else view.setView(lat, lon, 18); view.marks = view.marks.filter(m => !m.search).concat({ search: 1, pt: { lat, lon } }); view.draw(); } },
          h('b', {}, nm), h('small', {}, [P.street && P.name !== P.street ? P.street : '', P.district, P.city, P.state, P.country].filter(Boolean).join(', '))));
      }
    } catch { res.innerHTML = ''; res.append(h('div', { class: 'hint' }, 'Pencarian gagal (offline?). Tempel koordinat atau link Google Maps.')); }
  };
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } if (e.key === 'Escape' && !res.hidden) { e.stopPropagation(); res.hidden = true; } });
  // --- lapisan & alat ---
  const segBtns = (items, cur, fn) => { const box = h('div', { class: 'gm-seg' }); const draw = v => { box.innerHTML = ''; items.forEach(([k, l, i]) => box.append(h('button', { class: k === v ? 'on' : '', title: l, onclick: () => { fn(k); draw(k); } }, i ? h('span', { html: icon(i) }) : null, l))); }; draw(cur); return { box, draw }; };
  const layerSeg = segBtns(Object.entries(SRC).map(([k, s]) => [k, s.n]), saved.src, k => { view.src = k; view.draw(); persist(); });
  const toolSeg = segBtns([['pan', 'Geser', 'pan'], ['rect', 'Area persegi', 'rect'], ['poly', 'Batas lahan', 'area'], ['measure', 'Ukur', 'dist']], opt.mode || 'pan', k => setMode(k));
  const setMode = k => { view.mode = k; view.cv.style.cursor = k === 'pan' ? 'grab' : 'crosshair'; toolSeg.draw(k); hintTool(); };
  const toolHint = h('div', { class: 'gm-tip' });
  const hintTool = () => { toolHint.textContent = { pan: 'Seret untuk menggeser, scroll / pinch untuk zoom. Capture tanpa seleksi = area yang terlihat.', rect: 'Seret untuk membuat area capture. Titik sudut bisa digeser.', poly: 'Klik titik-titik batas lahan; klik titik pertama / klik ganda / Enter untuk menutup (Capture juga menutup otomatis). Backspace = hapus titik terakhir. Titik bisa digeser.', measure: 'Klik titik-titik untuk mengukur; klik ganda / Enter = selesai, klik titik pertama = area tertutup. Capture memplot garis ukur merah + dimensi ISO.' }[view.mode]; };
  const persist = () => { const c = view.center(); LS.set('amatucad-geomap', { lat: c.lat, lon: c.lon, zoom: view.zoom, src: view.src }); };
  // --- opsi ---
  const O = (k, l) => chk(l, o[k], v => { o[k] = v; LS.set('amatucad-geomap-opt', o); updInfo(); });
  const photoSel = sel([['sat', 'Satelit (Google)'], ['hyb', 'Hybrid (satelit + nama jalan)'], ['map', 'Peta jalan (Google)'], ['esri', 'Satelit (Esri, cadangan)'], ['none', '— tanpa foto —']], o.photo, v => { o.photo = v; LS.set('amatucad-geomap-opt', o); updInfo(); });
  const detSel = sel([['std', 'Standar (cepat)'], ['high', 'Tinggi (detail maksimum)']], o.detail, v => { o.detail = v; LS.set('amatucad-geomap-opt', o); updInfo(); });
  const coordSel = sel([['utm', 'UTM (WGS84)'], ['tm3', 'TM-3° (BPN)'], ['ll', 'Geografis (lintang/bujur)']], o.coord, v => { o.coord = v; LS.set('amatucad-geomap-opt', o); });
  const decSel = sel([['2', 'meter, 2 desimal (cm)'], ['3', 'meter, 3 desimal (mm)']], String(o.dec), v => { o.dec = +v; LS.set('amatucad-geomap-opt', o); });
  let busy = false;
  const capLbl = h('span', {}, ' Capture & plot ke gambar');
  const btnCap = h('button', { class: 'btn pri gm-go', onclick: () => doCapture() }, h('span', { html: icon('capture') }), capLbl);
  // saat tombol disentuh, sorot area yang akan di-capture (tanpa seleksi = seluruh peta; batas lahan / garis ukur = kotak + margin)
  btnCap.addEventListener('pointerenter', () => { if (!view || busy) return; const S = capShape(); view.hl = S.auto ? S : boxShape(capBox(S)); view.draw(); });
  btnCap.addEventListener('pointerleave', () => { if (view && !busy && view.hl) { view.hl = null; view.draw(); } });
  // garis ukur saja (tanpa unduh foto / tracing): untuk gambar yang fotonya sudah diplot, koordinat menyambung lewat lokasi gambar
  const btnMeas = h('button', { class: 'btn gm-meas', style: { display: 'none' }, title: 'Hanya garis ukur merah + dimensi ISO (dan luas bila tertutup) yang diplot, tanpa foto & tracing baru. Posisinya pas dengan foto yang sudah ada karena memakai lokasi geografis gambar.', onclick: () => doCapture({ only: true }) }, h('span', { html: icon('dist') }), ' Plot garis ukur saja (tanpa foto baru)');
  const geoNote = h('div', { class: 'note', style: { display: geo ? '' : 'none' } }, 'Gambar ini sudah punya lokasi geografis — capture baru otomatis menyambung (koordinat sama).', h('br'), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => { if (confirm('Hapus lokasi geografis gambar ini? Capture berikutnya akan memakai titik acuan baru.')) { app.mutate(() => { doc.geo = null; }); geoNote.style.display = 'none'; view.marks = []; view.draw(); } } }, 'Reset lokasi'));
  const side = h('div', { class: 'gm-side' },
    h('fieldset', {}, h('legend', {}, 'Area terpilih'), info),
    h('fieldset', {}, h('legend', {}, 'Isi yang diplot'), h('div', { class: 'col' },
      h('div', { class: 'grid2' }, 'Foto peta:', photoSel, 'Detail:', detSel),
      O('bld', 'Tracing bangunan'),
      Object.assign(O('obData', '+ Data bangunan terbuka (lebih lengkap)'), { title: 'Jejak bangunan Google Open Buildings + Microsoft + OSM (gabungan VIDA, source.coop): rumah yang tidak ada di peta Google ikut tergambar. Hanya bagian area ini yang diunduh (beberapa ratus KB).' }),
      Object.assign(O('snap', 'Selaraskan garis ke foto satelit'), { title: 'Garis bangunan, jalan & air digeser / diputar sedikit agar pas dengan tepi atap & jalan di foto satelit yang diplot (data peta umumnya bergeser 1–4 m dari foto).' }),
      O('road', 'Tracing tepi jalan'), O('water', 'Tracing sungai / air'), O('green', 'Tracing taman / area hijau'),
      O('boundary', 'Batas lahan (poligon) + ukuran riil & luas'),
      Object.assign(O('meas', 'Garis ukur (merah) + dimensi ISO'), { title: 'Garis dari alat Ukur diplot merah (layer SITE-UKUR); tiap segmen diberi dimensi aligned gaya ISO 129-1 / ISO-25 (layer SITE-UKUR-DIM): panah tertutup 2,5 mm, teks 2,5 mm sejajar di atas garis ukuran, garis bantu 0,625 / 1,25 mm, desimal koma. Garis ukur tertutup ikut diberi luas & keliling.' }),
      O('table', 'Tabel koordinat titik batas'), O('notes', 'Arah utara, skala grafis & keterangan'))),
    h('fieldset', {}, h('legend', {}, 'Ukuran & koordinat'), h('div', { class: 'grid2' }, 'Format ukuran:', decSel, 'Tabel koordinat:', coordSel)),
    geoNote, btnCap, btnMeas, h('div', {}, status, bar), log,
    h('div', { class: 'hint' }, 'Skala dihitung eksak dari elipsoid WGS84 (bukan skala tampilan), galat matematis < 1 mm. Akurasi posisi mengikuti data Google (umumnya 0,5–3 m); untuk legal/sertifikat tetap perlu ukur lapangan.'));
  const top = h('div', { class: 'gm-top' },
    h('div', { class: 'gm-search' }, h('span', { html: icon('find') }), q, h('button', { class: 'btn sm', onclick: go }, 'Cari'), res),
    layerSeg.box,
    h('button', { class: 'btn sm', title: 'Lokasi saya (GPS)', onclick: () => navigator.geolocation?.getCurrentPosition(p => { view.setView(p.coords.latitude, p.coords.longitude, 18); view.marks = view.marks.filter(m => !m.search).concat({ search: 1, pt: { lat: p.coords.latitude, lon: p.coords.longitude } }); view.draw(); }, () => toast('Lokasi tidak diizinkan / tidak tersedia.')) }, '◎ Lokasi saya'),
    h('button', { class: 'btn sm', title: 'Buka lokasi ini di Google Maps (tab baru). Salin link dari sana lalu tempel di kotak cari untuk kembali.', onclick: () => { const c = view.center(); window.open(gmapsUrl(c.lat, c.lon, view.zoom, view.src !== 'map'), '_blank', 'noopener'); } }, h('span', { html: icon('map') }), ' Buka di Google Maps'));
  const body = h('div', { class: 'gm' }, top, h('div', { class: 'gm-tools' }, toolSeg.box, toolHint, h('button', { class: 'btn sm', onclick: () => { view.shape = null; view.draw(); updInfo(); } }, 'Hapus seleksi')), h('div', { class: 'gm-body' }, h('div', { class: 'gm-mapwrap' }, mapBox, coordEl), side));
  const w = win({ title: 'Google Maps — Lokasi & Site Plan', body, id: 'geomap', width: Math.min(1500, innerWidth - 16), height: Math.min(980, innerHeight - 16), onClose: () => { persist(); view?.destroy(); } });
  w.el.classList.add('gm-win');
  view = new GeoView(mapBox, saved, () => updInfo());
  app.geoView = view; // hook debug
  view.onMove = ll => { coordEl.textContent = `${fmtLat(ll.lat)}  ${fmtLon(ll.lon)}  ·  ${ll.lat.toFixed(6)}, ${ll.lon.toFixed(6)}  ·  zoom ${view.zoom.toFixed(1)}`; };
  // tampilkan lokasi gambar yang sudah bergeolokasi
  if (geo) {
    const X = geoXform(geo), ext = doc.extents(doc.model);
    view.marks.push({ pt: { lat: geo.lat, lon: geo.lon } });
    if (isFinite(ext.x1)) { const poly = [[ext.x1, ext.y1], [ext.x2, ext.y1], [ext.x2, ext.y2], [ext.x1, ext.y2]].map(([x, y]) => X.toGeo(x, y)); view.marks.push({ poly }); if (!opt.keepView) view.fit(poly); }
  }
  setMode(opt.mode || 'pan');
  // yang di-capture: seleksi yang ada; batas lahan ≥ 3 titik yang belum ditutup (ditutup otomatis saat Capture);
  // garis ukur ≥ 2 titik (kotak garis + margin, agar foto pasti menutupi garisnya);
  // tanpa seleksi (atau baru 1–2 titik) = area yang sedang terlihat di peta, jadi tombol Capture selalu jalan
  function capShape() {
    const S = view.shape;
    if (S && (S.kind === 'rect' || (S.pts.length >= 3 && (S.closed || S.kind === 'poly')) || (S.kind === 'measure' && S.pts.length >= 2))) return S;
    return view.viewShape();
  }
  function measShape() { const S = view?.shape; return S && S.kind === 'measure' && S.pts.length >= 2 ? S : null; }
  function updInfo() {
    if (!view) return;
    const S0 = view.shape, S = capShape(), MS = measShape(), withM = !!MS && o.meas !== false; info.innerHTML = '';
    btnCap.disabled = busy; btnMeas.disabled = busy; btnMeas.style.display = MS ? '' : 'none';
    capLbl.textContent = withM ? ' Capture & plot peta + garis ukur' : ' Capture & plot ke gambar';
    if (S0?.kind === 'measure' && S0.pts.length) {
      const M = shapeMetrics(S0.pts, !!S0.closed);
      info.append(h('div', {}, h('b', {}, `Garis ukur · ${M.edges.length} segmen${S0.closed ? ' (tertutup)' : ''}`)), h('div', {}, `Panjang total: ${fmtM(M.per, 3)} m`), S0.closed ? h('div', {}, `Luas: ${fmtM(M.area)} m²`) : '');
    }
    if (S.auto) {
      info.append(h('div', {}, h('b', {}, 'Otomatis: area yang terlihat di peta')));
      if (S0?.kind === 'poly' && S0.pts.length) info.append(h('div', { class: 'hint' }, `Batas lahan baru ${S0.pts.length} titik (minimal 3), jadi belum dipakai.`));
    } else if (S.kind !== 'measure') {
      const M = shapeMetrics(S.pts, true);
      info.append(h('div', {}, h('b', {}, S.kind === 'rect' ? 'Area persegi' : `Batas lahan · ${S.pts.length} titik${S.closed ? '' : ' (ditutup otomatis saat Capture)'}`)),
        h('div', {}, `Luas: ${fmtM(M.area)} m²  ·  Keliling: ${fmtM(M.per)} m`));
    }
    const bb = capBox(S), E = makeENU(bb.c.lat, bb.c.lon), sw = E.fwd(bb.s, bb.w), ne = E.fwd(bb.n, bb.e);
    const Wm = ne.e - sw.e, Hm = ne.n - sw.n;
    info.append(h('div', {}, `Area capture: ${fmtM(Wm, 1)} × ${fmtM(Hm, 1)} m${S.kind === 'measure' ? ' (garis ukur + margin)' : ''}`));
    const z = pickZoom(bb, o.photo === 'none' ? 21 : SRC[o.photo].max, o.photo === 'none' ? 1 : SRC[o.photo].ts, maxPx(o));
    if (o.photo !== 'none') info.append(h('div', {}, `Foto: zoom ${z} · ${fmtM(gsd(bb.c.lat, z) * 100, 1)} cm/piksel`));
    const zt = pickZoom(bb, o.detail === 'high' ? 21 : 20, 2, maxPx(o));
    if (o.bld || o.road || o.water || o.green) info.append(h('div', {}, `Tracing: zoom ${zt} · ${fmtM(gsd(bb.c.lat, zt, 2) * 100, 1)} cm/piksel`));
    const tooBig = Math.max(Wm, Hm) > MAXCAP;
    if (tooBig) info.append(h('div', { style: { color: 'var(--warn)' } }, `Terlalu luas untuk Capture (maks. ${MAXCAP / 1000} km). Perbesar peta (zoom in) dulu.`));
    else if (Wm > 3000 || Hm > 3000) info.append(h('div', { style: { color: 'var(--warn)' } }, 'Area sangat luas — detail dikurangi otomatis agar memori cukup.'));
    if (S.auto && !tooBig) info.append(h('div', { class: 'hint' }, 'Tekan Capture untuk langsung memplot area ini. Untuk area tertentu pakai Area persegi; untuk ukuran, luas & tabel koordinat lahan pakai Batas lahan.'));
    if (MS) info.append(h('div', { class: 'hint' }, withM ? 'Capture memplot foto peta + garis ukur merah + dimensi ISO tiap segmen. Foto sudah ada di gambar? Pakai “Plot garis ukur saja”.' : 'Opsi “Garis ukur (merah) + dimensi ISO” mati: Capture hanya memplot peta.'));
  }
  function capBox(S) {
    let n = -90, s = 90, e = -180, ww = 180; for (const p of S.pts) { n = Math.max(n, p.lat); s = Math.min(s, p.lat); e = Math.max(e, p.lon); ww = Math.min(ww, p.lon); }
    if (S.kind !== 'rect') { // margin sekitar batas lahan: 15% atau ≥ 12 m
      const c = { lat: (n + s) / 2, lon: (e + ww) / 2 }, E = makeENU(c.lat, c.lon), a = E.fwd(s, ww), b = E.fwd(n, e), m = Math.max(12, 0.15 * Math.max(b.e - a.e, b.n - a.n));
      const p1 = E.inv(a.e - m, a.n - m), p2 = E.inv(b.e + m, b.n + m); s = p1.lat; ww = p1.lon; n = p2.lat; e = p2.lon;
    }
    return { n, s, e, w: ww, c: { lat: (n + s) / 2, lon: (e + ww) / 2 } };
  }
  // only: hanya garis ukur + dimensi (tanpa foto / tracing / anotasi baru)
  async function doCapture({ only = false } = {}) {
    if (busy || !view) return;
    const MS = measShape(); if (only && !MS) return;
    const S = only ? MS : capShape(), closing = S.kind === 'poly' && !S.closed;
    const L = (t, cls) => { log.append(h('div', { class: cls || '' }, t)); log.scrollTop = 1e9; };
    const box = capBox(S), E = makeENU(box.c.lat, box.c.lon), a = E.fwd(box.s, box.w), b = E.fwd(box.n, box.e), Wm = b.e - a.e, Hm = b.n - a.n;
    log.innerHTML = '';
    if (!only && !(Wm > 0.5 && Hm > 0.5 && Math.max(Wm, Hm) <= MAXCAP)) { // peta di-zoom-out terlalu jauh: tile & memori tidak cukup
      const t = `Area terlalu luas untuk di-capture (${fmtM(Wm / 1000, 1)} × ${fmtM(Hm / 1000, 1)} km). Perbesar peta (zoom in) atau buat Area persegi yang lebih kecil, lalu Capture lagi.`;
      setProg('', null); L(t, 'err'); toast(t, 6000); return;
    }
    if (closing) S.closed = true;
    busy = true; btnCap.disabled = true; btnMeas.disabled = true;
    view.hl = S.auto ? S : boxShape(box); view.draw();
    if (S.auto) L(`Tanpa seleksi → area yang terlihat di peta di-capture (${fmtM(Wm, 1)} × ${fmtM(Hm, 1)} m).`);
    if (closing) L(`Batas lahan ditutup otomatis (${S.pts.length} titik).`);
    const meas = MS && (only || o.meas !== false) ? MS : null;
    const oo = only ? { ...o, photo: 'none', bld: false, obData: false, road: false, water: false, green: false, boundary: false, table: false, notes: false } : o;
    try {
      const r = await capture(app, { shape: S, box, o: oo, meas, only, setProg, L });
      setProg('Selesai ✓', null);
      L(r.summary, 'ok');
      toast(only ? 'Garis ukur + dimensi ISO diplot ke gambar ✓' : meas ? 'Peta + garis ukur merah diplot ke gambar dengan skala riil ✓' : 'Peta diplot ke gambar dengan skala riil ✓');
      w.close(); app.ui.refresh();
      if (only && r.mbox && !ed.layout) ed.zoomRect(r.mbox, 1.25); else ed.zoomExtents();
    } catch (e) { console.error(e); setProg('Gagal: ' + (e.message || e), null); L(String(e.message || e), 'err'); }
    finally { busy = false; if (!w.closed) { view.hl = null; view.draw(); updInfo(); } }
  }
  updInfo(); hintTool();
  setTimeout(() => (opt.mode && opt.mode !== 'pan' ? view.cv : q).focus(), 60);
  return w;
}
const boxShape = bb => ({ kind: 'rect', pts: [{ lat: bb.n, lon: bb.w }, { lat: bb.n, lon: bb.e }, { lat: bb.s, lon: bb.e }, { lat: bb.s, lon: bb.w }] });

// ================= Garis ukur → polyline merah + dimensi ISO =================
// titik di dalam poligon yang paling jauh dari tepinya (label luas tetap di dalam walau bentuknya cekung / huruf L, U…)
function labelPt(P) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const p of P) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  const inside = (x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  const clr = (x, y) => { let d = Infinity; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], dx = b.x - a.x, dy = b.y - a.y, t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1e-12), 0, 1); d = Math.min(d, Math.hypot(x - a.x - t * dx, y - a.y - t * dy)); } return inside(x, y) ? d : -d; };
  let st = Math.max(x2 - x1, y2 - y1) / 40, best = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, bd = clr(best.x, best.y);
  for (let y = y1 + st / 2; y < y2; y += st) for (let x = x1 + st / 2; x < x2; x += st) { const d = clr(x, y); if (d > bd) { bd = d; best = { x, y }; } }
  for (let it = 0; it < 5; it++) { st /= 3; const b0 = best; for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const x = b0.x + i * st, y = b0.y + j * st, d = clr(x, y); if (d > bd) { bd = d; best = { x, y }; } } }
  return best;
}
// meas: {pts:[{lat,lon}], closed}; X: geoXform gambar; ps: unit gambar per mm kertas (skala anotasi)
export function measureEnts(meas, X, ps, o, units) {
  const out = [], E = e => { out.push({ color: 256, lt: 'ByLayer', lw: -1, ...e }); return e; }, dec = o.dec || 2;
  let P = [], LL = [];
  for (const q of meas.pts) { const p = X.toDwg(q.lat, q.lon), l = P[P.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 1e-6) { P.push(p); LL.push(q); } } // titik ganda (klik ganda) dibuang
  if (P.length > 2 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) < 1e-6) { P.pop(); LL.pop(); }
  const closed = !!meas.closed && P.length >= 3;
  if (P.length < 2) return { ents: out, n: 0 };
  const Mx = shapeMetrics(LL, closed); // jarak & luas riil (bidang ENU), sama dengan panel peta
  E({ type: 'pline', pts: P.map(q => ({ x: q.x, y: q.y, b: 0 })), closed, layer: 'SITE-UKUR' });
  // sisi dimensi: luar poligon (garis terbuka: sisi cembung lintasannya; garis lurus: atas / kiri)
  let ar = 0, d2 = 0; for (let i = 0; i < P.length; i++) { const u = P[i], v = P[(i + 1) % P.length]; ar += u.x * v.y - v.x * u.y; d2 = Math.max(d2, (u.x - P[0].x) ** 2 + (u.y - P[0].y) ** 2); }
  const sg = Math.abs(ar) < 1e-9 * d2 ? 0 : Math.sign(ar), off = 7 * ps;
  const ds = { ...ISO25, scale: ps, lfac: (UNIT_MM[units] || 1) / 1000, dec, suffix: ' m' };
  const m = closed ? P.length : P.length - 1;
  let lg = null; // segmen terpanjang (untuk label panjang total garis terbuka)
  for (let i = 0; i < m; i++) {
    const p1 = P[i], p2 = P[(i + 1) % P.length], dx = p2.x - p1.x, dy = p2.y - p1.y, l = Math.hypot(dx, dy); if (l < 1e-6) continue;
    let nx = dy / l, ny = -dx / l; // kanan arah lintasan = luar untuk poligon CCW
    if (sg < 0 || (sg === 0 && (ny < -1e-9 || (Math.abs(ny) <= 1e-9 && nx > 0)))) { nx = -nx; ny = -ny; }
    E({ type: 'dim', kind: 'ali', p1: { ...p1 }, p2: { ...p2 }, dl: { x: p1.x + nx * off, y: p1.y + ny * off }, ds, layer: 'SITE-UKUR-DIM' });
    if (!lg || l > lg.l) lg = { p1, p2, l, nx, ny };
  }
  if (closed) { // luas & keliling di dalam area
    const c = labelPt(P);
    E({ type: 'text', p: { x: c.x, y: c.y + 2.2 * ps }, s: `LUAS = ${fmtM(Mx.area)} m²`, h: 3 * ps, ha: 1, va: 2, rot: 0, layer: 'SITE-UKUR', lw: 35 });
    E({ type: 'text', p: { x: c.x, y: c.y - 2.6 * ps }, s: `KELILING = ${fmtM(Mx.per, dec)} m`, h: 2.2 * ps, ha: 1, va: 2, rot: 0, layer: 'SITE-UKUR' });
  } else if (m > 1 && lg) { // panjang total: sejajar segmen terpanjang, di sisi dalam (berlawanan dengan dimensinya), jadi tetap di dalam jangkauan garis
    let rot = Math.atan2(lg.p2.y - lg.p1.y, lg.p2.x - lg.p1.x); if (rot > Math.PI / 2 + 1e-6 || rot <= -Math.PI / 2 + 1e-6) rot += rot > 0 ? -Math.PI : Math.PI; // terbaca dari bawah / kanan
    const upx = -Math.sin(rot), upy = Math.cos(rot), inward = upx * -lg.nx + upy * -lg.ny > 0; // arah "atas" teks menjauhi garis?
    const g = 1.5 * ps, c = { x: (lg.p1.x + lg.p2.x) / 2 - lg.nx * g, y: (lg.p1.y + lg.p2.y) / 2 - lg.ny * g };
    E({ type: 'text', p: c, s: `PANJANG TOTAL = ${fmtM(Mx.per, dec)} m`, h: 2.5 * ps, ha: 1, va: inward ? 1 : 3, rot, layer: 'SITE-UKUR' });
  }
  return { ents: out, n: m, per: Mx.per, area: closed ? Mx.area : null, closed };
}
const maxPx = o => o.detail === 'high' ? (navigator.maxTouchPoints > 0 ? 4096 : 6144) : 4096;
const MAXCAP = 25000; // sisi area capture terpanjang (m); lebih luas → tile zoom ≤ 12 & kanvas terlalu besar
function pickZoom(bb, maxZ, ts, lim) { for (let z = maxZ; z > 12; z--) { const a = ll2px(bb.n, bb.w, z), b = ll2px(bb.s, bb.e, z); if ((b.x - a.x) * ts <= lim && (b.y - a.y) * ts <= lim) return z; } return 12; }
function mosaic(bb, z, ts) {
  const a = ll2px(bb.n, bb.w, z), b = ll2px(bb.s, bb.e, z);
  const X0 = Math.floor(a.x), Y0 = Math.floor(a.y), X1 = Math.ceil(b.x), Y1 = Math.ceil(b.y), tiles = [];
  for (let ty = Math.floor(Y0 / 256); ty <= Math.floor((Y1 - 1) / 256); ty++) for (let tx = Math.floor(X0 / 256); tx <= Math.floor((X1 - 1) / 256); tx++) tiles.push({ tx, ty, dx: (tx * 256 - X0) * ts, dy: (ty * 256 - Y0) * ts });
  return { z, ts, X0, Y0, X1, Y1, W: (X1 - X0) * ts, H: (Y1 - Y0) * ts, tiles, toLL: (x, y) => px2ll(X0 + x / ts, Y0 + y / ts, z) };
}
function solve3(A, b) { // eliminasi Gauss 3×3
  const m = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < 3; i++) { let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k; [m[i], m[p]] = [m[p], m[i]]; for (let k = i + 1; k < 3; k++) { const f = m[k][i] / m[i][i]; for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j]; } }
  const x = [0, 0, 0]; for (let i = 2; i >= 0; i--) { let s = m[i][3]; for (let j = i + 1; j < 3; j++) s -= m[i][j] * x[j]; x[i] = s / m[i][i]; } return x;
}
const blobURL = c => new Promise(r => c.toBlob(b => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }, 'image/jpeg', 0.88));

// Bangunan: data terbuka (per rumah) + trace peta Google → diselaraskan ke tepi atap di foto satelit
// (geser global + per bangunan + per sisi, di worker) → duplikat / tumpang tindih dibuang.
// Garis jalan/air/hijau peta Google ikut dikoreksi geser registrasi peta Google terhadap foto, lalu dipotong ulang ke area.
async function alignStep({ wk, msg, M, gB, gL, photo, obP, box, o, setProg, L }) {
  const snap = o.snap !== false && !!photo && photo.src !== 'map';
  const F = snap ? photo.M : M; // bingkai piksel kerja: foto (bila diselaraskan) atau mosaik trace
  const toF = (lat, lon) => { const q = ll2px(lat, lon, F.z); return [(q.x - F.X0) * F.ts, (q.y - F.Y0) * F.ts]; };
  const fromF = (x, y) => px2ll(F.X0 + x / F.ts, F.Y0 + y / F.ts, F.z);
  const conv = P => { const pts = []; for (let i = 0; i < P.pts.length; i += 2) { const ll = M.toLL(P.pts[i], P.pts[i + 1]); pts.push(...toF(ll.lat, ll.lon)); } return pts; };
  const ca = toF(box.n, box.w), cb = toF(box.s, box.e);
  const inside = p => { let sx = 0, sy = 0; for (let i = 0; i < p.length; i += 2) { sx += p[i]; sy += p[i + 1]; } sx /= p.length / 2; sy /= p.length / 2; return sx >= ca[0] && sx <= cb[0] && sy >= ca[1] && sy <= cb[1]; };
  const polys = gB.map(P => ({ pts: conv(P), src: 'g' })), lines = gL.map(P => ({ pts: conv(P), closed: P.closed, k: P.k }));
  if (obP) {
    setProg('Mengambil data bangunan terbuka…', 0.85);
    const ob = await obP;
    if (ob.err) L(`Data bangunan terbuka tidak dipakai (${ob.err.name === 'AbortError' ? 'koneksi terlalu lambat' : /fetch|network/i.test(ob.err.message) ? 'server data tidak terjangkau' : /404/.test(ob.err.message) ? 'belum tersedia untuk negara ini' : ob.err.message}); hanya trace peta Google.`, 'err');
    else {
      const by = {};
      for (const f of ob.feats) {
        const r = f.rings[0]; if (!r || r.length < 8) continue;
        const pts = []; for (let i = 0; i < r.length; i += 2) pts.push(...toF(r[i + 1], r[i]));
        if (Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 1e-6) pts.length -= 2; // titik penutup ganda
        if (pts.length < 6 || !inside(pts)) continue;
        polys.push({ pts, src: 'ob', conf: f.props.confidence ?? 0.7 }); const s = f.props.bf_source || 'lain'; by[s] = (by[s] || 0) + 1;
      }
      const n = Object.values(by).reduce((a, b) => a + b, 0);
      L(`✓ Data bangunan terbuka: ${n} bangunan${n ? ` (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''} · ${fmtM(ob.ms / 1000, 1)} dtk`);
    }
  }
  if (!snap && !polys.some(P => P.src === 'ob')) return { polys, lines, fromF }; // tidak ada yang perlu diselaraskan / digabung
  setProg(snap ? 'Menyelaraskan garis ke foto satelit…' : 'Menggabungkan data bangunan…', 0.88);
  if (snap) { const d = photo.cv.getContext('2d').getImageData(0, 0, photo.M.W, photo.M.H), p = msg(); wk.postMessage({ type: 'photo', W: photo.M.W, H: photo.M.H, buf: d.data.buffer }, [d.data.buffer]); await p; }
  const p = msg(); wk.postMessage({ type: 'bld', polys, lines, W: F.W, H: F.H, clip: { x1: ca[0], y1: ca[1], x2: cb[0], y2: cb[1] }, opt: { snap, gsd: gsd(box.c.lat, F.z, F.ts) } });
  const rb = await p;
  const nOb = rb.polys.filter(P => P.src === 'ob').length, ok = rb.polys.filter(P => P.ok).length, sh = s => s && (s.dx || s.dy) ? fmtM(Math.hypot(s.dx, s.dy), 2) + ' m' : null;
  if (snap) {
    const so = sh(rb.glob?.ob), sg = sh(rb.glob?.g);
    L(`✓ Diselaraskan ke foto: ${ok} dari ${rb.polys.length} bangunan pas ke tepi atap${so ? `; koreksi geser data terbuka ${so}` : ''}${sg ? `; koreksi geser peta Google ${sg} (juga jalan/air)` : ''} · ${fmtM(rb.ms / 1000, 1)} dtk`);
  }
  if (rb.polys.length) L(`✓ Bangunan: ${rb.polys.length} (${nOb} data terbuka + ${rb.polys.length - nOb} peta Google${rb.n > rb.polys.length ? `; ${rb.n - rb.polys.length} duplikat/tumpang tindih dibuang` : ''})`);
  return { polys: rb.polys, lines: rb.lines, fromF };
}

// ================= ATAP: klik atap pada foto peta → garis bangunan =================
// Untuk bangunan yang tidak ada di data mana pun: deteksi dari foto yang sudah diplot (jadi pasti pas dengan foto).
export async function roofCmd(app, ed) {
  const doc = app.doc, isOn = e => { const Ly = doc.layers[e.layer]; return !Ly || (Ly.on !== false && !Ly.frz); };
  const imgs = doc.model.filter(e => e.type === 'image' && (e.img || e.src) && isOn(e));
  if (!imgs.length) { ed.msg('Belum ada foto peta di gambar ini. Capture dulu lewat Google Maps (GEOMAP), lalu jalankan ATAP.', 'err'); return; }
  ed.msg('Klik di tengah atap bangunan pada foto → garis atap dideteksi otomatis. Kecil / Besar = ubah cakupan atap terakhir. Enter = selesai.');
  doc.addLayer('SITE-BANGUNAN', LAY['SITE-BANGUNAN']);
  const decoded = new Map(), added = []; let last = null;
  const local = (e, p) => { const c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0), dx = p.x - e.p.x, dy = p.y - e.p.y; return { x: c * dx + s * dy, y: -s * dx + c * dy }; };
  const world = (e, lx, ly) => { const c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0); return { x: e.p.x + c * lx - s * ly, y: e.p.y + s * lx + c * ly }; };
  const pixels = async e => { // foto → kanvas (sekali per perintah)
    const src = e.img ? doc.imgs?.[e.img] : e.src; if (!src) return null;
    if (!decoded.has(src)) { // onload, bukan img.decode(): decode() bisa menggantung bila halaman sedang tidak merender
      const im = new Image(); await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('foto rusak')); im.src = src; if (im.complete && im.naturalWidth) res(); });
      const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0); decoded.set(src, { cx, W: cv.width, H: cv.height }); }
    return decoded.get(src);
  };
  const pl = (L0, k) => ({ type: 'pline', pts: Array.from({ length: k.pts.length / 2 }, (_, i) => { const ix = k.pts[2 * i] + L0.x0, iy = k.pts[2 * i + 1] + L0.y0, q = world(L0.e, ix / L0.W * L0.e.w, (1 - iy / L0.H) * L0.e.h); return { x: q.x, y: q.y, b: 0 }; }), closed: true, layer: 'SITE-BANGUNAN', color: 256, lt: 'ByLayer', lw: -1 });
  const info = (k, n) => ed.msg(`Bangunan ${n}: luas atap ${fmtM(k.area, 1)} m²${k.touch ? ' (mungkin terpotong tepi foto)' : ''}.`);
  for (;;) {
    const kws = last ? ['Kecil', 'Besar', 'Undo'] : added.length ? ['Undo'] : [];
    const p = await ed.getPoint(`Klik atap bangunan pada foto${kws.length ? ` [${kws.join('/')}]` : ''} <selesai>:`, { kws, noSnap: true }); // tanpa OSNAP: titik klik apa adanya
    if (p === null || p === undefined) break;
    if (p === 'Undo') { const e = added.pop(); if (e) { ed.remove(e); ed.msg('Bangunan terakhir dihapus.'); } last = null; continue; }
    if (p === 'Kecil' || p === 'Besar') {
      const j = last.idx + (p === 'Kecil' ? 1 : -1), C = last.res.cands;
      if (j < 0 || j >= C.length) { ed.msg(p === 'Kecil' ? 'Sudah cakupan terkecil.' : 'Sudah cakupan terbesar (lebih dari ini bocor ke sekitar).'); continue; }
      ed.remove(last.ent); last.idx = j; last.ent = ed.add(pl(last.L0, C[j])); added[added.length - 1] = last.ent; info(C[j], added.length); continue;
    }
    if (typeof p !== 'object') continue;
    const e = [...imgs].reverse().find(im => { const q = local(im, p); return q.x >= 0 && q.y >= 0 && q.x <= im.w && q.y <= im.h; });
    if (!e) { ed.msg('Titik di luar foto peta — klik di atas foto.'); continue; }
    let px; try { px = await pixels(e); } catch { px = null; }
    if (!px) { ed.msg('Foto tidak bisa dibaca.', 'err'); continue; }
    const q = local(e, p), ix = q.x / e.w * px.W, iy = (1 - q.y / e.h) * px.H;
    const g = e.geo?.gsd || (e.w / px.W) * (UNIT_MM[doc.set.units || 'mm'] || 1) / 1000; // m per piksel foto
    let res = null, L0 = null;
    for (const half of [Math.round(30 / g), Math.round(70 / g)]) { // jendela ±30 m; bila atap menyentuh tepinya ±70 m
      const x0 = Math.max(0, Math.floor(ix - half)), y0 = Math.max(0, Math.floor(iy - half)), x1 = Math.min(px.W, Math.ceil(ix + half)), y1 = Math.min(px.H, Math.ceil(iy + half));
      const d = px.cx.getImageData(x0, y0, x1 - x0, y1 - y0);
      res = traceRoof(d.data, x1 - x0, y1 - y0, ix - x0, iy - y0, g, { free: { l: x0 === 0, t: y0 === 0, r: x1 === px.W, b: y1 === px.H } }); L0 = { e, x0, y0, W: px.W, H: px.H };
      const edge = x0 > 0 || y0 > 0 || x1 < px.W || y1 < px.H; // jendela belum sebesar foto
      if (res.err || !res.cands[res.pick].touch || !edge) break;
    }
    if (res.err) { ed.msg(`Atap tidak terdeteksi: ${res.err}. Klik lebih ke tengah atap, atau gambar manual (REC / PL).`); continue; }
    const k = res.cands[res.pick], ent = ed.add(pl(L0, k));
    added.push(ent); last = { res, idx: res.pick, L0, ent }; info(k, added.length);
  }
  if (added.length) ed.msg(`${added.length} bangunan ditambahkan di layer SITE-BANGUNAN.`, 'ok');
}

// ================= Capture → gambar =================
// meas: garis ukur yang ikut diplot (merah + dimensi ISO); only: hanya garis ukur (tanpa foto, tracing, anotasi & ubah layout)
export async function capture(app, { shape, box, o, meas = null, only = false, setProg = () => { }, L = () => { } }) {
  const doc = app.doc, units = doc.set.units || 'mm', k = 1000 / (UNIT_MM[units] || 1);
  // 1) geolokasi gambar (titik singgung ENU = pusat area pertama; pojok kiri-bawah area = 0,0 bila gambar kosong)
  let geo = doc.geo && Math.abs((doc.geo.k || k) - k) < 1e-9 ? doc.geo : null, newGeo = null;
  if (!geo) {
    const E = makeENU(box.c.lat, box.c.lon), sw = E.fwd(box.s, box.w), ext = doc.extents(doc.model);
    let x = -sw.e * k, y = -sw.n * k;
    if (doc.model.length && isFinite(ext.x2)) { x += ext.x2 + 10 * k; y += ext.y1; }
    newGeo = geo = { lat: box.c.lat, lon: box.c.lon, x, y, rot: 0, k };
  }
  const X = geoXform(geo);
  const ents = [], addL = [];
  let img = null, photoInfo = '', place = '';
  const revJ = only ? Promise.resolve(null) : fetch(`https://photon.komoot.io/reverse?lat=${box.c.lat}&lon=${box.c.lon}&limit=1`).then(r => r.json()).catch(() => null);
  const rev = revJ.then(j => { const P = j?.features?.[0]?.properties; if (P) place = [P.name, P.street, P.district || P.locality, P.city || P.county, P.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4).join(', '); });
  // jejak bangunan terbuka diunduh paralel dengan foto & tile trace (hanya beberapa ratus KB lewat HTTP Range)
  const obAbort = new AbortController(), obTimer = setTimeout(() => obAbort.abort(), 45000);
  const obP = o.bld && o.obData !== false ? openBuildings(box, revJ, obAbort.signal).catch(e => ({ err: e })) : null;
  let photo = null;
  // 2) foto
  if (o.photo !== 'none') {
    const S = SRC[o.photo]; let z = pickZoom(box, S.max, S.ts, maxPx(o));
    setProg('Memeriksa ketersediaan citra…', 0.02);
    for (let i = 0; i < 4; i++) { const c = ll2px(box.c.lat, box.c.lon, z); if (await loadImg(S.url(Math.floor(c.x / 256), Math.floor(c.y / 256), z), 1)) break; z--; }
    const M = mosaic(box, z, S.ts), cv = document.createElement('canvas'); cv.width = M.W; cv.height = M.H;
    const c = cv.getContext('2d'); c.fillStyle = '#7f7f7f'; c.fillRect(0, 0, M.W, M.H);
    let done = 0, fail = 0;
    await pool(M.tiles, 8, async t => {
      const n = 2 ** z, x = ((t.tx % n) + n) % n;
      let im = await loadImg(S.url(x, t.ty, z));
      if (im) c.drawImage(im, t.dx, t.dy, 256 * S.ts, 256 * S.ts);
      else { fail++; const P = await loadImg(S.url(x >> 1, t.ty >> 1, z - 1)); if (P) { const hw = P.naturalWidth / 2; c.drawImage(P, (x & 1) * hw, (t.ty & 1) * hw, hw, hw, t.dx, t.dy, 256 * S.ts, 256 * S.ts); } }
      setProg(`Mengunduh foto ${S.n}: ${++done}/${M.tiles.length} tile`, 0.05 + 0.4 * done / M.tiles.length);
    });
    setProg('Memproyeksikan foto ke koordinat riil…', 0.46);
    // affine piksel → ENU (kuadrat terkecil 9×9 titik) + cek residu; bila > 0,3 px pakai warp segitiga
    const G = [], N = 8; for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const u = M.W * i / N, v = M.H * j / N, ll = M.toLL(u, v), p = X.enu.fwd(ll.lat, ll.lon); G.push([u, v, p.e, p.n]); }
    const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], be = [0, 0, 0], bn = [0, 0, 0];
    for (const [u, v, e, n] of G) { const r = [u, v, 1]; for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) AtA[a][b] += r[a] * r[b]; be[a] += r[a] * e; bn[a] += r[a] * n; } }
    const [a1, b1, c1] = solve3(AtA, be), [a2, b2, c2] = solve3(AtA, bn);
    const g = Math.sqrt(Math.abs(a1 * b2 - b1 * a2));
    let res = 0; for (const [u, v, e, n] of G) res = Math.max(res, Math.hypot(a1 * u + b1 * v + c1 - e, a2 * u + b2 * v + c2 - n));
    let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity; for (const q of G) { e0 = Math.min(e0, q[2]); e1 = Math.max(e1, q[2]); n0 = Math.min(n0, q[3]); n1 = Math.max(n1, q[3]); }
    const Wo = Math.ceil((e1 - e0) / g), Ho = Math.ceil((n1 - n0) / g), out = document.createElement('canvas'); out.width = Wo; out.height = Ho;
    const oc = out.getContext('2d'); oc.fillStyle = '#808080'; oc.fillRect(0, 0, Wo, Ho); oc.imageSmoothingQuality = 'high';
    const toOut = (e, n) => [(e - e0) / g, (n1 - n) / g];
    if (res < 0.3 * g) { oc.setTransform(a1 / g, -a2 / g, b1 / g, -b2 / g, (c1 - e0) / g, (n1 - c2) / g); oc.drawImage(cv, 0, 0); }
    else for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { // warp per segitiga (presisi sub-mm)
      const q = (ii, jj) => G[jj * (N + 1) + ii], A = q(i, j), B = q(i + 1, j), C = q(i + 1, j + 1), D = q(i, j + 1);
      for (const T of [[A, B, C], [A, C, D]]) {
        const s = T.map(t => [t[0], t[1]]), d = T.map(t => toOut(t[2], t[3]));
        const den = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
        const ma = ((d[1][0] - d[0][0]) * (s[2][1] - s[0][1]) - (d[2][0] - d[0][0]) * (s[1][1] - s[0][1])) / den, mc = ((d[2][0] - d[0][0]) * (s[1][0] - s[0][0]) - (d[1][0] - d[0][0]) * (s[2][0] - s[0][0])) / den;
        const mb = ((d[1][1] - d[0][1]) * (s[2][1] - s[0][1]) - (d[2][1] - d[0][1]) * (s[1][1] - s[0][1])) / den, md = ((d[2][1] - d[0][1]) * (s[1][0] - s[0][0]) - (d[1][1] - d[0][1]) * (s[2][0] - s[0][0])) / den;
        const cx = (d[0][0] + d[1][0] + d[2][0]) / 3, cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
        oc.save(); oc.beginPath(); d.forEach(([x, y], ii) => { const ex = x + Math.sign(x - cx) * 0.6, ey = y + Math.sign(y - cy) * 0.6; ii ? oc.lineTo(ex, ey) : oc.moveTo(ex, ey); }); oc.closePath(); oc.clip();
        oc.setTransform(ma, mb, mc, md, d[0][0] - ma * s[0][0] - mc * s[0][1], d[0][1] - mb * s[0][0] - md * s[0][1]); oc.drawImage(cv, 0, 0); oc.restore();
      }
    }
    setProg('Menyimpan foto…', 0.5);
    const src = await blobURL(out), key = 'img' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    doc.imgs[key] = src;
    const bl = X.fromENU(e0, n1 - Ho * g);
    img = { type: 'image', p: bl, w: Wo * g * k, h: Ho * g * k, rot: geo.rot || 0, img: key, fade: 30, name: `Peta ${S.n} z${z}`, layer: 'PETA-FOTO', color: 256, lt: 'ByLayer', lw: -1, geo: { z, gsd: g, src: o.photo } };
    photoInfo = `foto ${S.n} zoom ${z} (${fmtM(g * 100, 1)} cm/px, ${Wo}×${Ho} px${fail ? `, ${fail} tile diganti zoom ${z - 1}` : ''}, residu proyeksi ${fmtM(res * 1000, 2)} mm)`;
    L(`✓ Foto: ${photoInfo}`);
    photo = { M, cv, src: o.photo };
  }
  // 3) tracing
  const want = { bld: o.bld, road: o.road, water: o.water, green: o.green }, traced = { bld: 0, bld2: 0, road: 0, water: 0, green: 0 };
  let obUsed = 0; // jumlah bangunan dari data terbuka (untuk atribusi lisensi di keterangan)
  if (want.bld || want.road || want.water || want.green) {
    const E = makeENU(box.c.lat, box.c.lon), a = E.fwd(box.s, box.w), b = E.fwd(box.n, box.e), m = Math.max(15, 0.08 * Math.max(b.e - a.e, b.n - a.n));
    const p1 = E.inv(a.e - m, a.n - m), p2 = E.inv(b.e + m, b.n + m), tb = { s: p1.lat, w: p1.lon, n: p2.lat, e: p2.lon };
    const z = pickZoom(tb, o.detail === 'high' ? 21 : 20, 2, maxPx(o)), M = mosaic(tb, z, 2);
    const wk = new Worker(new URL('./trace-worker.js?v=2', import.meta.url), { type: 'module' }); // ?v: jangan pakai worker lama dari cache (tak kenal pesan 'photo'/'bld')
    const msg = () => new Promise((res, rej) => { wk.onmessage = e => e.data.type === 'error' ? rej(new Error(e.data.msg)) : res(e.data); wk.onerror = e => rej(new Error(e.message || 'Worker gagal')); });
    try {
      let p = msg(); wk.postMessage({ type: 'init', W: M.W, H: M.H }); await p;
      const tc = document.createElement('canvas'); tc.width = tc.height = 512; const tx = tc.getContext('2d', { willReadFrequently: true });
      let done = 0, fail = 0;
      await pool(M.tiles, 8, async t => {
        const n = 2 ** z, im = await loadImg(traceUrl(((t.tx % n) + n) % n, t.ty, z));
        if (!im) fail++;
        else {
          tx.clearRect(0, 0, 512, 512); tx.drawImage(im, 0, 0, 512, 512);
          const sx = Math.max(0, -t.dx), sy = Math.max(0, -t.dy), sw = Math.min(512, M.W - t.dx) - sx, sh = Math.min(512, M.H - t.dy) - sy;
          if (sw > 0 && sh > 0) { const d = tx.getImageData(sx, sy, sw, sh); wk.postMessage({ type: 'tile', x: t.dx + sx, y: t.dy + sy, w: sw, h: sh, buf: d.data.buffer }, [d.data.buffer]); }
        }
        setProg(`Mengunduh peta untuk tracing: ${++done}/${M.tiles.length}`, 0.5 + 0.3 * done / M.tiles.length);
      });
      setProg('Tracing garis (vektorisasi)…', 0.82);
      const ca = ll2px(box.n, box.w, z), cb = ll2px(box.s, box.e, z), clip = { x1: (ca.x - M.X0) * 2, y1: (ca.y - M.Y0) * 2, x2: (cb.x - M.X0) * 2, y2: (cb.y - M.Y0) * 2 };
      p = msg(); wk.postMessage({ type: 'run', opt: { gsd: gsd(box.c.lat, z, 2), clip, want, ortho: true } });
      const r = await p;
      const LY = { bld: 'SITE-BANGUNAN', bld2: 'SITE-BANGUNAN', road: 'SITE-JALAN', water: 'SITE-AIR', green: 'SITE-HIJAU' }, gB = [], gL = [];
      const pline = (pts, closed, layer) => ents.push({ type: 'pline', pts, closed, layer, color: 256, lt: 'ByLayer', lw: -1 });
      const toDwgPts = (P, T) => { const pts = []; for (let i = 0; i < P.pts.length; i += 2) { const ll = T(P.pts[i], P.pts[i + 1]), q = X.toDwg(ll.lat, ll.lon); pts.push({ x: q.x, y: q.y, b: 0 }); } return pts; };
      for (const P of r.polys) (P.k === 'bld' || P.k === 'bld2' ? gB : gL).push(P);
      const cnt = k => gL.filter(P => P.k === k).length;
      L(`✓ Tracing peta Google zoom ${z} (${fmtM(gsd(box.c.lat, z, 2) * 100, 1)} cm/px): ${gB.length} bangunan, ${cnt('road')} tepi jalan, ${cnt('water')} air, ${cnt('green')} hijau${fail ? ` · ${fail} tile gagal` : ''}`);
      let A = null;
      try { A = await alignStep({ wk, msg, M, gB, gL, photo, obP, box, o, setProg, L }); }
      catch (e) { console.error(e); L(`Penggabungan / penyelarasan ke foto gagal (${e.message || e}); dipakai trace peta Google apa adanya.`, 'err'); }
      if (A) {
        for (const P of A.lines) { pline(toDwgPts(P, A.fromF), P.closed, LY[P.k]); traced[P.k]++; }
        for (const P of A.polys) { pline(toDwgPts(P, A.fromF), true, LY.bld); traced.bld++; if (P.src === 'ob') obUsed++; }
      } else for (const P of r.polys) { const b = P.k === 'bld' || P.k === 'bld2'; pline(toDwgPts(P, M.toLL), b || P.closed, LY[P.k]); traced[b ? 'bld' : P.k]++; }
    } finally { wk.terminate(); clearTimeout(obTimer); obAbort.abort(); }
  }
  await Promise.race([rev, new Promise(r => setTimeout(r, 2500))]);
  // 4) batas lahan, ukuran riil, anotasi
  setProg('Membuat batas lahan, ukuran & anotasi…', 0.94);
  const E = makeENU(box.c.lat, box.c.lon), a = E.fwd(box.s, box.w), b = E.fwd(box.n, box.e);
  const extra = (o.boundary && o.table && shape.kind === 'poly') || (o.notes && (newGeo || shape.kind === 'poly')) ? 150 : 0; // kolom tabel/keterangan di kanan (mm kertas)
  let N = PREF_SCALES.find(n => (b.e - a.e) * 1000 / n + extra <= 296 && (b.n - a.n) * 1000 / n <= 235) || 10000;
  if (only && !newGeo) { // garis ukur di atas foto yang sudah ada: ikut skala viewport layout, agar dimensinya sama besar dengan anotasi lain
    const s = doc.layouts[0]?.vp?.s, n = s > 0 ? Math.round((UNIT_MM[units] || 1) / s) : 0;
    if (n >= 1 && n <= 1e6) N = n;
  }
  const ps = N / (UNIT_MM[units] || 1);
  const capC = [[box.w, box.s], [box.e, box.s], [box.e, box.n], [box.w, box.n]].map(([lon, lat]) => X.toDwg(lat, lon));
  const bb = { x1: Math.min(...capC.map(p => p.x)), y1: Math.min(...capC.map(p => p.y)), x2: Math.max(...capC.map(p => p.x)), y2: Math.max(...capC.map(p => p.y)) };
  const T = (p, s, hmm, o2 = {}) => ents.push({ type: 'text', p, s, h: hmm * ps, ha: 0, va: 0, rot: 0, layer: 'SITE-TEKS', color: 256, lt: 'ByLayer', lw: -1, ...o2 });
  let site = null;
  const doB = o.boundary && shape.kind === 'poly', doNotes = o.notes && (!!newGeo || doB);
  if (doB) {
    const sp = shape.kind === 'rect' ? shape.pts : shape.pts;
    let P = sp.map(q => X.toDwg(q.lat, q.lon));
    let ar = 0; for (let i = 0; i < P.length; i++) { const u = P[i], v = P[(i + 1) % P.length]; ar += u.x * v.y - v.x * u.y; }
    let LL = sp; if (ar < 0) { P = P.reverse(); LL = [...sp].reverse(); }
    // mulai dari titik paling barat-laut agar penomoran P1… rapi
    let st = 0; P.forEach((q, i) => { if (q.y - q.x > P[st].y - P[st].x) st = i; }); P = [...P.slice(st), ...P.slice(0, st)]; LL = [...LL.slice(st), ...LL.slice(0, st)];
    const Mx = shapeMetrics(LL, true);
    site = { P, LL, area: Mx.area, per: Mx.per, edges: Mx.edges };
    ents.push({ type: 'pline', pts: P.map(q => ({ x: q.x, y: q.y, b: 0 })), closed: true, layer: 'SITE-BATAS', color: 256, lt: 'ByLayer', lw: -1, lts: ps / 100 > 0 ? 1 : 1 });
    const off = 7 * ps, ds = { scale: ps, lfac: (UNIT_MM[units] || 1) / 1000, dec: o.dec || 2, suffix: ' m', txt: 2.5 };
    P.forEach((p1, i) => {
      const p2 = P[(i + 1) % P.length], dx = p2.x - p1.x, dy = p2.y - p1.y, l = Math.hypot(dx, dy); if (l < 1e-6) return;
      const nx = dy / l, ny = -dx / l; // normal keluar (poligon CCW)
      ents.push({ type: 'dim', kind: 'ali', p1: { ...p1 }, p2: { ...p2 }, dl: { x: p1.x + nx * off, y: p1.y + ny * off }, ds, layer: 'SITE-DIMENSI', color: 256, lt: 'ByLayer', lw: -1 });
    });
    P.forEach((p, i) => {
      const A = P[(i - 1 + P.length) % P.length], B = P[(i + 1) % P.length];
      const n1 = (() => { const dx = p.x - A.x, dy = p.y - A.y, l = Math.hypot(dx, dy) || 1; return { x: dy / l, y: -dx / l }; })(), n2 = (() => { const dx = B.x - p.x, dy = B.y - p.y, l = Math.hypot(dx, dy) || 1; return { x: dy / l, y: -dx / l }; })();
      let bx = n1.x + n2.x, by = n1.y + n2.y; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
      ents.push({ type: 'circle', c: { ...p }, r: 0.9 * ps, layer: 'SITE-KOORDINAT', color: 256, lt: 'ByLayer', lw: -1 });
      ents.push({ type: 'text', p: { x: p.x + bx * 3.2 * ps, y: p.y + by * 3.2 * ps }, s: 'P' + (i + 1), h: 2.2 * ps, ha: 1, va: 2, rot: 0, layer: 'SITE-KOORDINAT', color: 256, lt: 'ByLayer', lw: -1 });
    });
    // label luas di titik berat
    let cx = 0, cy = 0, A6 = 0; for (let i = 0; i < P.length; i++) { const u = P[i], v = P[(i + 1) % P.length], cr = u.x * v.y - v.x * u.y; A6 += cr; cx += (u.x + v.x) * cr; cy += (u.y + v.y) * cr; } cx /= 3 * A6; cy /= 3 * A6;
    ents.push({ type: 'text', p: { x: cx, y: cy + 2.2 * ps }, s: `LUAS LAHAN = ${fmtM(site.area)} m²`, h: 3 * ps, ha: 1, va: 2, rot: 0, layer: 'SITE-TEKS', color: 256, lt: 'ByLayer', lw: 35 });
    ents.push({ type: 'text', p: { x: cx, y: cy - 2.6 * ps }, s: `KELILING = ${fmtM(site.per)} m`, h: 2.2 * ps, ha: 1, va: 2, rot: 0, layer: 'SITE-TEKS', color: 256, lt: 'ByLayer', lw: -1 });
  }
  // garis ukur: polyline merah + dimensi aligned ISO per segmen (+ luas / panjang total)
  const ms = meas && meas.pts.length >= 2 ? measureEnts(meas, X, ps, o, units) : null;
  if (ms?.n) { ents.push(...ms.ents); L(`✓ Garis ukur merah: ${ms.n} segmen, panjang total ${fmtM(ms.per, o.dec || 2)} m${ms.area != null ? `, luas ${fmtM(ms.area)} m²` : ''} · dimensi ISO 1:${N}`); }
  // tabel koordinat
  let tx0 = bb.x2 + 14 * ps, ty = bb.y2;
  if (site && o.table) {
    const sys = o.coord, cw = [12, 31, 31, 23, 25].map(v => v * ps), rh = 6 * ps, W = cw.reduce((s, v) => s + v, 0);
    const z0 = sys === 'tm3' ? tm3(site.LL[0].lat, site.LL[0].lon) : utm(site.LL[0].lat, site.LL[0].lon);
    const head = sys === 'll' ? ['TITIK', 'LINTANG', 'BUJUR', 'JARAK (m)', 'AZIMUT'] : ['TITIK', 'X / EASTING (m)', 'Y / NORTHING (m)', 'JARAK (m)', 'AZIMUT'];
    const rows = site.LL.map((q, i) => {
      const nx = site.LL[(i + 1) % site.LL.length], c = sys === 'tm3' ? tm3(q.lat, q.lon) : utm(q.lat, q.lon), En = makeENU(q.lat, q.lon).fwd(nx.lat, nx.lon);
      return ['P' + (i + 1), sys === 'll' ? fmtLat(q.lat) : fmtM(c.E, 3), sys === 'll' ? fmtLon(q.lon) : fmtM(c.N, 3), `P${i + 1}–P${(i + 1) % site.LL.length + 1}: ${fmtM(site.edges[i], o.dec || 2)}`, fmtAz(azimuth(En.e, En.n))];
    });
    const title = `TABEL KOORDINAT BATAS LAHAN — ${sys === 'll' ? 'WGS84 (geografis)' : z0.label}`;
    const tl = (x1, y1, x2, y2) => ents.push({ type: 'line', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, layer: 'SITE-TEKS', color: 256, lt: 'ByLayer', lw: -1 });
    T({ x: tx0, y: ty + 2 * ps }, title, 2.5, { lw: 35 });
    const nR = rows.length + 1;
    for (let r = 0; r <= nR; r++) tl(tx0, ty - r * rh, tx0 + W, ty - r * rh);
    let xx = tx0; for (let c = 0; c <= cw.length; c++) { tl(xx, ty, xx, ty - nR * rh); xx += cw[c] || 0; }
    [head, ...rows].forEach((row, r) => { let x = tx0; row.forEach((s, c) => { ents.push({ type: 'text', p: { x: x + (c === 0 ? cw[0] / 2 : 1.5 * ps), y: ty - r * rh - rh / 2 }, s, h: (r ? 2 : 1.8) * ps, ha: c === 0 ? 1 : 0, va: 2, rot: 0, layer: 'SITE-TEKS', color: 256, lt: 'ByLayer', lw: r ? -1 : 35 }); x += cw[c]; }); });
    ty -= nR * rh + 10 * ps;
  }
  if (doNotes) {
    // arah utara
    if (!doc.blocks['ARAH-UTARA'] && LIBRARY['ARAH-UTARA']) doc.blocks['ARAH-UTARA'] = JSON.parse(JSON.stringify(LIBRARY['ARAH-UTARA']));
    // dengan tabel: di kanan tabel; tanpa tabel: sebaris di kanan skala grafis (≤ 64 mm) & kolom keterangan (≈ 94 mm), tidak menimpa
    const na = site && o.table ? { x: bb.x2 + 150 * ps, y: bb.y2 - 10 * ps } : { x: tx0 + 112 * ps, y: ty - 6 * ps };
    if (doc.blocks['ARAH-UTARA']) ents.push({ type: 'insert', name: 'ARAH-UTARA', p: na, sx: ps / 100 * 1.4, sy: ps / 100 * 1.4, rot: geo.rot || 0, layer: 'SITE-SIMBOL', color: 256, lt: 'ByLayer', lw: -1 });
    // skala grafis 0–L m (L = panjang bulat ≈ 40 mm kertas)
    const Lm = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find(v => v * 1000 / N >= 30) || 1000, Lu = Lm * k, x0 = tx0, y0 = ty;
    for (let i = 0; i < 4; i++) { const xa = x0 + Lu * i / 4, xb = x0 + Lu * (i + 1) / 4; const r = [{ x: xa, y: y0 }, { x: xb, y: y0 }, { x: xb, y: y0 + 2 * ps }, { x: xa, y: y0 + 2 * ps }]; ents.push(i % 2 ? { type: 'pline', pts: r.map(q => ({ ...q, b: 0 })), closed: true, layer: 'SITE-SIMBOL', color: 256, lt: 'ByLayer', lw: -1 } : { type: 'solid', pts: r, layer: 'SITE-SIMBOL', color: 256, lt: 'ByLayer', lw: -1 }); }
    [0, Lm / 2, Lm].forEach((v, i) => ents.push({ type: 'text', p: { x: x0 + Lu * i / 2, y: y0 + 3.2 * ps }, s: String(v).replace('.', ','), h: 1.8 * ps, ha: 1, va: 0, rot: 0, layer: 'SITE-SIMBOL', color: 256, lt: 'ByLayer', lw: -1 }));
    T({ x: x0 + Lu + 2 * ps, y: y0 + 0.2 * ps }, 'm', 1.8);
    T({ x: x0, y: y0 - 4 * ps }, `SKALA 1 : ${N}`, 2.2);
    // keterangan
    const u0 = utm(geo.lat, geo.lon), lines = [
      'SITE PLAN', place ? 'Lokasi: ' + place : null,
      `Titik acuan (${fmtM(geo.x / k, 3)} ; ${fmtM(geo.y / k, 3)} m gambar): ${fmtLat(geo.lat)} ${fmtLon(geo.lon)}`,
      `${u0.label}: E ${fmtM(u0.E, 3)}  N ${fmtM(u0.N, 3)}`,
      site ? `Luas lahan ${fmtM(site.area)} m², keliling ${fmtM(site.per)} m` : null,
      ms?.n ? `Garis ukur (merah): ${ms.n} segmen, panjang total ${fmtM(ms.per, o.dec || 2)} m${ms.area != null ? `, luas ${fmtM(ms.area)} m²` : ''}; dimensi gaya ISO 129-1 (ISO-25).` : null,
      `Sumber: Google Maps${photoInfo ? ' — ' + photoInfo : ''}. Proyeksi bidang lokal WGS84 (jarak = jarak riil).`,
      obUsed ? `Jejak ${obUsed} bangunan: Google Open Buildings, Microsoft Building Footprints & © kontributor OpenStreetMap (gabungan VIDA, ODbL).` : null,
      `Satuan gambar ${units}; ukuran batas dalam meter. Akurasi posisi mengikuti data peta, verifikasi dengan ukur lapangan.`,
    ].filter(Boolean);
    const wrap = (t, n = 78) => { const out = []; let cur = ''; for (const w of t.split(' ')) { if ((cur + ' ' + w).trim().length > n) { out.push(cur.trim()); cur = w; } else cur += ' ' + w; } if (cur.trim()) out.push(cur.trim()); return out; };
    let yy = y0 - 11 * ps;
    lines.forEach((t, i) => { if (!i) { T({ x: x0, y: yy }, t, 3.5, { lw: 50 }); yy -= 5.5 * ps; return; } for (const l of wrap(t)) { T({ x: x0, y: yy }, l, 2); yy -= 3.4 * ps; } });
  }
  // 5) masukkan ke dokumen (satu langkah undo)
  app.mutate(() => {
    if (newGeo) { doc.geo = newGeo; if (!doc.model.length) doc.set.ltscale = ps; }
    const used = new Set(ents.map(e => e.layer));
    for (const [n, p] of Object.entries(LAY)) if (!only || used.has(n)) { const Lr = doc.addLayer(n, p); if (n === 'PETA-FOTO') Lr.plot = true; }
    for (const [n, p] of Object.entries(MLAY)) if (used.has(n)) doc.addLayer(n, p);
    if (!doc.ltypes.includes('PHANTOM')) doc.ltypes.push('PHANTOM');
    if (img) { doc.prep(img); doc.model.unshift(img); }
    for (const e of ents) { if (e.layer === 'SITE-BATAS') e.lts = 1; doc.prep(e); doc.model.push(e); }
    const Lo = doc.layouts[0];
    if (Lo && (!only || newGeo)) { if (/^JUDUL GAMBAR$/i.test(Lo.tb.title || '')) Lo.tb.title = 'SITE PLAN'; if (/^LOKASI PROYEK$/i.test(Lo.tb.location || '') && place) { const pl = place.split(', '); let t = pl[0]; if (pl[1] && (t + ', ' + pl[1]).length <= 30) t += ', ' + pl[1]; Lo.tb.location = t.slice(0, 34).toUpperCase(); }
      if (/^Semua ukuran dalam milimeter/i.test(Lo.tb.notes || '')) Lo.tb.notes = `Site plan skala 1:${N}. Ukuran batas lahan dalam meter (jarak riil WGS84); satuan gambar ${units}.`;
      const ext = doc.extents(doc.model); Lo.vp = { s: (UNIT_MM[units] || 1) / N, cx: (ext.x1 + ext.x2) / 2, cy: (ext.y1 + ext.y2) / 2, lock: false }; fitVp(Lo, doc); }
  });
  void addL; void rev;
  const mTxt = ms?.n ? `garis ukur merah ${ms.n} segmen (total ${fmtM(ms.per, o.dec || 2)} m${ms.area != null ? `, luas ${fmtM(ms.area)} m²` : ''}) + dimensi ISO` : '';
  const summary = only ? `Diplot: ${mTxt || 'tidak ada garis ukur'}, skala anotasi 1:${N}.`
    : `Site plan diplot: area ${fmtM(b.e - a.e, 1)} × ${fmtM(b.n - a.n, 1)} m, skala anotasi 1:${N}` + (site ? `, luas lahan ${fmtM(site.area)} m², keliling ${fmtM(site.per)} m` : '') + (mTxt ? ', ' + mTxt : '') + (traced.bld + traced.road ? `, ${traced.bld + traced.bld2} bangunan & ${traced.road} tepi jalan ditrace` : '') + '.';
  app.ui.print(summary, 'ok');
  if (o.bld && img) app.ui.print('Ada bangunan yang belum tergaris? Perintah ATAP (Insert › Klik Atap), lalu klik atapnya di foto.');
  if (newGeo) app.ui.print(`Lokasi gambar: ${fmtLat(geo.lat)} ${fmtLon(geo.lon)} di titik (${fmtM(geo.x, 1)}, ${fmtM(geo.y, 1)}) ${units}. Capture berikutnya otomatis menyambung.`);
  return { summary, bbox: bb, mbox: ms?.n ? doc.extents(ms.ents) : null };
}
