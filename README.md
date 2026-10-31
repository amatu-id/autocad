# Amatu CAD

Aplikasi CAD 2D di browser dengan tata letak, perintah, shortcut, dan gesture gaya AutoCAD.
Live: https://amatu-id.github.io/autocad/

## Fitur utama
- **Antarmuka**: Application menu, Quick Access Toolbar, ribbon (Home, Insert, Annotate, View, Manage, Output) dengan tab kontekstual *Hatch Creation*, file tabs, tab Model/Layout, command line mengambang dengan AutoComplete, Dynamic Input, status bar (GRID, SNAP, DYN, ORTHO, POLAR, OTRACK, OSNAP, LWT, QP), palet Properties, Layer Properties Manager.
- **Draw**: LINE, PLINE (arc/width), CIRCLE (CR/CD/2P/3P/TTR), ARC (7 cara), RECTANG (fillet/chamfer/dimensi/rotasi), POLYGON, ELLIPSE (+arc), SPLINE, XLINE, RAY, POINT, DONUT, REVCLOUD, WIPEOUT, HATCH (deteksi batas otomatis + pulau, 20+ pola), BOUNDARY, TEXT, MTEXT.
- **Modify**: MOVE, COPY, ROTATE, SCALE, MIRROR, OFFSET, TRIM/EXTEND (Quick mode), FILLET, CHAMFER, ARRAY (rect/polar/path), STRETCH, EXPLODE, JOIN, BREAK, BREAKATPOINT, LENGTHEN, ALIGN, PEDIT, MATCHPROP, DRAWORDER, grip edit (Stretch/Move/Rotate/Scale/Mirror).
- **Annotate**: DIM (smart), DIMLINEAR, DIMALIGNED, DIMANGULAR, DIMARC, DIMRADIUS, DIMDIAMETER, DIMORDINATE, DIMCONTINUE, DIMBASELINE, MLEADER, CENTERMARK, Dimension Style Manager.
- **Presisi**: OSNAP (End, Mid, Cen, GCen, Node, Quad, Int, Ext, Ins, Per, Tan, Nea), Object Snap Tracking, Polar Tracking, Ortho, Grid Snap, input `x,y` `@dx,dy` `@d<a` `#x,y`, direct distance entry, FROM, M2P, ekspresi aritmetika.
- **Seleksi**: klik, Window (kiri→kanan), Crossing (kanan→kiri), Lasso (tekan-seret), Fence, WPolygon, CPolygon, ALL, Last, Previous, Quick Select, Select Similar.
- **Gambar kerja**: Layout dengan viewport berskala & kop gambar Indonesia, Plot (Ctrl+P) ke PDF vektor multi-lembar, SVG, PNG.
- **Ekspor/Impor**: DXF untuk AutoCAD R12, 2000, 2004, 2007, 2010, 2013, 2018–2027 (template tervalidasi, dimensi/hatch/blok asli), impor DXF, SketchUp via COLLADA (.dae) dengan ekstrusi, format native `.amcad`.
- **Pustaka blok**: pintu, jendela, sanitair, furnitur, kendaraan, pohon, simbol (arah utara, elevasi, potongan), kolom, tangga.

## Shortcut
Ctrl+N/O/S/P, Ctrl+Z/Y, Ctrl+C/X/V, Ctrl+Shift+C/V, Ctrl+A, Ctrl+1, Ctrl+2, Ctrl+8, Ctrl+9, Ctrl+0, F1, F2, F3, F7, F8, F9, F10, F11, F12, Enter/Space (ulang perintah), Esc, Del. Roda mouse = zoom, tahan roda = pan, double-click roda = zoom extents, pinch/dua jari di trackpad & layar sentuh.

Catatan: format biner .dwg dan .skp tidak ditulis langsung di browser; gunakan DXF (dibuka langsung oleh AutoCAD dan dapat disimpan ulang sebagai DWG) dan DAE (File → Import di SketchUp).
