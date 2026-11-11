// Web Worker tracing: terima piksel tile (gaya trace) → klasifikasi ke peta kelas → vektorisasi.
import { classify, traceClasses } from './trace.js';
let W = 0, H = 0, cls = null;
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'init') { W = m.W; H = m.H; cls = new Uint8Array(W * H); self.postMessage({ type: 'ready' }); }
    else if (m.type === 'tile') classify(new Uint8ClampedArray(m.buf), m.w, m.h, cls, m.x, m.y, W);
    else if (m.type === 'run') { const r = traceClasses(cls, W, H, m.opt); cls = null; self.postMessage({ type: 'done', ...r }); }
  } catch (err) { self.postMessage({ type: 'error', msg: String(err?.message || err) }); }
};
