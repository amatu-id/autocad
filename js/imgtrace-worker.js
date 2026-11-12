// Web Worker Auto Trace: terima piksel RGBA gambar kerja → traceImage → bentuk CAD (piksel, Y ke atas).
import { traceImage, quickAnalyze } from './imgtrace.js?v=1';
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'analyze') self.postMessage({ type: 'analysis', id: m.id, ...quickAnalyze(new Uint8ClampedArray(m.buf), m.W, m.H) });
    else if (m.type === 'trace') {
      const r = traceImage(new Uint8ClampedArray(m.buf), m.W, m.H, m.opt || {}, (msg, f) => self.postMessage({ type: 'progress', id: m.id, msg, f }));
      self.postMessage({ type: 'done', id: m.id, ...r });
    }
  } catch (err) { self.postMessage({ type: 'error', id: m.id, msg: String(err?.message || err), stack: String(err?.stack || '') }); }
};
