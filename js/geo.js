// Geodesi untuk fitur peta: Web Mercator (tile Google), WGS84 → bidang lokal ENU (jarak riil di lapangan),
// UTM & TM-3 (BPN), format DMS/azimut, parsing link/koordinat Google Maps. Semua rumus eksak (elipsoid WGS84).
export const WGS84_A = 6378137, WGS84_F = 1 / 298.257223563;
const A = WGS84_A, F = WGS84_F, E2 = F * (2 - F), D2R = Math.PI / 180;
export const MAX_LAT = 85.0511287798066;

// ---------- Web Mercator (EPSG:3857, tile 256 px) ----------
export function ll2px(lat, lon, z) {
  const n = 256 * 2 ** z, s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R);
  return { x: (lon + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
export function px2ll(x, y, z) {
  const n = 256 * 2 ** z;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / D2R, lon: x / n * 360 - 180 };
}
// meter per piksel (arah timur-barat) pada zoom z dan skala tile (2 = tile 512 px)
export const gsd = (lat, z, scale = 1) => 2 * Math.PI * A * Math.cos(lat * D2R) / (256 * 2 ** z * scale);

// ---------- WGS84 → ECEF → ENU (bidang singgung lokal: jarak = jarak riil) ----------
export function ecef(lat, lon, h = 0) {
  const p = lat * D2R, l = lon * D2R, s = Math.sin(p), c = Math.cos(p), N = A / Math.sqrt(1 - E2 * s * s);
  return [(N + h) * c * Math.cos(l), (N + h) * c * Math.sin(l), (N * (1 - E2) + h) * s];
}
export function makeENU(lat0, lon0) {
  const p = lat0 * D2R, l = lon0 * D2R, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l), O = ecef(lat0, lon0);
  const fwd = (lat, lon) => {
    const P = ecef(lat, lon), dx = P[0] - O[0], dy = P[1] - O[1], dz = P[2] - O[2];
    return { e: -sl * dx + cl * dy, n: -sp * cl * dx - sp * sl * dy + cp * dz };
  };
  const radii = la => { const s = Math.sin(la * D2R), w = 1 - E2 * s * s; return { M: A * (1 - E2) / (w * Math.sqrt(w)), N: A / Math.sqrt(w) }; };
  const inv = (e, n) => { // iterasi Newton (konvergen < 1e-9 m dalam 3–4 langkah untuk area situs)
    const r0 = radii(lat0); let lat = lat0 + n / r0.M / D2R, lon = lon0 + e / (r0.N * cp) / D2R;
    for (let i = 0; i < 8; i++) {
      const q = fwd(lat, lon), de = e - q.e, dn = n - q.n;
      if (Math.abs(de) + Math.abs(dn) < 1e-9) break;
      const r = radii(lat); lat += dn / r.M / D2R; lon += de / (r.N * Math.cos(lat * D2R)) / D2R;
    }
    return { lat, lon };
  };
  return { lat0, lon0, fwd, inv };
}
// Transformasi geolokasi gambar: geo = { lat, lon, x, y, rot (rad, CCW), k (unit gambar per meter, mm = 1000) }
export function geoXform(geo) {
  const enu = makeENU(geo.lat, geo.lon), c = Math.cos(geo.rot || 0), s = Math.sin(geo.rot || 0), k = geo.k || 1000;
  return {
    enu, k,
    fromENU(e, n) { return { x: geo.x + k * (c * e - s * n), y: geo.y + k * (s * e + c * n) }; },
    toDwg(lat, lon) { const p = enu.fwd(lat, lon); return { x: geo.x + k * (c * p.e - s * p.n), y: geo.y + k * (s * p.e + c * p.n) }; },
    toGeo(x, y) { const dx = (x - geo.x) / k, dy = (y - geo.y) / k; return enu.inv(c * dx + s * dy, -s * dx + c * dy); },
  };
}

// ---------- Transverse Mercator (Krüger/Karney orde n^6, akurasi nm) ----------
const n = F / (2 - F), n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
const AA = A / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
const ALPHA = [0,
  n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
  13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
  61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
  49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
  34729 * n5 / 80640 - 3418889 * n6 / 1995840,
  212378941 * n6 / 319334400];
export function tm(lat, lon, lon0, k0, FE, FN) {
  const p = lat * D2R, l = (lon - lon0) * D2R, e = Math.sqrt(E2), cl = Math.cos(l), sl = Math.sin(l), t = Math.tan(p);
  const sg = Math.sinh(e * Math.atanh(e * t / Math.sqrt(1 + t * t)));
  const tp = t * Math.sqrt(1 + sg * sg) - sg * Math.sqrt(1 + t * t);
  const xp = Math.atan2(tp, cl), hp = Math.asinh(sl / Math.sqrt(tp * tp + cl * cl));
  let xi = xp, eta = hp;
  for (let j = 1; j <= 6; j++) { xi += ALPHA[j] * Math.sin(2 * j * xp) * Math.cosh(2 * j * hp); eta += ALPHA[j] * Math.cos(2 * j * xp) * Math.sinh(2 * j * hp); }
  return { E: FE + k0 * AA * eta, N: FN + k0 * AA * xi };
}
export function utm(lat, lon) {
  const zone = Math.min(60, Math.floor((lon + 180) / 6) + 1), lon0 = (zone - 1) * 6 - 177;
  return { ...tm(lat, lon, lon0, 0.9996, 500000, lat < 0 ? 10000000 : 0), zone, label: `UTM ${zone}${lat < 0 ? 'S' : 'N'} (WGS84)` };
}
// TM-3° BPN: meridian sentral tiap 3°, k0 0,9999, FE 200.000 m, FN 1.500.000 m (zona mis. 48.2 = BT 105°–108°)
export function tm3(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1, cm6 = (zone - 1) * 6 - 177, sub = lon < cm6 ? 1 : 2;
  return { ...tm(lat, lon, cm6 + (sub === 1 ? -1.5 : 1.5), 0.9999, 200000, 1500000), zone: `${zone}.${sub}`, label: `TM-3 zona ${zone}.${sub} (BPN)` };
}

// ---------- Format ----------
export function dms(v, pos, neg, dec = 2) {
  const sgn = v < 0 ? neg : pos; v = Math.abs(v);
  let d = Math.floor(v), m = Math.floor((v - d) * 60), x = +(((v - d) * 60 - m) * 60).toFixed(dec);
  if (x >= 60) { x = 0; m++; } if (m >= 60) { m = 0; d++; }
  return `${d}°${String(m).padStart(2, '0')}'${x.toFixed(dec).padStart(dec ? dec + 3 : 2, '0').replace('.', ',')}"${sgn ? ' ' + sgn : ''}`;
}
export const fmtLat = v => dms(v, 'LU', 'LS'), fmtLon = v => dms(v, 'BT', 'BB');
export const azimuth = (de, dn) => (Math.atan2(de, dn) / D2R + 360) % 360; // dari utara searah jarum jam
export const fmtAz = a => dms(a, '', '', 0);

// ---------- Parsing link / koordinat ----------
const okLL = (lat, lon) => isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
export function parseLoc(s) {
  s = String(s || '').trim(); if (!s) return null;
  try { s = decodeURIComponent(s); } catch { }
  let m, zoom = null;
  if ((m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)([zm])/))) zoom = m[4] === 'z' ? +m[3] : Math.max(3, Math.min(21, Math.round(Math.log2(35200000 / +m[3]))));
  if ((m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)) && okLL(+m[1], +m[2])) return { lat: +m[1], lon: +m[2], zoom: zoom ?? 19 };
  if ((m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)) && okLL(+m[1], +m[2])) return { lat: +m[1], lon: +m[2], zoom: zoom ?? 18 };
  if ((m = s.match(/[?&](?:q|ll|query|center|destination|daddr|sll)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i)) && okLL(+m[1], +m[2])) return { lat: +m[1], lon: +m[2], zoom: 18 };
  if ((m = s.match(/^(-?\d{1,2}(?:[.]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.]\d+)?)$/)) && okLL(+m[1], +m[2])) return { lat: +m[1], lon: +m[2], zoom: 18 };
  const dm = [...s.matchAll(/(\d{1,3})\s*°\s*(?:(\d{1,2})\s*['′]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*["″]\s*)?\s*(LU|LS|BT|BB|[NSEWUTB])\b/gi)];
  if (dm.length >= 2) {
    const v = x => (+x[1] + (+(x[2] || 0)) / 60 + (+String(x[3] || 0).replace(',', '.')) / 3600) * (/^(S|W|LS|BB|B)$/i.test(x[4]) ? -1 : 1);
    const isLat = x => /^(N|S|U|LU|LS)$/i.test(x[4]);
    const la = dm.find(isLat), lo = dm.find(x => !isLat(x));
    if (la && lo && okLL(v(la), v(lo))) return { lat: v(la), lon: v(lo), zoom: 18 };
  }
  return null;
}
export const gmapsUrl = (lat, lon, z = 18, sat = true) => `https://www.google.com/maps/@${lat.toFixed(7)},${lon.toFixed(7)},${Math.round(z)}z${sat ? '/data=!3m1!1e3' : ''}`;
