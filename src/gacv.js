/* gacv.js: GA reading with OpenCV.js, one function per part. Works in Node and in the browser.
   All functions take cv (the OpenCV.js module) and plain data; images are cv.Mat (RGBA or gray).
   Coordinates: pixels of the upright sheet, x to the right, y down.
   (Copy of the project doc ocvga/src/gacv.js, the OpenCV test by Henrique Gaspar, NTNU.) */
(function (root) {
  'use strict';
  var G = {};

  /* ---------- Part 0: turn the sheet upright from the text angles ---------- */
  // text items: {s, x, y, ang, h, w} in pixel coordinates of the render.
  G.turnFromText = function (items) {
    var n = {}; items.forEach(function (t) { var a = ((t.ang % 360) + 360) % 360; n[a] = (n[a] || 0) + t.s.length; });
    var best = 0, bn = -1; Object.keys(n).forEach(function (a) { if (n[a] > bn) { bn = n[a]; best = +a; } });
    // ang 270 (= -90): text reads upward, turn the sheet clockwise; 90: anticlockwise; 180: half turn
    return { 0: 0, 270: 1, 180: 2, 90: 3 }[best] || 0; // quarter turns clockwise
  };
  G.turnMat = function (cv, src, q) {
    var dst = new cv.Mat(); var codes = [null, cv.ROTATE_90_CLOCKWISE, cv.ROTATE_180, cv.ROTATE_90_COUNTERCLOCKWISE];
    if (!q) src.copyTo(dst); else cv.rotate(src, dst, codes[q]); return dst;
  };
  G.turnPoint = function (x, y, W, H, q) {
    if (q === 1) return [H - 1 - y, x]; if (q === 2) return [W - 1 - x, H - 1 - y]; if (q === 3) return [y, W - 1 - x]; return [x, y];
  };
  // text items moved to the upright sheet, as boxes {s, x0, y0, x1, y1, cx, cy, up} (up = upright after the turn)
  G.turnText = function (items, W, H, q) {
    return items.map(function (t) {
      var a = t.ang * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = dy, ny = -dx; // reading dir and "up" normal
      var pts = [[t.x, t.y], [t.x + dx * t.w, t.y + dy * t.w], [t.x + nx * t.h, t.y + ny * t.h], [t.x + dx * t.w + nx * t.h, t.y + dy * t.w + ny * t.h]]
        .map(function (p) { return G.turnPoint(p[0], p[1], W, H, q); });
      var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
      var b = { s: t.s, x0: Math.min.apply(0, xs), y0: Math.min.apply(0, ys), x1: Math.max.apply(0, xs), y1: Math.max.apply(0, ys), h: t.h };
      b.cx = (b.x0 + b.x1) / 2; b.cy = (b.y0 + b.y1) / 2; b.up = (((t.ang + 90 * q) % 360) + 360) % 360 === 0; return b;
    });
  };

  /* ---------- helpers ---------- */
  G.gray = function (cv, img) { var g = new cv.Mat(); if (img.channels() === 1) img.copyTo(g); else cv.cvtColor(img, g, cv.COLOR_RGBA2GRAY); return g; };
  G.ink = function (cv, gray, thr) { var b = new cv.Mat(); cv.threshold(gray, b, thr || 200, 255, cv.THRESH_BINARY_INV); return b; };
  function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }
  function inside(t, r, pad) { pad = pad || 0; return t.cx >= r.x - pad && t.cx <= r.x + r.w + pad && t.cy >= r.y - pad && t.cy <= r.y + r.h + pad; }
  G.rectOf = rect;

  /* ---------- Part 1: views ----------
     1) ink mask without text (text boxes are blanked, labels are found separately);
     2) close small gaps so a view becomes one blob, open to drop thin long lines between views;
     3) external contours = view candidates; small ones and the sheet frame are dropped;
     4) a view's role comes from the nearest view label (PROFILE, UPPER DECK, TANK TOP, SECTION ...). */
  var ROLE_WORDS = [
    [/PROFILE|ELEVATION|INBOARD/i, 'profile'],
    [/SECTION/i, 'section'],
    [/TANK\s*TOP|DOUBLE\s*BOTTOM|TANK\s*PLAN|INNER\s*BOTTOM/i, 'tank plan'],
    [/UPPER\s*DECK|MAIN\s*DECK|DECK\s*PLAN|PLAN\s*OF\s*DECK/i, 'deck plan'],
    [/DECK|PLAN/i, 'other plan']
  ];
  G.findViews = function (cv, gray0, text0, opt) {
    opt = opt || {};
    // work on a reduced copy (long side about 1000 px): views are big, and the morphology is much faster
    var s = Math.min(1, (opt.work || 1000) / Math.max(gray0.cols, gray0.rows)), gray = new cv.Mat();
    cv.resize(gray0, gray, new cv.Size(Math.round(gray0.cols * s), Math.round(gray0.rows * s)), 0, 0, cv.INTER_AREA);
    var text = text0.map(function (t) { return { s: t.s, x0: t.x0 * s, y0: t.y0 * s, x1: t.x1 * s, y1: t.y1 * s, cx: t.cx * s, cy: t.cy * s }; });
    var res = findViewsAt(cv, gray, text, opt); gray.delete();
    var pad = Math.round(Math.max(gray0.cols, gray0.rows) * 0.005); /* margin: the reduced copy can cut thin edges */
    res.forEach(function (b) { var x1 = Math.min(gray0.cols, Math.ceil((b.x + b.w) / s) + pad), y1 = Math.min(gray0.rows, Math.ceil((b.y + b.h) / s) + pad); b.x = Math.max(0, Math.floor(b.x / s) - pad); b.y = Math.max(0, Math.floor(b.y / s) - pad); b.w = x1 - b.x; b.h = y1 - b.y; if (b.labelDist != null) b.labelDist = Math.round(b.labelDist / s); });
    return res;
  };
  function findViewsAt(cv, gray, text, opt) {
    var W = gray.cols, H = gray.rows, L = Math.max(W, H);
    var ink = G.ink(cv, gray, opt.thr || 200);
    // blank text, so labels and tables of words do not glue views together
    text.forEach(function (t) { cv.rectangle(ink, new cv.Point(Math.floor(t.x0) - 2, Math.floor(t.y0) - 2), new cv.Point(Math.ceil(t.x1) + 2, Math.ceil(t.y1) + 2), new cv.Scalar(0), -1); });
    // remove long thin straight lines (page rules, frames, label underlines across views); hull lines
    // are curved at the ends or broken, so the views keep their shape
    var noLong = G.removeLongLines(cv, ink, opt.longFrac || 0.3);
    var k = Math.max(3, Math.round(L * (opt.join || 0.012))); // join gap, about 1.2% of the sheet
    var m = new cv.Mat(), K = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
    cv.morphologyEx(noLong, m, cv.MORPH_CLOSE, K); noLong.delete();
    var cs = new cv.MatVector(), hi = new cv.Mat();
    cv.findContours(m, cs, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    var boxes = [];
    for (var i = 0; i < cs.size(); i++) {
      var r = cv.boundingRect(cs.get(i));
      if (r.width * r.height < W * H * 0.004) continue;            // small: symbols, page number, stray marks
      if (r.width > W * 0.95 && r.height > H * 0.95) continue;     // sheet frame
      boxes.push(rect(r.x, r.y, r.width, r.height));
    }
    // merge boxes that overlap or almost touch (a view broken in two by the line removal)
    boxes = G.mergeBoxes(boxes, k);
    // ink density inside each box, used to tell a table of text from a drawing
    boxes.forEach(function (b) {
      var roi = ink.roi(new cv.Rect(b.x, b.y, b.w, b.h)); b.ink = cv.countNonZero(roi) / (b.w * b.h); roi.delete();
      b.words = text.filter(function (t) { return inside(t, b, 2); }).length;
    });
    ink.delete(); m.delete(); K.delete(); cs.delete(); hi.delete();
    G.guessRoles(boxes, text);
    return boxes.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
  }
  G.removeLongLines = function (cv, ink, frac) {
    var W = ink.cols, H = ink.rows, h = new cv.Mat(), v = new cv.Mat(), out = new cv.Mat();
    var Kh = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.round(W * frac), 1));
    var Kv = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.round(H * frac)));
    cv.morphologyEx(ink, h, cv.MORPH_OPEN, Kh); cv.morphologyEx(ink, v, cv.MORPH_OPEN, Kv);
    cv.bitwise_or(h, v, h); var K3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)); cv.dilate(h, h, K3);
    cv.subtract(ink, h, out); h.delete(); v.delete(); Kh.delete(); Kv.delete(); K3.delete(); return out;
  };
  G.mergeBoxes = function (boxes, pad) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < boxes.length && !changed; i++) for (var j = i + 1; j < boxes.length && !changed; j++) {
        var a = boxes[i], b = boxes[j];
        if (a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h) {
          var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
          boxes.splice(j, 1); boxes[i] = rect(x0, y0, x1 - x0, y1 - y0); changed = true;
        }
      }
    }
    return boxes;
  };
  G.guessRoles = function (boxes, text) {
    // a table: much of the box is covered by words (a drawing has a few small labels over a large area)
    boxes.forEach(function (b) {
      var a = 0; text.forEach(function (t) { if (inside(t, b, 2)) a += (t.x1 - t.x0) * (t.y1 - t.y0); });
      b.textFrac = a / (b.w * b.h);
    });
    // labels: short texts that match a role word; each label goes to the closest box (edge distance)
    var labels = [];
    text.forEach(function (t) { for (var i = 0; i < ROLE_WORDS.length; i++) if (ROLE_WORDS[i][0].test(t.s) && t.s.length < 30) { labels.push({ t: t, role: ROLE_WORDS[i][1], pri: i }); break; } });
    function dist(t, b) { var dx = Math.max(b.x - t.cx, 0, t.cx - b.x - b.w), dy = Math.max(b.y - t.cy, 0, t.cy - b.y - b.h); return Math.hypot(dx, dy); }
    boxes.forEach(function (b) { b.role = b.textFrac > 0.08 ? 'table' : null; b.label = null; });
    labels.sort(function (a, b) { return a.pri - b.pri; }).forEach(function (l) {
      var best = null, bd = 1e9;
      boxes.forEach(function (b) { if (b.role) return; var d = dist(l.t, b); if (d < bd) { bd = d; best = b; } });
      if (best && bd < 0.08 * Math.max(best.w, best.h) + 200) { best.role = l.role; best.label = l.t.s; best.labelDist = Math.round(bd); }
    });
    // a box full of words and no drawing role is a table (title block, particulars)
    boxes.forEach(function (b) { if (!b.role) b.role = 'other'; });
    return boxes;
  };

  /* ---------- Part 2: frame of a view ----------
     outline = the largest closed shape (hull) in the view; extents give length / breadth / depth in px.
     centreline (plans, section) and baseline (profile, section) are long horizontal or vertical runs.
     Scale: px per metre from LOA (profile and plans: outline length) and checks against B and D. */
  G.longLines = function (cv, binROI, horiz, minFrac, maxGapFrac) {
    // rows (horiz) or columns with a run of ink, gaps up to maxGap bridged, >= minFrac of the size
    var w = binROI.cols, h = binROI.rows, d = binROI.data, n = horiz ? h : w, len = horiz ? w : h;
    var gapMax = Math.round(len * (maxGapFrac || 0.01)), out = [];
    for (var i = 0; i < n; i++) {
      var best = 0, start = -1, last = -1e9, from = 0, to = 0;
      for (var j = 0; j < len; j++) {
        var v = horiz ? d[i * w + j] : d[j * w + i];
        if (v) { if (j - last > gapMax) start = j; last = j; if (last - start > best) { best = last - start; from = start; to = last; } }
      }
      if (best >= len * minFrac) {
        // solidity: share of the run that is ink (1 = solid line, about 0.5-0.8 = dashed or dash-dot)
        var on = 0; for (var q = from; q <= to; q++) if (horiz ? d[i * w + q] : d[q * w + i]) on++;
        out.push({ i: i, len: best, from: from, to: to, solid: on / (best + 1) });
      }
    }
    // merge neighbouring rows/cols into one line (thick or anti-aliased)
    var lines = [];
    out.forEach(function (o) { var l = lines[lines.length - 1]; if (l && o.i - l.i1 <= 2) { l.i1 = o.i; if (o.len > l.len) { l.len = o.len; l.from = o.from; l.to = o.to; } l.solid = Math.max(l.solid, o.solid); } else lines.push({ i0: o.i, i1: o.i, len: o.len, from: o.from, to: o.to, solid: o.solid }); });
    lines.forEach(function (l) { l.at = (l.i0 + l.i1) / 2; });
    return lines;
  };
  G.frame = function (cv, gray, box, role, opt) {
    opt = opt || {};
    var ink = G.ink(cv, gray, opt.thr || 200);
    var roi = ink.roi(new cv.Rect(box.x, box.y, box.w, box.h)), b = new cv.Mat(); roi.copyTo(b); roi.delete(); ink.delete();
    // hull outline: close small gaps, fill the biggest shape, then open it so thin lines sticking out
    // (centreline, CL, draught marks) are cut off; what is left is the solid shape of the hull
    var cs = new cv.MatVector(), hi = new cv.Mat(), c = new cv.Mat(), K = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(b, c, cv.MORPH_CLOSE, K);
    cv.findContours(c, cs, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    var bi = biggest(cv, cs), f = { role: role, box: box };
    if (bi >= 0) {
      var fill = cv.Mat.zeros(b.rows, b.cols, cv.CV_8UC1); cv.drawContours(fill, cs, bi, new cv.Scalar(255), -1);
      var ko = opt.open || 7, Ko = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(ko, ko));
      cv.morphologyEx(fill, fill, cv.MORPH_OPEN, Ko); Ko.delete();
      cs.delete(); hi.delete(); cs = new cv.MatVector(); hi = new cv.Mat();
      cv.findContours(fill, cs, hi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE); fill.delete();
      bi = biggest(cv, cs);
    }
    if (bi >= 0) {
      // breadth / height of the solid shape per column (used for the breadth over the parallel body)
      var one = cv.Mat.zeros(b.rows, b.cols, cv.CV_8UC1); cv.drawContours(one, cs, bi, new cv.Scalar(255), -1);
      f.colTop = []; f.colBot = [];
      for (var x = 0; x < one.cols; x++) { var t0 = -1, t1 = -1; for (var y = 0; y < one.rows; y++) if (one.data[y * one.cols + x]) { if (t0 < 0) t0 = y; t1 = y; } f.colTop.push(t0 < 0 ? null : t0 + box.y); f.colBot.push(t1 < 0 ? null : t1 + box.y); }
      one.delete();
      var r = cv.boundingRect(cs.get(bi)); f.outline = rect(r.x + box.x, r.y + box.y, r.width, r.height);
      var poly = new cv.Mat(); cv.approxPolyDP(cs.get(bi), poly, 2, true);
      f.outlinePts = []; for (var p = 0; p < poly.rows; p++) f.outlinePts.push([poly.data32S[p * 2] + box.x, poly.data32S[p * 2 + 1] + box.y]); poly.delete();
    }
    // long horizontal lines (>= 60% of the view width) and long vertical ones (>= 50% of its height), with solidity
    var H = G.longLines(cv, b, true, opt.hMin || 0.6, 0.012).map(function (l) { return { y: l.at + box.y, x0: l.from + box.x, x1: l.to + box.x, len: l.len, solid: +l.solid.toFixed(2) }; });
    var V = G.longLines(cv, b, false, opt.vMin || 0.5, 0.02).map(function (l) { return { x: l.at + box.x, y0: l.from + box.y, y1: l.to + box.y, len: l.len, solid: +l.solid.toFixed(2) }; });
    f.hLines = H; f.vLines = V;
    var o = f.outline;
    if (o) {
      if (/plan/.test(role)) {
        // centreline: long horizontal line nearest the middle of the outline (a plan is symmetric)
        var mid = o.y + o.h / 2, cl = null; H.forEach(function (l) { if (Math.abs(l.y - mid) < o.h * 0.15 && (!cl || Math.abs(l.y - mid) < Math.abs(cl.y - mid))) cl = l; });
        f.centreline = cl ? cl.y : null;
        f.lengthPx = o.w; f.maxBreadthPx = o.h;
        // breadth over the parallel middle body: median of the column heights from 30% to 70% of the length
        var tops = [], bots = [];
        for (var xx = Math.round(o.x - box.x + o.w * 0.3); xx < o.x - box.x + o.w * 0.7; xx++) if (f.colTop[xx] != null) { tops.push(f.colTop[xx]); bots.push(f.colBot[xx]); }
        var med = function (a) { a = a.slice().sort(function (p, q) { return p - q; }); return a[a.length >> 1]; };
        var yT = med(tops), yB = med(bots); f.breadthPx = yB - yT + 1;
        if (cl) { f.halfP = cl.y - yT; f.halfS = yB - cl.y; } // symmetry check
      } else if (role === 'profile' || role === 'section') {
        var span = o.w;
        if (role === 'profile') f.lengthPx = o.w; else f.breadthPx = o.w;
        if (role === 'section') { var midx = o.x + o.w / 2, cv2 = null; V.forEach(function (l) { if (Math.abs(l.x - midx) < o.w * 0.1 && (!cv2 || Math.abs(l.x - midx) < Math.abs(cv2.x - midx))) cv2 = l; }); f.centreline = cv2 ? cv2.x : null; }
        // lines across most of the hull, inside the outline height
        var inO = H.filter(function (l) { return l.y >= o.y - 3 && l.y <= o.y + o.h + 3 && l.len >= span * 0.6; });
        // baseline: the lowest long line (solid or dash-dot) near the bottom of the outline
        var base = inO.filter(function (l) { return l.y > o.y + o.h * 0.7; }).sort(function (a, c2) { return c2.y - a.y; })[0];
        f.baseline = base ? base.y : o.y + o.h; f.baselineFrom = base ? 'line' : 'outline bottom';
        // main deck: the LONGEST SOLID line above the baseline (deck piping and catwalks are shorter, draught lines are dashed)
        var cand = inO.filter(function (l) { return l !== base && l.solid >= 0.9 && l.y < f.baseline - o.h * 0.1; });
        var deck = cand.sort(function (a, c2) { return c2.len - a.len; })[0];
        f.mainDeck = deck ? deck.y : null;
        if (deck) {
          var D = f.baseline - deck.y;
          // dashed long lines between deck and baseline: waterlines (draught marks); solid ones close above the baseline: inner bottom
          f.waterlines = inO.filter(function (l) { return l.solid < 0.9 && l.y > deck.y && l.y < f.baseline - 2; }).map(function (l) { return l.y; });
          var ib = inO.filter(function (l) { return l.solid >= 0.9 && l.y < f.baseline - 2 && l.y > f.baseline - D * 0.25; }).sort(function (a, c2) { return c2.len - a.len; })[0];
          f.innerBottom = ib ? ib.y : null;
          f.depthPx = D;
        }
      }
    }
    b.delete(); c.delete(); cs.delete(); hi.delete(); K.delete();
    return f;
  };

  /* ---------- Ship coordinates (DBB axes) ----------
     x forward from the aft end of the hull outline, y to port (port = upper half of a plan), z up from the baseline; metres.
     kx = px per metre along the length (from LOA), ky = px per metre across and up (from B). */
  G.ship = function (frames, kx, ky) {
    ky = ky || kx;
    var by = function (r) { return frames.filter(function (f) { return f.role === r; })[0]; };
    var S = { k: kx, kx: kx, ky: ky, profile: by('profile'), deck: by('deck plan'), tank: by('tank plan'), section: by('section') };
    S.x = function (f, px) { return (px - f.outline.x) / kx; };                // any long view
    S.y = function (f, py) { return (f.centreline - py) / ky; };              // plans: port positive
    S.z = function (f, py) { return (f.baseline - py) / ky; };                // profile, section
    S.ys = function (f, px, kS) { return (f.centreline - px) / (kS || ky); }; // section: port on the left (looking forward)
    return S;
  };

  /* ---------- Part 3: transverse bulkheads ---------- */
  G.vertRuns = function (cv, gray, r, minLen, maxGap, thr) {
    // vertical lines inside rectangle r (absolute px): longest run per column, gaps bridged, merged neighbours
    var ink = G.ink(cv, gray, thr || 200), roi = ink.roi(new cv.Rect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))), b = new cv.Mat();
    roi.copyTo(b); roi.delete(); ink.delete();
    var L = G.longLines(cv, b, false, minLen / b.rows, maxGap / b.rows).map(function (l) { return { x: l.at + Math.round(r.x), y0: l.from + Math.round(r.y), y1: l.to + Math.round(r.y), len: l.len, solid: +l.solid.toFixed(2) }; });
    b.delete(); return L;
  };
  G.bulkheads = function (cv, gray, S, opt) {
    opt = opt || {};
    var out = { plan: [], profile: [], list: [] }, k = S.k;
    var pl = S.tank || S.deck;
    if (pl) {
      var o = pl.outline;
      G.vertRuns(cv, gray, o, o.h * 0.3, o.h * 0.03).forEach(function (l) {
        var i = Math.round(l.x - pl.box.x), top = pl.colTop[i], bot = pl.colBot[i];
        if (top == null) return;
        var local = bot - top + 1, share = l.len / local;
        if (share < 0.6) return;
        out.plan.push({ px: l.x, x: +S.x(pl, l.x).toFixed(2), share: +share.toFixed(2), kind: share >= 0.9 ? 'full' : 'inner', yP: +S.y(pl, l.y0).toFixed(2), yS: +S.y(pl, l.y1).toFixed(2), view: pl.role });
      });
    }
    var pr = S.profile;
    if (pr && pr.mainDeck != null) {
      var po = pr.outline, D = pr.baseline - pr.mainDeck;
      G.vertRuns(cv, gray, { x: po.x, y: pr.mainDeck - 3, w: po.w, h: D + 6 }, D * 0.7, D * 0.03).forEach(function (l) {
        out.profile.push({ px: l.x, x: +S.x(pr, l.x).toFixed(2), zTop: +S.z(pr, l.y0).toFixed(2), zBot: +S.z(pr, l.y1).toFixed(2), solid: l.solid });
      });
    }
    // match on x (tolerance 1 m, or 1% of the length)
    var tol = opt.tol || Math.max(1, pl ? pl.lengthPx / k * 0.01 : 1), used = {};
    out.plan.forEach(function (p) {
      var best = null; out.profile.forEach(function (q, j) { if (used[j]) return; var d = Math.abs(q.x - p.x); if (d <= tol && (!best || d < best.d)) best = { d: d, j: j }; });
      if (best) used[best.j] = true;
      out.list.push({ x: p.x, kind: p.kind, seen: best ? 'plan + profile' : 'plan only', dx: best ? +(out.profile[best.j].x - p.x).toFixed(2) : null,
        zTop: best ? out.profile[best.j].zTop : null, zBot: best ? out.profile[best.j].zBot : null, yP: p.yP, yS: p.yS });
    });
    out.profile.forEach(function (q, j) { if (!used[j]) out.list.push({ x: q.x, kind: '?', seen: 'profile only', zTop: q.zTop, zBot: q.zBot }); });
    out.list.sort(function (a, b) { return a.x - b.x; });
    return out;
  };

  /* ---------- Part 4: decks and levels ---------- */
  G.hRuns = function (cv, gray, r, minLen, maxGap, thr) {
    var ink = G.ink(cv, gray, thr || 200), x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    var roi = ink.roi(new cv.Rect(x, y, w, h)), b = new cv.Mat(); roi.copyTo(b); roi.delete(); ink.delete();
    var L = G.longLines(cv, b, true, minLen / b.cols, maxGap / b.cols).map(function (l) { return { y: l.at + y, x0: l.from + x, x1: l.to + x, len: l.len, solid: +l.solid.toFixed(2) }; });
    b.delete(); return L;
  };
  G.levels = function (cv, gray, S, opt) {
    opt = opt || {};
    var pr = S.profile, o = pr.outline, k = S.k, out = { levels: [], dashed: [] };
    var top = Math.max(0, o.y - 2), deckY = pr.mainDeck, baseY = pr.baseline;
    var regions = [
      { name: 'aft', r: { x: o.x, y: top, w: o.w * 0.25, h: deckY - 4 - top }, minLen: opt.minTier || 6 },
      { name: 'fore', r: { x: o.x + o.w * 0.85, y: top, w: o.w * 0.15, h: deckY - 4 - top }, minLen: opt.minFore || 6 },
      { name: 'hull', r: { x: o.x, y: deckY - 3, w: o.w, h: baseY - deckY + 6 }, minLen: opt.minFlat || 8 }
    ];
    var raw = [];
    regions.forEach(function (R) {
      if (!(R.r.h > 2) || !(R.r.w > 2)) return;
      G.hRuns(cv, gray, R.r, R.minLen * k, R.minLen * k * 0.05).forEach(function (l) {
        // a line cut by the inner edge of the aft or fore region carries on along the deck (piping, catwalk): not a tier
        if (R.name === 'aft' && l.x1 >= R.r.x + R.r.w - 3) return;
        if (R.name === 'fore' && l.x0 <= R.r.x + 3) return;
        var z = S.z(pr, l.y), it = { region: R.name, z: z, x0: S.x(pr, l.x0), x1: S.x(pr, l.x1), solid: l.solid };
        if (l.solid < 0.9) out.dashed.push(it); else raw.push(it);
      });
    });
    // one level per z (0.4 m), keeping the widest extent; the region decides the kind
    raw.sort(function (a, b) { return a.region < b.region ? -1 : a.region > b.region ? 1 : a.z - b.z; });
    raw.forEach(function (l) {
      var g = out.levels.filter(function (q) { return q.region === l.region && Math.abs(q.z - l.z) < 0.4; })[0];
      if (g) { g.x0 = Math.min(g.x0, l.x0); g.x1 = Math.max(g.x1, l.x1); g.n++; } else out.levels.push({ region: l.region, z: l.z, x0: l.x0, x1: l.x1, n: 1 });
    });
    var D = (baseY - deckY) / S.ky, ib = pr.innerBottom != null ? S.z(pr, pr.innerBottom) : null;
    out.levels.forEach(function (l) {
      l.kind = l.region === 'aft' ? 'deckhouse tier' : l.region === 'fore' ? 'forecastle' : Math.abs(l.z - D) < 0.4 ? 'main deck' : l.z < 0.4 ? 'baseline' : ib != null && Math.abs(l.z - ib) < 0.4 ? 'inner bottom' : 'flat';
      ['z', 'x0', 'x1'].forEach(function (p) { l[p] = +l[p].toFixed(2); }); l.length = +(l.x1 - l.x0).toFixed(2);
    });
    out.dashed.forEach(function (l) { ['z', 'x0', 'x1'].forEach(function (p) { l[p] = +l[p].toFixed(2); }); });
    // deckhouse: tiers sorted upward; tier heights between them; a last step under 2 m is a roof or rail, not a deck
    var tiers = out.levels.filter(function (l) { return l.kind === 'deckhouse tier'; }).sort(function (a, b) { return a.z - b.z; });
    out.tiers = tiers.map(function (t, i) { return { z: t.z, x0: t.x0, x1: t.x1, height: +(t.z - (i ? tiers[i - 1].z : D)).toFixed(2) }; });
    var last = tiers[tiers.length - 1], lt = out.tiers[out.tiers.length - 1];
    if (last && lt.height < 2) { last.kind = 'deckhouse roof'; lt.roof = true; }
    // forecastle: the lowest line is its deck; lines just above it (under 2 m) are the bulwark top
    var fc = out.levels.filter(function (l) { return l.kind === 'forecastle'; }).sort(function (a, b) { return a.z - b.z; });
    fc.forEach(function (l, i) { l.kind = i === 0 ? 'forecastle deck' : (l.z - fc[0].z < 2 ? 'forecastle bulwark' : 'forecastle top'); });
    out.mainDeck = +D.toFixed(2); out.innerBottom = ib != null ? +ib.toFixed(2) : null;
    // section: the same levels on its own scale (kS from the breadth), as a check
    var se = S.section;
    if (se && se.mainDeck != null && opt.kS) {
      var so = se.outline, kS = opt.kS;
      out.section = G.hRuns(cv, gray, { x: so.x, y: Math.max(0, se.box.y), w: so.w, h: se.baseline - se.box.y + 3 }, so.w * 0.15, so.w * 0.01)
        .map(function (l) { return { z: +((se.baseline - l.y) / kS).toFixed(2), halfWidth: +((l.x1 - l.x0) / 2 / kS).toFixed(2), solid: l.solid }; });
    }
    out.levels.sort(function (a, b) { return a.z - b.z; });
    return out;
  };

  /* ---------- Labels in ship coordinates (used by parts 5-9) ---------- */
  G.labelsIn = function (text, f, S, kS) {
    var b = f.box;
    return text.filter(function (t) { return t.cx >= b.x && t.cx <= b.x + b.w && t.cy >= b.y && t.cy <= b.y + b.h; }).map(function (t) {
      var r = { s: t.s };
      if (f.role === 'section') { r.y = +S.ys(f, t.cx, kS).toFixed(2); r.z = +((f.baseline - t.cy) / (kS || S.ky)).toFixed(2); }
      else { r.x = +S.x(f, t.cx).toFixed(2); if (/plan/.test(f.role)) r.y = +S.y(f, t.cy).toFixed(2); else r.z = +S.z(f, t.cy).toFixed(2); }
      return r;
    });
  };

  /* ---------- Part 6: double hull ---------- */
  G.doubleHull = function (cv, gray, S, text, opt) {
    opt = opt || {};
    var out = {}, se = S.section, kS = opt.kS || S.ky;
    if (se && se.mainDeck != null && se.innerBottom != null) {
      var lab = G.labelsIn(text, se, S, kS), pSign = 1;
      var p = lab.filter(function (l) { return /\(P\)/.test(l.s); }), s = lab.filter(function (l) { return /\(S\)/.test(l.s); });
      if (p.length && s.length) pSign = (p[0].y > s[0].y) ? 1 : -1; // S.ys puts the left side positive
      var h = se.innerBottom - se.mainDeck, half = se.breadthPx / 2 / kS;
      var V = G.vertRuns(cv, gray, { x: se.outline.x + 3, y: se.mainDeck + h * 0.05, w: se.outline.w - 6, h: h * 0.9 }, h * 0.9 * 0.5, h * 0.03);
      out.sectionLines = V.map(function (l) { return { y: +(pSign * S.ys(se, l.x, kS)).toFixed(2), solid: l.solid, len: +(l.len / kS).toFixed(2) }; });
      var solid = out.sectionLines.filter(function (l) { return l.solid >= 0.9; });
      var portIn = solid.filter(function (l) { return l.y > 1; }).sort(function (a, b) { return b.y - a.y; })[0];
      var stbdIn = solid.filter(function (l) { return l.y < -1; }).sort(function (a, b) { return a.y - b.y; })[0];
      out.clBulkhead = solid.some(function (l) { return Math.abs(l.y) < 0.5; });
      out.halfBreadthSection = +half.toFixed(2);
      if (portIn) out.wingP = +(half - portIn.y).toFixed(2);
      if (stbdIn) out.wingS = +(half + stbdIn.y).toFixed(2);
      out.innerBottomSection = +((se.baseline - se.innerBottom) / kS).toFixed(2);
      out.portIsLeft = pSign === 1;
    }
    // tank plan: inner hull lines and the inner half-breadth per x
    var tp = S.tank;
    if (tp) {
      var o = tp.outline, cl = tp.centreline;
      var H = G.hRuns(cv, gray, { x: o.x, y: o.y, w: o.w, h: o.h }, o.w * 0.4, o.w * 0.01).filter(function (l) { return l.solid >= 0.9; });
      var near = function (sideY, sgn) { return H.filter(function (l) { var d = sgn * (l.y - sideY); return d > 0.5 * S.ky && d < 5 * S.ky; }).sort(function (a, b) { return sgn * (a.y - b.y); })[0]; };
      var midTop = tp.centreline - tp.halfP, midBot = tp.centreline + tp.halfS;
      var ip = near(midTop, 1), is = near(midBot, -1);
      if (ip) out.planInnerP = { y: +S.y(tp, ip.y).toFixed(2), x0: +S.x(tp, ip.x0).toFixed(2), x1: +S.x(tp, ip.x1).toFixed(2), wing: +((ip.y - midTop) / S.ky).toFixed(2) };
      if (is) out.planInnerS = { y: +S.y(tp, is.y).toFixed(2), x0: +S.x(tp, is.x0).toFixed(2), x1: +S.x(tp, is.x1).toFixed(2), wing: +((midBot - is.y) / S.ky).toFixed(2) };
      // inner half-breadth per column: the first ink inside the shell, from the shell inwards
      // mask: ink without text, opened with a 1 m horizontal kernel (keeps the inner hull, drops bulkheads and dashes)
      var ink0 = G.ink(cv, gray, 200);
      (text || []).forEach(function (t) { cv.rectangle(ink0, new cv.Point(Math.floor(t.x0) - 1, Math.floor(t.y0) - 1), new cv.Point(Math.ceil(t.x1) + 1, Math.ceil(t.y1) + 1), new cv.Scalar(0), -1); });
      var ink = new cv.Mat(), Kh = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(3, Math.round(S.k)), 1));
      cv.morphologyEx(ink0, ink, cv.MORPH_OPEN, Kh); ink0.delete(); Kh.delete();
      var W = ink.cols, d = ink.data;
      out.innerHalf = []; out.outerHalf = [];
      for (var x = o.x; x < o.x + o.w; x++) {
        var top = tp.colTop[x - tp.box.x];
        if (top == null || cl == null) { out.innerHalf.push(null); out.outerHalf.push(null); continue; }
        var outer = (cl - top) / S.ky, wantIn = null;
        // walk from the shell inwards, skip the shell line itself (first 0.4 m), find the next solid ink pixel within 5 m
        for (var y = top + Math.round(0.4 * S.ky); y < top + 5 * S.ky && y < cl; y++) if (d[y * W + x]) { wantIn = (cl - y) / S.ky; break; }
        out.outerHalf.push(+outer.toFixed(2)); out.innerHalf.push(wantIn == null ? null : +wantIn.toFixed(2));
      }
      ink.delete(); out.planX0 = 0; // index 0 = aft end of the outline, 1 px steps
    }
    return out;
  };

  /* ---------- Part 5: cargo, slop and ballast tanks as DBB boxes ---------- */
  G.tanks = function (BH, LV, DH, S, text, opt) {
    opt = opt || {};
    var k = S.k, full = BH.list.filter(function (b) { return b.kind === 'full'; }).map(function (b) { return b.x; });
    var all = BH.list.map(function (b) { return b.x; });
    var spans = full.slice(1).map(function (x, i) { return [full[i], x]; }), best = null;
    for (var i = 0; i < spans.length; i++) for (var j = i + 2; j < spans.length; j++) {
      var w = spans.slice(i, j + 1), m = w.reduce(function (a, s) { return a + s[1] - s[0]; }, 0) / w.length;
      if (w.every(function (s) { return Math.abs((s[1] - s[0]) / m - 1) < 0.03; }) && (!best || w.length > best.length)) best = w;
    }
    var out = { cargo: best || [], blocks: [] };
    if (!best) return out;
    var x0c = best[0][0], prev = all.filter(function (x) { return x < x0c - 1; }).pop();
    out.slop = prev != null ? [prev, x0c] : null;
    var zIB = LV.innerBottom, zD = LV.mainDeck, wingDef = DH.wingP || DH.planInnerP && DH.planInnerP.wing || 2.6;
    if (zIB == null) zIB = opt.dbBottom || 0;
    var labels = S.tank ? G.labelsIn(text, S.tank, S) : [];
    function widths(xa, xb) {
      // mean outer and inner half-breadths over [xa, xb] (m), from the plan columns
      var n = 0, so = 0, si = 0;
      for (var px = Math.round(xa * k); px < Math.round(xb * k); px++) {
        var oh = (DH.outerHalf || [])[px], ih = (DH.innerHalf || [])[px];
        if (oh == null) continue;
        if (ih == null || ih > oh - 0.3) ih = oh - wingDef;  // no inner line found: assume the wing width
        n++; so += oh; si += ih;
      }
      return n ? { outer: so / n, inner: si / n } : null;
    }
    function nameFor(xa, xb, side, re) {
      var m = labels.filter(function (l) { return l.x > xa && l.x < xb && (side > 0 ? l.y > 0 : l.y < 0) && re.test(l.s); })[0];
      return m ? m.s : null;
    }
    function add(name, group, xa, xb, ya, yb, za, zb, src) {
      out.blocks.push({ name: name, group: group, shape: 'box', position: [+((xa + xb) / 2).toFixed(3), +((ya + yb) / 2).toFixed(3), +((za + zb) / 2).toFixed(3)],
        size: [+(xb - xa).toFixed(3), +Math.abs(yb - ya).toFixed(3), +(zb - za).toFixed(3)], volume: +((xb - xa) * Math.abs(yb - ya) * (zb - za)).toFixed(1), source: src });
    }
    var spansAll = (out.slop ? [{ s: out.slop, slop: true }] : []).concat(best.map(function (s) { return { s: s }; }));
    var nCargo = best.length;
    spansAll.forEach(function (sp, idx) {
      var xa = sp.s[0], xb = sp.s[1], wd = widths(xa, xb); if (!wd) return;
      var no = sp.slop ? null : nCargo - (idx - (out.slop ? 1 : 0));          // numbered from the bow
      [1, -1].forEach(function (sg) {
        var P = sg > 0 ? 'P' : 'S';
        var cot = nameFor(xa, xb, sg, sp.slop ? /SLOP(?!.*WBT)/ : /COT/) || (sp.slop ? 'SLOP(' + P + ')' : 'NO.' + no + ' COT(' + P + ')');
        var wbt = nameFor(xa, xb, sg, /WBT/) || (sp.slop ? 'SLOP WBT(' + P + ')' : 'NO.' + no + ' WBT(' + P + ')');
        add(cot, sp.slop ? 'Slop tanks' : 'Cargo tanks', xa, xb, 0, sg * wd.inner, zIB, zD, 'plan + profile');
        add(wbt + ' wing', 'Ballast tanks', xa, xb, sg * wd.inner, sg * wd.outer, zIB, zD, 'plan + profile');
        if (zIB > 0.3) add(wbt + ' DB', 'Ballast tanks', xa, xb, 0, sg * wd.outer, 0, zIB, 'plan + profile (DB is a box: the bilge is not cut off)');
      });
    });
    out.cargoVolume = +out.blocks.filter(function (b) { return b.group !== 'Ballast tanks'; }).reduce(function (a, b) { return a + b.volume; }, 0).toFixed(0);
    out.cotVolume = +out.blocks.filter(function (b) { return b.group === 'Cargo tanks'; }).reduce(function (a, b) { return a + b.volume; }, 0).toFixed(0);
    out.ballastVolume = +out.blocks.filter(function (b) { return b.group === 'Ballast tanks'; }).reduce(function (a, b) { return a + b.volume; }, 0).toFixed(0);
    return out;
  };

  /* ---------- Part 9 (first use): join labels written on two lines ---------- */
  G.joinLabels = function (labs, vert) {
    var key = vert || 'z', used = {}, out = [];
    labs.forEach(function (a, i) {
      if (used[i]) return; var grp = [a]; used[i] = true;
      labs.forEach(function (b, j) { if (used[j]) return; if (Math.abs(b.x - a.x) < 1.5 && grp.some(function (g) { return Math.abs(g[key] - b[key]) < 2.5; })) { grp.push(b); used[j] = true; } });
      grp.sort(function (p, q) { return q[key] - p[key]; });
      var r = { s: grp.map(function (g) { return g.s; }).join(' '), x: a.x }; r[key] = grp.reduce(function (s, g) { return s + g[key]; }, 0) / grp.length;
      if (vert !== 'y' && a.y != null) r.y = a.y; out.push(r);
    });
    return out;
  };

  /* ---------- Parts 7-8: aft end and fore end ---------- */
  G.ends = function (BH, LV, DH, S, text, TK, opt) {
    opt = opt || {};
    var kx = S.kx, out = { blocks: [], spaces: [] };
    var pl = G.joinLabels(S.profile ? G.labelsIn(text, S.profile, S) : [], 'z').filter(function (l) { return !/^(Ts|Td|BL|CL|\d+)$/.test(l.s); });
    var tl = G.joinLabels(S.tank ? G.labelsIn(text, S.tank, S) : [], 'y').filter(function (l) { return !/COT|WBT|SLOP|TANK TOP|^\d+$/.test(l.s); });
    out.labels = { profile: pl, plan: tl };
    var xs = BH.list.map(function (b) { return b.x; }), kinds = {}; BH.list.forEach(function (b) { kinds[b.x] = b.kind; });
    var Lh = S.profile.lengthPx / kx, ends = [0].concat(xs).concat([Lh]);
    var busy = (TK.slop ? [TK.slop] : []).concat(TK.cargo);
    var zD = LV.mainDeck, zIB = LV.innerBottom, ibL = LV.levels.filter(function (l) { return l.kind === 'inner bottom'; })[0];
    var flats = LV.levels.filter(function (l) { return l.kind === 'flat'; });
    function meanHalf(xa, xb, inner) {
      var n = 0, s = 0; for (var px = Math.round(xa * kx); px < Math.round(xb * kx); px++) { var v = ((inner ? DH.innerHalf : DH.outerHalf) || [])[px]; if (v != null) { n++; s += v; } }
      return n ? s / n : null;
    }
    function add(name, group, xa, xb, half, za, zb, src) {
      out.blocks.push({ name: name, group: group, shape: 'box', position: [+((xa + xb) / 2).toFixed(3), 0, +((za + zb) / 2).toFixed(3)], size: [+(xb - xa).toFixed(3), +(2 * half).toFixed(3), +(zb - za).toFixed(3)], volume: +((xb - xa) * 2 * half * (zb - za)).toFixed(1), source: src });
    }
    function groupOf(name) {
      return /ENGINE|PUMP|STEER|THR|B\.T\./i.test(name) ? 'Machinery' : /PEAK|TANK|WBT|BALLAST/i.test(name) ? 'Ballast tanks' : /DECKHOUSE|ACCOM|BRIDGE/i.test(name) ? 'Accommodation' : 'Other spaces';
    }
    for (var i = 0; i < ends.length - 1; i++) {
      var xa = ends[i], xb = ends[i + 1];
      if (xb - xa < 1) continue;
      if (busy.some(function (s) { return xa >= s[0] - 0.5 && xb <= s[1] + 0.5; })) continue;
      var inner = kinds[xa] === 'inner' && kinds[xb] === 'inner';
      var half = meanHalf(xa, xb, inner); if (half == null) continue;
      var labsP = pl.filter(function (l) { return l.x > xa && l.x < xb; }), labsT = tl.filter(function (l) { return l.x > xa && l.x < xb; });
      var withIB = ibL && ibL.x0 < xa + 1 && ibL.x1 > xb - 1, z0 = withIB ? zIB : 0;
      var fl = flats.filter(function (f) { return f.x0 < xb - 1 && f.x1 > xa + 1 && f.z > z0 + 1 && f.z < zD - 1; }).map(function (f) { return f.z; }).sort(function (a, b) { return a - b; });
      var cuts = [z0].concat(fl).concat([zD]);
      var sp = { x0: +xa.toFixed(2), x1: +xb.toFixed(2), inner: inner, parts: [] };
      for (var c = 0; c < cuts.length - 1; c++) {
        var za = cuts[c], zb = cuts[c + 1];
        var lab = labsP.filter(function (l) { return l.z > za && l.z < zb; })[0] || (cuts.length === 2 ? labsT[0] : null);
        var name = lab ? lab.s : (cuts.length > 2 ? (c === 0 ? 'Space below flat' : 'Space above flat') : 'Unnamed space') + ' (' + xa.toFixed(0) + '-' + xb.toFixed(0) + ' m)';
        if (/^B\.T\.$/.test(name) && labsT[0]) name = labsT[0].s;                 // short profile tag: take the plan name
        add(name, groupOf(name), xa, xb, half, za, zb, lab ? 'label' : 'no label');
        sp.parts.push({ name: name, z0: +za.toFixed(2), z1: +zb.toFixed(2) });
      }
      if (withIB) add('DB under ' + sp.parts[0].name, 'Ballast tanks', xa, xb, meanHalf(xa, xb, false), 0, zIB, 'inner bottom');
      out.spaces.push(sp);
    }
    // forecastle
    var fc = LV.levels.filter(function (l) { return l.kind === 'forecastle deck'; })[0];
    function deckHalf(xa, xb) {                       // mean half-breadth of the DECK plan outline (wider than the tank top at the ends)
      var d = S.deck; if (!d || d.centreline == null) return meanHalf(xa, xb, false);
      var n = 0, s = 0; for (var px = Math.round(d.outline.x + xa * kx); px < Math.round(d.outline.x + xb * kx); px++) { var t = d.colTop[px - d.box.x]; if (t != null) { n++; s += (d.centreline - t) / S.ky; } }
      return n ? s / n : null;
    }
    if (fc) { var h = deckHalf(fc.x0, Math.min(fc.x1, Lh)); if (h) add('Forecastle', 'Other spaces', fc.x0, Math.min(fc.x1, Lh), h, zD, fc.z, 'profile fore region + deck plan'); }
    // deckhouse tiers: half width from the nearest section line (within 0.7 m), else the one below
    var sec = (opt.sectionLines || []).filter(function (l) { return l.z > zD + 0.5; }).sort(function (a, b) { return a.z - b.z; });
    // stepped deckhouse: a lower tier is at least as long as the tier above it (its top line is partly hidden under that tier)
    for (var q = LV.tiers.length - 2; q >= 0; q--) { var up = LV.tiers[q + 1], lo = LV.tiers[q]; if (lo.roof) continue;
      if (up.x0 < lo.x0 || up.x1 > lo.x1) { lo.extended = true; lo.x0 = Math.min(lo.x0, up.x0); lo.x1 = Math.max(lo.x1, up.x1); } }
    var lastHalf = null;
    LV.tiers.forEach(function (t, i) {
      if (t.roof) return;
      var z0t = i ? LV.tiers[i - 1].z : zD, m = sec.filter(function (s) { return Math.abs(s.z - t.z) < 0.7; })[0];
      var hw = m ? m.halfWidth : (lastHalf != null ? lastHalf : opt.houseHalf);
      lastHalf = hw;
      if (hw == null) return;
      add('Deckhouse tier ' + (i + 1), 'Accommodation', t.x0, t.x1, hw, z0t, t.z, (m ? 'profile + section' : 'profile + section (width from the tier below)') + (t.extended ? '; length from the tier above' : ''));
    });
    return out;
  };

  /* ---------- Part 10a: hull (table of offsets) ---------- */
  function rowExtent(pts, y) {
    var xs = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    return xs.length >= 2 ? [Math.min.apply(0, xs), Math.max.apply(0, xs)] : null;
  }
  G.hull = function (S, LV, opt) {
    opt = opt || {};
    var kx = S.kx, ky = S.ky, pr = S.profile, dp = S.deck, tp = S.tank, se = S.section, kS = opt.kS || ky;
    var D = LV.mainDeck, zT = LV.innerBottom || 0, L = pr.lengthPx / kx;
    var nx = opt.stations || 41, warn = [];
    function planHalf(f, x) {
      var px = Math.round(f.outline.x + x * kx) - f.box.x, t = f.colTop[px], b = f.colBot[px];
      if (t == null || f.centreline == null) return 0;
      return Math.max(f.centreline - t, b - f.centreline) / ky;
    }
    // midship section shape s(z), from the section outline, symmetric about its centreline
    var secHalf = function (z) {
      if (!se || !se.outlinePts || se.centreline == null) return null;
      var y = se.baseline - z * kS, e = rowExtent(se.outlinePts, y);
      return e ? Math.max(se.centreline - e[0], e[1] - se.centreline) / kS : null;
    };
    var hMidD = secHalf(D - 0.3) || (opt.B / 2), sOf = function (z) { var h = secHalf(Math.max(0.15, Math.min(D - 0.3, z))); return h == null ? 1 : Math.min(1, h / hMidD); };
    var zs = [0, 0.5, 1, 1.5, zT, 3.5, 5, 6.5, 8, 10, 12].concat(opt.draughts || []).concat([D * 0.8, D * 0.9, D]);
    zs = zs.filter(function (z) { return z >= 0 && z <= D + 1e-6; }).map(function (z) { return Math.round(z * 1000) / 1000; })
      .sort(function (a, b) { return a - b; }).filter(function (z, i, a) { return !i || z - a[i - 1] > 0.05; });
    var xs = [];
    for (var i = 0; i < nx; i++) xs.push(i / (nx - 1) * L);
    [0.5, 1.5, 3, L - 3, L - 1.5, L - 0.5].forEach(function (x) { xs.push(x); });
    xs = xs.map(function (x) { return Math.round(x * 1000) / 1000; }).sort(function (a, b) { return a - b; }).filter(function (x, i, a) { return !i || x - a[i - 1] > 0.05; });
    var dpl = dp || tp, xD0 = null, xD1 = null;
    for (var xx = 0; xx <= L; xx += 0.1) if (planHalf(dpl, xx) > 0.3) { if (xD0 == null) xD0 = xx; xD1 = xx; }
    var xm = L / 2;
    var half = zs.map(function (z) {
      var zz = Math.max(0.15, Math.min(z, D - 0.15)), e = rowExtent(pr.outlinePts, pr.baseline - zz * ky);
      var xa = e ? (e[0] - pr.outline.x) / kx : null, xb = e ? (e[1] - pr.outline.x) / kx : null, s = sOf(z);
      return xs.map(function (x) {
        if (xa == null || x < xa - 1e-6 || x > xb + 1e-6) return null;
        var u = x <= xm ? xD0 + (x - xa) / Math.max(1e-6, xm - xa) * (xm - xD0) : xm + (x - xm) / Math.max(1e-6, xb - xm) * (xD1 - xm);
        var h = s * planHalf(dpl, Math.min(xD1, Math.max(xD0, u)));
        return Math.round(Math.max(0.3, h) * 1000) / 1000;
      });
    });
    zs.forEach(function (z, j) { if (half[j].every(function (v) { return v === null; })) warn.push('No hull found at z = ' + z + ' m in the profile.'); });
    return { xs: xs, zs: zs, half: half, L: L, B: 2 * Math.max.apply(0, half.map(function (r) { return Math.max.apply(0, r.map(function (v) { return v || 0; })); })), D: D,
      midship: zs.map(function (z) { return { z: z, s: +sOf(z).toFixed(3) }; }), warnings: warn };
  };
  G.offsetsCSV = function (H) {
    var rows = [['z_m \\ x_m'].concat(H.xs.map(function (x) { return x.toFixed(3); }))];
    H.zs.forEach(function (z, j) { rows.push([z.toFixed(3)].concat(H.half[j].map(function (v) { return v == null ? '' : v.toFixed(3); }))); });
    return rows.map(function (r) { return r.join(','); }).join('\r\n') + '\r\n';
  };

  function biggest(cv, cs) { var bi = -1, ba = 0; for (var i = 0; i < cs.size(); i++) { var a = cv.contourArea(cs.get(i)); if (a > ba) { ba = a; bi = i; } } return bi; }

  if (typeof module !== 'undefined' && module.exports) module.exports = G; else root.GACV = G;
})(this);
