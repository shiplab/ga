/* Local OCR. Everything it needs is inside the page (window.GA_ASSETS): the Tesseract worker and core, and the English data. Nothing is fetched. */
(function () {
  'use strict';
  var W = null, stop = false;
  function dec(s) { var b = atob(s), u = new Uint8Array(b.length), i; for (i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function txt(s) { return new TextDecoder().decode(dec(s)); }
  var onP = null;
  async function worker() {
    if (W) return W;
    var A = window.GA_ASSETS; if (!A || !window.Tesseract) throw new Error('The OCR files are not in this copy of the page.');
    var shim = "var _L=Uint8Array.from(atob(self.__LANG),function(c){return c.charCodeAt(0)});var _f=self.fetch;self.fetch=function(u,o){if(/traineddata/.test(String(u)))return Promise.resolve(new Response(_L.slice().buffer,{status:200}));return _f(u,o);};\n";
    var src = 'self.__LANG="' + A.lang + '";\n' + shim + txt(A.core) + '\n;\n' + txt(A.wk);
    var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    W = await Tesseract.createWorker('eng', 1, { workerPath: url, corePath: 'x', langPath: 'http://localhost/x', workerBlobURL: false, cacheMethod: 'none', logger: function (m) { if (onP) onP(m); } });
    await W.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return W;
  }
  function index(ts) { var B = {}, C = 64; ts.forEach(function (q) { var k = Math.floor(Math.min(q[0], q[2]) / C) + ',' + Math.floor(Math.min(q[1], q[3]) / C); (B[k] = B[k] || []).push(q); }); return { B: B, C: C }; }
  function inBox(ix, b) {
    var out = [], C = ix.C, x, y;
    for (x = Math.floor((b.x0 - 20) / C); x <= Math.floor((b.x1 + 20) / C); x++) for (y = Math.floor((b.y0 - 20) / C); y <= Math.floor((b.y1 + 20) / C); y++) (ix.B[x + ',' + y] || []).forEach(function (q) {
      if (Math.min(q[0], q[2]) >= b.x0 - 2 && Math.max(q[0], q[2]) <= b.x1 + 2 && Math.min(q[1], q[3]) >= b.y0 - 2 && Math.max(q[1], q[3]) <= b.y1 + 2) out.push(q);
    });
    return out;
  }
  function crop(list, b, k, turn, lw) {
    var pad = 6, w = Math.ceil((b.x1 - b.x0) * k) + 2 * pad, h = Math.ceil((b.y1 - b.y0) * k) + 2 * pad, c = document.createElement('canvas');
    c.width = turn ? h : w; c.height = turn ? w : h;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#000'; g.lineWidth = Math.max(1, (lw || 0.38) * k); g.lineCap = 'round';
    if (turn > 0) { g.translate(c.width, 0); g.rotate(Math.PI / 2); } else if (turn < 0) { g.translate(0, c.height); g.rotate(-Math.PI / 2); }
    g.beginPath(); list.forEach(function (q) { g.moveTo((q[0] - b.x0) * k + pad, (q[1] - b.y0) * k + pad); g.lineTo((q[2] - b.x0) * k + pad, (q[3] - b.y0) * k + pad); }); g.stroke();
    return c;
  }
  /* Reads every text block. segs: the page's segments (upright). onProgress(i, n). Returns [{text, x0,y0,x1,y1, conf}] in page points. */
  async function readPage(segs, W_, H_, onProgress) {
    stop = false;
    var G = window.GA2DBB, ts = G.textSegments(segs, W_, H_), blocks = G.textBlocks(ts, W_, H_), ix = index(ts), ixAll = null, w = await worker(), out = [], i;
    var tables = G.tableBoxes(segs, ts), t, res0;
    for (t = 0; t < tables.length; t++) {                                 // framed tables are read whole, in one go
      var tb = tables[t], tl = inBox(ixAll || (ixAll = index(segs)), { x0: tb.x0 + 3, y0: tb.y0 + 3, x1: tb.x1 - 3, y1: tb.y1 - 3 });
      res0 = await w.recognize(crop(tl, tb, Math.min(5, 3400 / Math.max(tb.x1 - tb.x0, tb.y1 - tb.y0)), 0, 0.72));
      if ((res0.data.text || '').trim()) out.push({ text: res0.data.text.trim(), x0: tb.x0, y0: tb.y0, x1: tb.x1, y1: tb.y1, conf: Math.round(res0.data.confidence), table: true });
    }
    var titles = G.titleBoxes(segs); await w.setParameters({ tessedit_pageseg_mode: '7' });
    for (t = 0; t < titles.length; t++) {                                 // titles over a double underline are read as one line each
      var tt = titles[t], tlst = inBox(ixAll || (ixAll = index(segs)), tt);
      if (tlst.length < 4) continue;
      var r7 = await w.recognize(crop(tlst, tt, 4, 0, 0.72)), t7 = (r7.data.text || '').trim().replace(/\s+/g, ' ');
      if (t7.length >= 3) out.push({ text: t7, x0: tt.x0, y0: tt.y0, x1: tt.x1, y1: tt.y1 + 3, conf: Math.round(r7.data.confidence), title: true });
    }
    await w.setParameters({ tessedit_pageseg_mode: '6' });
    blocks = blocks.filter(function (b) { var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; return !tables.some(function (q) { return cx > q.x0 && cx < q.x1 && cy > q.y0 && cy < q.y1; }); });
    blocks.sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; });
    for (i = 0; i < blocks.length; i++) {
      if (stop) break;
      var b = blocks[i], list = inBox(ix, b), bw = b.x1 - b.x0, bh = b.y1 - b.y0, k = Math.max(2, Math.min(6, 56 / Math.max(6, Math.min(bw, bh, 30)) * 1.6)), best = null, tries = bh > 1.6 * bw ? [1, -1] : [0];
      for (var t = 0; t < tries.length; t++) {
        var r = await w.recognize(crop(list, b, k, tries[t])), tx = (r.data.text || '').trim();
        if (tx && (!best || r.data.confidence > best.conf)) best = { text: tx, conf: r.data.confidence, turn: tries[t] };
      }
      if (best && best.conf >= 35 && /[A-Za-z0-9]{2,}/.test(best.text)) out.push({ text: best.text, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, conf: Math.round(best.conf), turn: best.turn });
      if (onProgress && (i % 5 === 0 || i === blocks.length - 1)) onProgress(i + 1, blocks.length);
      if (i % 20 === 0) await new Promise(function (r) { setTimeout(r, 0); });
    }
    return out;
  }
  /* Reads one region. From the vector lines inside box (page points), or from a picture (canvas). Returns {text, conf}. */
  async function readRegion(segs, box) {
    var w = await worker(); await w.setParameters({ tessedit_pageseg_mode: '6' });
    var list = inBox(index(segs), box), k = Math.max(2, Math.min(6, 3400 / Math.max(box.x1 - box.x0, box.y1 - box.y0, 1))), r = await w.recognize(crop(list, box, k, 0, 0.6));
    return { text: (r.data.text || '').trim(), conf: Math.round(r.data.confidence) };
  }
  async function readImage(img, box) {                                  // img: canvas or image; box in its pixels
    var w = await worker(); await w.setParameters({ tessedit_pageseg_mode: '6' });
    var bw = Math.max(8, box.x1 - box.x0), bh = Math.max(8, box.y1 - box.y0), k = Math.max(1, Math.min(4, 2400 / Math.max(bw, bh))), c = document.createElement('canvas');
    c.width = Math.round(bw * k) + 20; c.height = Math.round(bh * k) + 20; var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(img, box.x0, box.y0, bw, bh, 10, 10, bw * k, bh * k);
    var r = await w.recognize(c); return { text: (r.data.text || '').trim(), conf: Math.round(r.data.confidence) };
  }
  /* the words of a whole picture turned k quarter turns clockwise, sparse text mode: [{ text, conf, x0, y0, x1, y1 }] in the pixels of the turned picture of size (tw, th) */
  async function words(img, k, maxSide) {
    var sw = k % 2, W = sw ? img.height : img.width, H = sw ? img.width : img.height, s = Math.min(1.5, (maxSide || 2600) / Math.max(W, H)), c = document.createElement('canvas'); c.width = Math.round(W * s); c.height = Math.round(H * s);
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.save(); g.scale(s, s); g.translate(W / 2, H / 2); g.rotate(k * Math.PI / 2); g.drawImage(img, -img.width / 2, -img.height / 2); g.restore();
    var w = await worker(); await w.setParameters({ tessedit_pageseg_mode: '11' }); var r = await w.recognize(c), out = [];
    (r.data.words || []).forEach(function (q) { if (q.text && q.bbox) out.push({ text: q.text, conf: q.confidence, x0: q.bbox.x0 / s, y0: q.bbox.y0 / s, x1: q.bbox.x1 / s, y1: q.bbox.y1 / s }); });
    await w.setParameters({ tessedit_pageseg_mode: '6' }); return { words: out, W: W, H: H };
  }
  window.GAOCR = { words: words, progress: function (f) { onP = f; }, readRegion: readRegion, readImage: readImage, readPage: readPage, stop: function () { stop = true; }, ready: function () { return !!window.GA_ASSETS && !!window.Tesseract; } };
})();
