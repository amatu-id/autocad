// Aplikasi: multi-dokumen, file (buka/simpan .amcad/.dxf), autosave, plot/ekspor, perintah UI & layer.
import { Editor } from './editor.js';
import { UI, DESC } from './ui.js';
import { CMDS, ALIAS, setEditorRef } from './commands.js';
import { Doc, newLayout, fitVp, PAPERS, SCALES, UNIT_MM, scaleLabel, paperSize } from './doc.js';
import { exportDXF, parseDXF, DXF_VERSIONS, UNITS_FROM_INS } from './dxf.js';
import { exportPDF, exportSVG, renderPNG, exportDAE, tempLayout, download } from './export.js';
import { drawLayout } from './render.js';
import { LTYPES, bbox } from './ent.js';
import { bbOk, rectOf } from './geom.js';
import { $, h, win, toast, sel, num, chk } from './dom.js';
import { icon } from './icons.js';
import { buildSample } from './sample.js';
import * as D from './dialogs.js';
import { openGeoMap, roofCmd } from './geomap.js';
import { autoTrace, imageChoice, pasteImage } from './autotrace.js';

// ---------- penyimpanan (IndexedDB) ----------
const idb = (() => {
  let p;
  const open = () => p ||= new Promise((res, rej) => { const r = indexedDB.open('amatucad', 1); r.onupgradeneeded = () => r.result.createObjectStore('docs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('docs', mode), s = t.objectStore('docs'); const r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };
  return {
    put: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => { }),
    get: k => tx('readonly', s => s.get(k)).catch(() => null),
    del: k => tx('readwrite', s => s.delete(k)).catch(() => { }),
    all: async () => { try { const db = await open(); return await new Promise(res => { const out = [], t = db.transaction('docs'), c = t.objectStore('docs').openCursor(); c.onsuccess = () => { const x = c.result; if (x) { out.push({ key: x.key, ...x.value }); x.continue(); } else res(out); }; c.onerror = () => res(out); }); } catch { return []; } },
  };
})();
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

class App {
  constructor() {
    this.docs = []; this.doc = null; this.showStart = false; this.recent = [];
    const cv = { base: $('#cv-base'), sel: $('#cv-sel'), over: $('#cv-over'), wrap: $('#wrap') };
    this.ed = new Editor(this, cv);
    this.ed.cmds = CMDS; this.ed.alias = ALIAS; setEditorRef(this.ed);
    this.registerCommands();
    try { document.documentElement.dataset.theme = localStorage.getItem('amatucad-theme') || 'dark'; } catch { }
    Object.assign(this.ed.opt, LS.get('amatucad-opt', {}));
    const T = LS.get('amatucad-toggles', null); if (T) Object.assign(this.ed.T, T);
    const os = LS.get('amatucad-osnap', null); if (os) this.ed.os = new Set(os);
    $('#wrap').style.background = this.ed.opt.bg;
    this.addDoc(this.makeDoc('Drawing1'), false);
    this.ui = new UI(this); this.ui.DESC = DESC;
    this.ui.print('Amatu CAD 2027 — ketik perintah (mis. L, PL, C, REC, TR, O, DLI) atau F1 untuk bantuan.', 'ok');
    this.restore();
    window.addEventListener('beforeunload', e => { this.persistSession(); if (this.docs.some(d => d.dirty && !d.saved)) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('resize', () => { this.ed.resize(); this.ui?.fitRibbon(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.persistSession(); });
    this.bindDrop();
  }
  // ---------- dokumen ----------
  makeDoc(name) {
    const d = new Doc(name);
    d.key = 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.initView(d);
    return d;
  }
  initView(d) { const r = $('#wrap').getBoundingClientRect(); d.ui = { view: { scale: Math.max(0.2, (r.width || 1000) / 420), ox: 60, oy: (r.height || 600) - 60 }, space: -1, ms: false, pviews: {}, sel: new Set(), vstack: [] }; }
  addDoc(d, show = true) {
    this.docs.push(d); this.doc = d; this.showStart = false;
    if (show) { $('#startpage').hidden = true; this.ed.clearSel?.(); this.ui?.refresh(); this.ed.invalidate(); }
    return d;
  }
  switchDoc(i) {
    if (this.ed.cmd) this.ed.cancel();
    this.doc = this.docs[i]; this.showStart = false; $('#startpage').hidden = true;
    this.ui.refresh(); this.ed.invalidate(); this.ui.focusCmd();
  }
  nextDoc(d) { if (!this.docs.length) return; const i = this.docs.indexOf(this.doc); this.switchDoc((i + d + this.docs.length) % this.docs.length); }
  newDoc(opt = {}) {
    let n = 1; while (this.docs.some(d => d.name === 'Drawing' + n)) n++;
    const d = this.makeDoc(opt.name || 'Drawing' + n);
    if (opt.sample) { buildSample(d); }
    if (opt.layout) { d.layouts[0].paper = opt.layout; }
    this.addDoc(d);
    if (opt.sample) { setTimeout(() => this.ed.zoomExtents(), 30); }
    this.persistSession();
    return d;
  }
  closeDoc(i = this.docs.indexOf(this.doc)) {
    const d = this.docs[i]; if (!d) return;
    if (d.dirty && !confirm(`Simpan perubahan ke ${d.name}? (Batal = tutup tanpa menyimpan disarankan hanya jika sudah tersimpan)\n\nOK = tutup tanpa menyimpan · Cancel = kembali`)) return;
    this.docs.splice(i, 1);
    if (!this.docs.length) { this.doc = this.makeDoc('Drawing1'); this.docs.push(this.doc); this.showStartPage(true); }
    else this.doc = this.docs[Math.min(i, this.docs.length - 1)];
    this.ui.refresh(); this.ed.invalidate(); this.persistSession();
  }
  closeOthers(i) { const keep = this.docs[i]; this.docs = [keep]; this.doc = keep; this.ui.refresh(); this.ed.invalidate(); this.persistSession(); }
  showStartPage(on) {
    this.showStart = on; const sp = $('#startpage'); sp.hidden = !on;
    if (on) { if (this.ed.cmd) this.ed.cancel(); this.buildStart(); }
    this.ui.buildFileTabs();
  }
  exec(text) {
    text = String(text).trim();
    const name = this.ed.findCmd(text.split(/\s+/)[0]);
    if (!name) { this.ui.print(`Unknown command "${text}"`, 'err'); return; }
    if (this.showStart && !CMDS[name].startOk) this.showStartPage(false);
    this.ed.run(name, text.split(/\s+/).slice(1));
    this.ui.focusCmd();
  }
  mutate(fn) {
    if (this.ed.cmd) { fn(); this.ed.invalidate(); return; }
    this.doc.begin(); fn(); if (this.doc.commit()) this.onChange(); this.ed.invalidate();
  }
  async mutateAsync(fn) { this.doc.begin(); await fn(); if (this.doc.commit()) this.onChange(); this.ed.invalidate(); }
  onChange() {
    this.doc.dirty = true; this.doc.saved = false;
    this.ui?.setTitle(); this.ui?.buildFileTabs();
    clearTimeout(this._as); this._as = setTimeout(() => this.autosave(), 1500);
  }
  autosave() {
    if (!this.ed.opt.autosave) return;
    for (const d of this.docs) if (d.dirty || !d._stored) { this.storeDoc(d); d._stored = true; }
    this.persistSession();
  }
  persistSession() {
    LS.set('amatucad-session', { keys: this.docs.filter(d => d.model.length || d.dirty).map(d => d.key), cur: this.doc?.key });
    LS.set('amatucad-toggles', this.ed.T); LS.set('amatucad-osnap', [...this.ed.os]);
    for (const d of this.docs) if (d.model.length && (d.dirty || !d._stored)) { this.storeDoc(d); d._stored = true; }
  }
  storeDoc(d) {
    const keys = d.imgKeys();
    d._imgSaved ||= new Set();
    for (const k of keys) if (!d._imgSaved.has(k) && d.imgs[k]) { idb.put('img|' + k, { img: d.imgs[k], ts: 0 }); d._imgSaved.add(k); }
    idb.put(d.key, { name: d.name, data: d.toFile({ noImgs: true }), ts: Date.now(), fmt: d.fileFmt || 'amcad', imgKeys: keys });
  }
  async loadImgs(d, keys) {
    let n = 0; d._imgSaved ||= new Set();
    for (const k of keys || []) { if (d.imgs[k]) continue; const r = await idb.get('img|' + k); if (r?.img) { d.imgs[k] = r.img; d._imgSaved.add(k); n++; } }
    if (n) this.ed.invalidate();
  }
  saveOpts() { LS.set('amatucad-opt', this.ed.opt); }
  async restore() {
    const S = LS.get('amatucad-session', null);
    const raw = await idb.all(), all = raw.filter(x => !String(x.key).startsWith('img|')).sort((a, b) => b.ts - a.ts);
    this.recent = all;
    // pangkas riwayat lama + gambar raster yang tak lagi dipakai dokumen mana pun
    all.slice(30).forEach(x => idb.del(x.key));
    const used = new Set(all.slice(0, 30).flatMap(x => x.imgKeys || []));
    raw.filter(x => String(x.key).startsWith('img|') && !used.has(String(x.key).slice(4))).forEach(x => idb.del(x.key));
    if (S && S.keys?.length) {
      const docs = [];
      for (const k of S.keys) { const r = all.find(x => x.key === k); if (!r) continue; try { const d = this.makeDoc(r.name); d.key = k; d.load(JSON.parse(r.data)); d._stored = true; docs.push(d); this.loadImgs(d, r.imgKeys); } catch (e) { console.warn(e); } }
      if (docs.length) {
        this.docs = docs; this.doc = docs.find(d => d.key === S.cur) || docs[0];
        this.ui.refresh(); setTimeout(() => this.ed.zoomExtents(), 50);
        this.ui.print(`Drawing Recovery: ${docs.length} gambar dipulihkan dari sesi sebelumnya.`, 'ok');
        return;
      }
    }
    this.ui.refresh();
    this.showStartPage(true);
  }
  recentList() { return this.recent.map(r => ({ key: r.key, name: r.name, ts: r.ts })); }
  async openRecent(key) {
    const open = this.docs.findIndex(d => d.key === key); if (open >= 0) { this.switchDoc(open); return; }
    const r = await idb.get(key); if (!r) { toast('Data tidak ditemukan.'); return; }
    const d = this.makeDoc(r.name); d.key = key; d.load(JSON.parse(r.data)); d._stored = true; this.loadImgs(d, r.imgKeys);
    this.replaceBlankOrAdd(d); setTimeout(() => this.ed.zoomExtents(), 30);
  }
  replaceBlankOrAdd(d) {
    const blank = this.docs.length === 1 && !this.docs[0].model.length && !this.docs[0].dirty;
    if (blank) this.docs = [];
    this.addDoc(d); this.persistSession();
  }

  // ---------- file ----------
  async open() {
    const accept = '.amcad,.dxf,.json,.dwg';
    let file;
    if (window.showOpenFilePicker) {
      try { const [hd] = await showOpenFilePicker({ types: [{ description: 'Drawing (*.amcad, *.dxf)', accept: { 'application/octet-stream': ['.amcad', '.dxf', '.json', '.dwg'] } }] }); file = await hd.getFile(); file._h = hd; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    if (!file) file = await new Promise(res => { const i = $('#filein'); i.accept = accept; i.value = ''; i.onchange = () => res(i.files[0]); i.click(); });
    if (file) this.openFile(file);
  }
  async openFile(file) {
    const name = file.name.replace(/\.(amcad|dxf|json|dwg)$/i, '');
    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (ext === 'dwg') { this.ui.alert('Format DWG', h('div', { class: 'col' }, h('p', {}, 'File DWG adalah format biner tertutup milik Autodesk dan belum bisa dibaca langsung di browser.'), h('p', {}, 'Cara cepat: di AutoCAD jalankan SAVEAS → pilih "AutoCAD 2018 DXF", atau gunakan ODA File Converter (gratis) untuk DWG → DXF, lalu buka DXF-nya di sini.'))); return; }
    const text = await file.text();
    let d = this.makeDoc(name);
    try {
      if (ext === 'dxf' || /^\s*0\s*\r?\n\s*SECTION/.test(text)) {
        const R = parseDXF(text);
        Object.entries(R.layers).forEach(([n, L]) => d.layers[n] = { ...d.layers[n], ...L });
        Object.entries(R.ltypes).forEach(([n, L]) => { if (!LTYPES[n]) LTYPES[n] = L; if (!d.ltypes.includes(n)) d.ltypes.push(n); });
        Object.values(d.layers).forEach(L => { if (!LTYPES[L.lt]) L.lt = 'Continuous'; else if (!d.ltypes.includes(L.lt)) d.ltypes.push(L.lt); });
        d.blocks = R.blocks;
        R.ents.forEach(e => { delete e._ps; d.prep(e); d.model.push(e); });
        Object.values(d.blocks).forEach(b => b.ents.forEach((e, i) => { delete e._ps; e.id = i + 1; }));
        R.paper.forEach(e => { delete e._ps; d.prep(e); d.layouts[0].ents.push(e); });
        const iu = parseInt(R.header.$INSUNITS?.[0] || '4', 10); d.set.units = UNITS_FROM_INS[iu] || 'mm';
        if (R.header.$LTSCALE) d.set.ltscale = parseFloat(R.header.$LTSCALE[0]) || 1;
        if (R.header.$DIMSCALE) d.dim.scale = parseFloat(R.header.$DIMSCALE[0]) || 1;
        const ver = DXF_VERSIONS.find(v => v.acad === R.header.$ACADVER?.[0]);
        d.fileFmt = ver ? ver.key : 'R2018';
        this.ui.print(`DXF dibuka: ${R.ents.length} objek, ${Object.keys(R.layers).length} layer, ${Object.keys(R.blocks).length} blok${ver ? ' (' + ver.label + ')' : ''}.`, 'ok');
        if (R.warn.size) this.ui.print('Dilewati (belum didukung): ' + [...R.warn].join(', '));
      } else {
        const o = JSON.parse(text); d.load(o); if (o.name) d.name = name; d.fileFmt = 'amcad';
      }
    } catch (e) { console.error(e); this.ui.alert('Gagal membuka file', 'File tidak valid atau rusak: ' + e.message); return; }
    d.handle = file._h || null; d.fileName = file.name; d.dirty = false;
    this.replaceBlankOrAdd(d);
    setTimeout(() => this.ed.zoomExtents(), 30);
    this.autosave();
  }
  async save() {
    const d = this.doc;
    if (d.handle && d.fileFmt) { try { await this.writeTo(d.handle, d, d.fileFmt); return; } catch (e) { console.warn(e); } }
    return this.saveAs();
  }
  saveAs() {
    const d = this.doc;
    const nameIn = h('input', { value: d.name, style: { width: '100%' }, autofocus: true });
    let fmt = d.fileFmt || 'amcad';
    const types = [['amcad', 'Amatu CAD Drawing (*.amcad) — lengkap dengan layout & kop'], ...DXF_VERSIONS.map(v => [v.key, v.label + ' (*.dxf)'])];
    const note = h('div', { class: 'hint' });
    const upd = () => { const v = DXF_VERSIONS.find(x => x.key === fmt); note.textContent = v ? `Dibuka langsung oleh AutoCAD ${v.years}. Di AutoCAD dapat disimpan ulang sebagai DWG versi apa pun.` : 'Format asli aplikasi ini — menyimpan semua data (dimensi asosiatif, layout, kop gambar).'; };
    upd();
    win({ title: 'Save Drawing As', width: 520, body: h('div', { class: 'col' }, h('div', { class: 'grid2' }, 'File name:', nameIn, 'Files of type:', sel(types, fmt, x => { fmt = x; upd(); })), note), buttons: [{ label: 'Save', pri: true, fn: async w => { w.close(); d.name = nameIn.value.trim() || d.name; await this.saveFile(d, fmt); } }, { label: 'Cancel', fn: w => w.close() }] });
  }
  async saveFile(d, fmt) {
    const ext = fmt === 'amcad' ? '.amcad' : '.dxf';
    const fname = d.name + ext;
    if (window.showSaveFilePicker) {
      try {
        const hd = await showSaveFilePicker({ suggestedName: fname, types: [{ description: fmt === 'amcad' ? 'Amatu CAD Drawing' : (DXF_VERSIONS.find(v => v.key === fmt)?.label || 'DXF'), accept: { 'application/octet-stream': [ext] } }] });
        await this.writeTo(hd, d, fmt); d.handle = hd; d.fileFmt = fmt; return;
      } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
    }
    const blob = await this.serialize(d, fmt); download(blob, fname);
    d.fileFmt = fmt; this.markSaved(d, fname);
  }
  async serialize(d, fmt) { if (fmt === 'amcad') return new Blob([d.toFile()], { type: 'application/json' }); return new Blob([await exportDXF(d, { ver: fmt })], { type: 'application/dxf' }); }
  async writeTo(hd, d, fmt) { const w = await hd.createWritable(); await w.write(await this.serialize(d, fmt)); await w.close(); this.markSaved(d, hd.name); }
  markSaved(d, fname) { d.dirty = false; d.saved = true; this.ui.print(`Saved: ${fname}`, 'ok'); this.ui.setTitle(); this.ui.buildFileTabs(); this.autosave(); }
  async exportDXF(ents, name = 'export') {
    const ver = this.lastDxf || 'R2018';
    const txt = await exportDXF(this.doc, { ver, ents });
    download(new Blob([txt], { type: 'application/dxf' }), `${this.doc.name}-${name}.dxf`);
    this.ui.print(`WBLOCK: ${ents.length} objek ditulis ke DXF (${DXF_VERSIONS.find(v => v.key === ver).label}).`, 'ok');
  }
  bindDrop() {
    const w = document.body;
    w.addEventListener('dragover', e => { e.preventDefault(); });
    w.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (!f) return; if (/^image\//.test(f.type)) imageChoice(this, f); else this.openFile(f); });
    // tempel gambar (Ctrl+V) saat fokus di command line / kanvas → Auto Trace atau sisipkan
    document.addEventListener('paste', e => {
      const t = e.target; if (t?.closest?.('.win') && t !== $('#cmdin')) return;
      const f = [...(e.clipboardData?.files || [])].find(x => /^image\//.test(x.type)); if (!f) return;
      e.preventDefault(); imageChoice(this, f);
    });
  }
  async attachImage(file) {
    if (!file) file = await new Promise(res => { const i = $('#filein'); i.accept = 'image/*'; i.value = ''; i.onchange = () => res(i.files[0]); i.click(); });
    if (!file) return;
    const src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    const im = new Image(); im.src = src; await im.decode().catch(() => { });
    const ar = (im.naturalHeight || 1) / (im.naturalWidth || 1);
    this.ed.imgPending = { src, ar, name: file.name };
    this.exec('IMAGEPLACE');
  }
  newLayout() {
    this.mutate(() => { let i = this.doc.layouts.length + 1; while (this.doc.layouts.some(l => l.name === 'Layout' + i)) i++; const L = newLayout('Layout' + i); L.tb = { ...(this.doc.layouts[0]?.tb || L.tb) }; this.doc.layouts.push(L); });
    this.ui.setSpace(this.doc.layouts.length - 1);
  }

  // ---------- Plot / ekspor ----------
  curLayoutOrAuto(paper = 'A3') {
    const L = this.ed.layout; if (L) { fitVp(L, this.doc); return L; }
    const ext = this.doc.extents(this.doc.model);
    return tempLayout(this.doc, { paper, orient: 'L', area: bbOk(ext) ? ext : { x1: 0, y1: 0, x2: 420, y2: 297 }, tb: this.doc.layouts[0]?.tb });
  }
  plotDialog(previewOnly) {
    const doc = this.doc, ed = this.ed, cur = ed.layout;
    const st = { out: 'pdf', paper: cur?.paper || 'A3', orient: cur?.orient || 'L', area: cur ? 'layout' : 'extents', scale: 'fit', ctb: 'monochrome', lw: true, tb: true, all: false, win: null, dpi: 200 };
    const cv = h('canvas', { width: 520, height: 368 });
    const prev = h('div', { class: 'plotprev' }, cv);
    const build = () => {
      if (st.area === 'layout' && cur) { const L = JSON.parse(JSON.stringify(cur)); L.paper = st.paper; L.orient = st.orient; L.tb = { ...L.tb, on: st.tb }; L.vp = { ...fitVp(cur, doc) }; const F = fitVp(L, doc); void F; return L; }
      const area = st.area === 'window' && st.win ? st.win : st.area === 'display' ? (() => { const v = ed.view; const a = ed.s2w(0, v.h), b = ed.s2w(v.w, 0); return rectOf(a, b); })() : doc.extents(doc.model);
      const u = UNIT_MM[doc.set.units] || 1;
      return tempLayout(doc, { paper: st.paper, orient: st.orient, area: bbOk(area) ? area : { x1: 0, y1: 0, x2: 1000, y2: 700 }, tb: { ...(cur?.tb || doc.layouts[0]?.tb || newLayout('x').tb), on: st.tb }, scale: st.scale === 'fit' ? 0 : u / +st.scale, fit: st.scale === 'fit' });
    };
    const draw = () => {
      const L = build(), [W, H] = paperSize(L), k = Math.min(500 / W, 350 / H);
      cv.width = Math.round(W * k * 2); cv.height = Math.round(H * k * 2); cv.style.width = W * k + 'px'; cv.style.height = H * k + 'px';
      const x = cv.getContext('2d');
      drawLayout(x, L, doc, { scale: k * 2, ox: 0, oy: H * k * 2, w: cv.width, h: cv.height }, { export: true, mono: st.ctb === 'monochrome', lwt: st.lw });
      info.textContent = `Kertas ${L.paper} ${L.orient === 'P' ? 'Portrait' : 'Landscape'} (${W} × ${H} mm) · Skala ${scaleLabel(L.vp.s, doc.set.units)}`;
    };
    const info = h('div', { class: 'hint' });
    const scaleSel = sel([['fit', 'Fit to paper'], ...SCALES.map(n => [n, '1:' + n])], st.scale, x => { st.scale = x; draw(); });
    const left = h('div', { class: 'col', style: { minWidth: '270px' } },
      h('fieldset', {}, h('legend', {}, 'Printer/plotter'), sel([['pdf', 'AutoPDF — Vektor PDF (Gambar Kerja)'], ['png', 'PNG — Raster'], ['svg', 'SVG — Vektor']], st.out, x => { st.out = x; })),
      h('fieldset', {}, h('legend', {}, 'Paper size'), h('div', { class: 'row' }, sel(Object.keys(PAPERS), st.paper, x => { st.paper = x; draw(); }), sel([['L', 'Landscape'], ['P', 'Portrait']], st.orient, x => { st.orient = x; draw(); }))),
      h('fieldset', {}, h('legend', {}, 'Plot area'), h('div', { class: 'row' }, sel([...(cur ? [['layout', 'Layout']] : []), ['extents', 'Extents'], ['display', 'Display'], ['window', 'Window']], st.area, async x => { st.area = x; if (x === 'window') { w.el.style.display = 'none'; try { await this.pickWindow(st); } finally { w.el.style.display = ''; } } draw(); }))),
      h('fieldset', {}, h('legend', {}, 'Plot scale'), scaleSel, h('div', { class: 'hint', style: { marginTop: '4px' } }, 'Area Layout memakai skala viewport layout.')),
      h('fieldset', {}, h('legend', {}, 'Plot style table (pen assignments)'), sel([['monochrome', 'monochrome.ctb (hitam)'], ['acad', 'acad.ctb (warna)'], ['gray', 'Grayscale.ctb']], st.ctb, x => { st.ctb = x; draw(); })),
      h('fieldset', {}, h('legend', {}, 'Plot options'), h('div', { class: 'col' }, chk('Plot object lineweights', st.lw, v => { st.lw = v; draw(); }), chk('Kop gambar (title block)', st.tb, v => { st.tb = v; draw(); }), chk('Plot semua layout (PDF multi-halaman)', st.all, v => { st.all = v; }), h('button', { class: 'btn sm', onclick: () => { this.pageSetupDialog(() => draw()); } }, 'Edit kop / Page Setup…'))));
    const body = h('div', { class: 'row', style: { alignItems: 'flex-start', flexWrap: 'nowrap', gap: '14px' } }, left, h('div', { class: 'col', style: { flex: 1, minWidth: '300px' } }, prev, info));
    const w = win({ title: `Plot — ${cur ? cur.name : 'Model'}`, body, width: Math.min(900, innerWidth - 20), buttons: [
      { label: 'Apply to Layout', fn: () => { if (cur) { this.mutate(() => { cur.paper = st.paper; cur.orient = st.orient; cur.tb.on = st.tb; cur.ctb = st.ctb + '.ctb'; }); this.ui.refresh(); toast('Disimpan ke layout.'); } } },
      { label: 'OK', pri: true, fn: async () => {
        const opt = { mono: st.ctb === 'monochrome', gray: st.ctb === 'gray', lw: st.lw };
        const pages = st.all ? doc.layouts.map(L => { fitVp(L, doc); return L; }) : [build()];
        const nm = `${doc.name}${st.all ? '' : '-' + (cur ? cur.name : 'Model')}`;
        if (st.out === 'pdf') download(await exportPDF(pages, doc, opt), nm + '.pdf');
        else if (st.out === 'svg') pages.forEach((L, i) => download(exportSVG(L, doc, opt), nm + (pages.length > 1 ? '-' + (i + 1) : '') + '.svg'));
        else for (const [i, L] of pages.entries()) download(await renderPNG(L, doc, st.dpi, opt), nm + (pages.length > 1 ? '-' + (i + 1) : '') + '.png');
        this.ui.print(`Plot selesai: ${pages.length} halaman (${st.out.toUpperCase()}).`, 'ok'); w.close();
      } }, { label: 'Cancel', fn: x => x.close() }] });
    draw();
    void previewOnly;
  }
  async pickWindow(st) {
    try { const a = await this.ed.ask({ type: 'point', msg: 'Specify first corner:' }); const b = await this.ed.ask({ type: 'point', msg: 'Specify opposite corner:', base: a, rubber: 'rect' }); st.win = rectOf(a, b); } catch { }
  }
  pageSetupDialog(after) {
    const ed = this.ed, doc = this.doc;
    const L = ed.layout || doc.layouts[0]; if (!L) return;
    const T = { ...L.tb }, st = { paper: L.paper, orient: L.orient, scale: 'keep' };
    const vp = fitVp(L, doc), u = UNIT_MM[doc.set.units];
    const f = (k, l, ta) => [h('label', {}, l), ta ? h('textarea', { rows: 2, onchange: e => T[k] = e.target.value }, T[k] || '') : h('input', { value: T[k] || '', onchange: e => T[k] = e.target.value })];
    const body = h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '14px' } },
      h('div', { class: 'col', style: { minWidth: '250px' } },
        h('fieldset', {}, h('legend', {}, 'Paper'), h('div', { class: 'grid2' }, 'Size:', sel(Object.keys(PAPERS), st.paper, x => st.paper = x), 'Orientation:', sel([['L', 'Landscape'], ['P', 'Portrait']], st.orient, x => st.orient = x))),
        h('fieldset', {}, h('legend', {}, 'Viewport scale'), sel([['keep', 'Tetap (' + scaleLabel(vp.s, doc.set.units) + ')'], ['auto', 'Auto fit — skala standar'], ...SCALES.map(n => [n, '1:' + n])], 'keep', x => st.scale = x)),
        h('fieldset', {}, h('legend', {}, 'Kop gambar'), chk('Tampilkan kop (title block)', T.on, v => T.on = v), h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Kop gaya Indonesia di sisi kanan: konsultan, proyek, lokasi, judul, skala, paraf, tanggal, catatan, nomor lembar.'))),
      h('div', { class: 'grid2', style: { flex: 1 } }, ...f('company', 'Konsultan / Instansi'), ...f('project', 'Proyek'), ...f('location', 'Lokasi'), ...f('title', 'Judul gambar', true), ...f('drawn', 'Digambar'), ...f('checked', 'Diperiksa'), ...f('approved', 'Disetujui'), ...f('date', 'Tanggal'), ...f('rev', 'Revisi'), ...f('no', 'No. gambar'), ...f('sheet', 'Lembar'), ...f('notes', 'Catatan', true)));
    win({ title: `Page Setup — ${L.name}`, body, width: Math.min(820, innerWidth - 20), buttons: [{ label: 'OK', pri: true, fn: w => {
      this.mutate(() => { L.paper = st.paper; L.orient = st.orient; L.tb = T; fitVp(L, doc); if (st.scale === 'auto') fitVp(L, doc, true); else if (st.scale !== 'keep') L.vp.s = u / +st.scale; });
      w.close(); this.ui.refresh(); ed.invalidate(); after?.();
    } }, { label: 'Cancel', fn: w => w.close() }] });
  }
  exportDialog(preset) {
    const doc = this.doc, ed = this.ed;
    const st = { fmt: preset || 'pdfall', ver: this.lastDxf || 'R2018', sheet: '', vis: true, H: 3000, walls: true, faces: true };
    const body = h('div', { class: 'col' });
    const fmts = [['pdfall', 'gambar', 'PDF Gambar Kerja — semua layout (multi-halaman, kop otomatis)'], ['pdf', 'pdf', 'PDF — layout aktif / model (auto skala)'], ['dxf', 'dxf', 'AutoCAD DXF — pilih versi tahun'], ['dae', 'skp', 'SketchUp — COLLADA .dae (Import di SketchUp)'], ['svg', 'svg', 'SVG — vektor'], ['png', 'png', 'PNG — gambar 200 dpi']];
    const draw = () => {
      body.innerHTML = '';
      const list = h('div', { class: 'list', style: { maxHeight: 'none' } }, ...fmts.map(([k, i, l]) => h('div', { class: st.fmt === k ? 'on' : '', onclick: () => { st.fmt = k; draw(); } }, h('span', { html: icon(i), style: { width: '22px' } }), l)));
      body.append(list);
      if (st.fmt === 'dxf') body.append(h('fieldset', {}, h('legend', {}, 'Versi AutoCAD'), h('div', { class: 'list', style: { maxHeight: '220px' } }, ...DXF_VERSIONS.map(v => h('div', { class: st.ver === v.key ? 'on' : '', onclick: () => { st.ver = v.key; draw(); } }, h('b', { style: { width: '190px' } }, v.label), h('span', { class: 'hint' }, v.years, ' · ', v.acad))))),
        h('div', { class: 'grid2', style: { marginTop: '8px' } }, 'Sertakan kop:', sel([['', '— hanya Model space —'], ...doc.layouts.map((L, i) => [String(i), `Layout "${L.name}" (kop diskalakan ke model)`])], st.sheet, x => st.sheet = x), '', chk('Hanya layer yang terlihat', st.vis, v => st.vis = v)),
        h('div', { class: 'note', style: { marginTop: '8px' } }, 'DXF dibuka langsung di AutoCAD tahun tersebut (dan versi lebih baru). Untuk file .dwg: buka DXF di AutoCAD lalu SAVEAS → DWG versi yang sama. Dimensi diekspor sebagai DIMENSION asli, hatch sebagai HATCH, blok sebagai BLOCK/INSERT.'));
      if (st.fmt === 'dae') body.append(h('fieldset', {}, h('legend', {}, 'Opsi 3D'), h('div', { class: 'grid2' }, 'Tinggi ekstrusi (' + doc.set.units + '):', num(st.H, x => st.H = x >= 0 ? x : 0), '', chk('Ekstrusi semua garis jadi dinding', st.walls, v => st.walls = v), '', chk('Buat face pada area tertutup', st.faces, v => st.faces = v))),
        h('div', { class: 'note', style: { marginTop: '8px' } }, 'Format .skp milik Trimble tidak terbuka untuk ditulis langsung dari web. File .dae ini dibuka SketchUp lewat File → Import (setiap layer menjadi grup/tag). Untuk SketchUp Pro, DXF juga dapat di-import.'));
      if (st.fmt === 'pdfall') body.append(h('div', { class: 'note' }, `${doc.layouts.length} layout akan dicetak: ${doc.layouts.map(L => `${L.name} (${L.paper}${L.vp ? ', ' + scaleLabel(L.vp.s, doc.set.units) : ''})`).join(' · ')}. Edit kop melalui Page Setup.`));
    };
    draw();
    win({ title: 'Export Data', body, width: 600, buttons: [{ label: 'Page Setup…', fn: () => this.pageSetupDialog() }, { label: 'Export', pri: true, fn: async w => {
      w.close();
      try {
        if (st.fmt === 'pdfall') return this.autoSheet();
        if (st.fmt === 'pdf') { download(await exportPDF([this.curLayoutOrAuto()], doc, { mono: true }), `${doc.name}.pdf`); return; }
        if (st.fmt === 'svg') { download(exportSVG(this.curLayoutOrAuto(), doc, { mono: true }), `${doc.name}.svg`); return; }
        if (st.fmt === 'png') { download(await renderPNG(this.curLayoutOrAuto(), doc, 200, { mono: false }), `${doc.name}.png`); return; }
        if (st.fmt === 'dae') { download(exportDAE(doc, { height: st.H, walls: st.walls, faces: st.faces }), `${doc.name}-sketchup.dae`); this.ui.print('DAE untuk SketchUp diekspor (File → Import di SketchUp).', 'ok'); return; }
        if (st.fmt === 'dxf') {
          this.lastDxf = st.ver;
          const txt = await exportDXF(doc, { ver: st.ver, sheet: st.sheet !== '' ? doc.layouts[+st.sheet] : null, visibleOnly: st.vis });
          const v = DXF_VERSIONS.find(x => x.key === st.ver);
          download(new Blob([txt], { type: 'application/dxf' }), `${doc.name}_${v.key}.dxf`);
          this.ui.print(`DXF diekspor: ${v.label} ($ACADVER ${v.acad}).`, 'ok');
        }
      } catch (e) { console.error(e); this.ui.alert('Export gagal', e.message); }
    } }, { label: 'Cancel', fn: w => w.close() }] });
  }
  async autoSheet() {
    const doc = this.doc;
    if (!doc.model.length) { toast('Model masih kosong.'); return; }
    doc.layouts.forEach(L => fitVp(L, doc));
    const blob = await exportPDF(doc.layouts, doc, { mono: true, lw: true });
    download(blob, `${doc.name}-gambar-kerja.pdf`);
    this.ui.print(`Gambar kerja PDF: ${doc.layouts.length} lembar (${doc.layouts.map(L => L.paper + ' ' + scaleLabel(L.vp.s, doc.set.units)).join(', ')}).`, 'ok');
    toast('PDF gambar kerja dibuat ✓');
  }

  // ---------- Start page ----------
  buildStart() {
    const sp = $('#startpage'); sp.innerHTML = '';
    const act = (i, t, s, fn) => h('button', { onclick: fn }, h('span', { html: icon(i) }), h('span', {}, t, h('small', {}, s)));
    const recent = this.recent.slice(0, 8);
    const cards = h('div', { class: 'sp-cards' });
    const card = (t, s, fn, draw) => { const c = h('canvas', { width: 380, height: 240 }); cards.append(h('button', { class: 'sp-card', onclick: fn }, c, h('div', {}, h('b', {}, t), h('small', {}, s)))); setTimeout(() => draw(c), 0); };
    const thumb = (d, c) => { const x = c.getContext('2d'); x.fillStyle = '#212830'; x.fillRect(0, 0, c.width, c.height); const bb = d.extents(d.model); if (!bbOk(bb)) return; const s = Math.min((c.width - 20) / (bb.x2 - bb.x1 || 1), (c.height - 20) / (bb.y2 - bb.y1 || 1)); import('./render.js').then(R => R.drawEntities(x, d.model, d, { scale: s, ox: c.width / 2 - (bb.x1 + bb.x2) / 2 * s, oy: c.height / 2 + (bb.y1 + bb.y2) / 2 * s, w: c.width, h: c.height }, { bg: 'dark', cull: false })); };
    card('Contoh: Denah Rumah Tipe 45', 'As, dinding, kusen, dimensi, kop A3', () => this.newDoc({ sample: true, name: 'Denah-Tipe-45' }), c => { const d = new Doc('x'); buildSample(d); thumb(d, c); });
    for (const r of recent) card(r.name, new Date(r.ts).toLocaleString('id-ID'), () => this.openRecent(r.key), c => { try { const d = new Doc('x'); d.load(JSON.parse(r.data)); thumb(d, c); } catch { } });
    const keys = [['L', 'Line'], ['PL', 'Polyline'], ['C', 'Circle'], ['REC', 'Rectangle'], ['H', 'Hatch'], ['T', 'Mtext'], ['M', 'Move'], ['CO', 'Copy'], ['RO', 'Rotate'], ['TR', 'Trim'], ['EX', 'Extend'], ['O', 'Offset'], ['F', 'Fillet'], ['AR', 'Array'], ['DLI', 'Dim Linear'], ['LA', 'Layer'], ['Ctrl+P', 'Plot PDF'], ['F8', 'Ortho'], ['F3', 'Osnap'], ['F12', 'Dyn input']];
    sp.append(h('div', { class: 'sp-grid' },
      h('div', {}, h('div', { class: 'sp-brand', html: `<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#101c2e"/><path d="M7 25L16 6l9 19M11 18h10" fill="none" stroke="#F2C94C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><div><h1>Amatu CAD 2027</h1><p>Drafting & Annotation · CAD 2D di browser</p></div>` }),
        h('div', { class: 'sp-act' },
          act('new', 'New Drawing', 'Template acadiso (mm) · Ctrl+N', () => this.newDoc()),
          act('sheet', 'New — Gambar Kerja A3', 'Layout A3 + kop Indonesia siap plot', () => { const d = this.newDoc({ layout: 'A3' }); d.layouts[0].tb.title = 'JUDUL GAMBAR'; }),
          act('open', 'Open Files…', 'DXF (R12 – 2018/2027) atau .amcad · Ctrl+O', () => this.open()),
          act('door', 'Contoh Denah Rumah', 'Pelajari fitur dengan contoh', () => this.newDoc({ sample: true, name: 'Denah-Tipe-45' })),
          act('map', 'Site Plan dari Google Maps', 'Cari lokasi → capture → skala riil + tracing otomatis', () => { const blank = !this.doc.model.length; if (!blank) this.newDoc({ name: 'Site-Plan' }); else this.showStartPage(false); openGeoMap(this, { mode: 'poly' }); }),
          act('autotrace', 'Gambar dari Foto / Sketsa', 'Auto Trace: unggah gambar → garis CAD otomatis', () => { const blank = !this.doc.model.length; if (!blank) this.newDoc({ name: 'Auto-Trace' }); else this.showStartPage(false); autoTrace(this); }),
          this.docs.some(d => d.model.length) ? act('start', 'Kembali ke gambar', this.doc.name, () => this.showStartPage(false)) : null,
          act('help', 'Perintah & Shortcut', 'F1', () => D.help(this.ui)))),
      h('div', {}, h('h3', { class: 'sp-h' }, recent.length ? 'Recent Documents & Contoh' : 'Contoh'), cards,
        h('h3', { class: 'sp-h' }, 'Shortcut favorit (sama seperti AutoCAD)'), h('div', { class: 'sp-keys' }, ...keys.map(([k, l]) => h('div', {}, h('kbd', {}, k), ' ', l))),
        h('div', { class: 'note', style: { marginTop: '18px', maxWidth: '760px' } }, 'Ekspor: PDF gambar kerja (vektor, multi-lembar dengan kop), DXF untuk AutoCAD R12, 2000, 2004, 2007, 2010, 2013 sampai 2018–2027, SketchUp (.dae), SVG dan PNG. Semua gambar tersimpan otomatis di browser ini (Drawing Recovery).'))));
  }

  // ---------- perintah tambahan ----------
  registerCommands() {
    const C = (n, fn, o = {}) => { CMDS[n] = { fn, noUndo: true, ...o }; (o.alias || []).forEach(a => ALIAS[a] = n); };
    delete ALIAS.EXPORTPDF; delete ALIAS.EXPORTSKP; delete ALIAS.EXPORTDWG;
    C('EXPORTPDF', async () => download(await exportPDF([this.curLayoutOrAuto()], this.doc, { mono: true }), `${this.doc.name}.pdf`));
    C('AUTOSHEET', () => this.autoSheet(), { alias: ['GAMBARKERJA', 'GK'] });
    C('EXPORT_DXF', () => this.exportDialog('dxf'), { alias: ['EXPORTDWG'] });
    C('EXPORT_SKP', () => this.exportDialog('dae'), { alias: ['EXPORTSKP', 'SKP', 'DAE'] });
    C('EXPORT_SVG', () => download(exportSVG(this.curLayoutOrAuto(), this.doc, { mono: true }), `${this.doc.name}.svg`));
    C('EXPORT_PNG', async () => download(await renderPNG(this.curLayoutOrAuto(), this.doc, 200, {}), `${this.doc.name}.png`));
    C('PLOTPREVIEW', () => this.plotDialog(true), { alias: ['PREVIEW', 'PRE'] });
    C('EXPORT', () => this.exportDialog(), { alias: ['EXP', 'DXFOUT', 'SAVEDXF'] });
    C('LIBRARY', async ed => { const n = await this.ui.insertDialog('lib'); if (n) { ed.insertName = n; setTimeout(() => this.exec('INSERT'), 0); } }, { alias: ['LIB', 'TOOLPALETTES', 'TP'] });
    C('LIBDOOR', async ed => { const n = await this.ui.insertDialog('Pintu & Jendela'); if (n) { ed.insertName = n; setTimeout(() => this.exec('INSERT'), 0); } });
    C('GEOMAP', () => openGeoMap(this), { alias: ['PETA', 'MAPS', 'GMAPS', 'GOOGLEMAPS', 'GEO', 'GEOGRAPHICLOCATION', 'MAP'] });
    C('GEOMAPIMAGE', () => openGeoMap(this, { mode: 'rect' }), { alias: ['CAPTUREMAP', 'MAPCAPTURE'] });
    C('SITEPLAN', () => openGeoMap(this, { mode: 'poly' }), { alias: ['BATASLAHAN', 'SP'] });
    C('ATAP', ed => roofCmd(this, ed), { noUndo: false, alias: ['KLIKATAP', 'TRACEATAP', 'TRACEROOF', 'ROOF'] });
    C('AUTOTRACE', () => { autoTrace(this); }, { alias: ['TRACEIMAGE', 'IMAGETRACE', 'RETRACE', 'AUTOTRACING', 'VECTORIZE', 'TRACEGAMBAR', 'GAMBAROTOMATIS', 'FOTOKEGARIS', 'IMG2CAD', 'AT'] });
    this.pasteImage = () => pasteImage(this);
    C('GEOREMOVE', () => { if (!this.doc.geo) { this.ui.print('Gambar ini belum punya lokasi geografis.'); return; } this.mutate(() => { this.doc.geo = null; }); this.ui.print('Lokasi geografis dihapus.', 'ok'); }, { alias: ['GEOLOCATIONREMOVE'] });
    C('IMAGEPLACE', async ed => {
      const I = ed.imgPending; if (!I) return; ed.imgPending = null;
      const p = await ed.getPoint('Specify insertion point:'); if (!p) return;
      const w = await ed.getDist('Specify scale factor (width) <1000>:', { base: p, def: 1000, preview: q => [{ type: 'image', p, w: Math.max(1, Math.abs(q.x - p.x)), h: Math.max(1, Math.abs(q.x - p.x)) * I.ar, rot: 0 }] });
      const key = 'img' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); ed.doc.imgs[key] = I.src;
      ed.add({ type: 'image', p, w, h: w * I.ar, rot: 0, img: key, name: I.name });
    }, { noUndo: false });
    // toggle UI
    const flip = (k, n) => () => this.ui.flip(k, n);
    C('UI_ORTHO', flip('ortho', 'Ortho'), { transparent: true, noEcho: true }); C('UI_GRID', flip('grid', 'Grid'), { transparent: true, noEcho: true }); C('UI_SNAP', flip('snap', 'Snap'), { transparent: true, noEcho: true });
    C('UI_OSNAP', flip('osnap', 'Osnap'), { transparent: true, noEcho: true }); C('UI_POLAR', flip('polar', 'Polar'), { transparent: true, noEcho: true }); C('UI_DYN', flip('dyn', 'Dynamic Input'), { transparent: true, noEcho: true });
    C('UI_PROPS', () => this.ui.togglePalette('props'), { transparent: true, noEcho: true });
    C('UI_QP', () => { this.ed.T.qp = !this.ed.T.qp; this.ui.refreshStatus(); }, { transparent: true, noEcho: true });
    C('UI_FILETABS', () => { const f = $('#filetabs'); f.style.display = f.style.display === 'none' ? '' : 'none'; $('#app').style.gridTemplateRows = f.style.display === 'none' ? '34px auto auto 0 1fr 28px' : ''; this.ed.resize(); }, { noEcho: true });
    C('UI_LAYOUTTABS', () => { const f = $('#ltabs'); f.style.display = f.style.display === 'none' ? '' : 'none'; }, { noEcho: true });
    C('UI_NAVBAR', () => { const n = $('#navbar'); n.style.display = n.style.display === 'none' ? '' : 'none'; }, { noEcho: true, alias: ['NAVBAR'] });
    C('UI_THEME', () => this.ui.toggleTheme(), { noEcho: true });
    C('UI_RIBMIN', () => { $('#app').classList.toggle('ribmin'); this.ed.resize(); this.ui.fitRibbon(); }, { noEcho: true });
    C('UI_ZOOMIN', ed => ed.zoomAt(ed.view.w / 2, ed.view.h / 2, 1.5), { transparent: true, noEcho: true });
    C('UI_ZOOMOUT', ed => ed.zoomAt(ed.view.w / 2, ed.view.h / 2, 1 / 1.5), { transparent: true, noEcho: true });
    // kontrol tab Hatch Creation (mengirim opsi ke perintah HATCH aktif)
    const hk = k => ed => { if (ed.cmd === 'HATCH') ed.submit(k); };
    C('HATCHPICK', () => { }, { transparent: true, noEcho: true }); C('HATCHSEL', hk('Select objects'), { transparent: true, noEcho: true }); C('HATCHUNDO', hk('Undo'), { transparent: true, noEcho: true }); C('HATCHCLOSE', hk(''), { transparent: true, noEcho: true });
    // layer tools
    const L = (n, fn, o = {}) => { CMDS[n] = { fn, ...o }; (o.alias || []).forEach(a => ALIAS[a] = n); };
    const pickLayers = async (ed, msg) => { const S = await ed.getSel(msg, { pickfirst: true }); return [...new Set(S.map(e => e.layer))]; };
    L('LAYMCUR', async ed => { const r = await ed.getEnt('Select object whose layer will become current:'); ed.doc.clayer = r.e.layer; ed.msg(`${r.e.layer} is now the current layer.`); this.ui.refresh(); });
    L('LAYISO', async ed => { const ls = await pickLayers(ed, 'Select objects on the layer(s) to be isolated:'); if (!ls.length) return; ed.doc._layiso = Object.fromEntries(Object.entries(ed.doc.layers).map(([n, l]) => [n, l.on])); Object.entries(ed.doc.layers).forEach(([n, l]) => l.on = ls.includes(n)); if (!ls.includes(ed.doc.clayer)) ed.doc.clayer = ls[0]; ed.msg(`Layer(s) ${ls.join(', ')} have been isolated.`); this.ui.refresh(); });
    L('LAYUNISO', async ed => { const s = ed.doc._layiso; if (!s) { ed.msg('No layers isolated with LAYISO.'); return; } Object.entries(s).forEach(([n, on]) => { if (ed.doc.layers[n]) ed.doc.layers[n].on = on; }); ed.doc._layiso = null; ed.msg('Layers isolated by LAYISO command have been restored.'); this.ui.refresh(); });
    L('LAYOFF', async ed => { for (;;) { const r = await ed.getEnt('Select an object on the layer to be turned off or [Settings/Undo]:', { kws: ['Settings', 'Undo'] }); if (!r || typeof r !== 'object') break; ed.doc.layers[r.e.layer].on = false; ed.msg(`Layer "${r.e.layer}" has been turned off.`); ed.invalidate(); this.ui.refresh(); } });
    L('LAYFRZ', async ed => { for (;;) { const r = await ed.getEnt('Select an object on the layer to be frozen or [Settings/Undo]:', { kws: ['Settings', 'Undo'] }); if (!r || typeof r !== 'object') break; if (r.e.layer === ed.doc.clayer) { ed.msg('Cannot freeze the current layer.'); continue; } ed.doc.layers[r.e.layer].frz = true; ed.msg(`Layer "${r.e.layer}" has been frozen.`); ed.invalidate(); this.ui.refresh(); } });
    L('LAYLCK', async ed => { const r = await ed.getEnt('Select an object on the layer to be locked:'); ed.doc.layers[r.e.layer].lck = true; ed.msg(`Layer "${r.e.layer}" has been locked.`); this.ui.refresh(); });
    L('LAYULK', async ed => { const r = await ed.getEnt('Select an object on the layer to be unlocked:'); ed.doc.layers[r.e.layer].lck = false; ed.msg(`Layer "${r.e.layer}" has been unlocked.`); this.ui.refresh(); });
    L('LAYON', async ed => { Object.values(ed.doc.layers).forEach(l => l.on = true); ed.msg('All layers have been turned on.'); this.ui.refresh(); });
    L('LAYTHW', async ed => { Object.values(ed.doc.layers).forEach(l => l.frz = false); ed.msg('All layers have been thawed.'); this.ui.refresh(); });
    L('LAYMATCH', async ed => { const S = await ed.getSel('Select objects to be changed:'); if (!S.length) return; const r = await ed.getEnt('Select object on destination layer or [Name]:', { kws: ['Name'] }); let ln = r?.e?.layer; if (r === 'Name') ln = await ed.getStr('Enter layer name:'); if (!ln || !ed.doc.layers[ln]) return; S.forEach(e => e.layer = ln); ed.msg(`${S.length} object(s) changed to layer "${ln}".`); this.ui.refresh(); });
  }
}

window.addEventListener('error', e => { console.error(e.error || e.message); });
const app = new App();
window.amatucad = app;
