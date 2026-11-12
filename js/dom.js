// Utilitas DOM: elemen, jendela/dialog, menu konteks, toast.
import { icon } from './icons.js';
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const overlay = () => document.getElementById('overlay');
let zTop = 100;
const openWins = new Map();
// Jendela mengambang (modal atau palet)
export function win({ title, body, buttons = [], modal = true, width, height, id, left, top, onClose, footLeft }) {
  if (id && openWins.has(id)) { const w = openWins.get(id); w.el.style.zIndex = ++zTop; return w; }
  const bg = modal ? h('div', { class: 'modal-bg' }) : null;
  const wb = h('div', { class: 'wb' }, body);
  const wf = buttons.length || footLeft ? h('div', { class: 'wf' }, footLeft ? h('div', { class: 'left' }, footLeft) : null, ...buttons.map(b => h('button', { class: 'btn' + (b.pri ? ' pri' : ''), onclick: () => b.fn?.(api) }, b.label))) : null;
  const xb = h('button', { title: 'Close', onclick: () => api.close() }, '×');
  const head = h('div', { class: 'wh' }, h('span', { class: 't' }, title), xb);
  const el = h('div', { class: 'win', style: { width: width ? width + 'px' : null, height: height ? height + 'px' : null, zIndex: ++zTop } }, head, wb, wf);
  if (bg) overlay().append(bg);
  overlay().append(el);
  const W = el.offsetWidth, H = el.offsetHeight;
  el.style.left = (left ?? Math.max(8, (innerWidth - W) / 2)) + 'px';
  el.style.top = (top ?? Math.max(8, (innerHeight - H) / 2.4)) + 'px';
  el.addEventListener('pointerdown', () => { el.style.zIndex = ++zTop; });
  let drag = null;
  head.addEventListener('pointerdown', e => { if (e.target === xb) return; drag = { x: e.clientX - el.offsetLeft, y: e.clientY - el.offsetTop }; head.setPointerCapture(e.pointerId); });
  head.addEventListener('pointermove', e => { if (!drag) return; el.style.left = Math.min(innerWidth - 60, Math.max(-W + 80, e.clientX - drag.x)) + 'px'; el.style.top = Math.min(innerHeight - 30, Math.max(0, e.clientY - drag.y)) + 'px'; });
  head.addEventListener('pointerup', () => drag = null);
  const keys = e => { if (e.key === 'Escape' && document.activeElement?.closest('.win') === el) { e.stopPropagation(); api.close(); } };
  el.addEventListener('keydown', keys);
  const api = { el, body: wb, close(v) { if (api.closed) return; api.closed = true; el.remove(); bg?.remove(); if (id) openWins.delete(id); onClose?.(v); } };
  if (id) openWins.set(id, api);
  setTimeout(() => { const f = el.querySelector('[autofocus]') || el.querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea'); if (f && modal) f.focus(); }, 30);
  return api;
}
export const isOpen = id => openWins.has(id);
export function closeWin(id) { openWins.get(id)?.close(); }
// Menu konteks
let curMenu = null;
export function closeMenu() { curMenu?.remove(); curMenu = null; }
// Menu buatan sendiri (mis. menu aplikasi) didaftarkan sebagai menu aktif agar closeMenu() (klik item, Esc, klik kanvas) ikut menutupnya.
export function setMenu(m) { curMenu = m; }
export function menu(items, x, y, cls = '') {
  closeMenu();
  const m = h('div', { class: 'menu ' + cls });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h('hr')); continue; }
    if (it.h) { m.append(h('div', { class: 'mh' }, it.h)); continue; }
    const row = h('div', { class: (it.dis ? 'dis ' : '') + (it.chk ? 'chk' : ''), onclick: e => { e.stopPropagation(); if (it.sub) { const r = row.getBoundingClientRect(); menu(it.sub, r.right, r.top); return; } closeMenu(); it.fn?.(); } },
      it.i ? h('span', { html: icon(it.i) }) : null, h('span', {}, it.l), it.sc ? h('span', { class: 'sc' }, it.sc) : null, it.sub ? h('span', { class: 'sc' }, '▸') : null);
    m.append(row);
  }
  overlay().append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  curMenu = m;
  setTimeout(() => { const off = e => { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); } }; document.addEventListener('pointerdown', off, true); }, 0);
  return m;
}
export function toast(msg, ms = 2600) {
  const t = h('div', { class: 'toast' }, msg); document.body.append(t);
  setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.remove(), 400); }, ms);
}
export function field(label, input) { return [h('label', {}, label), input]; }
export function sel(options, value, onchange, attrs = {}) {
  const s = h('select', { ...attrs, onchange: e => onchange?.(e.target.value) });
  for (const o of options) { const [v, l] = Array.isArray(o) ? o : [o, o]; const opt = h('option', { value: v }, l); if (String(v) === String(value)) opt.selected = true; s.append(opt); }
  return s;
}
export function num(value, onchange, attrs = {}) { return h('input', { type: 'number', step: 'any', value, ...attrs, onchange: e => onchange?.(parseFloat(e.target.value)) }); }
export function chk(label, value, onchange) { const i = h('input', { type: 'checkbox', onchange: e => onchange?.(e.target.checked) }); i.checked = !!value; return h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer' } }, i, label); }
