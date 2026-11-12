// Shell UI: QAT, ribbon, command line + autocomplete, status bar, palet Properties, dynamic input, editor teks, Start page, keyboard.
import { $, $$, h, esc, win, menu, closeMenu, setMenu, toast, sel, isOpen, closeWin } from './dom.js';
import { icon } from './icons.js';
import { ACI, LTYPES, LWEIGHTS, lwName, colorName, TYPE_NAMES, PATTERNS, dimValue, fmtNum, curveLen, entArea, CAP, decodeText, prims, hatchLines, loopPts, xform } from './ent.js';
import { D2R, R2D, dist, ang, polar, an, sweepOf, len, M, add, sub, mul, unit } from './geom.js';
import { scaleLabel, SCALES, UNIT_MM, fitVp } from './doc.js';
import { OSNAP_NAMES } from './editor.js';
import * as D from './dialogs.js';

const big = (c, l, i, dd) => ({ t: 'big', c, l, i, dd });
const sm = (c, l, i, dd) => ({ t: 'sm', c, l, i, dd });
const col = (...items) => ({ t: 'col', items });
const W = w => ({ t: 'w', w });
const v = (c, l, i) => ({ c, l, i });
const CIRCLE_DD = [v('CIRCLE', 'Center, Radius', 'circle'), v('CIRCLE \\ D', 'Center, Diameter', 'circle'), v('CIRCLE 2P', '2-Point', 'circle'), v('CIRCLE 3P', '3-Point', 'circle'), v('CIRCLE T', 'Tan, Tan, Radius', 'circle')];
const ARC_DD = [v('ARC', '3-Point', 'arc'), v('ARC \\ C', 'Start, Center, End', 'arc'), v('ARC \\ E', 'Start, End, Center', 'arc'), v('ARC \\ E \\ R', 'Start, End, Radius', 'arc'), v('ARC \\ E \\ A', 'Start, End, Angle', 'arc'), v('ARC C', 'Center, Start, End', 'arc'), v('ARC C \\ \\ A', 'Center, Start, Angle', 'arc')];
const DIM_DD = [v('DIMLINEAR', 'Linear', 'dimlin'), v('DIMALIGNED', 'Aligned', 'dimali'), v('DIMANGULAR', 'Angular', 'dimang'), v('DIMARC', 'Arc Length', 'dimarc'), v('DIMRADIUS', 'Radius', 'dimrad'), v('DIMDIAMETER', 'Diameter', 'dimdia'), v('DIMORDINATE', 'Ordinate', 'dimord')];
export const RIBBON = {
  Home: [
    { n: 'Draw', items: [big('LINE', 'Line', 'line'), big('PLINE', 'Polyline', 'pline'), big('CIRCLE', 'Circle', 'circle', CIRCLE_DD), big('ARC', 'Arc', 'arc', ARC_DD),
      col(sm('RECTANG', 'Rectangle', 'rect', [v('RECTANG', 'Rectangle', 'rect'), v('POLYGON', 'Polygon', 'polygon')]), sm('HATCH', 'Hatch', 'hatch', [v('HATCH', 'Hatch', 'hatch'), v('GRADIENT', 'Gradient', 'gradient'), v('BOUNDARY', 'Boundary', 'boundary')]), sm('ELLIPSE', 'Ellipse', 'ellipse', [v('ELLIPSE C', 'Center', 'ellipse'), v('ELLIPSE', 'Axis, End', 'ellipse'), v('ELLIPSE A', 'Elliptical Arc', 'ellipse')])),
      col(sm('SPLINE', 'Spline Fit', 'spline'), sm('XLINE', 'Construction Line', 'xline'), sm('RAY', 'Ray', 'ray')),
      col(sm('MULTIPLEPOINT', 'Multiple Points', 'point'), sm('DONUT', 'Donut', 'donut'), sm('REVCLOUD', 'Revision Cloud', 'revcloud'))] },
    { n: 'Modify', items: [col(sm('MOVE', 'Move', 'move'), sm('COPY', 'Copy', 'copy'), sm('STRETCH', 'Stretch', 'stretch')), col(sm('ROTATE', 'Rotate', 'rotate'), sm('MIRROR', 'Mirror', 'mirror'), sm('SCALE', 'Scale', 'scale')),
      col(sm('TRIM', 'Trim', 'trim', [v('TRIM', 'Trim', 'trim'), v('EXTEND', 'Extend', 'extend')]), sm('FILLET', 'Fillet', 'fillet', [v('FILLET', 'Fillet', 'fillet'), v('CHAMFER', 'Chamfer', 'chamfer')]), sm('ARRAYRECT', 'Array', 'array', [v('ARRAYRECT', 'Rectangular Array', 'array'), v('ARRAYPATH', 'Path Array', 'arraypath'), v('ARRAYPOLAR', 'Polar Array', 'arraypolar')])),
      col(sm('ERASE', '', 'erase'), sm('EXPLODE', '', 'explode'), sm('OFFSET', '', 'offset')),
      col(sm('BREAK', '', 'break'), sm('JOIN', '', 'join'), sm('BREAKATPOINT', '', 'breakpt')),
      col(sm('LENGTHEN', '', 'lengthen'), sm('ALIGN', '', 'align'), sm('DRAWORDER', '', 'draworder'))] },
    { n: 'Annotation', items: [big('MTEXT', 'Text', 'mtext', [v('MTEXT', 'Multiline Text', 'mtext'), v('TEXT', 'Single Line', 'text')]), big('DIM', 'Dimension', 'dim', [v('DIM', 'Dimension (smart)', 'dim'), ...DIM_DD]),
      col(sm('MLEADER', 'Leader', 'leader'), sm('CENTERMARK', 'Center Mark', 'centermark'), sm('DIMSTYLE', 'Dim Style', 'dimstyle'))] },
    { n: 'Layers', items: [big('LAYER', 'Layer Properties', 'layer'), col(W('layerdd'), W('layerbtns1'), W('layerbtns2'))] },
    { n: 'Block', items: [big('INSERTPALETTE', 'Insert', 'insert'), col(sm('BLOCK', 'Create', 'block'), sm('PURGE', 'Purge', 'purge'), sm('WBLOCK', 'Write Block', 'export'))] },
    { n: 'Properties', items: [big('MATCHPROP', 'Match Properties', 'matchprop'), col(W('colordd'), W('lwdd'), W('ltdd'))] },
    { n: 'Utilities', items: [big('MEASUREGEOM', 'Measure', 'measure', [v('DIST', 'Distance', 'dist'), v('MEASUREGEOM R', 'Radius', 'dimrad'), v('MEASUREGEOM A', 'Angle', 'dimang'), v('AREA', 'Area', 'area')]), col(sm('QSELECT', 'Quick Select', 'qselect'), sm('AI_SELALL', 'Select All', 'selall'), sm('ID', 'ID Point', 'id')), col(sm('QUICKCALC', 'QuickCalc', 'calc'), sm('LIST', 'List', 'list'), sm('FIND', 'Find', 'find'))] },
    { n: 'Clipboard', items: [big('PASTECLIP', 'Paste', 'paste', [v('PASTECLIP', 'Paste', 'paste'), v('PASTEBLOCK', 'Paste as Block', 'block'), v('PASTEORIG', 'Paste to Original Coordinates', 'paste')]), col(sm('CUTCLIP', 'Cut', 'cut'), sm('COPYCLIP', 'Copy Clip', 'copyclip'), sm('COPYBASE', 'Copy with Base Point', 'copyclip'))] },
  ],
  Insert: [
    { n: 'Block', items: [big('INSERTPALETTE', 'Insert', 'insert'), big('BLOCK', 'Create Block', 'block'), col(sm('WBLOCK', 'Write Block', 'export'), sm('PURGE', 'Purge', 'purge'))] },
    { n: 'Library', items: [big('LIBRARY', 'Block Library', 'library'), big('LIBDOOR', 'Doors & Windows', 'door')] },
    { n: 'Location', items: [big('GEOMAP', 'Google Maps', 'map'), col(sm('GEOMAPIMAGE', 'Capture Area', 'capture'), sm('SITEPLAN', 'Batas Lahan', 'siteplan'), sm('GEOREMOVE', 'Hapus Lokasi', 'erase'))] },
    { n: 'Reference', items: [big('IMAGEATTACH', 'Attach Image', 'image')] },
    { n: 'Import', items: [big('OPEN', 'Import DXF', 'open'), big('PASTEBLOCK', 'Paste as Block', 'paste')] },
  ],
  Annotate: [
    { n: 'Text', items: [big('MTEXT', 'Multiline Text', 'mtext'), col(sm('TEXT', 'Single Line', 'text'), sm('STYLE', 'Text Style', 'textstyle'), sm('FIND', 'Find Text', 'find')), col(sm('TEXTEDIT', 'Edit Text', 'text'), sm('TEXTTOFRONT', 'Text to Front', 'draworder'))] },
    { n: 'Dimensions', items: [big('DIM', 'Dimension', 'dim'), col(sm('DIMLINEAR', 'Linear', 'dimlin', DIM_DD), sm('DIMALIGNED', 'Aligned', 'dimali'), sm('DIMANGULAR', 'Angular', 'dimang')), col(sm('DIMRADIUS', 'Radius', 'dimrad'), sm('DIMDIAMETER', 'Diameter', 'dimdia'), sm('DIMARC', 'Arc Length', 'dimarc')), col(sm('DIMCONTINUE', 'Continue', 'dimcont'), sm('DIMBASELINE', 'Baseline', 'dimbase'), sm('DIMORDINATE', 'Ordinate', 'dimord')), col(sm('DIMSTYLE', 'Dimension Style', 'dimstyle'), sm('DIMSCALE', 'DIMSCALE', 'scale'))] },
    { n: 'Centerlines', items: [big('CENTERMARK', 'Center Mark', 'centermark')] },
    { n: 'Leaders', items: [big('MLEADER', 'Multileader', 'leader')] },
    { n: 'Markup', items: [col(sm('REVCLOUD', 'Revision Cloud', 'revcloud'), sm('WIPEOUT', 'Wipeout', 'wipeout'))] },
  ],
  View: [
    { n: 'Navigate', items: [big('ZOOMEXTENTS', 'Extents', 'zoomext', [v('ZOOMEXTENTS', 'Extents', 'zoomext'), v('ZOOM W', 'Window', 'zoomwin'), v('ZOOM P', 'Previous', 'zoomprev'), v('ZOOM', 'Realtime', 'zoomext'), v('ZOOM O', 'Object', 'zoomwin'), v('ZOOM C', 'Center', 'zoomext')]), col(sm('ZOOM W', 'Window', 'zoomwin'), sm('ZOOM P', 'Previous', 'zoomprev'), sm('PAN', 'Pan', 'pan'))] },
    { n: 'Palettes', items: [big('PROPERTIES', 'Properties', 'props'), col(sm('LAYER', 'Layer Properties', 'layer'), sm('COMMANDLINE', 'Command Line', 'cmdline'), sm('TEXTSCR', 'Text Window', 'list')), col(sm('INSERTPALETTE', 'Blocks', 'insert'), sm('QUICKCALC', 'QuickCalc', 'calc'))] },
    { n: 'Interface', items: [col(sm('UI_FILETABS', 'File Tabs', 'list'), sm('UI_LAYOUTTABS', 'Layout Tabs', 'sheet'), sm('UI_NAVBAR', 'Navigation Bar', 'pan')), col(sm('CLEANSCREENON', 'Clean Screen', 'cleanscreen'), sm('UI_THEME', 'Light / Dark', 'options'), sm('UI_RIBMIN', 'Minimize Ribbon', 'menu'))] },
    { n: 'Display', items: [col(sm('GRID', 'Grid', 'grid'), sm('LWDISPLAY', 'Lineweight', 'lwt'), sm('REGEN', 'Regen', 'zoomext'))] },
  ],
  Manage: [
    { n: 'Cleanup', items: [big('PURGE', 'Purge', 'purge'), big('OVERKILL', 'Delete Duplicates', 'overkill')] },
    { n: 'Settings', items: [col(sm('UNITS', 'Units', 'units'), sm('DSETTINGS', 'Drafting Settings', 'dsettings'), sm('OPTIONS', 'Options', 'options')), col(sm('DIMSTYLE', 'Dimension Style', 'dimstyle'), sm('STYLE', 'Text Style', 'textstyle'), sm('LINETYPE', 'Linetype', 'ltype')), col(sm('LWEIGHT', 'Lineweight', 'lweight'), sm('LTSCALE', 'LTSCALE', 'ltype'), sm('PDMODE', 'Point Style', 'point'))] },
    { n: 'Draw Order', items: [col(sm('TEXTTOFRONT', 'Text to Front', 'draworder'), sm('HATCHTOBACK', 'Hatch to Back', 'hatch'), sm('DRAWORDER', 'Draw Order', 'draworder'))] },
  ],
  Output: [
    { n: 'Plot', items: [big('PLOT', 'Plot', 'plot'), col(sm('PAGESETUP', 'Page Setup Manager', 'pagesetup'), sm('PLOTPREVIEW', 'Preview', 'zoomext'))] },
    { n: 'Gambar Kerja', items: [big('AUTOSHEET', 'Gambar Kerja PDF', 'gambar'), col(sm('EXPORTPDF', 'Export PDF…', 'pdf'), sm('EXPORT_SVG', 'Export SVG', 'svg'), sm('EXPORT_PNG', 'Export PNG', 'png'))] },
    { n: 'Export CAD', items: [big('EXPORT_DXF', 'AutoCAD DXF', 'dxf'), big('EXPORT_SKP', 'SketchUp', 'skp'), big('EXPORT', 'Export…', 'export')] },
  ],
};
export const DESC = {
  LINE: 'Creates straight line segments', PLINE: 'Creates a 2D polyline', CIRCLE: 'Creates a circle', ARC: 'Creates an arc', RECTANG: 'Creates a rectangular polyline', POLYGON: 'Creates an equilateral closed polyline', ELLIPSE: 'Creates an ellipse or an elliptical arc', SPLINE: 'Creates a smooth curve', XLINE: 'Creates a line of infinite length', RAY: 'Creates a semi-infinite line', POINT: 'Creates a point object', DONUT: 'Creates a filled circle or a wide ring', REVCLOUD: 'Creates or modifies a revision cloud', WIPEOUT: 'Creates a wipeout object', HATCH: 'Fills an enclosed area with a hatch pattern', BOUNDARY: 'Creates a region or polyline from an enclosed area', TEXT: 'Creates a single-line text object', MTEXT: 'Creates a multiline text object',
  MOVE: 'Moves objects a specified distance', COPY: 'Copies objects a specified distance', ROTATE: 'Rotates objects around a base point', SCALE: 'Enlarges or reduces selected objects', MIRROR: 'Creates a mirrored copy of objects', OFFSET: 'Creates concentric circles, parallel lines', TRIM: 'Trims objects to meet the edges of other objects', EXTEND: 'Extends objects to meet the edges of other objects', FILLET: 'Rounds and fillets the edges of objects', CHAMFER: 'Bevels the edges of objects', ARRAYRECT: 'Distributes copies in rows and columns', ARRAYPOLAR: 'Distributes copies around a center point', ARRAYPATH: 'Distributes copies along a path', STRETCH: 'Stretches objects crossed by a window', EXPLODE: 'Breaks a compound object into components', JOIN: 'Joins similar objects to form a single object', BREAK: 'Breaks the selected object between two points', ERASE: 'Removes objects from a drawing', LENGTHEN: 'Changes the length of objects', MATCHPROP: 'Applies the properties of a selected object to other objects', PEDIT: 'Edits polylines', ALIGN: 'Aligns objects with other objects',
  DIMLINEAR: 'Creates a linear dimension', DIMALIGNED: 'Creates an aligned linear dimension', DIMANGULAR: 'Creates an angular dimension', DIMRADIUS: 'Creates a radius dimension', DIMDIAMETER: 'Creates a diameter dimension', DIMCONTINUE: 'Creates a dimension that starts from an extension line', DIMBASELINE: 'Creates a dimension from the baseline', DIM: 'Creates multiple dimensions in a single command', MLEADER: 'Creates a multileader object', DIST: 'Measures the distance and angle between two points', AREA: 'Calculates the area and perimeter', LIST: 'Displays property data for selected objects', ID: 'Displays the coordinates of a location',
  GEOMAP: 'Membuka Google Maps: cari lokasi, capture foto berskala riil + tracing site plan otomatis', GEOMAPIMAGE: 'Capture area peta Google ke gambar (skala riil)', SITEPLAN: 'Gambar batas lahan di Google Maps → site plan dengan ukuran riil, luas & tabel koordinat', GEOREMOVE: 'Menghapus lokasi geografis gambar',
  BLOCK: 'Creates a block definition', INSERT: 'Inserts a block', LAYER: 'Manages layers and layer properties', ZOOM: 'Increases or decreases the magnification of the view', PAN: 'Adds a pan to the current view', PLOT: 'Plots a drawing to a plotter, printer, or file', EXPORT: 'Saves objects to other file formats', SAVE: 'Saves the drawing', OPEN: 'Opens an existing drawing file', NEW: 'Creates a new drawing', UNDO: 'Reverses the effect of commands', OPTIONS: 'Customizes the program settings', DSETTINGS: 'Sets grid and snap, polar and object snap tracking', UNITS: 'Controls coordinate and angle display formats', PROPERTIES: 'Controls properties of existing objects', QSELECT: 'Creates a selection set based on filtering criteria', PURGE: 'Removes unused items', OVERKILL: 'Removes duplicate or overlapping objects', DIMSTYLE: 'Creates and modifies dimension styles',
};

export class UI {
  constructor(app) {
    this.app = app; this.ed = app.ed; this.tab = 'Home'; this.ctxTab = null; this.hist = []; this.inputHist = []; this.ihi = -1; this.acIdx = 0;
    this.split = {};
    this.el = { hist: $('#cmdhist'), prompt: $('#cmdprompt'), input: $('#cmdin'), ac: $('#ac'), dyn: $('#dyn'), status: $('#sright'), ltabs: $('#ltabs'), ftabs: $('#filetabs'), props: $('#props'), ribbon: $('#ribbon'), rtabs: $('#rtabs') };
    this.buildQAT(); this.buildTabs(); this.buildRibbon(); this.buildNav(); this.buildStatus(); this.bindCmd(); this.bindKeys(); this.bindMisc();
    this.prompt(null);
  }
  get doc() { return this.app.doc; }

  // ================= QAT & title =================
  buildQAT() {
    const q = $('#qat');
    const b = (c, i, t) => h('button', { title: t, html: icon(i), onclick: () => this.app.exec(c) });
    q.append(b('NEW', 'new', 'New (Ctrl+N)'), b('OPEN', 'open', 'Open (Ctrl+O)'), b('QSAVE', 'save', 'Save (Ctrl+S)'), b('SAVEAS', 'saveas', 'Save As (Ctrl+Shift+S)'), b('PLOT', 'plot', 'Plot (Ctrl+P)'), b('U', 'undo', 'Undo (Ctrl+Z)'), b('MREDO', 'redo', 'Redo (Ctrl+Y)'),
      sel([['dr', 'Drafting & Annotation'], ['basic', '2D Basics']], 'dr', () => toast('Workspace: Drafting & Annotation')));
    $('#appbtn').onclick = e => this.appMenu(e);
    const tr = $('#tright');
    tr.append(h('span', { class: 'signin' }, 'Amatu'), h('button', { title: 'Help (F1)', html: icon('help'), onclick: () => D.help(this) }), h('button', { title: 'Light / Dark', html: icon('options'), onclick: () => this.toggleTheme() }));
    const search = $('#search');
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { const t = search.value.trim(); search.value = ''; search.blur(); if (t) { const n = this.ed.findCmd(t.split(/\s+/)[0]); if (n) this.app.exec(t); else D.help(this, t); } } e.stopPropagation(); });
  }
  appMenu(e) {
    const open = document.querySelector('.appmenu');
    closeMenu(); open?.remove();
    if (open) return; // klik tombol A lagi = tutup menu
    const r = $('#appbtn').getBoundingClientRect();
    const m = h('div', { class: 'menu appmenu' });
    const L = h('div', { class: 'am-l' }), R = h('div', { class: 'am-r' }, h('h5', {}, 'Recent Documents'));
    const it = (i, l, c) => L.append(h('div', { onclick: () => { closeMenu(); this.app.exec(c); } }, h('span', { html: icon(i) }), l));
    it('new', 'New', 'NEW'); it('open', 'Open', 'OPEN'); it('save', 'Save', 'QSAVE'); it('saveas', 'Save As', 'SAVEAS'); it('export', 'Export', 'EXPORT'); it('gambar', 'Gambar Kerja PDF', 'AUTOSHEET'); it('map', 'Google Maps / Site Plan', 'GEOMAP'); it('plot', 'Print', 'PLOT'); it('purge', 'Drawing Utilities (Purge)', 'PURGE'); it('close', 'Close', 'CLOSE');
    const rec = this.app.recentList();
    if (!rec.length) R.append(h('div', { class: 'hint' }, 'Belum ada.'));
    rec.slice(0, 12).forEach(x => R.append(h('div', { title: x.name, onclick: () => { closeMenu(); this.app.openRecent(x.key); } }, x.name)));
    m.append(L, R, h('div', { class: 'am-f' }, h('button', { class: 'btn sm', onclick: () => { closeMenu(); this.app.exec('OPTIONS'); } }, 'Options'), h('button', { class: 'btn sm', onclick: () => { closeMenu(); this.app.exec('CLOSE'); } }, 'Exit Drawing')));
    document.getElementById('overlay').append(m); m.style.left = r.left + 'px'; m.style.top = r.bottom + 'px';
    setMenu(m); // tanpa ini closeMenu() di item tidak menutup menu, dan menu tertinggal menumpuk di atas dialog
    setTimeout(() => { const off = ev => { if (!m.contains(ev.target) && !$('#appbtn').contains(ev.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0);
    void e;
  }
  setTitle() { $('#docname').textContent = this.doc.name + (this.doc.dirty ? ' *' : ''); document.title = this.doc.name + ' — Amatu CAD'; }

  // ================= Ribbon =================
  buildTabs() {
    const T = this.el.rtabs; T.innerHTML = '';
    const tabs = [...Object.keys(RIBBON)];
    for (const t of tabs) T.append(h('button', { class: t === this.tab && !this.ctxTab ? 'on' : '', onclick: () => { this.tab = t; this.ctxTab = null; this.buildTabs(); this.buildRibbon(); } }, t));
    if (this.ctxTab) T.append(h('button', { class: 'ctx on' }, this.ctxTab.name));
    T.append(h('button', { class: 'rmin', title: 'Minimize ribbon', onclick: () => { $('#app').classList.toggle('ribmin'); this.ed.resize(); this.fitRibbon(); } }, '▴▾'));
  }
  buildRibbon() {
    const R = this.el.ribbon; R.innerHTML = '';
    const panels = this.ctxTab ? this.ctxTab.panels : RIBBON[this.tab];
    for (const p of panels) {
      const body = h('div', { class: 'rbody' });
      for (const it of p.items) body.append(this.ritem(it));
      R.append(h('div', { class: 'rpanel' }, body, h('div', { class: 'rtitle' }, p.n, ' ▾')));
    }
    this.fitRibbon();
  }
  // Ribbon adaptif seperti AutoCAD: panel paling kanan diciutkan jadi satu tombol (flyout) sampai muat tanpa scroll.
  fitRibbon() {
    const R = this.el.ribbon; if (!R.isConnected || !R.clientWidth) return;
    const panels = this.ctxTab ? this.ctxTab.panels : RIBBON[this.tab];
    const els = [...R.children];
    els.forEach((el, i) => { if (el._full) { el.replaceWith(el._full); els[i] = el._full; } });
    const firstIcon = items => { for (const it of items) { if (it.t === 'col') { const r = firstIcon(it.items); if (r) return r; } else if (it.i || it.dd) return it.dd ? it.dd[0].i : it.i; } return 'panel'; };
    for (let i = els.length - 1; i >= 0 && R.scrollWidth > R.clientWidth + 1; i--) {
      const full = els[i], p = panels[i]; if (!p) continue;
      const btn = h('button', { class: 'rbig', title: p.n }, h('span', { html: icon(firstIcon(p.items)) }), h('span', {}, p.n, h('span', { class: 'dd arrow' }, '▾')));
      btn.onclick = () => this.panelFlyout(full, btn);
      const mini = h('div', { class: 'rpanel mini' }, h('div', { class: 'rbody' }, btn), h('div', { class: 'rtitle' }, p.n));
      mini._full = full; full.replaceWith(mini); els[i] = mini;
    }
  }
  panelFlyout(full, btn) {
    closeMenu();
    const r = btn.getBoundingClientRect(), body = full.querySelector('.rbody');
    const fly = h('div', { class: 'rflyout' }, body);
    const done = () => { full.prepend(body); fly.remove(); document.removeEventListener('pointerdown', off, true); };
    const off = e => { if (!fly.contains(e.target) || e.target.closest('.rsm,.rbig')) setTimeout(done, 0); };
    document.getElementById('overlay').append(fly);
    fly.style.top = r.bottom + 2 + 'px'; fly.style.left = Math.max(4, Math.min(r.left, innerWidth - fly.offsetWidth - 4)) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  ritem(it) {
    if (it.t === 'col') return h('div', { class: 'rcol' }, ...it.items.map(x => this.ritem(x)));
    if (it.t === 'w') return this.widget(it.w);
    if (it.t === 'el') return it.el;
    const cur = it.dd ? (this.split[it.c] || it.dd[0]) : null;
    const cmd = cur ? cur.c : it.c, ic = cur ? cur.i : it.i;
    const label = it.t === 'big' ? it.l : (it.l || this.ed.cmds[it.c]?.label || it.c[0] + it.c.slice(1).toLowerCase());
    const tip = (label || it.c) + (DESC[it.c.split(' ')[0]] ? '\n' + DESC[it.c.split(' ')[0]] : '') + `\nCommand: ${it.c.split(' ')[0]}`;
    const btn = h('button', { class: it.t === 'big' ? 'rbig' : 'rsm', title: tip, onclick: e => { if (it.dd && e.target.closest('.arrow')) { this.ddMenu(it, btn); return; } this.app.exec(cmd); } },
      h('span', { html: icon(ic) }), it.t === 'big' ? h('span', {}, label, it.dd ? h('span', { class: 'dd arrow' }, '▾') : null) : h('span', {}, label || ''), it.dd && it.t !== 'big' ? h('span', { class: 'arrow', style: { position: 'static', marginLeft: '2px', color: 'var(--tx3)' } }, '▾') : null);
    return btn;
  }
  ddMenu(it, btn) {
    const r = btn.getBoundingClientRect();
    menu(it.dd.map(d => ({ l: d.l, i: d.i, fn: () => { this.split[it.c] = d; this.buildRibbon(); this.app.exec(d.c); } })), r.left, r.bottom);
  }
  widget(w) {
    const ed = this.ed, doc = this.doc;
    if (w === 'layerdd') {
      const L = doc.layers[doc.clayer] || {};
      const el = h('div', { class: 'layerdd', title: 'Layer', onclick: () => this.layerMenu(el) },
        h('span', { html: icon(L.on ? 'bulb' : 'bulb') , style: { color: L.on ? '#F2C94C' : '#666' } }), h('span', { html: icon(L.frz ? 'snow' : 'sun'), style: { color: L.frz ? '#8fc3ff' : '#F2C94C' } }), h('span', { html: icon(L.lck ? 'lock' : 'unlock') }),
        h('i', { class: 'swatch', style: { background: ACI[L.color] } }), h('span', { class: 'nm' }, ed.sel.size ? this.selLayerName() : doc.clayer), h('span', {}, '▾'));
      return el;
    }
    if (w === 'layerbtns1' || w === 'layerbtns2') {
      const set = w === 'layerbtns1' ? [['LAYMCUR', 'laymcur', 'Make Current'], ['LAYMATCH', 'laymatch', 'Match Layer'], ['LAYISO', 'layiso', 'Isolate'], ['LAYUNISO', 'layuniso', 'Unisolate'], ['LAYOFF', 'layoff', 'Off']] : [['LAYFRZ', 'layfrz', 'Freeze'], ['LAYLCK', 'laylck', 'Lock'], ['LAYULK', 'layulk', 'Unlock'], ['LAYON', 'layon', 'Turn All Layers On'], ['LAYTHW', 'laythw', 'Thaw All Layers']];
      return h('div', { class: 'row', style: { gap: '1px' } }, ...set.map(([c, i, t]) => h('button', { class: 'rsm icononly', title: t + '\nCommand: ' + c, html: icon(i), onclick: () => this.app.exec(c) })));
    }
    if (w === 'colordd') {
      const c = ed.sel.size ? this.common('color') : doc.set.ccolor;
      return h('div', { class: 'propdd', title: 'Object Color', onclick: e => this.colorMenu(e.currentTarget) }, h('i', { class: 'swatch', style: { background: c === undefined ? 'transparent' : c >= 256 || c === 0 ? 'linear-gradient(135deg,#fff 50%,#000 50%)' : ACI[c] } }), h('span', { style: { flex: 1 } }, c === undefined ? '*VARIES*' : colorName(c)), '▾');
    }
    if (w === 'ltdd') {
      const lt = ed.sel.size ? this.common('lt') : doc.set.clt;
      return h('div', { class: 'propdd', title: 'Linetype', onclick: e => this.ltMenu(e.currentTarget) }, h('span', { class: 'ltprev', style: { borderTopStyle: lt && lt !== 'Continuous' && lt !== 'ByLayer' ? 'dashed' : 'solid' } }), h('span', { style: { flex: 1 } }, lt ?? '*VARIES*'), '▾');
    }
    if (w === 'lwdd') {
      const lw = ed.sel.size ? this.common('lw') : doc.set.clw;
      return h('div', { class: 'propdd', title: 'Lineweight', onclick: e => this.lwMenu(e.currentTarget) }, h('span', { class: 'ltprev', style: { borderTopWidth: Math.max(1, (lw > 0 ? lw : 25) / 25) + 'px' } }), h('span', { style: { flex: 1 } }, lw === undefined ? '*VARIES*' : lwName(lw)), '▾');
    }
    if (w === 'hatchgallery') {
      const g = h('div', { class: 'gallery' });
      for (const name of Object.keys(PATTERNS)) {
        const c = h('canvas', { width: 88, height: 84 });
        const b = h('button', { class: doc.set.hpName === name ? 'on' : '', title: name + ' — ' + PATTERNS[name].d, onclick: () => { doc.set.hpName = name; this.buildRibbon(); } }, c, h('span', {}, name));
        g.append(b); setTimeout(() => patternSwatch(c, name), 0);
      }
      return g;
    }
    if (w === 'hatchprops') {
      const s = doc.set;
      return h('div', { class: 'rcol' },
        h('div', { class: 'rfield' }, 'Pattern', sel(Object.keys(PATTERNS), s.hpName, v => { s.hpName = v; this.buildRibbon(); })),
        h('div', { class: 'rfield' }, 'Angle', h('input', { type: 'number', value: s.hpAng || 0, step: 15, onchange: e => s.hpAng = parseFloat(e.target.value) || 0 })),
        h('div', { class: 'rfield' }, 'Scale', h('input', { type: 'number', value: s.hpScale, step: 0.5, min: 0.001, onchange: e => { s.hpScale = parseFloat(e.target.value) || 1; s.hpScaleSet = true; } })));
    }
    if (w === 'hatchcolor') {
      const s = this.doc.set;
      return h('div', { class: 'rcol' }, h('div', { class: 'propdd', onclick: e => this.colorMenu(e.currentTarget, c => { s.hpColor = c; this.buildRibbon(); }) }, h('i', { class: 'swatch', style: { background: s.hpColor && s.hpColor < 256 ? ACI[s.hpColor] : 'linear-gradient(135deg,#fff 50%,#000 50%)' } }), h('span', { style: { flex: 1 } }, colorName(s.hpColor ?? 256)), '▾'),
        h('div', { class: 'rfield' }, 'Layer', sel(['(current)', ...Object.keys(this.doc.layers)], s.hpLayer || '(current)', v => s.hpLayer = v === '(current)' ? null : v)));
    }
    return h('span');
  }
  selLayerName() { const l = new Set([...this.ed.sel].map(e => e.layer)); return l.size === 1 ? [...l][0] : '*VARIES*'; }
  common(k) { const vals = new Set([...this.ed.sel].map(e => e[k] ?? (k === 'color' ? 256 : k === 'lt' ? 'ByLayer' : -1))); return vals.size === 1 ? [...vals][0] : undefined; }
  layerMenu(anchor) {
    const r = anchor.getBoundingClientRect(), doc = this.doc;
    const items = Object.entries(doc.layers).map(([n, L]) => ({ l: `${n === doc.clayer ? '✓ ' : '   '}${L.on ? '💡' : '⚫'} ${L.frz ? '❄' : '☀'} ${L.lck ? '🔒' : '🔓'}  ${n}`, fn: () => {
      if (this.ed.sel.size) { this.app.mutate(() => this.ed.sel.forEach(e => e.layer = n)); }
      else { doc.clayer = n; }
      this.refresh();
    } }));
    items.push('-', { l: 'Layer Properties Manager…', i: 'layer', fn: () => this.app.exec('LAYER') });
    menu(items, r.left, r.bottom);
  }
  colorMenu(anchor, cb) {
    const r = anchor.getBoundingClientRect();
    const set = c => { if (cb) return cb(c); if (this.ed.sel.size) this.app.mutate(() => this.ed.sel.forEach(e => e.color = c)); else this.doc.set.ccolor = c; this.refresh(); };
    menu([...[256, 0, 1, 2, 3, 4, 5, 6, 7].map(c => ({ l: colorName(c), fn: () => set(c) })), '-', { l: 'More Colors…', i: 'color', fn: () => D.colorDialog(this, null, set) }], r.left, r.bottom);
  }
  ltMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const set = lt => { if (this.ed.sel.size) this.app.mutate(() => this.ed.sel.forEach(e => e.lt = lt)); else this.doc.set.clt = lt; this.refresh(); };
    menu([...['ByLayer', 'ByBlock', ...this.doc.ltypes].map(lt => ({ l: lt, fn: () => set(lt) })), '-', { l: 'Other…', fn: () => this.app.exec('LINETYPE') }], r.left, r.bottom);
  }
  lwMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const set = lw => { if (this.ed.sel.size) this.app.mutate(() => this.ed.sel.forEach(e => e.lw = lw)); else this.doc.set.clw = lw; this.refresh(); };
    menu([-1, -2, -3, ...LWEIGHTS].map(w => ({ l: lwName(w), fn: () => set(w) })), r.left, r.bottom);
  }
  hatchPanel(on) {
    if (on) {
      this.ctxTab = { name: 'Hatch Creation', panels: [
        { n: 'Boundaries', items: [big('HATCHPICK', 'Pick Points', 'hatch'), col(sm('HATCHSEL', 'Select', 'boundary'), sm('HATCHUNDO', 'Undo', 'undo'))] },
        { n: 'Pattern', items: [W('hatchgallery')] },
        { n: 'Properties', items: [W('hatchprops'), W('hatchcolor')] },
        { n: 'Close', items: [big('HATCHCLOSE', 'Close Hatch Creation', 'close')] },
      ] };
    } else this.ctxTab = null;
    this.buildTabs(); this.buildRibbon();
  }

  // ================= Navigation bar & view label =================
  buildNav() {
    const n = $('#navbar');
    const b = (c, i, t) => h('button', { title: t, html: icon(i), onclick: () => this.app.exec(c) });
    n.append(b('PAN', 'pan', 'Pan'), b('ZOOMEXTENTS', 'zoomext', 'Zoom Extents (double-click wheel)'), b('ZOOM W', 'zoomwin', 'Zoom Window'), b('ZOOM P', 'zoomprev', 'Zoom Previous'), b('UI_ZOOMIN', 'plus', 'Zoom In'), b('UI_ZOOMOUT', 'menu', 'Zoom Out'));
    $('#vplabel').addEventListener('click', e => {
      const m = e.target.dataset.m, r = e.target.getBoundingClientRect();
      if (m === 'vp') menu([{ l: 'Maximize Viewport', fn: () => this.app.exec('ZOOMEXTENTS') }, { l: 'ViewCube', dis: true }, { l: 'Navigation Bar', chk: $('#navbar').style.display !== 'none', fn: () => this.app.exec('UI_NAVBAR') }], r.left, r.bottom);
      if (m === 'view') menu([{ l: 'Top', chk: true }, { l: 'Bottom', dis: true }, { l: 'Left', dis: true }, '-', { l: 'SW Isometric', dis: true }], r.left, r.bottom);
      if (m === 'vs') menu([{ l: '2D Wireframe', chk: true }, { l: 'Wireframe', dis: true }, { l: 'Hidden', dis: true }, { l: 'Realistic', dis: true }], r.left, r.bottom);
    });
  }

  // ================= Status bar =================
  buildStatus() {
    const S = this.el.status; S.innerHTML = '';
    const ed = this.ed;
    this.coordEl = h('span', { class: 'coords', title: 'Coordinates' }, '0.0000, 0.0000, 0.0000');
    const tog = (k, i, t, key, dd) => {
      const b = h('button', { class: 'sb' + (ed.T[k] ? ' on' : ''), title: `${t} (${key})`, html: icon(i), onclick: () => { ed.T[k] = !ed.T[k]; this.msgToggle(t, ed.T[k]); this.refreshStatus(); ed.invalidate(); }, oncontextmenu: e => { e.preventDefault(); dd?.(e); } });
      b.dataset.k = k; return dd ? [b, h('button', { class: 'sb dd', onclick: e => dd(e) }, '▾')] : [b];
    };
    const sp = this.app.ed.layout ? (this.app.ed.U.ms ? 'MODEL' : 'PAPER') : 'MODEL';
    S.append(this.coordEl,
      h('button', { class: 'sb txt', title: 'Model or Paper space', onclick: () => { if (ed.layout) { ed.U.ms = !ed.U.ms; this.refresh(); ed.invalidate(); } } }, sp),
      ...tog('grid', 'grid', 'Grid', 'F7'), ...tog('snap', 'snap', 'Snap Mode', 'F9', e => this.snapMenu(e)),
      ...tog('dyn', 'dyn', 'Dynamic Input', 'F12'), ...tog('ortho', 'ortho', 'Ortho Mode', 'F8'), ...tog('polar', 'polar', 'Polar Tracking', 'F10', e => this.polarMenu(e)),
      ...tog('otrack', 'otrack', 'Object Snap Tracking', 'F11'), ...tog('osnap', 'osnap', '2D Object Snap', 'F3', e => this.osnapMenu(e.clientX, e.clientY - 300)),
      ...tog('lwt', 'lwt', 'Show/Hide Lineweight', 'LWDISPLAY'), ...tog('qp', 'qp', 'Quick Properties', 'Ctrl+Shift+P'),
      h('span', { class: 'sep' }));
    if (ed.layout) {
      const vp = fitVp(ed.layout, this.doc);
      S.append(h('button', { class: 'sb txt', title: 'Viewport Scale', onclick: e => this.vpScaleMenu(e) }, scaleLabel(vp.s, this.doc.set.units), ' ▾'), h('button', { class: 'sb' + (vp.lock ? ' on' : ''), title: 'Lock viewport', html: icon(vp.lock ? 'lock' : 'unlock'), onclick: () => { vp.lock = !vp.lock; this.refreshStatus(); } }));
    } else S.append(h('button', { class: 'sb txt', title: 'Annotation Scale' }, '1:1'));
    S.append(h('button', { class: 'sb txt', title: 'Units', onclick: () => this.app.exec('UNITS') }, this.doc.set.units),
      h('button', { class: 'sb', title: 'Isolate Objects', html: icon('isolate'), onclick: e => menu([{ l: 'Isolate Objects', fn: () => this.isolate(true) }, { l: 'Hide Objects', fn: () => this.isolate(false) }, { l: 'End Object Isolation', fn: () => this.isolate(null) }], e.clientX, e.clientY - 100) }),
      h('button', { class: 'sb', title: 'Clean Screen (Ctrl+0)', html: icon('cleanscreen'), onclick: () => this.cleanScreen() }),
      h('button', { class: 'sb', title: 'Customization', html: icon('menu'), onclick: e => menu([{ h: 'Status bar' }, { l: 'Coordinates', chk: this.coordEl.style.display !== 'none', fn: () => { this.coordEl.style.display = this.coordEl.style.display === 'none' ? '' : 'none'; } }, { l: 'Theme: Light / Dark', fn: () => this.toggleTheme() }, { l: 'Options…', fn: () => this.app.exec('OPTIONS') }], e.clientX - 160, e.clientY - 120) }));
  }
  refreshStatus() { this.buildStatus(); }
  msgToggle(t, on) { this.print(`<${t} ${on ? 'on' : 'off'}>`); }
  coords(p) { if (this.coordEl) this.coordEl.textContent = `${this.ed.fmt(p.x)}, ${this.ed.fmt(p.y)}, ${this.ed.fmt(0)}`; }
  osnapMenu(x, y) {
    const ed = this.ed;
    const items = Object.entries(OSNAP_NAMES).filter(([k]) => !['app', 'par'].includes(k)).map(([k, n]) => ({ l: n, chk: ed.os.has(k), fn: () => { ed.os.has(k) ? ed.os.delete(k) : ed.os.add(k); ed.T.osnap = true; this.refreshStatus(); } }));
    if (ed.req && ed.req.type === 'point') {
      menu([{ h: 'Snap override (sekali pakai)' }, ...Object.entries(OSNAP_NAMES).filter(([k]) => !['app', 'par'].includes(k)).map(([k, n]) => ({ l: n, fn: () => { ed.overrideSnap = k; } })), { l: 'None', fn: () => ed.overrideSnap = 'non' }, '-', { l: 'Mid Between 2 Points', fn: () => ed.submit('M2P') }, { l: 'From', fn: () => ed.submit('FROM') }, '-', { l: 'Object Snap Settings…', fn: () => this.app.exec('OSNAP') }], x, y);
      return;
    }
    menu([...items, '-', { l: 'Object Snap Settings…', fn: () => this.app.exec('OSNAP') }], x, y);
  }
  polarMenu(e) {
    const ed = this.ed;
    menu([90, 45, 30, 22.5, 18, 15, 10, 5].map(a => ({ l: `${a}, ${a * 2}, ${a * 3}, ${a * 4}…`, chk: ed.opt.polarInc === a, fn: () => { ed.opt.polarInc = a; ed.T.polar = true; ed.T.ortho = false; this.refreshStatus(); } })).concat(['-', { l: 'Tracking Settings…', fn: () => D.drafting(this, 'polar') }]), e.clientX, e.clientY - 260);
  }
  snapMenu(e) { menu([{ l: 'Polar Snap', fn: () => D.drafting(this, 'snap') }, { l: 'Grid Snap', chk: true }, '-', { l: 'Snap Settings…', fn: () => D.drafting(this, 'snap') }], e.clientX, e.clientY - 120); }
  vpScaleMenu(e) {
    const L = this.ed.layout; if (!L) return; const vp = fitVp(L, this.doc), u = UNIT_MM[this.doc.set.units];
    menu([...SCALES.map(n => ({ l: '1:' + n, chk: Math.abs(vp.s - u / n) < 1e-12, fn: () => { this.app.mutate(() => { vp.s = u / n; }); this.refresh(); } })), '-', { l: 'Auto fit (skala standar)', fn: () => { this.app.mutate(() => fitVp(L, this.doc, true)); this.refresh(); } }], e.clientX, e.clientY - 400);
  }
  isolate(mode) {
    const ed = this.ed, ents = ed.ents;
    if (mode === null) { ents.forEach(e => delete e._hide); this.doc._iso = null; }
    else { const s = new Set(ed.sel); if (!s.size) return toast('Pilih objek terlebih dahulu.'); this.doc._iso = mode ? 'iso' : 'hide'; }
    // isolasi via layer sementara tidak mengubah file: gunakan filter render
    if (mode !== null) { const s = new Set(ed.sel); this.app.isoSet = mode ? s : null; this.app.hideSet = mode ? null : s; } else { this.app.isoSet = null; this.app.hideSet = null; }
    ed.clearSel(); ed.invalidate();
  }

  // ================= Layout & file tabs =================
  buildLayoutTabs() {
    const T = this.el.ltabs; T.innerHTML = '';
    const ed = this.ed, U = ed.U;
    const tab = (name, i) => {
      const t = h('div', { class: 'ltab' + (U.space === i ? ' on' : ''), onclick: () => this.setSpace(i), oncontextmenu: e => { e.preventDefault(); this.layoutMenu(i, e); } }, name);
      T.append(t);
    };
    tab('Model', -1);
    this.doc.layouts.forEach((L, i) => tab(L.name, i));
    T.append(h('div', { class: 'ltab add', title: 'New Layout', onclick: () => this.app.newLayout() }, '+'));
  }
  layoutMenu(i, e) {
    if (i < 0) return;
    const L = this.doc.layouts[i];
    menu([{ l: 'New Layout', fn: () => this.app.newLayout() }, { l: 'Rename', fn: () => { const n = prompt('Nama layout:', L.name); if (n) { this.app.mutate(() => L.name = n); this.buildLayoutTabs(); } } }, { l: 'Delete', dis: this.doc.layouts.length < 2, fn: () => { this.app.mutate(() => this.doc.layouts.splice(i, 1)); this.setSpace(-1); } }, { l: 'Duplicate (Move or Copy…)', fn: () => { this.app.mutate(() => { const c = JSON.parse(JSON.stringify(L)); c.name = L.name + ' (2)'; this.doc.layouts.splice(i + 1, 0, c); }); this.buildLayoutTabs(); } }, '-', { l: 'Page Setup Manager…', fn: () => { this.setSpace(i); this.app.exec('PAGESETUP'); } }, { l: 'Plot…', fn: () => { this.setSpace(i); this.app.exec('PLOT'); } }, { l: 'Export Layout to PDF', fn: () => { this.setSpace(i); this.app.exec('EXPORTPDF'); } }], e.clientX, e.clientY - 220);
  }
  setSpace(i) {
    const ed = this.ed;
    if (ed.cmd) ed.cancelReq();
    ed.U.space = i; ed.U.ms = false; ed.clearSel();
    if (i >= 0) fitVp(this.doc.layouts[i], this.doc);
    this.refresh(); ed.invalidate();
  }
  buildFileTabs() {
    const T = this.el.ftabs; T.innerHTML = '';
    T.append(h('div', { class: 'ftab' + (this.app.showStart ? ' on' : ''), onclick: () => this.app.showStartPage(true) }, 'Start'));
    this.app.docs.forEach((d, i) => T.append(h('div', { class: 'ftab' + (!this.app.showStart && d === this.doc ? ' on' : ''), title: d.name, onclick: () => this.app.switchDoc(i), oncontextmenu: e => { e.preventDefault(); menu([{ l: 'New', fn: () => this.app.exec('NEW') }, { l: 'Save', fn: () => { this.app.switchDoc(i); this.app.exec('QSAVE'); } }, { l: 'Close', fn: () => this.app.closeDoc(i) }, { l: 'Close All Other Drawings', fn: () => this.app.closeOthers(i) }], e.clientX, e.clientY); } },
      h('span', {}, d.name), d.dirty ? h('span', { class: 'dirty' }, '●') : null, h('span', { class: 'x', title: 'Close', onclick: e => { e.stopPropagation(); this.app.closeDoc(i); } }, '×'))));
    T.append(h('div', { class: 'ftab add', title: 'New Drawing (Ctrl+N)', onclick: () => this.app.exec('NEW') }, '+'));
  }

  // ================= Command line =================
  bindCmd() {
    const I = this.el.input;
    I.addEventListener('input', () => { this.autocomplete(); this.ed.invalidate('over'); this.dyn(this.ed); });
    $('#cmdx').onclick = () => this.toggleCmd();
    $('#cmdcust').onclick = e => menu([{ l: 'Input Settings: AutoComplete', chk: true }, { l: 'Lines of Prompt History…', fn: () => this.textWindow() }, { l: 'Options…', fn: () => this.app.exec('OPTIONS') }], e.clientX, e.clientY - 120);
    $('#cmdico').onclick = e => menu(this.inputHist.slice(-12).reverse().map(t => ({ l: t.toUpperCase(), fn: () => this.app.exec(t) })).concat(this.inputHist.length ? [] : [{ l: '(belum ada)', dis: true }]), e.clientX, e.clientY - 300);
    this.el.prompt.addEventListener('click', e => { const k = e.target.dataset?.kw; if (k) { this.ed.submit(k); this.focusCmd(); } });
    this.el.ac.addEventListener('pointerdown', e => { const d = e.target.closest('[data-c]'); if (d) { e.preventDefault(); this.el.input.value = ''; this.hideAc(); this.app.exec(d.dataset.c); } });
  }
  focusCmd() { if (document.activeElement !== this.el.input && !document.activeElement?.closest('.win,.tedit,#props,.tedit-bar') && !document.activeElement?.matches?.('#search')) this.el.input.focus({ preventScroll: true }); }
  cmdValue() { return this.el.input.value; }
  print(s, cls) {
    const H = this.el.hist;
    for (const line of String(s).split('\n')) { H.append(h('div', { class: cls || '' }, line)); this.hist.push(line); }
    while (H.childNodes.length > 500) H.firstChild.remove();
    H.scrollTop = H.scrollHeight;
  }
  echo(req, t) { this.print(this.plainPrompt(req) + ' ' + t); }
  plainPrompt(req) { return (req?.msg || '').split('\n').pop(); }
  prompt(req) {
    const P = this.el.prompt; P.innerHTML = '';
    if (!req) {
      if (this.ed.cmd) { P.innerHTML = ''; }
      else P.append(h('span', { class: 'ph' }, ''));
      this.el.input.placeholder = this.ed.cmd ? '' : 'Type a command';
      this.dyn(this.ed); return;
    }
    this.el.input.placeholder = '';
    const lines = req.msg.split('\n');
    if (lines.length > 1) lines.slice(0, -1).forEach(l => this.print(l));
    const msg = lines[lines.length - 1];
    const m = msg.match(/^(.*?)\[(.*)\](.*)$/);
    const cname = this.ed.cmd && this.ed.cmd !== 'GRIPEDIT' ? h('span', { class: 'c' }, this.ed.cmd + ' ') : null;
    if (cname) P.append(cname);
    if (m) {
      P.append(m[1] + '[');
      m[2].split('/').forEach((k, i, a) => { P.append(h('span', { class: 'k', 'data-kw': k.trim() }, k)); if (i < a.length - 1) P.append('/'); });
      P.append(']' + m[3]);
    } else P.append(msg);
    P.append(' ');
    this.dyn(this.ed);
  }
  autocomplete() {
    const t = this.el.input.value.trim().toUpperCase();
    if (!t || this.ed.req || /[\d,@#<.-]/.test(t[0])) { this.hideAc(); return; }
    const names = Object.keys(this.ed.cmds).filter(n => !n.startsWith('UI_') && !n.startsWith('HATCH') || n === 'HATCH' || n === 'HATCHEDIT');
    const al = Object.entries(this.ed.alias);
    const res = [];
    for (const [a, n] of al) if (a === t) res.push({ c: a, n, alias: true });
    for (const n of names) if (n.startsWith(t) && !res.some(r => r.n === n)) res.push({ c: n, n });
    for (const n of names) if (!n.startsWith(t) && n.includes(t) && !res.some(r => r.n === n)) res.push({ c: n, n });
    for (const [a, n] of al) if (a.startsWith(t) && a !== t && !res.some(r => r.n === n)) res.push({ c: a, n, alias: true });
    this.acList = res.slice(0, 12); this.acIdx = 0;
    if (!this.acList.length) { this.hideAc(); return; }
    const A = this.el.ac; A.innerHTML = '';
    this.acList.forEach((r, i) => A.append(h('div', { class: i === 0 ? 'on' : '', 'data-c': r.n }, h('span', { html: icon(iconFor(r.n)) }), h('b', {}, r.n), r.alias ? h('small', {}, `(${r.c})`) : h('small', {}, (DESC[r.n] || '').slice(0, 46)))));
    A.style.display = 'block';
  }
  hideAc() { this.el.ac.style.display = 'none'; this.acList = null; }
  acMove(d) { if (!this.acList) return false; const n = this.acList.length; this.acIdx = (this.acIdx + d + n) % n; [...this.el.ac.children].forEach((c, i) => c.classList.toggle('on', i === this.acIdx)); this.el.ac.children[this.acIdx]?.scrollIntoView({ block: 'nearest' }); return true; }
  submitCmd() {
    const I = this.el.input; let t = I.value;
    const ed = this.ed;
    if (!ed.req && this.acList && t.trim() && !ed.findCmd(t.trim().split(/\s+/)[0])) t = this.acList[this.acIdx].n;
    I.value = ''; this.hideAc();
    if (!ed.req && t.trim()) { this.inputHist.push(t.trim()); }
    if (ed.req && t.trim()) this.inputHist.push(t.trim());
    this.ihi = -1;
    ed.dynAng = null;
    ed.submit(t);
  }
  toggleCmd() { $('#cmd').classList.toggle('hidden'); }
  textWindow(force) { const H = this.el.hist; if (force === true) H.classList.add('big'); else H.classList.toggle('big'); H.scrollTop = H.scrollHeight; }
  cmdStart() { this.hideAc(); this.buildRibbonIfDyn(); }
  cmdEnd() { this.refreshLight(); }
  buildRibbonIfDyn() { }

  // ================= Dynamic input =================
  dyn(ed) {
    const el = this.el.dyn;
    if (!ed.T.dyn || !ed.mouse.in || this.teditOpen) { el.style.display = 'none'; return; }
    const R = ed.req, typed = this.el.input.value;
    let html = '';
    if (!R) { if (!typed) { el.style.display = 'none'; return; } html = `<div class="dp">${esc(typed)}<b style="color:#6fb6ff">▏</b></div>`; }
    else {
      const msg = this.plainPrompt(R).replace(/\s*\[.*\]/, '').replace(/<[^>]*>/, '').replace(/:$/, '');
      html = `<div class="dp">${esc(msg)}${R.kws?.length ? ' <span style="color:#8fc3ff">[↓]</span>' : ''}</div>`;
      if (R.type === 'point' || R.type === 'dist' || R.type === 'angle') {
        const p = ed.spt, b = R.base;
        if (b && R.type !== 'angle') { const d = dist(b, p), a = an(ang(b, p)) * R2D; html += `<div class="dfields"><span class="df on">${typed ? esc(typed) : ed.fmt(d)}</span><span class="df">${a.toFixed(0)}°</span></div>`; }
        else if (R.type === 'point') html += `<div class="dfields"><span class="df on">${typed ? esc(typed) : ed.fmt(p.x)}</span><span class="df">${ed.fmt(p.y)}</span></div>`;
        else if (typed) html += `<div class="dfields"><span class="df on">${esc(typed)}</span></div>`;
      } else if (typed) html += `<div class="dfields"><span class="df on">${esc(typed)}</span></div>`;
      if (ed.track?.label) html += `<div class="trk">${esc(ed.track.label)}</div>`;
    }
    el.innerHTML = html; el.style.display = 'block';
    const w = $('#wrap').getBoundingClientRect();
    let x = ed.mouse.sx + 20, y = ed.mouse.sy + 20;
    if (x + el.offsetWidth > w.width - 10) x = ed.mouse.sx - el.offsetWidth - 14;
    if (y + el.offsetHeight > w.height - 50) y = ed.mouse.sy - el.offsetHeight - 14;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  dynHide() { this.el.dyn.style.display = 'none'; }

  // ================= Keyboard =================
  bindKeys() {
    window.addEventListener('keydown', e => this.onKey(e), true);
    window.addEventListener('keyup', e => { if (e.key === 'Shift') this.ed.shiftDown = false; });
  }
  onKey(e) {
    const ed = this.ed, app = this.app, k = e.key, mod = e.ctrlKey || e.metaKey, tgt = e.target;
    if (k === 'Shift') ed.shiftDown = true;
    const inDialog = tgt.closest?.('.win, .tedit, .tedit-bar, #props, #searchbox, .menu') && tgt !== this.el.input;
    if (inDialog) { if (k === 'Escape' && tgt.closest('.menu')) closeMenu(); return; }
    if (this.app.showStart && !mod && !/^F\d+$/.test(k)) return;
    const run = c => { e.preventDefault(); e.stopPropagation(); app.exec(c); };
    // F-keys
    const F = { F1: () => D.help(this), F2: () => this.textWindow(), F3: () => this.flip('osnap', 'Osnap'), F7: () => this.flip('grid', 'Grid'), F8: () => this.flip('ortho', 'Ortho'), F9: () => this.flip('snap', 'Snap'), F10: () => this.flip('polar', 'Polar'), F11: () => this.flip('otrack', 'Object Snap Tracking'), F12: () => this.flip('dyn', 'Dynamic Input') };
    if (F[k] && !mod) { e.preventDefault(); F[k](); return; }
    if (mod) {
      const K = k.toLowerCase();
      const map = { n: 'NEW', o: 'OPEN', s: e.shiftKey ? 'SAVEAS' : 'QSAVE', p: e.shiftKey ? 'UI_QP' : 'PLOT', z: 'UNDOKEY', y: 'MREDO', a: 'AI_SELALL', c: e.shiftKey ? 'COPYBASE' : 'COPYCLIP', x: 'CUTCLIP', v: e.shiftKey ? 'PASTEBLOCK' : 'PASTECLIP', '1': 'UI_PROPS', '2': 'INSERTPALETTE', '3': 'LIBRARY', '8': 'QUICKCALC', '9': 'COMMANDLINE', '0': 'CLEANSCREENON', l: 'UI_ORTHO', g: 'UI_GRID', b: 'UI_SNAP', f: 'UI_OSNAP', u: 'UI_POLAR', e: null, w: null, r: null, h: null, k: null, q: null, tab: 'UI_NEXTDOC', j: null, d: 'UI_DYN' };
      if (K === 'tab') { e.preventDefault(); app.nextDoc(e.shiftKey ? -1 : 1); return; }
      if (e.shiftKey && K === 'z') { run('MREDO'); return; }
      if (K in map && map[K]) {
        if (map[K] === 'UNDOKEY') { e.preventDefault(); if (ed.cmd) ed.cancel(); else app.exec('U'); return; }
        if ((K === 'c' || K === 'x' || K === 'a' || K === 'v') && tgt === this.el.input && this.el.input.value && K !== 'v' && K !== 'a') return; // salin teks command line
        if (K === 'v' && tgt === this.el.input && !ed.sel.size && navigator.clipboard && !localStorage.getItem('amatucad-clip')) return;
        run(map[K]); return;
      }
      if (K === '=' || K === '+' || K === '-') { e.preventDefault(); ed.zoomAt(ed.view.w / 2, ed.view.h / 2, K === '-' ? 1 / 1.4 : 1.4); return; }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); this.el.input.value = ''; this.hideAc(); closeMenu(); ed.cancel(); this.dyn(ed); return; }
    if (k === 'Enter' || (k === ' ' && !(ed.req?.spaces))) {
      if (k === ' ' && ed.req?.type === 'str' && ed.req.spaces) return;
      e.preventDefault(); this.submitCmd(); return;
    }
    if (k === 'Delete' && !this.el.input.value) { if (!ed.cmd && ed.sel.size) run('ERASE'); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (this.acList) { e.preventDefault(); this.acMove(k === 'ArrowDown' ? 1 : -1); return; }
      if (ed.req?.kws?.length && k === 'ArrowDown' && ed.T.dyn) { e.preventDefault(); const r = $('#dyn').getBoundingClientRect(); menu(ed.req.kws.map(kw => ({ l: kw, fn: () => ed.submit(kw) })), r.left, r.bottom); return; }
      if (this.inputHist.length) { e.preventDefault(); this.ihi = this.ihi < 0 ? this.inputHist.length - 1 : Math.max(0, Math.min(this.inputHist.length - 1, this.ihi + (k === 'ArrowUp' ? -1 : 1))); this.el.input.value = this.inputHist[this.ihi]; }
      return;
    }
    if (k === 'Tab' && ed.req?.base && ed.T.dyn) { e.preventDefault(); const v = parseFloat(this.el.input.value); if (isFinite(v)) { ed.dynAng = null; } return; }
    if (k.length === 1 && tgt !== this.el.input && !e.altKey) { this.focusCmd(); }
  }
  flip(k, name) { this.ed.T[k] = !this.ed.T[k]; if (k === 'ortho' && this.ed.T.ortho) this.ed.T.polar = false; if (k === 'polar' && this.ed.T.polar) this.ed.T.ortho = false; this.msgToggle(name, this.ed.T[k]); this.refreshStatus(); this.ed.invalidate(); }

  // ================= Misc =================
  bindMisc() {
    $('#wrap').addEventListener('pointerdown', () => closeMenu());
    window.addEventListener('cad-regen', () => this.ed.invalidate());
  }
  toggleTheme() { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'light' ? 'dark' : 'light'; try { localStorage.setItem('amatucad-theme', r.dataset.theme); } catch { } }
  cleanScreen() { $('#app').classList.toggle('clean'); }
  togglePalette(id, on) { const p = this.el.props; if (on === undefined) on = p.hidden; p.hidden = !on; if (on) this.buildProps(); this.ed.resize(); }
  toast(m) { toast(m); }
  alert(t, m) { win({ title: t, body: h('div', { style: { maxWidth: '420px' } }, m), buttons: [{ label: 'OK', pri: true, fn: w => w.close() }] }); }
  refresh() { this.buildRibbon(); this.buildTabs(); this.refreshStatus(); this.buildLayoutTabs(); this.buildFileTabs(); this.buildProps(); this.setTitle(); D.refreshLayerManager(this); }
  refreshLight() { this.buildRibbon(); this.buildProps(); this.buildFileTabs(); this.setTitle(); D.refreshLayerManager(this); }
  onSel() { clearTimeout(this._selT); this._selT = setTimeout(() => { this.buildRibbon(); this.buildProps(); if (this.ed.T.qp && this.ed.sel.size && !this.ed.cmd) D.quickProps(this); else if (isOpen('qp')) closeWin('qp'); }, 30); }
  onRegen() { }
  onOver() { }
  canvasMenu(x, y) {
    const ed = this.ed, app = this.app, r = $('#wrap').getBoundingClientRect(); x += r.left; y += r.top;
    if (ed.req) {
      const kws = ed.req.kws || [];
      menu([{ l: 'Enter', fn: () => ed.submit('') }, { l: 'Cancel', fn: () => ed.cancel() }, ...(kws.length ? ['-', ...kws.map(k => ({ l: k, fn: () => ed.submit(k) }))] : []), '-', { l: 'Snap Overrides', sub: Object.entries(OSNAP_NAMES).filter(([k]) => !['app', 'par'].includes(k)).map(([k, n]) => ({ l: n, fn: () => ed.overrideSnap = k })) }, { l: 'Pan', i: 'pan', fn: () => app.exec('PAN') }, { l: 'Zoom', i: 'zoomext', fn: () => app.exec('ZOOM') }, '-', { l: 'QuickCalc', i: 'calc', fn: () => app.exec('QUICKCALC') }], x, y);
      return;
    }
    const last = ed.lastCmd;
    const common = [last ? { l: `Repeat ${last}`, fn: () => app.exec(last) } : null, { l: 'Recent Input', sub: this.inputHist.slice(-10).reverse().map(t => ({ l: t.toUpperCase(), fn: () => app.exec(t) })).concat(this.inputHist.length ? [] : [{ l: '(kosong)', dis: true }]) }, '-'];
    if (ed.sel.size) {
      const one = ed.sel.size === 1 ? [...ed.sel][0] : null;
      menu([...common,
        { l: 'Cut', i: 'cut', sc: 'Ctrl+X', fn: () => app.exec('CUTCLIP') }, { l: 'Copy', i: 'copyclip', sc: 'Ctrl+C', fn: () => app.exec('COPYCLIP') }, { l: 'Copy with Base Point', sc: 'Ctrl+Shift+C', fn: () => app.exec('COPYBASE') }, { l: 'Paste', i: 'paste', sc: 'Ctrl+V', fn: () => app.exec('PASTECLIP') }, '-',
        { l: 'Erase', i: 'erase', sc: 'Del', fn: () => app.exec('ERASE') }, { l: 'Move', i: 'move', fn: () => app.exec('MOVE') }, { l: 'Copy Selection', i: 'copy', fn: () => app.exec('COPY') }, { l: 'Scale', i: 'scale', fn: () => app.exec('SCALE') }, { l: 'Rotate', i: 'rotate', fn: () => app.exec('ROTATE') },
        { l: 'Draw Order', i: 'draworder', sub: [{ l: 'Bring to Front', fn: () => app.exec('DRAWORDER F') }, { l: 'Send to Back', fn: () => app.exec('DRAWORDER B') }] },
        one && ['text', 'mtext', 'dim', 'leader'].includes(one.type) ? { l: 'Edit Text', i: 'text', fn: () => this.editEntity(one) } : null,
        one && one.type === 'pline' ? { l: 'Polyline Edit', i: 'pline', fn: () => app.exec('PEDIT') } : null,
        one && one.type === 'hatch' ? { l: 'Hatch Edit…', i: 'hatch', fn: () => app.exec('HATCHEDIT') } : null,
        one && one.type === 'insert' ? { l: 'Explode Block', i: 'explode', fn: () => app.exec('EXPLODE') } : null,
        '-', { l: 'Isolate', sub: [{ l: 'Isolate Objects', fn: () => this.isolate(true) }, { l: 'Hide Objects', fn: () => this.isolate(false) }, { l: 'End Object Isolation', fn: () => this.isolate(null) }] },
        { l: 'Deselect All', fn: () => ed.clearSel() }, { l: 'Select Similar', fn: () => app.exec('SELECTSIMILAR') }, { l: 'Quick Select…', i: 'qselect', fn: () => app.exec('QSELECT') }, { l: 'QuickCalc', i: 'calc', fn: () => app.exec('QUICKCALC') }, '-',
        { l: 'Quick Properties', i: 'qp', fn: () => D.quickProps(this) }, { l: 'Properties', i: 'props', sc: 'Ctrl+1', fn: () => this.togglePalette('props', true) }], x, y);
      return;
    }
    menu([...common, { l: 'Clipboard', sub: [{ l: 'Paste', fn: () => app.exec('PASTECLIP') }, { l: 'Paste as Block', fn: () => app.exec('PASTEBLOCK') }, { l: 'Paste to Original Coordinates', fn: () => app.exec('PASTEORIG') }] },
      { l: 'Isolate', sub: [{ l: 'End Object Isolation', fn: () => this.isolate(null) }] }, '-',
      { l: 'Undo', i: 'undo', sc: 'Ctrl+Z', fn: () => app.exec('U') }, { l: 'Redo', i: 'redo', sc: 'Ctrl+Y', fn: () => app.exec('MREDO') }, { l: 'Pan', i: 'pan', fn: () => app.exec('PAN') }, { l: 'Zoom', i: 'zoomext', fn: () => app.exec('ZOOM') }, '-',
      { l: 'Action Recorder', dis: true }, { l: 'Subobject Selection Filter', dis: true }, { l: 'Quick Select…', i: 'qselect', fn: () => app.exec('QSELECT') }, { l: 'QuickCalc', i: 'calc', fn: () => app.exec('QUICKCALC') }, { l: 'Find…', i: 'find', fn: () => app.exec('FIND') }, { l: 'Options…', i: 'options', fn: () => app.exec('OPTIONS') }], x, y);
  }
  editEntity(e) {
    const ed = this.ed;
    if (['text', 'mtext', 'dim', 'leader'].includes(e.type)) { ed.run('TEXTEDIT'); setTimeout(() => { if (ed.req?.type === 'ent') ed.finish({ e, p: e.p || e.dl }); }, 0); return; }
    if (e.type === 'hatch') { this.app.mutateAsync(() => D.hatchDialog(this, e)); return; }
    if (e.type === 'pline') { ed.setSel([e]); this.app.exec('PEDIT'); return; }
    if (e.type === 'insert') { this.togglePalette('props', true); return; }
    D.quickProps(this);
  }

  // ================= Properties palette =================
  buildProps(target = this.el.props, compact = false) {
    if (target.hidden) return;
    const ed = this.ed, doc = this.doc, all = [...ed.sel];
    target.innerHTML = '';
    const types = {}; all.forEach(e => types[e.type] = (types[e.type] || 0) + 1);
    let filt = this.propFilter && types[this.propFilter] ? this.propFilter : null;
    const list = filt ? all.filter(e => e.type === filt) : all;
    if (!compact) {
      const s = sel([['', all.length ? `All (${all.length})` : 'No selection'], ...Object.entries(types).map(([t, n]) => [t, `${TYPE_NAMES[t]} (${n})`])], filt || '', v => { this.propFilter = v || null; this.buildProps(); });
      target.append(h('div', { class: 'phead' }, s,
        h('button', { title: 'Toggle value of PICKADD', html: icon('plus') }),
        h('button', { title: 'Select Objects', html: icon('selall'), onclick: () => this.app.exec('SELECT') }),
        h('button', { title: 'Quick Select', html: icon('qselect'), onclick: () => this.app.exec('QSELECT') }),
        h('button', { title: 'Close', html: icon('close'), onclick: () => this.togglePalette('props', false) })));
    }
    const body = h('div', { class: 'pbody' }); target.append(body);
    const U = (fn) => { this.app.mutate(fn); ed.invalidate(); this.buildProps(target, compact); this.buildRibbon(); };
    const sec = (title, rows) => { const s = h('div', { class: 'psec' }, h('h4', { onclick: () => s.classList.toggle('closed') }, title, h('span', {}, '▾')), h('div', { class: 'prows' }, ...rows.filter(Boolean))); body.append(s); };
    const ro = (l, v) => h('div', { class: 'prow' }, h('label', { title: l }, l), h('div', {}, h('span', { class: 'ro', title: String(v) }, v)));
    const numRow = (l, val, set, f = x => ed.fmt(x)) => h('div', { class: 'prow' }, h('label', { title: l }, l), h('div', {}, h('input', { value: val === undefined ? '*VARIES*' : f(val), onchange: e => { const x = parseFloat(String(e.target.value).replace(',', '.')); if (isFinite(x)) U(() => set(x)); } })));
    const txtRow = (l, val, set) => h('div', { class: 'prow' }, h('label', {}, l), h('div', {}, h('input', { value: val ?? '', onchange: e => U(() => set(e.target.value)) })));
    const selRow = (l, opts, val, set) => h('div', { class: 'prow' }, h('label', {}, l), h('div', {}, sel(val === undefined ? [['', '*VARIES*'], ...opts] : opts, val ?? '', x => { if (x !== '') U(() => set(x)); })));
    const same = k => { const s = new Set(list.map(e => JSON.stringify(e[k] ?? null))); return s.size === 1 ? list[0][k] : undefined; };
    const colorOpts = [[256, 'ByLayer'], [0, 'ByBlock'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(c => [c, colorName(c)]), ['more', 'Select Color…']];
    const layOpts = Object.keys(doc.layers).map(n => [n, n]);
    const ltOpts = ['ByLayer', 'ByBlock', ...doc.ltypes].map(x => [x, x]);
    const lwOpts = [-1, -2, -3, ...LWEIGHTS].map(w => [w, lwName(w)]);
    if (!list.length) {
      sec('General', [
        selRow('Color', colorOpts, doc.set.ccolor, x => { if (x === 'more') return D.colorDialog(this, null, c => { doc.set.ccolor = c; this.buildProps(); }); doc.set.ccolor = +x; }),
        selRow('Layer', layOpts, doc.clayer, x => doc.clayer = x),
        selRow('Linetype', ltOpts, doc.set.clt, x => doc.set.clt = x),
        numRow('Linetype scale', doc.set.ltscale, x => doc.set.ltscale = x, x => String(x)),
        selRow('Lineweight', lwOpts, doc.set.clw, x => doc.set.clw = +x),
        ro('Transparency', 'ByLayer'), ro('Thickness', '0'),
      ]);
      sec('Plot style', [ro('Plot style', 'ByColor'), ro('Plot style table', 'monochrome.ctb')]);
      const v = ed.view, c = ed.s2w(v.w / 2, v.h / 2);
      sec('View', [ro('Center X', ed.fmt(c.x)), ro('Center Y', ed.fmt(c.y)), ro('Height', ed.fmt(v.h / v.scale)), ro('Width', ed.fmt(v.w / v.scale))]);
      sec('Misc', [ro('Annotation scale', '1:1'), ro('UCS icon On', 'Yes'), ro('UCS Name', ''), ro('Units', doc.set.units), numRow('Text height', doc.set.textH, x => doc.set.textH = x), numRow('Dim scale', doc.dim.scale, x => { doc.dim.scale = x; doc.dimRev++; }, x => String(x))]);
      return;
    }
    sec('General', [
      selRow('Color', colorOpts, same('color') ?? (list.every(e => e.color === undefined) ? 256 : undefined), x => { if (x === 'more') { D.colorDialog(this, null, c => U(() => list.forEach(e => e.color = c))); return; } list.forEach(e => e.color = +x); }),
      selRow('Layer', layOpts, same('layer'), x => list.forEach(e => e.layer = x)),
      selRow('Linetype', ltOpts, same('lt') ?? 'ByLayer', x => list.forEach(e => e.lt = x)),
      numRow('Linetype scale', same('lts') ?? 1, x => list.forEach(e => e.lts = x), x => String(x)),
      selRow('Lineweight', lwOpts, same('lw') ?? -1, x => list.forEach(e => e.lw = +x)),
      ro('Transparency', 'ByLayer'), ro('Hyperlink', ''), ro('Thickness', '0'),
    ]);
    if (Object.keys(types).length > 1 && !filt) return;
    const e = list[0], one = list.length === 1, f = x => ed.fmt(x), dg = x => (an(x) * R2D).toFixed(Math.max(0, doc.set.angPrec || 0));
    switch (e.type) {
      case 'line': sec('Geometry', [numRow('Start X', one ? e.p1.x : undefined, x => e.p1.x = x), numRow('Start Y', one ? e.p1.y : undefined, x => e.p1.y = x), numRow('End X', one ? e.p2.x : undefined, x => e.p2.x = x), numRow('End Y', one ? e.p2.y : undefined, x => e.p2.y = x), ro('Delta X', one ? f(e.p2.x - e.p1.x) : '*VARIES*'), ro('Delta Y', one ? f(e.p2.y - e.p1.y) : '*VARIES*'),
        numRow('Length', one ? dist(e.p1, e.p2) : undefined, x => e.p2 = polar(e.p1, ang(e.p1, e.p2), x)), numRow('Angle', one ? an(ang(e.p1, e.p2)) : undefined, x => e.p2 = polar(e.p1, x * D2R, dist(e.p1, e.p2)), dg)]); break;
      case 'circle': sec('Geometry', [numRow('Center X', one ? e.c.x : undefined, x => e.c.x = x), numRow('Center Y', one ? e.c.y : undefined, x => e.c.y = x), numRow('Radius', same('r'), x => list.forEach(c => c.r = x)), numRow('Diameter', same('r') !== undefined ? e.r * 2 : undefined, x => list.forEach(c => c.r = x / 2)), numRow('Circumference', same('r') !== undefined ? e.r * Math.PI * 2 : undefined, x => list.forEach(c => c.r = x / Math.PI / 2)), numRow('Area', same('r') !== undefined ? Math.PI * e.r * e.r : undefined, x => list.forEach(c => c.r = Math.sqrt(x / Math.PI)))]); break;
      case 'arc': sec('Geometry', [numRow('Center X', one ? e.c.x : undefined, x => e.c.x = x), numRow('Center Y', one ? e.c.y : undefined, x => e.c.y = x), numRow('Radius', same('r'), x => list.forEach(c => c.r = x)), numRow('Start angle', one ? e.sa : undefined, x => e.sa = x * D2R, dg), numRow('End angle', one ? e.ea : undefined, x => e.ea = x * D2R, dg), ro('Total angle', one ? dg(sweepOf(e.sa, e.ea)) : ''), ro('Arc length', one ? f(curveLen(e)) : ''), ro('Area', one ? f(e.r * e.r * (sweepOf(e.sa, e.ea) - Math.sin(sweepOf(e.sa, e.ea))) / 2) : '')]); break;
      case 'ellipse': sec('Geometry', [numRow('Center X', one ? e.c.x : undefined, x => e.c.x = x), numRow('Center Y', one ? e.c.y : undefined, x => e.c.y = x), numRow('Major radius', one ? len(e.u) : undefined, x => { e.u = mul(unit(e.u), x); }), numRow('Minor radius', one ? len(e.u) * e.k : undefined, x => { e.k = Math.min(1, x / len(e.u)); }), ro('Radius ratio', one ? e.k.toFixed(4) : ''), ro('Area', one ? f(entArea(e)) : '')]); break;
      case 'pline': {
        this.vtx = Math.min(this.vtx || 0, e.pts.length - 1);
        const P = e.pts[this.vtx];
        sec('Geometry', [one ? h('div', { class: 'prow' }, h('label', {}, 'Current Vertex'), h('div', {}, sel(e.pts.map((_, i) => [i, String(i + 1)]), this.vtx, x => { this.vtx = +x; this.buildProps(target, compact); }))) : null,
          one ? numRow('Vertex X', P.x, x => P.x = x) : null, one ? numRow('Vertex Y', P.y, x => P.y = x) : null, numRow('Global width', same('w') ?? 0, x => list.forEach(p => p.w = x)),
          ro('Elevation', '0'), ro('Area', one ? f(entArea(e)) : '*VARIES*'), ro('Length', one ? f(curveLen(e)) : '*VARIES*')]);
        sec('Misc', [selRow('Closed', [['1', 'Yes'], ['0', 'No']], same('closed') === undefined ? undefined : same('closed') ? '1' : '0', x => list.forEach(p => p.closed = x === '1')), ro('Linetype generation', 'Disabled')]);
        break;
      }
      case 'text': sec('Text', [one ? txtRow('Contents', e.s, x => e.s = x) : ro('Contents', '*VARIES*'), ro('Style', doc.set.textStyle), selRow('Justify', [['0,0', 'Left'], ['1,0', 'Center'], ['2,0', 'Right'], ['1,2', 'Middle'], ['0,3', 'Top left'], ['1,3', 'Top center'], ['2,3', 'Top right'], ['0,2', 'Middle left'], ['1,2', 'Middle center'], ['2,2', 'Middle right'], ['0,1', 'Bottom left'], ['1,1', 'Bottom center'], ['2,1', 'Bottom right']], one ? `${e.ha || 0},${e.va || 0}` : undefined, x => { const [a, b] = x.split(',').map(Number); list.forEach(t => { t.ha = a; t.va = b; }); }),
        numRow('Height', same('h'), x => list.forEach(t => t.h = x)), numRow('Rotation', same('rot') ?? 0, x => list.forEach(t => t.rot = x * D2R), dg), numRow('Width factor', same('wf') ?? 1, x => list.forEach(t => t.wf = x), x => String(x))]);
        if (one) sec('Geometry', [numRow('Position X', e.p.x, x => e.p.x = x), numRow('Position Y', e.p.y, x => e.p.y = x)]); break;
      case 'mtext': sec('Text', [one ? h('div', { class: 'prow' }, h('label', {}, 'Contents'), h('div', {}, h('button', { class: 'btn sm', style: { margin: '1px 4px' }, onclick: () => this.editEntity(e) }, 'Edit…'), h('span', { class: 'ro' }, decodeText(e.s).replace(/\n/g, ' ⏎ ')))) : null, numRow('Text height', same('h'), x => list.forEach(t => t.h = x)), numRow('Rotation', same('rot') ?? 0, x => list.forEach(t => t.rot = x * D2R), dg), numRow('Defined width', same('w') ?? 0, x => list.forEach(t => t.w = x)), selRow('Attachment', ['Top left', 'Top center', 'Top right', 'Middle left', 'Middle center', 'Middle right', 'Bottom left', 'Bottom center', 'Bottom right'].map((n, i) => [i + 1, n]), same('at') ?? 1, x => list.forEach(t => t.at = +x)), numRow('Line space factor', same('ls') ?? 1, x => list.forEach(t => t.ls = x), x => String(x))]);
        if (one) sec('Geometry', [numRow('Position X', e.p.x, x => e.p.x = x), numRow('Position Y', e.p.y, x => e.p.y = x)]); break;
      case 'hatch': sec('Pattern', [selRow('Pattern name', Object.keys(PATTERNS).map(p => [p, p]), same('pat'), x => list.forEach(t => { t.pat = x; delete t.patDef; })), numRow('Angle', same('ang') ?? 0, x => list.forEach(t => { t.ang = x * D2R; delete t.patDef; }), dg), numRow('Scale', same('sc') ?? 1, x => list.forEach(t => { t.sc = x; delete t.patDef; }), x => String(x)), ro('Associative', 'No')]);
        sec('Geometry', [ro('Area', one ? f(entArea(e)) : '*VARIES*'), ro('Loops', one ? e.loops.length : '')]); break;
      case 'dim': {
        const ds = { ...doc.dim, ...(e.ds || {}) };
        const setDs = (k, x) => list.forEach(d => { d.ds = { ...(d.ds || {}), [k]: x }; });
        sec('Text', [ro('Measurement', one ? fmtNum(dimValue(e) * (ds.lfac || 1), e.kind === 'ang' ? ds.angDec : ds.dec, ds.sep) : '*VARIES*'), txtRow('Text override', one ? e.txt : '', x => list.forEach(d => d.txt = x)), numRow('Text height', ds.txt, x => setDs('txt', x)), numRow('Text offset', ds.gap, x => setDs('gap', x))]);
        sec('Lines & Arrows', [selRow('Arrow', [['closed', 'Closed filled'], ['tick', 'Architectural tick'], ['dot', 'Dot'], ['open', 'Open']], ds.arrow, x => setDs('arrow', x)), numRow('Arrow size', ds.asz, x => setDs('asz', x)), numRow('Ext line ext', ds.exe, x => setDs('exe', x)), numRow('Ext line offset', ds.exo, x => setDs('exo', x))]);
        sec('Primary Units', [selRow('Precision', [0, 1, 2, 3, 4].map(n => [n, n ? '0.' + '0'.repeat(n) : '0']), ds.dec, x => setDs('dec', +x)), selRow('Decimal separator', [[',', "',' (Comma)"], ['.', "'.' (Period)"]], ds.sep, x => setDs('sep', x)), numRow('Dim scale linear', ds.lfac, x => setDs('lfac', x), x => String(x)), numRow('Overall scale', ds.scale, x => setDs('scale', x), x => String(x))]);
        break;
      }
      case 'insert': sec('Geometry', [ro('Name', one ? e.name : '*VARIES*'), numRow('Position X', one ? e.p.x : undefined, x => e.p.x = x), numRow('Position Y', one ? e.p.y : undefined, x => e.p.y = x), numRow('Scale X', same('sx') ?? 1, x => list.forEach(b => b.sx = x), x => String(x)), numRow('Scale Y', same('sy') ?? same('sx') ?? 1, x => list.forEach(b => b.sy = x), x => String(x)), numRow('Rotation', same('rot') ?? 0, x => list.forEach(b => b.rot = x * D2R), dg)]); break;
      case 'point': if (one) sec('Geometry', [numRow('Position X', e.p.x, x => e.p.x = x), numRow('Position Y', e.p.y, x => e.p.y = x)]); break;
      case 'leader': sec('Text', [one ? txtRow('Contents', e.s, x => e.s = x) : null, numRow('Text height', same('h') ?? doc.dim.txt, x => list.forEach(t => t.h = x))]); break;
      case 'spline': sec('Data', [ro('Method', e.cp ? 'CV' : 'Fit'), ro('Number of points', (e.fit || e.cp || []).length), ro('Closed', e.closed ? 'Yes' : 'No'), ro('Length', one ? f(curveLen(e)) : '')]); break;
      case 'xline': case 'ray': if (one) sec('Geometry', [numRow('Basepoint X', e.p.x, x => e.p.x = x), numRow('Basepoint Y', e.p.y, x => e.p.y = x), numRow('Direction angle', an(Math.atan2(e.dir.y, e.dir.x)), x => e.dir = { x: Math.cos(x * D2R), y: Math.sin(x * D2R) }, dg)]); break;
    }
  }

  // ================= In-place text editor =================
  textEditor({ p, w, h: th, rot, s, single }) {
    return new Promise(resolve => {
      const ed = this.ed, wrap = $('#wrap'), sp = ed.w2s(p), v = ed.view;
      const fs = Math.max(10, Math.min(72, th * v.scale / CAP));
      const ta = h('textarea', { class: 'tedit', spellcheck: 'false' });
      ta.value = s || '';
      Object.assign(ta.style, { left: sp.x + 'px', top: (sp.y - (single ? fs * 1.1 : 0)) + 'px', fontSize: fs + 'px', width: Math.max(140, w ? w * v.scale : 300) + 'px', height: Math.max(fs * 2.2, fs * 1.667 * Math.max(2, (s || '').split('\n').length + 1)) + 'px', transform: rot ? `rotate(${-rot}rad)` : '', transformOrigin: '0 0' });
      const bar = h('div', { class: 'tedit-bar' }, 'Text Editor', h('span', { style: { color: 'var(--tx3)' } }, single ? 'Enter = OK' : 'Ctrl+Enter = OK · Esc = Batal'),
        h('button', { class: 'btn sm', onclick: () => done(true) }, '✓ Close Text Editor'), h('button', { class: 'btn sm', onclick: () => done(false) }, 'Cancel'));
      Object.assign(bar.style, { left: sp.x + 'px', top: Math.max(4, sp.y - (single ? fs * 1.1 : 0) - 34) + 'px' });
      wrap.append(ta, bar); this.teditOpen = true; this.dynHide();
      setTimeout(() => { ta.focus(); ta.select(); }, 20);
      let closed = false;
      const done = ok => { if (closed) return; closed = true; ta.remove(); bar.remove(); this.teditOpen = false; this.focusCmd(); resolve(ok ? ta.value : null); };
      ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') done(false); if (e.key === 'Enter' && (single || e.ctrlKey || e.metaKey)) { e.preventDefault(); done(true); } });
      const off = e => { if (!ta.contains(e.target) && !bar.contains(e.target)) { document.removeEventListener('pointerdown', off, true); done(true); } };
      setTimeout(() => document.addEventListener('pointerdown', off, true), 50);
    });
  }

  // ================= dialog proxies =================
  layerManager() { D.layerManager(this); }
  draftingDialog(t) { D.drafting(this, t); }
  unitsDialog() { D.units(this); }
  optionsDialog() { D.options(this); }
  dimStyleDialog() { D.dimStyle(this); }
  textStyleDialog() { D.textStyle(this); }
  colorDialog(c, cb) { D.colorDialog(this, c, cb); }
  linetypeDialog() { D.linetype(this); }
  lweightDialog() { D.lweight(this); }
  quickCalc() { D.quickCalc(this); }
  help() { D.help(this); }
  qselectDialog() { D.qselect(this); }
  findDialog() { D.find(this); }
  blockDialog() { return D.blockDialog(this); }
  insertDialog(filter) { return D.insertDialog(this, filter); }
  hatchDialog(e) { return D.hatchDialog(this, e); }
}
function iconFor(n) {
  const m = { LINE: 'line', PLINE: 'pline', CIRCLE: 'circle', ARC: 'arc', RECTANG: 'rect', POLYGON: 'polygon', ELLIPSE: 'ellipse', SPLINE: 'spline', XLINE: 'xline', RAY: 'ray', POINT: 'point', DONUT: 'donut', REVCLOUD: 'revcloud', HATCH: 'hatch', BOUNDARY: 'boundary', TEXT: 'text', MTEXT: 'mtext', MOVE: 'move', COPY: 'copy', ROTATE: 'rotate', SCALE: 'scale', MIRROR: 'mirror', OFFSET: 'offset', TRIM: 'trim', EXTEND: 'extend', FILLET: 'fillet', CHAMFER: 'chamfer', ARRAYRECT: 'array', ARRAYPOLAR: 'arraypolar', ARRAYPATH: 'arraypath', STRETCH: 'stretch', EXPLODE: 'explode', JOIN: 'join', BREAK: 'break', ERASE: 'erase', LENGTHEN: 'lengthen', MATCHPROP: 'matchprop', DIMLINEAR: 'dimlin', DIMALIGNED: 'dimali', DIMANGULAR: 'dimang', DIMRADIUS: 'dimrad', DIMDIAMETER: 'dimdia', DIM: 'dim', MLEADER: 'leader', LAYER: 'layer', BLOCK: 'block', INSERT: 'insert', ZOOM: 'zoomext', PAN: 'pan', PLOT: 'plot', EXPORT: 'export', DIST: 'dist', AREA: 'area', UNITS: 'units', OPTIONS: 'options', PURGE: 'purge', QSELECT: 'qselect' };
  return m[n] || 'line';
}
// Pratinjau pola hatch kecil
export function patternSwatch(c, name) {
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#111'; x.fillStyle = '#111'; x.lineWidth = 1;
  if (name === 'SOLID') { x.fillStyle = '#4a4f57'; x.fillRect(6, 6, c.width - 12, c.height - 12); return; }
  const sc = { 'AR-B816': 0.06, 'AR-BRSTD': 0.15, 'AR-CONC': 0.15, 'AR-SAND': 0.35, GRASS: 0.4, EARTH: 0.5 }[name] || 0.9;
  const loop = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 38 }, { x: 0, y: 38 }];
  const segs = hatchLines([loop], name, sc) || [];
  const k = c.width / 40; x.beginPath();
  for (const [a, b] of segs) { if (a.x === b.x && a.y === b.y) { x.rect(a.x * k - .7, c.height - a.y * k - .7, 1.4, 1.4); continue; } x.moveTo(a.x * k, c.height - a.y * k); x.lineTo(b.x * k, c.height - b.y * k); }
  x.stroke();
}
void prims; void loopPts; void xform; void M; void add; void sub;
