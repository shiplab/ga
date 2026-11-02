/* The OpenCV engine in the browser: loads OpenCV.js (vendor/opencv.js, its own file) on demand, renders the GA page
   upright at 3000 px, takes the PDF text, and runs the parts of gacv.js (views, frame and scale, bulkheads, levels,
   double hull, tanks, ends, hull). Everything runs on this computer. Pixels of the render are page points times kR. */
(function () {
  var loading = null;
  function load(src) {
    if (window.__cvReady) return Promise.resolve(window.__cvReady);  // {cv}
    if (loading) return loading;
    loading = new Promise(function (ok, fail) {
      function ready() {
        var m = window.cv; if (!m || m instanceof Element) { fail(new Error('OpenCV did not load')); return; }
        function done(mm) { window.__cvReady = { cv: mm }; ok(window.__cvReady); }      // wrapped: the module is a thenable, and a promise would wait on it for ever
        if (typeof m.then === 'function' && !m.Mat) { m.then(done, fail); return; }
        if (m.Mat) { done(m); return; }
        m.onRuntimeInitialized = function () { done(m); };
      }
      if (window.cv && !(window.cv instanceof Element)) { ready(); return; }      // the canvas of the app has the id cv: window.cv is that element until OpenCV loads
      var s = document.createElement('script'); s.src = src || 'vendor/opencv.js'; s.async = true;
      s.onload = ready; s.onerror = function () { loading = null; fail(new Error('vendor/opencv.js not found')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function strip(f) { if (!f) return null; var g = {}; Object.keys(f).forEach(function (k) { if (k !== 'hLines' && k !== 'vLines') g[k] = f[k]; }); return g; }
  // page: a pdf.js page; rot: quarter turns clockwise already applied by the app; info: {loa, beam, depth, draught, draughtDesign, dbBottom}
  async function analyse(page, rot, info, opt) {
    opt = opt || {};
    var cv = (await load(opt.src)).cv, G = window.GACV, t0 = Date.now();
    var rotation = ((page.rotate || 0) + 90 * rot) % 360, v1 = page.getViewport({ scale: 1, rotation: rotation }), kR = (opt.side || 3000) / Math.max(v1.width, v1.height);
    var vp = page.getViewport({ scale: kR, rotation: rotation }), c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    var g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    var tc = await page.getTextContent(), T = window.pdfjsLib.Util.transform;
    var items = tc.items.filter(function (t) { return t.str && t.str.trim(); }).map(function (t) {
      var m = T(vp.transform, t.transform), ang = Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI), h = Math.hypot(m[2], m[3]);
      return { s: t.str.trim(), x: m[4], y: m[5], ang: ang, h: h, w: t.width * kR };
    });
    var out = { kR: kR, W: c.width, H: c.height, notes: [] };
    var q = items.length >= 8 ? G.turnFromText(items) : 0;
    if (q) out.notes.push('Most of the text on the sheet is turned ' + (90 * q) + ' degrees; the sheet was read as the app turned it.');      // the app's turn (from the lines) is kept
    var src = cv.imread(c), gray = G.gray(cv, src); src.delete();
    try {
      var text = G.turnText(items, c.width, c.height, 0);
      var views = G.findViews(cv, gray, text);
      var frames = views.filter(function (v) { return /profile|plan|section/.test(v.role); }).map(function (v) { return G.frame(cv, gray, v, v.role); });
      out.views = views; out.text = text;
      var own = function (role) { return frames.some(function (f) { return f.role === role && f.outline; }); };
      if ((!own('profile') || !(own('tank plan') || own('deck plan'))) && opt.views && opt.views.length) {     // OpenCV did not name the views: take the views and roles of the app
        out.viewsFrom = 'app';
        frames = opt.views.map(function (v) { var b = { x: Math.max(0, Math.round(v.x0 * kR)), y: Math.max(0, Math.round(v.y0 * kR)), w: Math.round((v.x1 - v.x0) * kR), h: Math.round((v.y1 - v.y0) * kR), role: v.role }; b.w = Math.min(b.w, c.width - b.x); b.h = Math.min(b.h, c.height - b.y); return b; })
          .filter(function (b) { return b.w > 20 && b.h > 20; }).map(function (v) { return G.frame(cv, gray, v, v.role); });
      }
      var pr = frames.filter(function (f) { return f.role === 'profile'; })[0], plans = frames.filter(function (f) { return /plan/.test(f.role) && f.outline && f.centreline != null; });
      var se = frames.filter(function (f) { return f.role === 'section' && f.outline; })[0];
      if (!pr || !pr.outline || !plans.length) { out.fail = 'no profile and plan found by OpenCV'; return out; }
      if (pr.mainDeck == null) { out.fail = 'no main deck line found in the profile'; return out; }
      var LOA = info.loa, B = info.beam;
      if (!LOA) { out.fail = 'the length overall is needed'; return out; }
      var k = pr.lengthPx / LOA, planB = plans.map(function (f) { return f.breadthPx; }).filter(function (v) { return v > 0; });
      var ky = B && planB.length ? planB.reduce(function (a, b) { return a + b; }, 0) / planB.length / B : k, kS = se && B ? se.breadthPx / B : null;
      if (Math.abs(ky / k - 1) > 0.08) { out.notes.push('Breadth and length scales differ by ' + Math.round((ky / k - 1) * 100) + '%: the breadth scale was not used.'); ky = k; }
      if (Math.abs(ky / k - 1) > 0.005) out.notes.push('Drawing not quite to scale: the length gives ' + k.toFixed(2) + ' px/m, the breadth ' + ky.toFixed(2) + ' px/m (' + ((ky / k - 1) * 100).toFixed(1) + '%). x uses the length, y and z the breadth.');
      var S = G.ship(frames.filter(function (f) { return f.outline; }), k, ky);
      if (S.tank && S.tank.centreline == null) S.tank = null; if (S.deck && S.deck.centreline == null) S.deck = null;
      if (!S.tank && !S.deck) { out.fail = 'no plan with a centreline'; return out; }
      var BH = G.bulkheads(cv, gray, S), LV = G.levels(cv, gray, S, { kS: kS }), DH = G.doubleHull(cv, gray, S, text, { kS: kS, B: B });
      if (!DH.outerHalf && (S.tank || S.deck)) {                          // no tank plan: the deck plan gives the half-breadths
        var pl = S.deck || S.tank; DH.outerHalf = []; DH.innerHalf = [];
        for (var x = pl.outline.x; x < pl.outline.x + pl.outline.w; x++) { var t = pl.colTop[x - pl.box.x]; DH.outerHalf.push(t == null ? null : +((pl.centreline - t) / ky).toFixed(2)); DH.innerHalf.push(null); }
      }
      var TK = G.tanks(BH, LV, DH, S, text, { dbBottom: info.dbBottom });
      var EN = G.ends(BH, LV, DH, S, text, TK, { sectionLines: LV.section, houseHalf: B ? 0.35 * B : null });
      var drafts = [info.draughtDesign, info.draught].filter(function (v) { return v > 0; });
      var HU = null; try { HU = G.hull(S, LV, { kS: kS, B: B, draughts: drafts }); } catch (e) { out.notes.push('Hull table not made: ' + e.message); }
      out.ok = true; out.k = k; out.ky = ky; out.kS = kS;
      out.frames = { profile: strip(S.profile), deck: strip(S.deck), tank: strip(S.tank), section: strip(S.section) };
      out.BH = BH; out.LV = LV; out.DH = { wingP: DH.wingP, wingS: DH.wingS, clBulkhead: DH.clBulkhead, innerBottomSection: DH.innerBottomSection };
      out.TK = TK; out.EN = EN; out.HU = HU; out.ms = Date.now() - t0;
      return out;
    } finally { gray.delete(); }
  }
  /* Compartments of a view on a picture (scan): the ink of the drawing without the text and small marks, door openings
     closed, and the white areas it encloses. img: canvas; box: the view (pixels); o: {pxPerM, gapM (0.6), minM2 (1),
     textBoxes [{x0,y0,x1,y1}] to blank (OCR words)}. Returns {areas: [{id, x0, y0, x1, y1, areaPx}], at(x, y) -> id}. */
  function areas(cv, img, box, o) {
    var x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0)), w = Math.min(img.width - x0, Math.ceil(box.x1 - box.x0)), h = Math.min(img.height - y0, Math.ceil(box.y1 - box.y0));
    var c = document.createElement('canvas'); c.width = w; c.height = h; var g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, x0, y0, w, h, 0, 0, w, h);
    var src = cv.imread(c), gray = new cv.Mat(), ink = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); src.delete();
    // ink: dark pixels; Otsu between 120 and 215 (grey lines of a scan stay ink, paper does not)
    var th = o.th != null ? cv.threshold(gray, ink, +o.th, 255, cv.THRESH_BINARY_INV) : cv.threshold(gray, ink, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU); gray.delete();      // the ink level: chosen by the picture (Otsu) or set by hand
    (o.text === false ? [] : o.textBoxes || []).forEach(function (t) { cv.rectangle(ink, new cv.Point(Math.round(t.x0 - x0) - 1, Math.round(t.y0 - y0) - 1), new cv.Point(Math.round(t.x1 - x0) + 1, Math.round(t.y1 - y0) + 1), new cv.Scalar(0), -1); });
    // door openings, broken and dashed lines: the ink grows by half the gap first, so dashes join into lines
    var r = Math.max(1, Math.round((o.gapM != null ? o.gapM : 0.6) / 2 * o.pxPerM)), K = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * r + 1, 2 * r + 1)); cv.dilate(ink, ink, K); K.delete();
    // then text and small marks: connected pieces of ink that stay smaller than 1.2 m (plus the growth) every way are dropped
    var lab = new cv.Mat(), st = new cv.Mat(), cen = new cv.Mat(), n = cv.connectedComponentsWithStats(ink, lab, st, cen, 8, cv.CV_32S), small = new Uint8Array(n), lim = (o.markM != null ? o.markM : 1.2) * o.pxPerM + 2 * r, i;
    for (i = 1; i < n; i++) { var bw = st.intAt(i, cv.CC_STAT_WIDTH), bh = st.intAt(i, cv.CC_STAT_HEIGHT); if (bw < lim && bh < lim) small[i] = 1; }
    var L = lab.data32S, D = ink.data; for (i = 0; i < L.length; i++) if (small[L[i]]) D[i] = 0;
    lab.delete(); st.delete(); cen.delete();
    var mask = o.mask ? new Uint8Array(ink.data) : null;                // what OpenCV took as ink (after the gaps were closed and the marks dropped), for the overlay
    var white = new cv.Mat(); cv.bitwise_not(ink, white); ink.delete();
    var lab2 = new cv.Mat(), st2 = new cv.Mat(), cen2 = new cv.Mat(), n2 = cv.connectedComponentsWithStats(white, lab2, st2, cen2, 4, cv.CV_32S), out = [], minPx = (o.minM2 != null ? o.minM2 : 1) * o.pxPerM * o.pxPerM;
    for (i = 1; i < n2; i++) {
      var ax = st2.intAt(i, cv.CC_STAT_LEFT), ay = st2.intAt(i, cv.CC_STAT_TOP), aw = st2.intAt(i, cv.CC_STAT_WIDTH), ah = st2.intAt(i, cv.CC_STAT_HEIGHT), ar = st2.intAt(i, cv.CC_STAT_AREA);
      if (ax <= 0 || ay <= 0 || ax + aw >= w || ay + ah >= h) continue;            // touches the view border: outside the hull
      var grown = ar + 2 * (aw + ah) * r; if (grown < minPx) continue;
      out.push({ id: i, x0: x0 + ax - r, y0: y0 + ay - r, x1: x0 + ax + aw + r, y1: y0 + ay + ah + r, areaPx: grown });
    }
    var labs = new Int32Array(lab2.data32S); lab2.delete(); st2.delete(); cen2.delete(); white.delete();
    return { areas: out, th: th, mask: mask, mx: x0, my: y0, mw: w, mh: h, at: function (x, y) { var px = Math.round(x - x0), py = Math.round(y - y0); if (px < 0 || py < 0 || px >= w || py >= h) return 0; return labs[py * w + px]; } };
  }
  window.GAOCV = { load: load, analyse: analyse, areas: function (img, box, o) { return load().then(function (m) { return areas(m.cv, img, box, o); }); } };
})();
