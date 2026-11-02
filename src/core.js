/* GA 2D extractor to DBB core: reads vector line work and printed particulars from a general arrangement (GA) PDF page and suggests
   decks, bulkheads and blocks for a DBB project. Works in node (tests) and in the browser. No dependencies.
   Coordinates: "page" coordinates are pdf.js viewport points at scale 1 (x right, y down). After rotation the drawing is
   upright: length along x with the bow to the right, height along y with the deck up. Metres: x forward from the aft end,
   y to port, z up from the baseline (the DBB axes). */
(function (root) {
  'use strict';
  var FORMAT = 'dbb-block-editor', VERSION = 2;

  /* ---------- line work from a pdf.js operator list ---------- */
  /* Only stroked paths count (clip paths and fills are dropped). Returns segments [x1, y1, x2, y2, lineWidth] in page points. */
  function segmentsFromOps(ops, OPS, transform) {
    var segs = [], ctm = transform.slice(), stack = [], lw = 1, pend = [], i, k;
    var COMMIT = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];
    var DROP = [OPS.fill, OPS.eoFill, OPS.endPath, OPS.clip, OPS.eoClip];
    function mul(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
    function ap(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
    for (i = 0; i < ops.fnArray.length; i++) {
      var fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn === OPS.save) stack.push([ctm.slice(), lw]);
      else if (fn === OPS.restore) { var t = stack.pop(); if (t) { ctm = t[0]; lw = t[1]; } }
      else if (fn === OPS.setLineWidth) lw = a[0];
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (COMMIT.indexOf(fn) >= 0) { var sc = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])); pend.forEach(function (q) { q[4] = lw * sc; segs.push(q); }); pend = []; }
      else if (DROP.indexOf(fn) >= 0) pend = [];
      else if (fn === OPS.constructPath) {
        var cmds = a[0], c = a[1], cur = null, start = null, p;
        k = 0;
        for (var j = 0; j < cmds.length; j++) {
          var cmd = cmds[j];
          if (cmd === OPS.moveTo) { cur = ap(ctm, c[k], c[k + 1]); start = cur; k += 2; }
          else if (cmd === OPS.lineTo) { p = ap(ctm, c[k], c[k + 1]); k += 2; if (cur) pend.push([cur[0], cur[1], p[0], p[1], 0]); cur = p; }
          else if (cmd === OPS.curveTo) { p = ap(ctm, c[k + 4], c[k + 5]); if (cur) pend.push([cur[0], cur[1], p[0], p[1], 0]); cur = p; k += 6; }
          else if (cmd === OPS.curveTo2 || cmd === OPS.curveTo3) { p = ap(ctm, c[k + 2], c[k + 3]); if (cur) pend.push([cur[0], cur[1], p[0], p[1], 0]); cur = p; k += 4; }
          else if (cmd === OPS.rectangle) {
            var x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3], r = [ap(ctm, x, y), ap(ctm, x + w, y), ap(ctm, x + w, y + h), ap(ctm, x, y + h)]; k += 4;
            for (var q = 0; q < 4; q++) pend.push([r[q][0], r[q][1], r[(q + 1) % 4][0], r[(q + 1) % 4][1], 0]);
          } else if (cmd === OPS.closePath) { if (cur && start) pend.push([cur[0], cur[1], start[0], start[1], 0]); cur = start; }
        }
      }
    }
    return segs;
  }

  function inPage(segs, W, H) {                                     // drop trim marks and anything outside the page
    return segs.filter(function (q) { return q[0] >= 0 && q[2] >= 0 && q[0] <= W && q[2] <= W && q[1] >= 0 && q[3] >= 0 && q[1] <= H && q[3] <= H; });
  }

  /* k quarter turns clockwise (page, y down). Returns new segments and the new page size. */
  function rotateSegs(segs, W, H, k) {
    k = ((k % 4) + 4) % 4;
    var out = segs, w = W, h = H;
    for (var n = 0; n < k; n++) {
      var hh = h;
      out = out.map(function (q) { return [hh - q[1], q[0], hh - q[3], q[2], q[4]]; });
      var t = w; w = h; h = t;
    }
    return { segs: out, W: w, H: h };
  }

  /* ---------- views: cut the page where there is white space ---------- */
  function splitViews(segs, W, H, o) {
    o = o || {};
    var gap = o.gap || 4, minSeg = o.minSegs || 150, maxLong = o.maxLong || 150, boxes = [];
    function cut(list, box, horizontalFirst, depth) {
      if (!list.length) return;
      var axis = horizontalFirst ? 0 : 1, lo = box[axis], hi = box[axis + 2], n = Math.max(1, Math.ceil(hi - lo)), bins = new Uint8Array(n + 2), best = null, i;
      list.forEach(function (q) {
        if (Math.hypot(q[2] - q[0], q[3] - q[1]) > maxLong) return;
        var a = Math.min(q[axis], q[axis + 2]), b = Math.max(q[axis], q[axis + 2]);
        for (i = Math.floor(a - lo); i <= Math.floor(b - lo); i++) if (i >= 0 && i <= n) bins[i] = 1;
      });
      var start = -1, run = [];
      for (i = 0; i <= n + 1; i++) {
        if (bins[i] === 0 && start < 0) start = i;
        if ((bins[i] === 1 || i === n + 1) && start >= 0) { if (i - start >= gap && start > 0 && i <= n) run.push([start, i]); start = -1; }
      }
      if (!run.length) { if (depth === 0) { cut(list, box, !horizontalFirst, 1); return; } finalize(list); return; }
      var prev = 0, parts = [];
      run.forEach(function (r) { parts.push([prev, r[0]]); prev = r[1]; });
      parts.push([prev, n + 1]);
      parts.forEach(function (pr) {
        var a = lo + pr[0], b = lo + pr[1];
        var sub = list.filter(function (q) { var m = (q[axis] + q[axis + 2]) / 2; return m >= a && m < b; });
        if (!sub.length) return;
        var nb = box.slice(); nb[axis] = a; nb[axis + 2] = b;
        cut(sub, nb, !horizontalFirst, depth + 1);
      });
    }
    function finalize(list) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      list.forEach(function (q) { x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]); });
      if (list.length >= minSeg && x1 - x0 > 20 && y1 - y0 > 20) boxes.push({ x0: x0, y0: y0, x1: x1, y1: y1, n: list.length });
    }
    var inside = segs.filter(function (q) { return Math.hypot(q[2] - q[0], q[3] - q[1]) < 0.9 * Math.max(W, H); });
    cut(inside, [0, 0, W, H], false, 0);
    boxes.sort(function (a, b) { return (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0; });
    return boxes;
  }

  /* Dash-dot centre lines, frame lines and base lines run across several views and tie them together. Drop every horizontal or vertical
     line (also when drawn in dashes) longer than minLen points. */
  function dropAxisLines(segs, minLen) {
    var hr = runs(segs, true, { minLen: minLen, gap: 20, tolPos: 0.5 }), vr = runs(segs, false, { minLen: minLen, gap: 20, tolPos: 0.5 });
    if (!hr.length && !vr.length) return segs;
    var hb = {}, vb = {};
    hr.forEach(function (r) { var k = Math.round(r.p); [k - 1, k, k + 1].forEach(function (kk) { (hb[kk] = hb[kk] || []).push(r); }); });
    vr.forEach(function (r) { var k = Math.round(r.p); [k - 1, k, k + 1].forEach(function (kk) { (vb[kk] = vb[kk] || []).push(r); }); });
    return segs.filter(function (q) {
      if (Math.abs(q[3] - q[1]) < 0.3) { var y = (q[1] + q[3]) / 2, L = hb[Math.round(y)], a = Math.min(q[0], q[2]), b = Math.max(q[0], q[2]); if (L && L.some(function (r) { return Math.abs(r.p - y) < 0.6 && a >= r.a - 1 && b <= r.b + 1; })) return false; }
      else if (Math.abs(q[2] - q[0]) < 0.3) { var x = (q[0] + q[2]) / 2, M = vb[Math.round(x)], c = Math.min(q[1], q[3]), d = Math.max(q[1], q[3]); if (M && M.some(function (r) { return Math.abs(r.p - x) < 0.6 && c >= r.a - 1 && d <= r.b + 1; })) return false; }
      return true;
    });
  }
  /* Views as connected clusters of lines (cells of `cell` points, grown by `grow` cells). Works when the guillotine cut finds no empty band. */
  function splitViewsCC(segs, W, H, o) {
    o = o || {}; var C = o.cell || 8, grow = o.grow || 2, gw = Math.ceil(W / C) + 2, gh = Math.ceil(H / C) + 2, occ = new Uint8Array(gw * gh), lab = new Int32Array(gw * gh).fill(-1), i, j, k;
    segs.forEach(function (q) {
      var L = Math.hypot(q[2] - q[0], q[3] - q[1]), n = Math.max(1, Math.ceil(L / C));
      for (var t = 0; t <= n; t++) { var x = Math.floor((q[0] + (q[2] - q[0]) * t / n) / C), y = Math.floor((q[1] + (q[3] - q[1]) * t / n) / C); if (x >= 0 && y >= 0 && x < gw && y < gh) occ[y * gw + x] = 1; }
    });
    var boxes = [], stack = [], id = 0;
    for (i = 0; i < gw * gh; i++) {
      if (!occ[i] || lab[i] >= 0) continue;
      var b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, id: id }; lab[i] = id; stack.push(i);
      while (stack.length) {
        var u = stack.pop(), ux = u % gw, uy = (u - ux) / gw; b.x0 = Math.min(b.x0, ux); b.x1 = Math.max(b.x1, ux); b.y0 = Math.min(b.y0, uy); b.y1 = Math.max(b.y1, uy);
        for (j = -grow; j <= grow; j++) for (k = -grow; k <= grow; k++) { var nx = ux + k, ny = uy + j; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; var v = ny * gw + nx; if (occ[v] && lab[v] < 0) { lab[v] = id; stack.push(v); } }
      }
      boxes.push(b); id++;
    }
    var cnt = boxes.map(function () { return 0; });
    segs.forEach(function (q) { var x = Math.floor((q[0] + q[2]) / 2 / C), y = Math.floor((q[1] + q[3]) / 2 / C), l = x >= 0 && y >= 0 && x < gw && y < gh ? lab[y * gw + x] : -1; if (l >= 0) cnt[l]++; });
    return boxes.map(function (b, q) { return { x0: b.x0 * C, y0: b.y0 * C, x1: (b.x1 + 1) * C, y1: (b.y1 + 1) * C, n: cnt[q] }; })
      .filter(function (b) { return b.n >= (o.minSegs || 400) && b.x1 - b.x0 > 40 && b.y1 - b.y0 > 40; })
      .sort(function (a, b) { return (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0; });
  }


  /* Views stacked in one column that no empty band separates (labels and masts interleave): cut where the line count is low for a stretch.
     A thin band left between two cuts (a ruler and a title) belongs to the view above. */
  function splitRows(segs, o) {
    o = o || {}; var B = 8, minW = o.minWidth || 32, i, y0 = 1e9, y1 = -1e9;
    segs.forEach(function (q) { y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]); });
    var n = Math.ceil((y1 - y0) / B) + 1, c = new Array(n).fill(0), total = segs.length;
    segs.forEach(function (q) { c[Math.min(n - 1, Math.floor(((q[1] + q[3]) / 2 - y0) / B))]++; });
    var cuts = [], st = -1;
    function runsAt(T) { var r = [], s0 = -1, q; for (q = 0; q <= n; q++) { var low = q < n && c[q] <= T; if (low && s0 < 0) s0 = q; if (!low && s0 >= 0) { if ((q - s0) * B >= minW && s0 > 2 && q < n - 2) r.push([s0, q]); s0 = -1; } } return r; }
    function mx(a, b) { var m = 0, q; for (q = Math.max(0, a); q < Math.min(n, b); q++) m = Math.max(m, c[q]); return m; }
    var side = Math.round(96 / B);
    runsAt(28).forEach(function (r) { cuts.push(r); });
    runsAt(100).forEach(function (r) {
      var m = mx(r[0], r[1]), lm = mx(r[0] - side, r[0]), rm = mx(r[1], r[1] + side);
      if (m * 25 <= Math.min(lm, rm) && !cuts.some(function (u) { return u[0] < r[1] && u[1] > r[0]; })) cuts.push(r);
    });
    cuts.sort(function (a, b) { return a[0] - b[0]; });
    var parts = [], prev = 0;
    cuts.forEach(function (r) { parts.push([prev, r[0]]); prev = r[1]; });
    parts.push([prev, n]);
    var boxes = parts.map(function (p, pi) {
      var a = y0 + p[0] * B, b = y0 + p[1] * B, list = segs.filter(function (q) { var m = (q[1] + q[3]) / 2; return m >= a && m < b; });
      if (!list.length) return null;
      var x0 = 1e9, x1 = -1e9, ya = 1e9, yb = -1e9; list.forEach(function (q) { x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); ya = Math.min(ya, q[1], q[3]); yb = Math.max(yb, q[1], q[3]); });
      return { x0: x0, y0: ya, x1: x1, y1: yb, n: list.length, gb: pi ? (cuts[pi - 1][1] - cuts[pi - 1][0]) * B : 1e9, ga: pi < cuts.length ? (cuts[pi][1] - cuts[pi][0]) * B : 1e9 };
    }).filter(Boolean), out = boxes.slice(), q2;
    function join(a, b) { a.x0 = Math.min(a.x0, b.x0); a.x1 = Math.max(a.x1, b.x1); a.y0 = Math.min(a.y0, b.y0); a.y1 = Math.max(a.y1, b.y1); a.n += b.n; a.gb = Math.min(a.gb, b.gb); a.ga = Math.min(a.ga, b.ga); }
    for (q2 = 0; q2 < out.length; q2++) {                                 // a thin piece (a ruler, a mast top) joins the neighbour across the smaller gap
      var b = out[q2];
      if (out.length > 1 && b.n < 0.03 * total && (b.y1 - b.y0) < 160) {
        var toPrev = q2 > 0 && (q2 === out.length - 1 || b.gb <= b.ga), nb = toPrev ? out[q2 - 1] : out[q2 + 1];
        if (nb) { join(nb, b); out.splice(q2, 1); q2 = -1; }
      }
    }
    return out.filter(function (b) { return b.n >= (o.minSegs || 400); });
  }
  /* All views of a busy sheet (several views, tables, title block). Returns boxes sorted top to bottom, left to right. */
  function splitSheet(segs, W, H) {
    var k = dropAxisLines(segs, 400), cc = splitViewsCC(k, W, H, { cell: 8, grow: 2, minSegs: 1500 }), out = [];
    cc.forEach(function (b) {
      if ((b.y1 - b.y0) > 900) { splitRows(segsIn(k, b, 1)).forEach(function (r) { out.push(r); }); }
      else out.push(b);
    });
    return out.sort(function (a, b) { return Math.round((a.y0 + a.y1) / 2 / 150) - Math.round((b.y0 + b.y1) / 2 / 150) || a.x0 - b.x0; });
  }

  function segsIn(segs, b, pad) {
    pad = pad == null ? 1 : pad;
    return segs.filter(function (q) { return Math.min(q[0], q[2]) >= b.x0 - pad && Math.max(q[0], q[2]) <= b.x1 + pad && Math.min(q[1], q[3]) >= b.y0 - pad && Math.max(q[1], q[3]) <= b.y1 + pad; });
  }

  /* ---------- straight runs: collinear segments merged ---------- */
  function runs(segs, horiz, o) {
    o = o || {};
    var tolP = o.tolPos == null ? 0.35 : o.tolPos, gap = o.gap == null ? 2.5 : o.gap, minLen = o.minLen == null ? 8 : o.minLen, items = [];
    segs.forEach(function (q) {
      var dx = q[2] - q[0], dy = q[3] - q[1];
      if (horiz && Math.abs(dy) <= 0.25 && Math.abs(dx) > 0.01) items.push({ p: (q[1] + q[3]) / 2, a: Math.min(q[0], q[2]), b: Math.max(q[0], q[2]) });
      if (!horiz && Math.abs(dx) <= 0.25 && Math.abs(dy) > 0.01) items.push({ p: (q[0] + q[2]) / 2, a: Math.min(q[1], q[3]), b: Math.max(q[1], q[3]) });
    });
    items.sort(function (u, v) { return u.p - v.p; });
    var lines = [];
    items.forEach(function (it) {
      var l = lines[lines.length - 1];
      if (l && it.p - l.last <= tolP) { l.items.push(it); l.last = it.p; l.sum += it.p; } else lines.push({ last: it.p, sum: it.p, items: [it] });
    });
    var out = [];
    lines.forEach(function (l) {
      l.items.sort(function (u, v) { return u.a - v.a; });
      var cur = null, p = l.sum / l.items.length;
      l.items.forEach(function (it) {
        if (cur && it.a <= cur.b + gap) cur.b = Math.max(cur.b, it.b); else { cur = { p: p, a: it.a, b: it.b }; out.push(cur); }
      });
    });
    return out.filter(function (r) { return r.b - r.a >= minLen; });
  }

  function bbox(segs) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    segs.forEach(function (q) { x0 = Math.min(x0, q[0], q[2]); x1 = Math.max(x1, q[0], q[2]); y0 = Math.min(y0, q[1], q[3]); y1 = Math.max(y1, q[1], q[3]); });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function pct(arr, p) { if (!arr.length) return 0; var s = arr.slice().sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; }
  function median(arr) { return pct(arr, 0.5); }

  /* ---------- guess which way the page is turned ---------- */
  /* Tries the four turns and scores each: the length lies along x, the aft end (more detail: deckhouse, machinery) is on the left,
     and the superstructure sticks up. Returns the turn that scores best, with the scores. */
  function guessRotation(segs, W, H) {
    var scores = [], k;
    for (k = 0; k < 4; k++) {
      var r = rotateSegs(segs, W, H, k), S = r.segs, bb = bbox(S), w = bb.x1 - bb.x0, h = bb.y1 - bb.y0, sc = 0;
      if (w > h) sc += 2;                                              // length horizontal
      var left = 0, right = 0, up = 0, down = 0, midTop = [], midBot = [];
      S.forEach(function (q) {
        var mx = (q[0] + q[2]) / 2;
        if (mx < bb.x0 + 0.2 * w) left++; else if (mx > bb.x1 - 0.2 * w) right++;
      });
      sc += (left - right) / Math.max(1, left + right);                // aft end busier than the bow
      scores.push({ k: k, score: sc });
    }
    scores.sort(function (a, b) { return b.score - a.score; });
    return { k: scores[0].k, scores: scores };
  }
  /* refine with the profile: the deckhouse stands above the body, so the turn where it points up wins between two candidates 180 degrees apart */
  function guessUp(segsUpright, view) {
    var S = segsIn(segsUpright, view), w = view.x1 - view.x0, mid = S.filter(function (q) { var m = (q[0] + q[2]) / 2; return m > view.x0 + 0.3 * w && m < view.x1 - 0.3 * w; });
    var aft = S.filter(function (q) { return (q[0] + q[2]) / 2 < view.x0 + 0.2 * w; });
    if (!mid.length || !aft.length) return 0;
    var by0 = pct(mid.map(function (q) { return Math.min(q[1], q[3]); }), 0.01), by1 = pct(mid.map(function (q) { return Math.max(q[1], q[3]); }), 0.99);
    var aup = by0 - Math.min.apply(null, aft.map(function (q) { return Math.min(q[1], q[3]); })), adn = Math.max.apply(null, aft.map(function (q) { return Math.max(q[1], q[3]); })) - by1;
    return aup - adn;                                                // positive: structure above the body, the deck is up
  }

  /* ---------- roles of the views ---------- */
  function describeView(segs, b) {
    var S = segsIn(segs, b), w = b.x1 - b.x0, h = b.y1 - b.y0, diag = 0, hr = runs(S, true, { minLen: 0.3 * w, gap: 3 });
    S.forEach(function (q) { var dx = Math.abs(q[2] - q[0]), dy = Math.abs(q[3] - q[1]), L = Math.hypot(dx, dy); if (L > 20 && dx > 0.2 * dy && dy > 0.2 * dx) diag++; });
    var top = Infinity, bot = -Infinity;
    hr.forEach(function (r) { top = Math.min(top, r.p); bot = Math.max(bot, r.p); });
    var mid = isFinite(top) && bot - top > 0.15 * h ? (top + bot) / 2 : (b.y0 + b.y1) / 2, cell = 2, gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1, g = new Uint8Array(gw * gh), occ = 0, sym = 0;
    S.forEach(function (q) {
      var L = Math.hypot(q[2] - q[0], q[3] - q[1]), n = Math.max(1, Math.ceil(L / cell));
      for (var i = 0; i <= n; i++) { var x = q[0] + (q[2] - q[0]) * i / n, y = q[1] + (q[3] - q[1]) * i / n, ci = Math.floor((x - b.x0) / cell), cj = Math.floor((y - b.y0) / cell); if (ci >= 0 && cj >= 0 && ci < gw && cj < gh) g[cj * gw + ci] = 1; }
    });
    for (var j = 0; j < gh; j++) for (var i2 = 0; i2 < gw; i2++) if (g[j * gw + i2]) {
      var y = b.y0 + j * cell, my = 2 * mid - y, mj = Math.round((my - b.y0) / cell);
      if (y < mid) { occ++; var ok = false; for (var d = -1; d <= 1 && !ok; d++) if (mj + d >= 0 && mj + d < gh && g[(mj + d) * gw + i2]) ok = true; if (ok) sym++; }
    }
    return { w: w, h: h, aspect: w / Math.max(1, h), diag: diag, symmetry: occ > 20 ? sym / occ : 0, n: S.length, mid: mid };
  }
  function guessRoles(segs, views) {
    var info = views.map(function (v) { return describeView(segs, v); }), roles = views.map(function () { return 'ignore'; });
    var long = [];
    info.forEach(function (d, i) { if (d.aspect >= 3) long.push(i); else if (d.w > 20) roles[i] = 'section'; });
    /* a plan is mirror-symmetric about the centreline; the profile is not: the least symmetric long view is the profile */
    long.sort(function (a, b) { return info[a].symmetry - info[b].symmetry; });
    var prof = long.length && info[long[0]].symmetry < 0.8 ? [long[0]] : [], plans = long.filter(function (i) { return prof.indexOf(i) < 0; });
    if (prof.length) roles[prof[0]] = 'profile';
    /* of the plans, the tank plan has the fewest lines (the deck plan carries pipes and equipment) */
    plans.sort(function (a, b) { return info[a].n - info[b].n; });
    if (plans.length) roles[plans[0]] = 'tank';
    for (var k = 1; k < plans.length; k++) roles[plans[k]] = 'deck';
    return roles.map(function (r, i) { return { role: r, info: info[i] }; });
  }

  /* ---------- the analysis ---------- */
  /* segs: upright page segments. views: {profile, tank, deck}: boxes. info: {loa, beam, depth, ...} in metres (any may be missing).
     Returns the scale, levels, bulkheads, tank candidates and checks. */
  function analyse(segs, views, info, o) {
    o = o || {};
    info = info || {};
    var res = { notes: [], scale: {}, levels: [], bulkheads: [], spans: [], tanks: [], checks: [] };
    var P = views.profile ? segsIn(segs, views.profile) : [], T = views.tank ? segsIn(segs, views.tank) : [], U = views.deck ? segsIn(segs, views.deck) : [];
    var plan = T.length ? T : U, planBox = T.length ? views.tank : views.deck;
    if (!views.profile) { res.notes.push('No profile view chosen.'); }

    /* length: the longest line along the plan is the centreline, from the stern to the bow tip */
    var ext = null;
    function hullChain(S, box) {                                              // the widest group of lines that touch end to end (snap 0.7 pt) and are tall enough to be the hull
      var par = {}, key = function (x, y) { return Math.round(x / 0.7) + ',' + Math.round(y / 0.7); }, i;
      function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      function add(a) { if (par[a] === undefined) par[a] = a; }
      function uni(a, b) { a = find(a); b = find(b); if (a !== b) par[a] = b; }
      S.forEach(function (q) { var a = key(q[0], q[1]), b = key(q[2], q[3]); add(a); add(b); uni(a, b); });
      var bb = {}; S.forEach(function (q) { var r = find(key(q[0], q[1])), o = bb[r] || (bb[r] = { a: 1e9, b: -1e9, y0: 1e9, y1: -1e9 }); o.a = Math.min(o.a, q[0], q[2]); o.b = Math.max(o.b, q[0], q[2]); o.y0 = Math.min(o.y0, q[1], q[3]); o.y1 = Math.max(o.y1, q[1], q[3]); });
      var best = null, k; for (k in bb) { var o = bb[k]; if (o.y1 - o.y0 < 0.3 * (box.y1 - box.y0)) continue; if (!best || o.b - o.a > best.b - best.a) best = o; } return best;
    }
    function lenExt(S, box) {
      if (!S.length) return null;
      var hr = runs(S, true, { minLen: 0.5 * (box.x1 - box.x0), gap: 3 }).sort(function (a, b) { return (b.b - b.a) - (a.b - a.a); });
      var xs = []; S.forEach(function (q) { if (Math.hypot(q[2] - q[0], q[3] - q[1]) < 0.7 * (box.x1 - box.x0)) xs.push(q[0], q[2]); });
      var p0 = pct(xs, 0.002), p1 = pct(xs, 0.998);
      var ch = hullChain(S, box);                                              // the connected outline of the hull: the centreline and the label lines often run past the bow and the stern
      if (ch && ch.b - ch.a >= 0.93 * (hr.length ? hr[0].b - hr[0].a : p1 - p0) && ch.b - ch.a >= 0.5 * (box.x1 - box.x0)) return { a: ch.a, b: ch.b, how: 'hull outline' };
      if (hr.length && hr[0].b - hr[0].a >= 0.85 * (p1 - p0)) return { a: hr[0].a, b: hr[0].b, how: 'centreline' };
      return { a: p0, b: p1, how: 'extent of the drawing' };
    }
    ext = lenExt(plan, planBox || views.profile) || (views.profile ? lenExt(P, views.profile) : null);
    if (!ext) return res;
    var Lpts = ext.b - ext.a, sx = o.ptsPerM ? 1 / o.ptsPerM : (info.loa ? info.loa / Lpts : null);
    if (o.ptsPerM) res.scale.fromRuler = true;
    res.scale.lengthPts = Lpts; res.scale.xA = ext.a; res.scale.lengthHow = ext.how;
    if (!sx) { res.notes.push('Overall length missing: type the length of the ship to set the scale.'); res.scale.sx = null; return res; }

    /* beam from the plan outline, centreline from the plan */
    var sy = sx, yc = null, beamPts = null;
    if (plan.length) {
      var bb = bbox(plan.filter(function (q) { return Math.hypot(q[2] - q[0], q[3] - q[1]) < 0.9 * (planBox.x1 - planBox.x0) || Math.abs(q[3] - q[1]) > 1; }));
      beamPts = bb.y1 - bb.y0;
      var cl = runs(plan, true, { minLen: 0.8 * Lpts, gap: 3 }).sort(function (a, b) { return (b.b - b.a) - (a.b - a.a); });
      yc = cl.length && Math.abs(cl[0].p - (bb.y0 + bb.y1) / 2) < 0.04 * beamPts ? cl[0].p : (bb.y0 + bb.y1) / 2;
      res.scale.beamPts = beamPts;
      if (info.beam && beamPts > 0) {
        var r = info.beam / beamPts / sx;
        res.scale.beamRatio = r;
        if (o.ptsPerM) res.notes.push('Scale from the ruler: the beam in the drawing is ' + (r > 1 ? '+' : '') + Math.round((r - 1) * 1000) / 10 + '% against the sheet.'); else if (r > 0.9 && r < 1.1) sy = info.beam / beamPts; else res.notes.push('The beam in the plan view is ' + Math.round(Math.abs(1 - r) * 100) + '% off from the length scale: the length scale is used for widths.');
      }
    }

    /* profile: full-depth transverse bulkheads */
    var sz = sx, baseY = null, deckY = null, vr = [], bh = null;
    if (P.length) {
      vr = runs(P, false, { minLen: 8, gap: 2.5, tolPos: 0.4 });
      var hmax = 0; vr.forEach(function (r) { hmax = Math.max(hmax, r.b - r.a); });
      // the tallest vertical runs that are not drawing frames or masts: use the biggest group of equal-height runs
      var tall = vr.filter(function (r) { return (r.b - r.a) >= 0.9 * hmax && r.p > ext.a - 1 && r.p < ext.b + 1; });
      var counts = {}; tall.forEach(function (r) { var k = Math.round(r.a) + '_' + Math.round(r.b); counts[k] = (counts[k] || 0) + 1; });
      var bestK = null; Object.keys(counts).forEach(function (k) { if (!bestK || counts[k] > counts[bestK]) bestK = k; });
      var grp = tall.filter(function (r) { return Math.round(r.a) + '_' + Math.round(r.b) === bestK; });
      if (grp.length >= 2) {
        deckY = median(grp.map(function (r) { return r.a; })); baseY = median(grp.map(function (r) { return r.b; })); bh = baseY - deckY;
      } else {
        var hr2 = runs(P, true, { minLen: 0.3 * Lpts, gap: 3 }).sort(function (a, b) { return a.p - b.p; });
        // the bulkheads are the most common vertical run of the profile (a mast or a rail can be taller): they run from the deck to the tank top, and the keel line is the long line just under them
        var gk = {}, gbest = null; vr.forEach(function (r) { if (r.b - r.a >= 0.05 * Lpts && r.p > ext.a - 1 && r.p < ext.b + 1) { var k = Math.round(r.a / 1.5) + '_' + Math.round(r.b / 1.5); (gk[k] = gk[k] || []).push(r); } });
        Object.keys(gk).forEach(function (k) { if (gk[k].length >= 3 && (!gbest || gk[k].length > gbest.length)) gbest = gk[k]; });
        if (gbest) {
          var gTop = median(gbest.map(function (r) { return r.a; })), gBot = median(gbest.map(function (r) { return r.b; })), under = hr2.filter(function (h) { return h.p >= gBot - 1 && h.p <= gBot + 0.35 * (gBot - gTop); });
          deckY = gTop; baseY = under.length ? under[under.length - 1].p : gBot; bh = baseY - deckY;
        } else if (hr2.length >= 2) { deckY = hr2[0].p; baseY = hr2[hr2.length - 1].p; bh = baseY - deckY; }
      }
      if (bh) {
        res.scale.heightPts = bh;
        if (info.depth) {
          var rz = info.depth / bh / sx; res.scale.depthRatio = rz;
          if (o.ptsPerM) res.notes.push('Scale from the ruler: the profile height is ' + (rz > 1 ? '+' : '') + Math.round((rz - 1) * 1000) / 10 + '% against the depth on the sheet (the profile may include a bulwark or rails).'); else if (rz > 0.85 && rz < 1.15) sz = info.depth / bh; else res.notes.push('The depth in the profile is ' + Math.round(Math.abs(1 - rz) * 100) + '% off from the length scale: the length scale is used for heights.');
        }
      }
    }
    res.scale.sx = sx; res.scale.sy = sy; res.scale.sz = sz; res.scale.baseY = baseY; res.scale.deckY = deckY; res.scale.yc = yc;
    function X(px) { return (px - ext.a) * sx; }
    function Z(py) { return baseY == null ? null : (baseY - py) * sz; }
    res.X = X;
    res.Zf = Z;

    /* levels: horizontal lines in the profile */
    if (P.length && baseY != null) {
      var hr3 = runs(P, true, { minLen: Math.max(8, 0.03 * Lpts), gap: 3, tolPos: 0.4 }), lv = [];
      hr3.forEach(function (r) {
        var z = Z(r.p);
        if (z < -0.5 || z > (info.depth || 25) * 2.2) return;
        var l = lv.filter(function (u) { return Math.abs(u.z - z) < 0.45; })[0];
        if (!l) { l = { z: z, x0: r.a, x1: r.b, len: 0, n: 0, runs: [] }; lv.push(l); }
        l.runs.push([r.a, r.b]);
        l.x0 = Math.min(l.x0, r.a); l.x1 = Math.max(l.x1, r.b); l.len += r.b - r.a; l.n++;
        l.z = (l.z * (l.n - 1) + z) / l.n;
      });
      lv.sort(function (a, b) { return a.z - b.z; });
      res.levels = lv.map(function (l) { return { z: l.z, x0: X(l.x0), x1: X(l.x1), len: l.len * sx, n: l.n, runs: l.runs.map(function (q) { return [X(q[0]), X(q[1])]; }) }; });
    }

    /* bulkheads: full-depth vertical runs (at least 85% of the bulkhead height) */
    if (P.length && bh) {
      var bl = vr.filter(function (r) { return (r.b - r.a) >= 0.85 * bh && r.a <= deckY + 0.08 * bh && r.b >= baseY - 0.2 * bh && r.p > ext.a - 1 && r.p < ext.b + 1; }).map(function (r) { return r.p; }).sort(function (a, b) { return a - b; });
      var merged = [];
      bl.forEach(function (p) { if (merged.length && p - merged[merged.length - 1] < 1.5) return; merged.push(p); });
      res.bulkheads = merged.map(function (p) { return X(p); });
      /* the regular ones: spans of similar length are the cargo tanks */
      var spans = [];
      for (var i = 0; i + 1 < merged.length; i++) spans.push({ a: merged[i], b: merged[i + 1] });
      res.spanPts = spans;
    }

    res.planSegs = plan; res.planYc = yc;
    /* the hull envelope in the plan: the half-width at each x */
    if (plan.length && yc != null) {
      var env = {}, step = 1;
      plan.forEach(function (q) {
        var L = Math.hypot(q[2] - q[0], q[3] - q[1]);
        if (L > 0.5 * Lpts) return;
        var n = Math.max(1, Math.ceil(L / step));
        for (var i = 0; i <= n; i++) {
          var x = q[0] + (q[2] - q[0]) * i / n, y = q[1] + (q[3] - q[1]) * i / n, k = Math.round(x), d = Math.abs(y - yc);
          if (!(env[k] > d)) env[k] = d;
        }
      });
      res.envelope = function (px) { var best = 0; for (var d = 0; d <= 2; d++) { var v = Math.max(env[Math.round(px) - d] || 0, env[Math.round(px) + d] || 0); if (v > best) best = v; } return best; };
      /* longitudinal lines: horizontal runs on the tank plan, offset from the centreline */
      var hl = runs(plan, true, { minLen: 0.12 * Lpts, gap: 3, tolPos: 0.4 }).map(function (r) { return { d: Math.abs(r.p - yc), side: r.p < yc ? 'P' : 'S', a: r.a, b: r.b, p: r.p }; });
      res.longLines = hl.filter(function (r) { return r.d > 0.5; });
    }
    if (U.length) {
      var clu = runs(U, true, { minLen: 0.8 * Lpts, gap: 3 }).sort(function (a, b) { return (b.b - b.a) - (a.b - a.a); });
      res.deckPlan = { segs: U, yc: clu.length ? clu[0].p : (views.deck.y0 + views.deck.y1) / 2 };
    }
    res.ext = ext; res.planBox = planBox; res.profileBox = views.profile;
    return res;
  }




  /* The turn from the drawing itself, and from the text when the sheet has plenty of it: letters sit in wide blocks when the page is upright (k 0 or 2)
     and in tall blocks when it is on its side (k 1 or 3). The shape cues only choose between the two in each pair. */
  function guessRotationText(segs, W, H) {
    var g = guessRotation(segs, W, H), ts, bl, wide = 0, tall = 0;
    try { ts = textSegments(segs, W, H); bl = textBlocks(ts, W, H); } catch (e) { return g; }
    bl.forEach(function (b) { var w = b.x1 - b.x0, h = b.y1 - b.y0; if (w > 1.6 * h) wide++; else if (h > 1.6 * w) tall++; });
    var n = wide + tall; g.text = { wide: wide, tall: tall };
    if (n < 40) return g;
    var allowed = wide > 2 * tall ? [0, 2] : tall > 2 * wide ? [1, 3] : null;
    if (!allowed) return g;
    var best = g.scores.filter(function (s) { return allowed.indexOf(s.k) >= 0; }).sort(function (a, b) { return b.score - a.score; })[0];
    if (best) g.k = best.k;
    return g;
  }


  /* Views of a sheet with many views: the shape split first, the sheet splitter when that finds fewer than three. */
  function sheetViews(segs, W, H) {
    var v = splitViews(segs, W, H);
    if (v.length >= 3) return { views: v, mode: 'simple', segs: segs };
    var clean = dropAxisLines(segs, 400), b = splitSheet(segs, W, H);
    return { views: b, mode: 'sheet', segs: clean };
  }
  /* Roles on a sheet: the profile first, then the plans by order. Titles read by OCR refine them (see titleRole). */
  function sheetRoles(segs, views) {
    var g = guessRoles(segs, views).map(function (r) { return r.role; }), out = [], plans = [];
    views.forEach(function (b, i) {
      var w = b.x1 - b.x0, h = b.y1 - b.y0, wide = w > 1000 && w / h > 2.2;
      if (!wide || b.n < 3000) out[i] = (g[i] === 'profile' || g[i] === 'deck' || g[i] === 'tank') ? 'section' : g[i] === 'ignore' ? 'ignore' : 'section';
      else if (g[i] === 'profile' && !out.some(function (r) { return r === 'profile'; })) out[i] = 'profile';
      else if (g[i] === 'section') out[i] = 'section';
      else { out[i] = 'plan'; plans.push(i); }
    });
    if (!out.some(function (r) { return r === 'profile'; })) { var f = views.findIndex(function (b) { return b.x1 - b.x0 > 1000; }); if (f >= 0) { out[f] = 'profile'; plans = plans.filter(function (p) { return p !== f; }); } }
    if (plans.length) { out[plans[plans.length - 1]] = 'tank'; plans.pop(); }
    if (plans.length) { out[plans[plans.length >= 3 ? plans.length - 2 : 0]] = 'deck'; }
    return out;
  }
  function titleRole(t) {
    t = String(t || '').toUpperCase().replace(/[^A-Z0-9 \-]/g, '').trim();
    if (/^PROFILE/.test(t)) return 'profile';
    if (/TANK ?TOP/.test(t)) return 'tank';
    if (/BELOW/.test(t)) return 'plan';
    if (/^A[- ]?DECK|^B[- ]?DECK|^C[- ]?DECK|BRIDGE|WHEEL/.test(t)) return 'plan';
    if (/DECK/.test(t)) return 'deck';
    if (/SECTION|SEEN FROM|FRAME|FR\.? ?\d/.test(t)) return 'section';
    return null;
  }


  /* A ruler of frame ticks under the views: short vertical lines at an even pitch. Returns {pitch (pt), n, y} for the best row, or null. */
  function rulerPitch(segs) {
    var rows = {}, best = null;
    segs.forEach(function (q) {
      if (Math.abs(q[0] - q[2]) > 0.3) return; var h = Math.abs(q[3] - q[1]); if (h < 3 || h > 16) return;
      var k = Math.round(Math.min(q[1], q[3]) / 3); (rows[k] = rows[k] || []).push(q[0]);
    });
    Object.keys(rows).forEach(function (k) {
      var xs = rows[k].sort(function (a, b) { return a - b; }); if (xs.length < 25) return;
      var d = []; for (var i = 1; i < xs.length; i++) { var g = xs[i] - xs[i - 1]; if (g > 3) d.push(g); }
      if (d.length < 20) return;
      var bins = {}; d.forEach(function (g) { var b = Math.round(g * 4) / 4; bins[b] = (bins[b] || 0) + 1; });
      var top = Object.keys(bins).sort(function (a, b) { return (bins[b] + (bins[+b + 0.25] || 0) + (bins[+b - 0.25] || 0)) - (bins[a] + (bins[+a + 0.25] || 0) + (bins[+a - 0.25] || 0)); })[0], t = +top;
      var inm = d.filter(function (g) { return Math.abs(g - t) <= 0.4; });
      if (inm.length >= 20 && (!best || inm.length > best.n)) best = { pitch: inm.reduce(function (a, b) { return a + b; }, 0) / inm.length, n: inm.length, y: +k * 3, x0: xs[0], x1: xs[xs.length - 1] };
    });
    return best;
  }
  /* The frame spacing behind a ruler pitch: the value in the sheet (mm) when it agrees with the length, otherwise the nearest multiple of 50 mm. */
  function frameSpacing(pitchPts, loa, extentPts, sheetMM) {
    if (!(pitchPts > 0 && loa > 0 && extentPts > 0)) return null;
    var implied = pitchPts * loa / extentPts;                              // metres per tick, if the drawing extent were the length overall
    if (sheetMM && Math.abs(sheetMM / 1000 - implied) / implied < 0.12) return sheetMM / 1000;
    var common = [0.4, 0.5, 0.6, 0.7, 0.8, 1.0], near = common.slice().sort(function (a, b) { return Math.abs(a - implied) - Math.abs(b - implied); })[0];
    if (Math.abs(near - implied) / implied < 0.12) return near;
    var s = Math.round(implied / 0.05) * 0.05; return s > 0 ? Math.round(s * 1000) / 1000 : null;
  }

  /* ---------- text drawn as outlines ----------
     Many CAD plots draw letters as tiny closed outlines, so the page has no text to read. Letters are dense clusters of short segments with no long
     line next to them. textSegments keeps those; textBlocks groups them into words and lines (boxes in page points) so each can be read by OCR on its own. */
  function textSegments(segs, W, H) {
    var C = 6, gw = Math.ceil(W / C) + 2, gh = Math.ceil(H / C) + 2, cnt = new Uint16Array(gw * gh), lng = new Uint16Array(gw * gh), i;
    function cell(q) { return (Math.min(gh - 2, Math.max(1, Math.floor((q[1] + q[3]) / 2 / C))) * gw) + Math.min(gw - 2, Math.max(1, Math.floor((q[0] + q[2]) / 2 / C))); }
    for (i = 0; i < segs.length; i++) { var q = segs[i], l = Math.hypot(q[2] - q[0], q[3] - q[1]); if (l < 4) cnt[cell(q)]++; else if (l >= 20 && Math.abs(q[3] - q[1]) > 0.2 * l) lng[cell(q)]++; }
    return segs.filter(function (q) {
      if (Math.hypot(q[2] - q[0], q[3] - q[1]) >= 16) return false;
      var c = cell(q), n = 0, L = 0, d, e;
      for (d = -1; d <= 1; d++) for (e = -1; e <= 1; e++) { n += cnt[c + d * gw + e]; L += lng[c + d * gw + e]; }
      return n >= 14 && L <= 3;
    });
  }
  function textBlocks(ts, W, H, o) {
    o = o || {}; var C = 4, gw = Math.ceil(W / C) + 2, gh = Math.ceil(H / C) + 2, grid = new Int32Array(gw * gh).fill(-1), hx = o.gapX || 3, hy = o.gapY || 1, i, j, k;
    var occ = new Uint8Array(gw * gh);
    ts.forEach(function (q) { var a = Math.floor(q[0] / C), b = Math.floor(q[1] / C), c = Math.floor(q[2] / C), d = Math.floor(q[3] / C); [[a, b], [c, d]].forEach(function (p) { if (p[0] >= 0 && p[1] >= 0 && p[0] < gw && p[1] < gh) occ[p[1] * gw + p[0]] = 1; }); });
    var id = 0, box = [], stack = [];
    for (i = 0; i < gw * gh; i++) {
      if (!occ[i] || grid[i] >= 0) continue;
      var bx = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, n: 0 }; grid[i] = id; stack.push(i);
      while (stack.length) {
        var u = stack.pop(), ux = u % gw, uy = (u - ux) / gw; bx.x0 = Math.min(bx.x0, ux); bx.x1 = Math.max(bx.x1, ux); bx.y0 = Math.min(bx.y0, uy); bx.y1 = Math.max(bx.y1, uy); bx.n++;
        for (j = -hy; j <= hy; j++) for (k = -hx; k <= hx; k++) { var nx = ux + k, ny = uy + j; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; var v = ny * gw + nx; if (occ[v] && grid[v] < 0) { grid[v] = id; stack.push(v); } }
      }
      box.push({ x0: bx.x0 * C, y0: bx.y0 * C, x1: (bx.x1 + 1) * C, y1: (bx.y1 + 1) * C, n: bx.n }); id++;
    }
    return box.filter(function (b) { var h = b.y1 - b.y0, w = b.x1 - b.x0; return b.n >= 3 && h >= 5 && h <= 120 && w >= 8 && w <= 700; });
  }



  /* Framed tables: a closed rectangle of long lines with text inside (main dimensions, capacities, title block). Returns boxes in page points. */
  function tableBoxes(segs, ts) {
    var hs = runs(segs, true, { minLen: 120, gap: 3, tolPos: 0.6 }), vs = runs(segs, false, { minLen: 80, gap: 3, tolPos: 0.6 }), out = [], i, j;
    function near(a, b, t) { return Math.abs(a - b) <= t; }
    for (i = 0; i < hs.length; i++) for (j = i + 1; j < hs.length; j++) {
      var t = hs[i].p < hs[j].p ? hs[i] : hs[j], b = hs[i].p < hs[j].p ? hs[j] : hs[i];
      if (!near(t.a, b.a, 6) || !near(t.b, b.b, 6) || b.p - t.p < 60 || b.p - t.p > 900 || t.b - t.a > 900) continue;
      var l = vs.filter(function (v) { return near(v.p, t.a, 6) && v.a <= t.p + 6 && v.b >= b.p - 6; }).length, r = vs.filter(function (v) { return near(v.p, t.b, 6) && v.a <= t.p + 6 && v.b >= b.p - 6; }).length;
      if (!l || !r) continue;
      var box = { x0: t.a, y0: t.p, x1: t.b, y1: b.p };
      if (out.some(function (o) { return o.x0 <= box.x0 + 8 && o.x1 >= box.x1 - 8 && o.y0 <= box.y0 + 8 && o.y1 >= box.y1 - 8; })) continue;
      var inside = ts.filter(function (q) { return q[0] > box.x0 + 3 && q[2] < box.x1 - 3 && q[1] > box.y0 + 3 && q[3] < box.y1 - 3; }).length;
      if (inside >= 300) out.push(box);
    }
    return out;
  }


  /* Drawing titles in CAD plots are a line of text over a double underline. Returns boxes of the text above each double underline. */
  function titleBoxes(segs) {
    var hs = segs.filter(function (q) { var L = Math.abs(q[2] - q[0]); return Math.abs(q[3] - q[1]) < 0.3 && L >= 50 && L <= 450; }), out = [], i, j;
    hs.sort(function (a, b) { return a[1] - b[1]; });
    for (i = 0; i < hs.length; i++) for (j = i + 1; j < hs.length && hs[j][1] - hs[i][1] <= 6; j++) {
      var a = hs[i], b = hs[j], d = b[1] - a[1];
      if (d < 1.2 || Math.abs(Math.min(a[0], a[2]) - Math.min(b[0], b[2])) > 1.5 || Math.abs(Math.max(a[0], a[2]) - Math.max(b[0], b[2])) > 1.5) continue;
      var same = 0, x0s = Math.min(a[0], a[2]), x1s = Math.max(a[0], a[2]);                // a hatch is a stack of equal lines: a title has just the two
      for (var m = Math.max(0, i - 6); m < Math.min(hs.length, j + 7); m++) { var c = hs[m]; if (Math.abs(c[1] - a[1]) <= 20 && Math.abs(Math.min(c[0], c[2]) - x0s) < 2 && Math.abs(Math.max(c[0], c[2]) - x1s) < 2) same++; }
      if (same !== 2) continue;
      var x0 = Math.min(a[0], a[2]), x1 = Math.max(a[0], a[2]);
      if (!out.some(function (o) { return Math.abs(o.x0 - x0) < 2 && Math.abs(o.y1 - a[1]) < 8; })) out.push({ x0: x0 - 4, x1: x1 + 4, y0: a[1] - 26, y1: a[1] - 1 });
    }
    return out;
  }

  /* ---------- particulars from OCR lines ("LENGTH O.A.   36,25  M") ---------- */
  function parseOcrLines(lines) {
    var f = {};
    function put(k, v, unit, src) { if (v != null && isFinite(v) && f[k] == null) f[k] = { v: v, unit: unit || '', src: src }; }
    function nm(t) { var x = parseFloat(String(t).replace(/\s/g, '').replace(',', '.')); return isFinite(x) ? x : null; }
    lines.forEach(function (raw) {
      var t = String(raw).replace(/[|_]/g, ' ').replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();
      var m = t.match(/^(.*?[A-Za-z.)])\s*[:.]*\s+(-?\d[\d.,]*)\s*(MM|M3|M2|KN|GT|T|M)?\.?\s*$/i);
      if (!m) return;
      var key = m[1].toUpperCase().replace(/[^A-Z0-9 .\-]/g, '').replace(/\s+/g, ' ').trim(), v = nm(m[2]), unit = (m[3] || '').toLowerCase();
      if (v == null) return;
      var src = t;
      function dim(k, lab) { if (v >= 60 && /^\d{3,4}$/.test(m[2].replace(/[.,]/g, ''))) v = v / 100; put(k, v, 'm', src); }   // a lost comma: 960 is 9,60
      if (/^LENGTH (O\.?A|OVERALL)/.test(key)) put('loa', v, 'm', src);
      else if (/^LENGTH (BETW|BP|B\.P|BTW)/.test(key) || /^LENGTH.*PERP/.test(key)) put('lbp', v, 'm', src);
      else if (/^BREADTH/.test(key) || /^BEAM/.test(key)) dim('beam');
      else if (/^DEPTH TO (1|MAIN|FIRST)/.test(key) || /^DEPTH MOULDED/.test(key)) dim('depth');
      else if (/^DEPTH TO (A|UPPER|2)/.test(key)) dim('depthUpper');
      else if (/^DRAUGHT.*NORM|^DRAUGHT.*OPER/.test(key)) dim('draughtDesign');
      else if (/^DRAUGHT.*MAX/.test(key)) dim('draught');
      else if (/^SCANTLING/.test(key)) dim('draughtScantling');
      else if (/^GROSS/.test(key)) put('gt', v, 'GT', src);
      else if (/^FRAME/.test(key)) put('frameMM', v, 'mm', src);
      else if (/^FUEL OIL/.test(key)) put('fuelVol', v, 'm3', src);
      else if (/^FRESH WATER/.test(key)) put('freshVol', v, 'm3', src);
      else if (/^TECHNICAL WATER/.test(key)) put('techVol', v, 'm3', src);
      else if (/^CARGO HOLD/.test(key) && unit === 'm3') put('cargoVol', v, 'm3', src);
      else if (/^DEADWEIGHT/.test(key)) put('dwt', v, 't', src);
      else if (/^SPEED/.test(key)) put('speed', v, 'kn', src);
    });
    return f;
  }


  /* The transverse shape from a section view: the half-width at each height as a fraction of the half-beam. ppm = points per metre. Returns
     {zs, s} (s rises with z, 1 at the deck) or null. The keel is the lowest line of the view that is not a long level line (a base line) or the title. */
  function sectionShape(segs, box, ppm, D, B) {
    var S = segsIn(segs, box, 1), titles = titleBoxes(S), lim = box.y1, i;
    titles.forEach(function (t) { lim = Math.min(lim, t.y1 + 12); });
    S = S.filter(function (q) { var L = Math.hypot(q[2] - q[0], q[3] - q[1]); return !(Math.abs(q[3] - q[1]) < 0.5 && L > 0.45 * B * ppm) && Math.max(q[1], q[3]) <= lim; });
    if (S.length < 200 || !(ppm > 0) || !(D > 0) || !(B > 0)) return null;
    var hb = B / 2 * ppm, tol = 1.6, i, j;
    var Hs = []; segsIn(segs, box, 1).forEach(function (q) { if (Math.abs(q[3] - q[1]) < 0.5 && Math.abs(q[2] - q[0]) >= 0.5 * B * ppm && q[1] <= lim) Hs.push([q[1], Math.abs(q[2] - q[0])]); });
    var yK = null, bestL = 0;                                             // the keel and the deck: the pair of long level lines one depth apart
    Hs.forEach(function (k) { Hs.forEach(function (d) { if (Math.abs((k[0] - d[0]) - D * ppm) <= 0.04 * D * ppm && k[1] + d[1] > bestL) { bestL = k[1] + d[1]; yK = k[0]; } }); });
    if (yK == null) { yK = -1e9; S.forEach(function (q) { yK = Math.max(yK, q[1], q[3]); }); }
    var yD = yK - D * ppm, n = 60, rows = [];
    function cross(y) { var xs = []; S.forEach(function (q) { var a = Math.min(q[1], q[3]), b = Math.max(q[1], q[3]); if (b - a < 0.05 || y < a - 0.4 || y > b + 0.4) return; var yy = Math.max(a, Math.min(b, y)); xs.push(q[0] + (q[2] - q[0]) * (yy - q[1]) / (q[3] - q[1])); }); return xs.sort(function (u, v) { return u - v; }); }
    function pair(xs, cx) {                                               // the widest pair of crossings that mirror each other about cx, not wider than the breadth
      var best = 0; xs.forEach(function (x) { if (x >= cx) return; var h = cx - x; if (h > 1.05 * hb || h <= best) return; for (var m = 0; m < xs.length; m++) if (Math.abs(xs[m] - (cx + h)) <= tol) { best = h; break; } }); return best;
    }
    var mid = []; for (i = 0; i < 12; i++) mid.push(cross(yK - D * (0.3 + 0.05 * i) * ppm));
    var cxBest = null, scBest = -1;
    for (var cx0 = box.x0; cx0 <= box.x1; cx0 += 1) { var sc = 0; mid.forEach(function (xs) { var h = pair(xs, cx0); if (h > 0.8 * hb) sc++; }); if (sc > scBest) { scBest = sc; cxBest = cx0; } }
    if (scBest < 4) return null;
    var cx = cxBest, zs = [], w = [];
    for (i = 0; i <= n; i++) { var z = D * i / n, h = pair(cross(yK - z * ppm - (i === 0 ? 1 : 0)), cx); if (h > 0.15 * hb) { zs.push(z); w.push(h); } }
    if (zs.length < 8) return null;
    (function () {                                                        // rows with a narrow pair are interior structure, not the shell: interpolate across them
      var good = []; w.forEach(function (v, q) { if (v >= 0.8 * hb || (q > 0 && v >= 0.15 * hb && false)) good.push(q); });
      var out = w.slice(); if (good.length < 4) return;
      w.forEach(function (v, q) { if (good.indexOf(q) >= 0) return; var lo = -1, hi = -1, t; for (t = good.length - 1; t >= 0; t--) if (good[t] < q) { lo = good[t]; break; } for (t = 0; t < good.length; t++) if (good[t] > q) { hi = good[t]; break; } out[q] = lo < 0 ? w[hi] : hi < 0 ? w[lo] : w[lo] + (w[hi] - w[lo]) * (zs[q] - zs[lo]) / (zs[hi] - zs[lo]); });
      w = out;
    })();
    var zz0 = zs.slice(), ww0 = w.map(function (v) { return v / ppm; }), wmax = (function () { var u = w.filter(function (v, q) { return zs[q] >= 0.4 * D; }).sort(function (a, b) { return a - b; }); return u.length ? u[Math.floor(0.75 * (u.length - 1))] : Math.max.apply(null, w); })(), s = w.map(function (v) { return Math.min(1, v / wmax); });
    /* Below 40% of the depth the lines of the section are mixed with skegs, pods and machinery, so that part is not read: it is a bilge arc of an assumed radius. */
    var zT = 0.4 * D, k = 0; while (k < zs.length - 1 && zs[k] < zT) k++;
    var rr = Math.min(0.25 * D, 0.1 * B), hbM = wmax / ppm, sk = s[k], zn = [], sn = [];
    for (i = 0; i <= 12; i++) { var zz = rr * i / 12; zn.push(zz); sn.push(Math.max(0.02, (hbM * sk - rr + Math.sqrt(Math.max(0, rr * rr - (rr - zz) * (rr - zz)))) / hbM)); }
    for (i = 0; i < zs.length; i++) if (zs[i] > rr + 1e-6) { zn.push(zs[i]); sn.push(i < k ? sk : s[i]); }
    zs = zn; s = sn;
    for (i = 1; i < s.length; i++) s[i] = Math.max(s[i], s[i - 1]);                // the hull does not narrow going up (flare or vertical sides)
    var smx = s[s.length - 1]; s = s.map(function (v) { return Math.min(1, v / smx); });
    return { raw: { z: zz0, w: ww0 }, zs: zs, s: s, wmaxM: wmax / ppm, keelY: yK, deckY: yD, cx: cx };
  }
  function shapeAt(sh, z) {
    var zs = sh.zs, s = sh.s, n = zs.length;
    if (z <= zs[0]) return s[0]; if (z >= zs[n - 1]) return s[n - 1];
    var k = 0; while (k < n - 2 && z > zs[k + 1]) k++;
    return s[k] + (s[k + 1] - s[k]) * (z - zs[k]) / (zs[k + 1] - zs[k]);
  }


  /* ---------- specification text (rows without dots, frame ranges) ---------- */
  function linesFromItems(items) {                                          // text items {s,x,y} to lines, left to right
    var it = items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }), out = [], cur = null;
    it.forEach(function (t) { if (cur && Math.abs(t.y - cur.y) <= 2.5) { cur.t.push(t); } else { cur = { y: t.y, t: [t] }; out.push(cur); } });
    return out.map(function (l) { return l.t.sort(function (a, b) { return a.x - b.x; }).map(function (t) { return t.s.trim(); }).join(' ').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  }
  var FR = '(\\d{1,3}|[A-J])';
  function frameIndex(tok, after, nLet) {                                  // frame token to a running index: 0..after, then A..J, then after+1...
    after = after == null ? 27 : after; nLet = nLet == null ? 10 : nLet;
    if (/^[A-J]$/.test(tok)) return after + 1 + (tok.charCodeAt(0) - 65);
    var n = +tok; return n <= after ? n : n + nLet;
  }
  function parseSpec(lines) {
    var f = {}, ranges = [], seen = {};
    function set(k, v, src) { if (f[k] == null && (typeof v === 'string' || isFinite(v))) f[k] = { v: v, src: src }; }
    lines.forEach(function (ln) {
      var m; ln = ln.replace(/\s+([,.])/g, '$1').replace(/,(?=\S)/g, ', ').replace(/\s+/g, ' ');
      var LK = [['loa', /Length (?:over all|oa)[^\d]{0,6}?\s([\d.,]+)\s*m\b/i], ['lbp', /Length (?:between p\.?p\.?|bp)[^\d]{0,6}?\s([\d.,]+)\s*m\b/i], ['beam', /Breadth moulded[^\d]{0,6}?\s([\d.,]+)\s*m\b/i], ['depth', /Depth to [\w-]*deck[^\d]{0,4}?\s([\d.,]+)\s*m\b/i], ['draughtDesign', /Baseline,? (?:draught )?(?:amidships)?[^\d]{0,6}?\s([\d.,]+)\s*m\b/i], ['gt', /Gross tonnage[^\d]{0,6}?\s(\d+)\s*GT/i], ['dwt', /Deadweight[^\d]{0,6}?\s(\d+)\s*t\b/i], ['hfoVol', /Fuel oil[^\d]{0,6}?\s(\d+)\s*m/i], ['frameMM', /Frame spacing[^\d]{0,6}?\s(\d+)\s*mm/i], ['speed', /At 100% MCR[^\d]{0,6}?\s([\d.]+)\s*kn/i]];
      LK.forEach(function (e) { var q = e[1].exec(ln); if (q) set(e[0], +q[1].replace(',', '.'), ln); });
      if ((m = /Vessel[’']?s name[^\w]*\s([A-Z][\w-]+)/.exec(ln))) set('name', m[1], ln);
      if ((m = /^Length over all,? m\s+([\d.,]+)$/i.exec(ln))) set('loa', +m[1].replace(',', '.'), ln);
      else if ((m = /^Length between p\.?p\.?,? m\s+([\d.,]+)$/i.exec(ln))) set('lbp', +m[1].replace(',', '.'), ln);
      else if ((m = /^Breadth moulded,? m\s+([\d.,]+)$/i.exec(ln))) set('beam', +m[1].replace(',', '.'), ln);
      else if ((m = /^Depth[^,]*,? m\s+([\d.,]+)$/i.exec(ln))) set('depth', +m[1].replace(',', '.'), ln);
      else if ((m = /^Baseline draught[^\d]*?,? m\s+([\d.,]+)$/i.exec(ln))) set('draughtDesign', +m[1].replace(',', '.'), ln);
      else if ((m = /^Gross Tonnage,? GT\s+(\d+)$/i.exec(ln))) set('gt', +m[1], ln);
      else if ((m = /^Deadweight\s+(\d+)\s*t\b/i.exec(ln))) set('dwt', +m[1], ln);
      else if ((m = /^Fuel oil\s+(\d+)\s*m/i.exec(ln))) set('hfoVol', +m[1], ln);
      else if ((m = /^Speed at 100% MCR\s+([\d.]+)/i.exec(ln))) set('speed', +m[1], ln);
      else if ((m = /[“"]([A-Z][^”"]{2,30})[”"]\s+is a\b/.exec(ln))) set('name', m[1], ln);
      if ((m = /^(.*?)[,\s]+(\d(?: ?\d){0,2}|[A-J])\s*(?:…|\.{2,3})\s*(\d(?: ?\d){0,2}|[A-J])(?:\s*fr\.?)?$/.exec(ln)) && m[1] && !/\.{4,}/.test(ln) && !/^\d/.test(m[1])) {
        m[2] = m[2].replace(/ /g, ''); m[3] = m[3].replace(/ /g, ''); var nm = m[1].replace(/,$/, '').trim(), tk = /\b(tank|dbb|sewage|water|sludge|waste|bilge|fuel|ballast|oil)\b/i.test(nm) && !/room|compartment/i.test(nm);
        var side = /\b\d+\s*sb\b|\bsb\b/i.test(nm) ? 'S' : /\b\d+\s*p\b/i.test(nm) ? 'P' : '', key = nm + '|' + m[2] + '|' + m[3];
        var wing = /wing/i.test(nm), dbb = /dbb|double/i.test(nm);
        if (!seen[key]) { seen[key] = 1; ranges.push({ name: nm, kind: tk ? 'tank' : 'space', side: side, wing: wing, dbb: dbb, f0: m[2], f1: m[3] }); }
        else { ranges.push({ name: nm, kind: tk ? 'tank' : 'space', side: side === '' ? 'S2' : side, wing: wing, dbb: dbb, f0: m[2], f1: m[3] }); }   // a repeated line is the second (other) side
      }
    });
    var all = lines.join(' ').replace(/\s+([,.:])/g, '$1').replace(/\s+/g, ' ');                // values that sit in a column of their own: a second pass over the whole text
    [['depth', /Depth to [\w-]*deck[^\d]{0,4}?\s([\d.,]+)\s*m\b/i], ['loa', /Length (?:over all|oa)[^\d]{0,6}?\s([\d.,]+)\s*m\b/i], ['beam', /Breadth moulded[^\d]{0,6}?\s([\d.,]+)\s*m\b/i]].forEach(function (e) { var q = e[1].exec(all); if (q) set(e[0], +q[1].replace(',', '.'), q[0]); });
    var nq = /Vessel[’']?s name\W+([A-Z][\w-]+)/.exec(all); if (nq) set('name', nq[1], nq[0]);
    ranges.forEach(function (r, i) { if (r.side === 'S2') { r.side = 'P'; for (var q = i - 1; q >= 0; q--) if (ranges[q].name === r.name && ranges[q].f0 === r.f0 && ranges[q].f1 === r.f1 && !ranges[q].side) { ranges[q].side = 'S'; break; } } });
    return { fields: f, ranges: ranges };
  }


  /* ---------- a hull from three contours ----------
     c = { L, B, D, T, plan: [[x, half-breadth]], keel: [[x, z]] | [], deck: [[x, z]] | [], section: [[y, z]] }, all in metres. The half-breadth at (x, z) is
     b(x) times the section shape at the same relative height, pulled in toward the ends. With no section a bilge arc is used. Same result shape as guessHull. */
  function lin(pts, x) {
    var n = pts.length; if (!n) return null; if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[n - 1][0]) return pts[n - 1][1];
    var k = 0; while (k < n - 2 && x > pts[k + 1][0]) k++;
    var d = pts[k + 1][0] - pts[k][0]; return d > 1e-9 ? pts[k][1] + (pts[k + 1][1] - pts[k][1]) * (x - pts[k][0]) / d : pts[k][1];
  }

  function smooth(pts, x) {                                                 // monotone cubic (Fritsch-Carlson) through the points: smooth, no overshoot
    var n = pts.length; if (n < 3) return lin(pts, x); if (x <= pts[0][0]) return pts[0][1]; if (x >= pts[n - 1][0]) return pts[n - 1][1];
    var h = [], d = [], m = [], i;
    for (i = 0; i < n - 1; i++) { h[i] = Math.max(1e-9, pts[i + 1][0] - pts[i][0]); d[i] = (pts[i + 1][1] - pts[i][1]) / h[i]; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) { if (Math.abs(d[i]) < 1e-12) { m[i] = 0; m[i + 1] = 0; } else { var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } } }
    var k = 0; while (k < n - 2 && x > pts[k + 1][0]) k++;
    var u = (x - pts[k][0]) / h[k], u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * pts[k][1] + (u3 - 2 * u2 + u) * h[k] * m[k] + (-2 * u3 + 3 * u2) * pts[k + 1][1] + (u3 - u2) * h[k] * m[k + 1];
  }
  /* ordered contours: the points keep the order they were clicked in, so an outline may curl back (round bow, bulb, tumblehome).
     If the independent coordinate only rises (or only falls) the monotone cubic above is used; otherwise a centripetal Catmull-Rom path, and the value at u is the largest on the path. */
  function monoDir(pts) {                                                   // 1 rises, -1 falls, 0 neither (a contour that doubles back)
    var up = true, dn = true, i; for (i = 1; i < pts.length; i++) { if (pts[i][0] < pts[i - 1][0] - 1e-9) up = false; if (pts[i][0] > pts[i - 1][0] + 1e-9) dn = false; }
    return up ? 1 : dn ? -1 : 0;
  }
  function crPath(P, per) {
    var out = [], n = P.length, i, k;
    function g(i) { return P[Math.max(0, Math.min(n - 1, i))]; }
    function dd(a, b) { return Math.max(1e-6, Math.pow(Math.hypot(a[0] - b[0], a[1] - b[1]), 0.5)); }
    for (i = 0; i < n - 1; i++) {
      var p0 = i === 0 ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]] : g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = i + 2 >= n ? [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]] : g(i + 2);
      var t0 = 0, t1 = t0 + dd(p0, p1), t2 = t1 + dd(p1, p2), t3 = t2 + dd(p2, p3);
      for (k = 0; k < per; k++) {
        var t = t1 + (t2 - t1) * k / per, q = [0, 0], c;
        for (c = 0; c < 2; c++) {
          var A1 = (t1 - t) / (t1 - t0) * p0[c] + (t - t0) / (t1 - t0) * p1[c], A2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c], A3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
          var B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2, B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
          q[c] = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
        }
        out.push(q);
      }
    }
    out.push(P[n - 1].slice()); return out;
  }
  function curvePath(list, ix) {                                            // the smooth curve through the ordered points, as a list of points in the same coordinates (ix = which one is the independent one)
    var n = list.length; if (n < 3) return list.map(function (p) { return p.slice(); });
    var P = ix === 1 ? list.map(function (p) { return [p[1], p[0]]; }) : list.map(function (p) { return p.slice(); }), d = monoDir(P), out = [], t;
    if (d !== 0) {
      var S = d > 0 ? P : P.slice().reverse(), lo = S[0][0], hi = S[S.length - 1][0];
      for (t = 0; t <= 80; t++) { var u = lo + (hi - lo) * t / 80; out.push([u, smooth(S, u)]); }
    } else out = crPath(P, 14);
    return ix === 1 ? out.map(function (p) { return [p[1], p[0]]; }) : out;
  }
  function curveFn(P) {                                                     // P = [[u, v]...] in click order -> function u -> v
    var d = monoDir(P);
    if (d !== 0) { var S = d > 0 ? P : P.slice().reverse(); return function (u) { return smooth(S, u); }; }
    var path = crPath(P, 14), lo = Infinity, hi = -Infinity; path.forEach(function (q) { if (q[0] < lo) lo = q[0]; if (q[0] > hi) hi = q[0]; });
    return function (u) {
      u = Math.max(lo, Math.min(hi, u)); var best = -Infinity, i;
      for (i = 0; i + 1 < path.length; i++) { var a = path[i], b = path[i + 1], x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]); if (u < x0 - 1e-9 || u > x1 + 1e-9) continue; var v = x1 - x0 < 1e-9 ? Math.max(a[1], b[1]) : a[1] + (b[1] - a[1]) * (u - a[0]) / (b[0] - a[0]); if (v > best) best = v; }
      return best === -Infinity ? 0 : best;
    };
  }
  function hullFromContours(c) {
    function srt(a) { return (a || []).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); }); }
    var L = c.L, B = c.B, D = c.D, T = c.T || 0.65 * D, plan = srt(c.plan), keel = srt(c.keel), deck = srt(c.deck), sec = srt((c.section || []).map(function (p) { return [p[1], p[0]]; }));   // sec: [z, y]
    var planF = plan.length >= 2 ? curveFn(plan) : null, keelF = keel.length ? curveFn(keel) : null, deckF = deck.length ? curveFn(deck) : null, secF = sec.length >= 2 ? curveFn(sec) : null;
    if (!(L > 0 && B > 0 && D > 0) || plan.length < 2) return null;
    var nx = 41, nz = 22, i, j, xs = [], zs = [], half = [], bmax = Math.max.apply(null, plan.map(function (p) { return p[1]; })), ymax = sec.length ? Math.max.apply(null, sec.map(function (p) { return p[1]; })) : 0;
    if (!(bmax > 0)) return null;
    for (i = 0; i < nx; i++) xs.push(r2(L * i / (nx - 1)));
    for (j = 0; j < nz; j++) zs.push(r2(D * j / (nz - 1)));
    var rB = 0.06 * B;
    for (j = 0; j < nz; j++) {
      var row = [];
      for (i = 0; i < nx; i++) {
        var x = xs[i], b = Math.max(0, planF(x)), zk = keelF ? keelF(x) : 0, zd = deckF ? deckF(x) : D, z = zs[j];
        if (z < zk - 1e-9 || z > zd + 1e-9 || b < 0.02 || zd - zk < 0.05) { row.push(null); continue; }
        var y, h = z - zk;
        if (secF && ymax > 0) { var t = h / (zd - zk) * D, p = 1 + 1.5 * Math.max(0, 1 - b / bmax); y = b * Math.pow(Math.max(0.001, Math.min(1, secF(t) / ymax)), p); }
        else { var r = Math.min(rB, b * 0.9); y = h >= r ? b : (b - r) + Math.sqrt(Math.max(0, r * r - (r - h) * (r - h))); }
        row.push(r2(Math.max(0.02, y)));
      }
      half.push(row);
    }
    var vol = 0, Tm = Math.min(T, D);
    for (i = 0; i + 1 < nx; i++) for (j = 0; j + 1 < nz; j++) if (zs[j + 1] <= Tm + 1e-9) { var ya = half[j][i] == null ? 0 : half[j][i], yb = half[j][i + 1] == null ? 0 : half[j][i + 1]; vol += (ya + yb) / 2 * (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j]) * 2; }
    return { hull: { type: 'offsets', offsets: { zs: zs, xs: xs, half: half }, x: 0, y: 0, loa: r2(L), beam: r2(B), depth: r2(D), draught: r2(Math.min(D, T)) }, cb: vol / (L * B * Tm), fromContours: true };
  }


  /* ---------- a guessed hull ----------
     Half-breadths come from the outline of the plan views (measured). The bilge radius and the rise of the keel aft are assumed, the sides are vertical,
     the deck is flat at the depth. Returns a DBB hull of type 'offsets' with a few numbers to check, or null if there is no outline. */
  /* the outline of the hull in the profile view, from the compartments found there: for each height the aft and forward ends, along the length the keel.
     ok(px, py): the pixel belongs to a compartment; X(px), Z(py): metres. Only up to the depth (the hull, not the superstructure). */
  function profileOutline(w, h, ok, X, Z, D) {
    var bins = {}, kb = {}, px, py;
    for (py = 0; py < h; py++) {
      var z = Z(py); if (z < -0.2 || z > D + 0.2) continue; var a = -1, c = -1;
      for (px = 0; px < w; px++) if (ok(px, py)) { if (a < 0) a = px; c = px; }
      if (a < 0) continue; var k = Math.round(z * 4) / 4, xa = X(a), xf = X(c);
      if (!bins[k]) bins[k] = { z: k, xa: xa, xf: xf }; else { bins[k].xa = Math.min(bins[k].xa, xa); bins[k].xf = Math.max(bins[k].xf, xf); }
      for (px = a; px <= c; px++) if (ok(px, py)) { var kx = Math.round(X(px) * 2) / 2; if (kb[kx] == null || z < kb[kx]) kb[kx] = z; }
    }
    var raw = Object.keys(bins).map(function (k) { return bins[k]; }).filter(function (q) { return q.z <= D - 0.2; }).sort(function (p, q) { return p.z - q.z; });
    // decks and flats are drawn as lines: a height that falls on one sees only part of the compartments. The ends at each height are the outermost within 0.5 m up or down,
    // and the outline is grown by half a line gap (the compartments stop at the inside of the hull line)
    var g = 0.3, rows = raw.map(function (q) { var nb = raw.filter(function (u) { return Math.abs(u.z - q.z) <= 0.5; }); return { z: q.z, xa: Math.min.apply(null, nb.map(function (u) { return u.xa; })) - g, xf: Math.max.apply(null, nb.map(function (u) { return u.xf; })) + g }; });
    var k0 = Object.keys(kb).map(function (k) { return { x: +k, z: kb[k] }; }).sort(function (p, q) { return p.x - q.x; });
    // the keel: the lowest compartment within 3 m along the length; flat (z = 0) between the first and the last place where it is low; rising only towards the ends
    var keel = k0.map(function (q) { var nb = k0.filter(function (u) { return Math.abs(u.x - q.x) <= 3; }); return { x: q.x, z: Math.max(0, Math.min.apply(null, nb.map(function (u) { return u.z; })) - g) }; });
    var low = keel.filter(function (q) { return q.z < 0.15 * D; });
    if (low.length) { var la = low[0].x, lf = low[low.length - 1].x, i;
      keel.forEach(function (q) { if (q.x >= la && q.x <= lf) q.z = 0; });
      for (i = keel.length - 2; i >= 0; i--) if (keel[i].x < la) keel[i].z = Math.max(keel[i].z, keel[i + 1].z);     // aft: the keel only rises going aft
      for (i = 1; i < keel.length; i++) if (keel[i].x > lf) keel[i].z = Math.max(keel[i].z, keel[i - 1].z); }        // forward: only rises going forward
    return rows.length >= 3 ? { rows: rows, keel: keel } : null;
  }
  function guessHull(res, info, o) {
    o = o || {}; info = info || {};
    var sc = res && res.scale; if (!sc || sc.sx == null || !res.envelope) return null;
    var L = info.loa || sc.lengthPts * sc.sx, B = info.beam || (sc.beamPts ? sc.beamPts * sc.sy : 0), D = info.depth || (sc.heightPts ? sc.heightPts * sc.sz : 0);
    if (!(L > 0 && B > 0 && D > 0)) return null;
    var T = info.draughtDesign || info.draught || D * 0.65, nx = 41, nz = 22, i, j, b = [], xs = [];
    for (i = 0; i < nx; i++) { xs.push(r2(L * i / (nx - 1))); b.push(res.envelope(sc.xA + (L * i / (nx - 1)) / sc.sx) * sc.sy); }
    var mx = Math.max.apply(null, b); if (!(mx > 0)) return null;
    var k0 = b.findIndex(function (v) { return v >= 0.97 * mx; }), k1 = b.length - 1 - b.slice().reverse().findIndex(function (v) { return v >= 0.97 * mx; });
    for (i = k1 + 1; i < nx; i++) b[i] = Math.min(b[i], b[i - 1]);          // forward of the full part the width only falls
    for (i = k0 - 1; i >= 0; i--) b[i] = Math.min(b[i], b[i + 1]);          // and aft of it
    b = b.map(function (v, q) { var a = b[Math.max(0, q - 1)], c = b[Math.min(nx - 1, q + 1)]; return q === 0 || q === nx - 1 ? v : (a + 2 * v + c) / 4; });
    var f = (B / 2) / Math.max.apply(null, b); if (Math.abs(f - 1) > 0.1) f = 1; b = b.map(function (v) { return v * f; });
    b[nx - 1] = Math.min(b[nx - 1], 0.02 * B);                              // the stem is a point
    var rB = o.bilge != null ? o.bilge : 0.06 * B, runL = 0.2 * L, runH = 0.12 * T, zs = [], half = [], zk = [];
    // the profile: the aft and forward ends of the hull at each height, and the keel line (from the compartments of the profile view)
    var P = o.prof && o.prof.rows && o.prof.rows.length >= 3 ? o.prof : null;
    if (P) {                                                              // the profile spans the length overall: its own ends are stretched to 0 and L (views of a scan are not always lined up)
      var pmn = Math.min.apply(null, P.rows.map(function (q) { return q.xa; })), pmx = Math.max.apply(null, P.rows.map(function (q) { return q.xf; })), ks = L / Math.max(1e-6, pmx - pmn);
      if (ks > 0.85 && ks < 1.2) P = { rows: P.rows.map(function (q) { return { z: q.z, xa: (q.xa - pmn) * ks, xf: (q.xf - pmn) * ks }; }), keel: (P.keel || []).map(function (q) { return { x: (q.x - pmn) * ks, z: q.z }; }) }; else P = null;
    }
    if (P) { var rD = P.rows.filter(function (q) { return q.z > 0.5 * D; }), spanD = rD.length ? Math.max.apply(null, rD.map(function (q) { return q.xf; })) - Math.min.apply(null, rD.map(function (q) { return q.xa; })) : 0; if (spanD < 0.85 * L) P = null; }    // the profile must cover the length near the deck, else it is not used
    function lin(list, key, v, a, c) { if (v <= list[0][key]) return [list[0][a], c ? list[0][c] : 0]; var n = list.length - 1; if (v >= list[n][key]) return [list[n][a], c ? list[n][c] : 0]; for (var q = 0; q < n; q++) if (v <= list[q + 1][key]) { var t = (v - list[q][key]) / Math.max(1e-9, list[q + 1][key] - list[q][key]); return [list[q][a] + t * (list[q + 1][a] - list[q][a]), c ? list[q][c] + t * (list[q + 1][c] - list[q][c]) : 0]; } return [list[n][a], c ? list[n][c] : 0]; }
    function at(arr, fi) { var k = Math.max(0, Math.min(arr.length - 1, Math.floor(fi))), t = fi - k, a = arr[k] || 0, c = arr[Math.min(arr.length - 1, k + 1)] || 0; return a + (c - a) * t; }
    var bx0 = xs[b.findIndex(function (v) { return v > 0.02; })] || 0, bx1 = xs[nx - 1 - b.slice().reverse().findIndex(function (v) { return v > 0.02; })] || L;
    for (i = 0; i < nx; i++) {
      var x = xs[i];
      if (P && P.keel && P.keel.length >= 3) { var kx = P.keel.filter(function (q) { return Math.abs(q.x - x) <= L / (nx - 1); }); zk.push(kx.length ? Math.max(0, Math.min(0.9 * D, Math.min.apply(null, kx.map(function (q) { return q.z; })))) : (x < P.keel[0].x || x > P.keel[P.keel.length - 1].x ? D : Math.max(0, lin(P.keel, 'x', x, 'z')[0]))); }
      else zk.push(x < runL ? runH * Math.pow((runL - x) / runL, 2) : 0);
    }
    var sec = o.section || null, bmx = Math.max.apply(null, b), pw = [];
    for (i = 0; i < nx; i++) {                                              // how much the section is pulled in at station i: 1 at the full part, more forward and aft
      var p = 1 + 1.5 * Math.max(0, 1 - b[i] / bmx);
      if (sec && o.low && o.low.b && o.low.b[i] > 0 && b[i] > 0) { var sz = shapeAt(sec, o.low.z); if (sz > 0.05 && sz < 0.95) p = Math.max(0.5, Math.min(4, Math.log(Math.min(0.999, o.low.b[i] / b[i])) / Math.log(sz))); }
      pw.push(p);
    }
    for (j = 0; j < nz; j++) zs.push(r2(D * j / (nz - 1)));
    for (j = 0; j < nz; j++) {
      var row = [], rg = P ? lin(P.rows, 'z', zs[j], 'xa', 'xf') : null;
      for (i = 0; i < nx; i++) {
        var h = zs[j] - zk[i], fi = i, bi = b[i];
        if (rg) {                                                         // the waterline keeps the shape of the deck outline, fitted between the ends of the profile at this height
          if (xs[i] < rg[0] - 1e-6 || xs[i] > rg[1] + 1e-6 || rg[1] - rg[0] < 0.05 * L) { row.push(null); continue; }
          fi = (bx0 + (xs[i] - rg[0]) * (bx1 - bx0) / Math.max(1e-6, rg[1] - rg[0])) / L * (nx - 1); bi = at(b, fi);
          if (xs[i] >= rg[1] - 1e-6) bi = Math.min(bi, 0.02 * B);
        }
        if (h < -1e-9 || bi < 0.02) { row.push(null); continue; }
        var y;
        if (sec) y = bi * Math.pow(Math.max(0.001, shapeAt(sec, h * D / Math.max(1e-6, D - zk[i]))), at(pw, fi));
        else if (o.decks && o.decks.length >= 1) {                         // several deck plans: the half-breadth goes straight from one deck to the next, under the lowest one a round bilge
          var pts = o.decks.filter(function (d) { return at(d.b, fi) > 0 && d.z < D; }).map(function (d) { return [d.z, Math.min(bi, at(d.b, fi))]; }); pts.push([D, bi]);
          var zz = zs[j] - zk[i];
          if (pts.length < 2 || zz >= pts[0][0]) { y = bi; for (var q = 0; q + 1 < pts.length; q++) if (zz >= pts[q][0] && zz <= pts[q + 1][0]) { var t = (zz - pts[q][0]) / Math.max(1e-6, pts[q + 1][0] - pts[q][0]); y = pts[q][1] + t * (pts[q + 1][1] - pts[q][1]); break; } }
          else { var w0 = pts[0][1], r3 = Math.min(rB, w0 * 0.9); y = h >= r3 ? w0 : (w0 - r3) + Math.sqrt(Math.max(0, r3 * r3 - (r3 - h) * (r3 - h))); }
        }
        else { var r = Math.min(rB, bi * 0.9); y = h >= r ? bi : (bi - r) + Math.sqrt(Math.max(0, r * r - (r - h) * (r - h))); }
        row.push(r2(Math.max(0.02, y)));
      }
      half.push(row);
    }
    var vol = 0, Tm = Math.min(T, D);                                      // block coefficient at the draught, trapezoid rule
    for (i = 0; i + 1 < nx; i++) { var a = 0, c = 0; for (j = 0; j + 1 < nz; j++) { var zm = (zs[j] + zs[j + 1]) / 2; if (zs[j + 1] <= Tm + 1e-9) { var ya = half[j][i] == null ? 0 : half[j][i], yb = half[j][i + 1] == null ? 0 : half[j][i + 1]; vol += (ya + yb) / 2 * (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j]) * 2; } } }
    var cb = vol / (L * B * Tm);
    return { hull: { type: 'offsets', offsets: { zs: zs, xs: xs, half: half }, x: 0, y: 0, loa: r2(L), beam: r2(B), depth: r2(D), draught: r2(Math.min(D, T)) }, cb: cb, bilge: rB, rise: runH, fromSection: !!sec, fromDecks: !sec && !!(o.decks && o.decks.length >= 1), fromProfile: !!P, plan: xs.map(function (x, q) { return [x, r2(b[q])]; }), runL: runL, runH: runH };
  }

  /* ---------- blocks from the analysis ---------- */
  var GROUPS = { cargo: 'g_cargo', tanks: 'g_tanks', mach: 'g_mach', acc: 'g_acc', outfit: 'g_outfit', struct: 'g_struct' };
  function r2(v) { return Math.round(v * 100) / 100; }

  /* Tank spans between the regular bulkheads. a, b in page points along the length. info supplies the numbers of tanks. */
  function suggestTanks(res, info) {
    var out = [];
    if (!res.spanPts || !res.spanPts.length || res.scale.sx == null) return out;
    var sx = res.scale.sx, sy = res.scale.sy, X = res.X, Lpts = res.scale.lengthPts, yc = res.scale.yc, env = res.envelope;
    var spans = res.spanPts.filter(function (s) { return (s.b - s.a) >= 0.08 * Lpts && (s.b - s.a) <= 0.3 * Lpts; });
    if (!spans.length) return out;
    var nPairs = info && info.cargoTanks ? Math.round(info.cargoTanks / 2) : null, reg = [];
    function cv(list) { var m = list.reduce(function (a, s) { return a + (s.b - s.a); }, 0) / list.length, v = list.reduce(function (a, s) { return a + Math.pow((s.b - s.a) - m, 2); }, 0) / list.length; return Math.sqrt(v) / m; }
    function chains() {                                                   // runs of spans that touch end to end
      var cs = [], cur = [];
      spans.forEach(function (s) { if (cur.length && Math.abs(cur[cur.length - 1].b - s.a) < 1.5) cur.push(s); else { if (cur.length) cs.push(cur); cur = [s]; } });
      if (cur.length) cs.push(cur);
      return cs;
    }
    if (nPairs) {                                                         // the window of nPairs touching spans with the most equal lengths
      var best = null;
      chains().forEach(function (c) { for (var i = 0; i + nPairs <= c.length; i++) { var w = c.slice(i, i + nPairs), q = cv(w); if (!best || q < best.q - 1e-9) best = { q: q, w: w }; } });
      if (best) reg = best.w;
    }
    if (!reg.length) {
      var med = median(spans.map(function (s) { return s.b - s.a; }));
      reg = spans.filter(function (s) { return Math.abs((s.b - s.a) - med) <= 0.12 * med; });
    }
    if (!reg.length) return out;
    // the cargo tanks, numbered from the bow (no. 1 is forward)
    var zBot = info && info.dbBottom != null ? info.dbBottom : 2.4, depth = info && info.depth ? info.depth : res.scale.heightPts * res.scale.sz, skin = info && info.dbSide != null ? info.dbSide : 2.4;
    var yIn = null;
    if (res.longLines && res.longLines.length) {                      // the inner skin: the line nearest the side that spans the cargo block
      var xa = reg[0].a, xb = reg[reg.length - 1].b, bl = xb - xa, emax = 0, ex;
      if (env) for (ex = xa; ex <= xb; ex += 2) { var ev = env(ex); if (isFinite(ev)) emax = Math.max(emax, ev); }
      function near(l) { return !emax || l.d >= 0.6 * emax; }                    // the inner skin stands near the side, not at the centreline (a centreline bulkhead can be drawn as a double line)
      var cand = res.longLines.filter(function (l) { return near(l) && l.a <= xa + 3 && l.b >= xb - 3; }).sort(function (u, v) { return v.d - u.d; });
      if (!cand.length) cand = res.longLines.filter(function (l) { return near(l) && l.a <= xa + 0.1 * bl && Math.min(l.b, xb) - Math.max(l.a, xa) >= 0.8 * bl; }).sort(function (u, v) { return v.d - u.d; });      // it may stop short of the forward tank, where the hull narrows
      if (cand.length) yIn = cand[0].d;
    }
    reg.slice().reverse().forEach(function (s, i) {
      var no = i + 1, x0 = X(s.a), x1 = X(s.b), half = Infinity;
      for (var px = s.a; px <= s.b; px += 2) half = Math.min(half, env ? env(px) : Infinity);
      var hw = (isFinite(half) ? half * sy : (info.beam || 40) / 2) - skin;
      if (yIn != null) hw = Math.min(hw, yIn * sy);
      if (!(hw > 0.5)) return;
      ['P', 'S'].forEach(function (side) {
        out.push({ kind: 'cargo', name: 'No.' + no + ' cargo tank ' + side, side: side, x0: r2(x0), x1: r2(x1), y0: r2(side === 'P' ? 0 : -hw), y1: r2(side === 'P' ? hw : 0), z0: r2(zBot), z1: r2(depth), group: GROUPS.cargo, on: true });
      });
    });
    res.tankNote = reg.length + ' regular tank spans' + (nPairs ? ' (the data sheet gives ' + nPairs + ' pairs)' : '');
    // aft spaces: the spans aft of the cargo block (slop tanks, pump room), between full-depth bulkheads
    var aftA = reg.length ? reg[0].a : null;
    if (aftA != null) {
      var aft = res.spanPts.filter(function (s) { return s.b <= aftA + 1 && (s.b - s.a) >= 0.03 * Lpts; }).sort(function (u, v) { return v.b - u.b; });
      if (res.bulkheads && res.bulkheads.length && res.bulkheads[0] > 0.02 * (info.loa || 1e9) && res.bulkheads[0] < 0.12 * (info.loa || 0)) aft.push({ a: res.ext.a, b: res.ext.a + res.bulkheads[0] / sx, end: 'aft' });   // the space aft of the first bulkhead (steering gear, aft peak)
      aft.slice(0, 5).forEach(function (s, i) {
        var half = 0; for (var px = s.a; px <= s.b; px += 2) half = Math.max(half, env ? env(px) : 0);
        var hw = Math.min((isFinite(half) ? half * sy : (info.beam || 40) / 2) - skin, yIn != null ? yIn * sy : 1e9);
        if (!(hw > 0.5)) return;
        var isSlop = info && info.slopTanks && i === 0;
        if (isSlop) {
          ['P', 'S'].forEach(function (side) { out.push({ kind: 'slop', name: 'Slop tank ' + side, side: side, x0: r2(X(s.a)), x1: r2(X(s.b)), y0: r2(side === 'P' ? 0 : -hw), y1: r2(side === 'P' ? hw : 0), z0: r2(zBot), z1: r2(depth), group: GROUPS.tanks, on: true }); });
        } else {
          out.push({ kind: 'space', name: 'Aft space ' + (i + 1), side: '', x0: r2(X(s.a)), x1: r2(X(s.b)), y0: r2(-hw), y1: r2(hw), z0: 0, z1: r2(depth), group: GROUPS.tanks, on: false });
        }
      });
    }
    var lastB = reg.length ? reg[reg.length - 1].b : null, Lm = info.loa || Lpts * sx;      // the space forward of the last cargo tank: fore peak and bow thruster room
    if (lastB != null && Lm - X(lastB) > 0.03 * Lm && Lm - X(lastB) < 0.2 * Lm) {
      var hf = 0, px2; for (px2 = lastB; px2 <= lastB + 0.35 * (res.ext.b - lastB); px2 += 2) hf = Math.max(hf, env ? env(px2) : 0);
      var hwf = Math.min((isFinite(hf) ? hf * sy : (info.beam || 40) / 2) - skin, 0.9 * (hf * sy));
      if (hwf > 0.5) out.push({ kind: 'space', name: 'Fore space', side: '', x0: r2(X(lastB)), x1: r2(Lm), y0: r2(-hwf), y1: r2(hwf), z0: 0, z1: r2(depth), group: GROUPS.tanks, on: false, bow: true });
    }
    return out;
  }

  /* Width of the deckhouse (m) between x0m and x1m (metres from the aft end), from the transverse lines of the deck plan that are
     roughly symmetric about the centreline. Returns null when nothing fits. */
  function houseWidth(res, x0m, x1m, info) {
    if (!res.deckPlan || res.scale.sx == null) return null;
    var sx = res.scale.sx, sy = res.scale.sy, ext = res.ext, yc = res.deckPlan.yc, span = x1m - x0m, best = null;
    var vr = runs(res.deckPlan.segs, false, { minLen: 5, gap: 3, tolPos: 0.4 });
    vr.forEach(function (r) {
      var xm = (r.p - ext.a) * sx;
      var tol = 0.06 * span, dEdge = Math.min(Math.abs(xm - x0m), Math.abs(xm - x1m));         // the walls of the house: the vertical lines at its ends
      if (dEdge > tol && (xm < x0m + 0.1 * span || xm > x1m - 0.1 * span)) return;
      var up = (yc - r.a) * sy, dn = (r.b - yc) * sy, len = up + dn, B = info && info.beam ? info.beam : 40;
      if (len < 0.25 * B || len > 0.9 * B || up <= 0 || dn <= 0 || Math.abs(up - dn) > 0.35 * len) return;
      if (!best || len > best) best = len;
    });
    return best;
  }

  /* ---------- the particulars on the data sheet page ---------- */
  var NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  function num(s) { var m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; }
  /* items: pdf.js text items as {s, x, y, w} in page points (y down). Returns {fields, rows}. */
  /* Particulars in a plain two-column table: "Length overall    250.0 m" (the label on the left, the value on the right of the same row). Fills what the dot-leader reader did not find. */
  function parseTable(items) {
    var rows = [], f = {};
    items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (it) {
      var r = rows.filter(function (q) { return Math.abs(q.y - it.y) <= 2; })[0]; if (!r) { r = { y: it.y, items: [] }; rows.push(r); } r.items.push(it);
    });
    function num1(t) { var m = /(\d[\d,]*(?:\.\d+)?)/.exec(String(t || '')); return m ? +m[1].replace(/,/g, '') : null; }
    function set(k, v, src) { if (v != null && v !== '' && !(typeof v === 'number' && !isFinite(v)) && f[k] == null) f[k] = { v: v, src: src }; }
    rows.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var cells = [], cur = null; r.items.forEach(function (it) { if (cur && it.x - cur.end <= 9) { cur.s += ' ' + it.s; cur.end = it.x + it.w; } else { cur = { s: it.s, x: it.x, end: it.x + it.w }; cells.push(cur); } });
      for (var ci = 0; ci + 1 < cells.length; ci++) (function (c0, c1) {      // every cell may be the label, the next one the value (a row can also hold a column of running text)
      var key = c0.s.toLowerCase().replace(/[:.]+$/, '').replace(/\s+/g, ' ').trim(), val = c1.s.trim(), src = c0.s.trim(), n, m;
      if (/^length (overall|o\.?a\.?|over all)( \((loa|l\.?o\.?a\.?)\))?$/.test(key)) set('loa', num1(val), src);
      else if (/^length (bp|b\.p\.|between perp\w*|pp)$/.test(key)) set('lbp', num1(val), src);
      else if (/^(breadth|beam)(,? (moulded|mld\.?|molded))?( \((width|moulded)\))?$/.test(key)) set('beam', num1(val), src);
      else if (/^depth(,? (moulded|mld\.?|molded))?( to (main|upper|strength) deck)?$/.test(key)) set('depth', num1(val), src);
      else if (/(draught|draft).*depth/.test(key)) { m = /(\d+(?:\.\d+)?)\s*m?\s*\/\s*(\d+(?:\.\d+)?)/.exec(val); if (m) { set('draught', +m[1], src); set('depth', +m[2], src); } else set('draught', num1(val), src); }
      else if (/^design (draught|draft)/.test(key)) set('draughtDesign', num1(val), src);
      else if (/wing.*double bottom|double side.*double bottom/.test(key)) { m = /(\d+(?:\.\d+)?)\s*m?\s*\/\s*(\d+(?:\.\d+)?)/.exec(val); if (m) { set('dbSide', +m[1], src); set('dbBottom', +m[2], src); } }
      else if (/^double bottom( height)?$/.test(key)) set('dbBottom', num1(val), src);
      else if (/^draught|^draft/.test(key)) { m = /(\d+(?:\.\d+)?)\s*m?\s*\/\s*(\d+(?:\.\d+)?)/.exec(val); if (m && /design/.test(key)) { set('draughtDesign', +m[1], src); set('draught', +m[2], src); } else if (/design/.test(key)) set('draughtDesign', num1(val), src); else set('draught', num1(val), src); }
      else if (/^deadweight/.test(key)) set(/design/.test(key) ? 'dwtDesign' : 'dwt', num1(val), src);
      else if (/^cargo tanks?$/.test(key)) { m = /(\d+)\s*(?:pairs?|prs?)\s*(?:of\s*)?(?:cot|cargo)/i.exec(val) || /^(\d+)\s*pairs?\b/i.exec(val); if (m) set('cargoTanks', 2 * +m[1], src); else if ((n = num1(val)) != null && /^\d/.test(val)) set('cargoTanks', n, src); m = /(\d+)\s*(?:pairs?|prs?)\s*(?:of\s*)?slop/i.exec(val); if (m) set('slopTanks', 2 * +m[1], src); }
      else if (/^cargo capacity|^cargo volume/.test(key)) set('cargoVol', num1(val), src);
      else if (/^(service )?speed/.test(key)) set('speed', num1(val), src);
      else if (/^type$/.test(key)) set('type', val, src);
      else if (/^(builder|shipbuilder|yard)$/.test(key)) set('builder', val, src);
      else if (/^(owner|operator|owner\/operator)$/.test(key)) set('owner', val, src);
      else if (/^flag$/.test(key)) set('flag', val, src);
      else if (/^imo( number| no\.?)?$/.test(key)) set('imo', val, src);
      else if (/^gross tonnage/.test(key)) set('gt', num1(val), src);
      else if (/^(total )?decks$|^number of decks$/.test(key)) set('decks', num1(val), src);
      else if (/^passenger(s| capacity)|^max(imum)? passengers|^capacity \(passengers\)/.test(key)) set('passengers', num1(val), src);
      else if (/^(total )?(cabins|staterooms)( \/ suites)?$|^number of (cabins|staterooms)$/.test(key)) set('cabins', num1(val), src);
      })(cells[ci], cells[ci + 1]);
    });
    var first = items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; })[0];            // the title of a data sheet, in capitals, is the name of the ship
    if (first && /^[A-Z][A-Z0-9 -]{2,30}$/.test(first.s.trim()) && first.s.trim().split(/\s+/).length <= 4) set('name', first.s.trim().replace(/\w\S*/g, function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); }), 'title of the page');
    var all = items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }).map(function (i) { return i.s; }).join(' ').replace(/\s+/g, ' '), mm = /\b([A-Z][A-Z0-9]*(?: [A-Z0-9-]+){1,4}) is an? [a-z]/.exec(all);
    if (mm && !/^(THE|THIS|IT)\b/.test(mm[1])) set('name', mm[1].replace(/\w\S*/g, function (w) { return w.length > 3 || /^[A-Z]{2,3}$/.test(w) && false ? w.charAt(0) + w.slice(1).toLowerCase() : w; }), 'text of the page');
    return { fields: f };
  }
  function parseInfo(items) {
    var rows = [], tol = 2;
    items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (it) {
      var r = rows.filter(function (q) { return Math.abs(q.y - it.y) <= tol; })[0];
      if (!r) { r = { y: it.y, items: [] }; rows.push(r); }
      r.items.push(it);
    });
    rows.sort(function (a, b) { return a.y - b.y; });
    var cells = [];
    rows.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var cur = null;
      r.items.forEach(function (it) {
        if (cur && it.x - cur.end <= 7) { cur.s += (cur.s.slice(-1) === ' ' || /^[\s.,:)]/.test(it.s) ? '' : ' ') + it.s; cur.end = it.x + it.w; }
        else { cur = { s: it.s, x: it.x, y: r.y, end: it.x + it.w }; cells.push(cur); }
      });
    });
    var text = cells.map(function (c) { return c.s; }).join('\n');
    var kv = [];
    cells.forEach(function (c) {
      var m = c.s.match(/^(.*?)\s*[:.\s]*\.{3,}\s*(.*)$/);
      if (m && m[1].trim()) kv.push({ key: m[1].replace(/[:\s]+$/, '').replace(/’/g, "'").trim(), val: m[2].trim(), x: c.x, y: c.y });
    });
    var f = {}, section = '';
    function put(k, v, unit, src) { if (v != null && f[k] == null) f[k] = { v: v, unit: unit || '', src: src }; }
    kv.forEach(function (e) {
      var k = e.key.toLowerCase(), v = e.val, n = num(v);
      if (k === 'shipbuilder') put('builder', v.replace(/\s+/g, ' '), '', e.key);
      else if (k === "vessel's name") put('name', v, '', e.key);
      else if (k === 'flag') put('flag', v, '', e.key);
      else if (k === 'imo number') put('imo', v, '', e.key);
      else if (k === 'hull no') put('hullNo', v, '', e.key);
      else if (k === 'owner/operator') put('owner', v, '', e.key);
      else if (k === 'length oa') put('loa', n, 'm', e.key);
      else if (k === 'length bp') put('lbp', n, 'm', e.key);
      else if (k === 'breadth moulded') put('beam', n, 'm', e.key);
      else if (k === 'to main deck') put('depth', n, 'm', 'Depth moulded, ' + e.key);
      else if (k === 'to upper deck') put('depthUpper', n, 'm', 'Depth moulded, ' + e.key);
      else if (k === 'gross') put('gt', n, 'GT', e.key);
      else if (k.indexOf('speed, service') === 0) put('speed', n, 'knots', e.key);
      else if (k === 'liquid volume') put('cargoVol', n, 'm3', 'Cargo capacity, ' + e.key);
      else if (k === 'heavy oil') put('hfoVol', n, 'm3', 'Bunkers, ' + e.key);
      else if (k === 'diesel oil') put('mdoVol', n, 'm3', 'Bunkers, ' + e.key);
      else if (k === 'water ballast') put('ballastVol', n, 'm3', e.key);
      else if (k === 'side') put('dbSide', n, 'm', 'Width of double skin, ' + e.key);
      else if (k === 'bottom') put('dbBottom', n, 'm', 'Width of double skin, ' + e.key);
      else if (k === 'scantling' || k === 'design') {
        if (/dwt/i.test(v)) put(k === 'scantling' ? 'dwt' : 'dwtDesign', n, 't', 'Deadweight, ' + e.key);
        else if (/m\b/i.test(v) || /mld/i.test(v)) put(k === 'scantling' ? 'draught' : 'draughtDesign', n, 'm', 'Draught, ' + e.key);
      } else if (/cargo tanks/i.test(v)) {
        var mc = v.match(/(\d+)\s*cargo tanks/i), ms = v.match(/(\d+)\s*slop tanks/i);
        if (mc) put('cargoTanks', parseInt(mc[1], 10), '', e.key + ' ' + v);
        if (ms) put('slopTanks', parseInt(ms[1], 10), '', e.key + ' ' + v);
      }
    });
    var all = text.replace(/\n/g, ' ');
    if (f.cargoTanks == null) {
      var m1 = all.match(/(\w+)\s+port\s+and\s+(\w+)\s+starboard[^.]*?cargo tanks/i);
      if (m1 && NUMW[m1[1].toLowerCase()]) put('cargoTanks', NUMW[m1[1].toLowerCase()] * 2, '', 'text: ' + m1[0].slice(0, 60));
      var m2 = all.match(/(\w+)\s+slop tanks/i);
      if (m2 && NUMW[m2[1].toLowerCase()]) put('slopTanks', NUMW[m2[1].toLowerCase()], '', 'text: ' + m2[0]);
    }
    var mt = all.match(/([A-Z][A-Z .\-]+):\s*(Tanker|Bulk carrier|Container ship|[A-Z][a-z]+(?: [a-z]+)?)\s/);
    if (!f.name) { var mn = all.match(/\b([A-Z][A-Z ]{3,}):\s*([A-Z][a-z]+(?: [a-z]+)?)/); if (mn) { put('name', mn[1].trim().replace(/\b(\w)(\w*)/g, function (_, a, b) { return a + b.toLowerCase(); }), '', 'title'); put('type', mn[2], '', 'title'); } }
    else { var mt2 = all.match(/:\s*(Tanker|Bulk carrier|Container ship|General cargo|Ro-ro|RoPax|Passenger ship|Offshore vessel)\b/i); if (mt2) put('type', mt2[1], '', 'title'); }
    return { fields: f, cells: cells, text: text, pairs: kv };
  }

  /* ---------- the DBB project ---------- */
  function defaultGroups() {
    return [
      { id: 'g_task', name: 'Task related systems', color: '#9aa3b0', parent: null, visible: true, density: null },
      { id: 'g_cargo', name: 'Cargo spaces', color: '#e0603c', parent: 'g_task', visible: true, density: 0.6 },
      { id: 'g_ah', name: 'Anchor handling and towing', color: '#f2a93b', parent: 'g_task', visible: true, density: 0.4 },
      { id: 'g_oc', name: 'Offshore construction', color: '#8e63c9', parent: 'g_task', visible: true, density: 0.4 },
      { id: 'g_ship', name: 'Ship systems', color: '#9aa3b0', parent: null, visible: true, density: null },
      { id: 'g_struct', name: 'Ship structure', color: '#8c97a8', parent: 'g_ship', visible: true, density: 0.15 },
      { id: 'g_outfit', name: 'Ship outfitting', color: '#2fa7b8', parent: 'g_ship', visible: true, density: 0.15 },
      { id: 'g_acc', name: 'Accommodation', color: '#4fae6a', parent: 'g_ship', visible: true, density: 0.12 },
      { id: 'g_mach', name: 'Machinery', color: '#e9cf3a', parent: 'g_ship', visible: true, density: 0.4 },
      { id: 'g_tanks', name: 'Tanks and voids', color: '#3f72d6', parent: 'g_ship', visible: true, density: 0.85 }
    ];
  }
  var GROUP_NAMES = { g_cargo: 'Cargo spaces', g_tanks: 'Tanks and voids', g_mach: 'Machinery', g_acc: 'Accommodation', g_outfit: 'Ship outfitting', g_struct: 'Ship structure' };

  /* rows: [{name, group, x0, x1, y0, y1, z0, z1, on, density?, fill?, deck?, gt?}] in metres. Writes a DBB project (JSON object). */

  /* ---------- block shapes (the primitives of DBB) and STL export ----------
     Unit shapes in the cube [-0.5, 0.5]^3, built like DBB: cylinder, cone and pyramid stand on z with the apex at +z; the half cylinder (arch) and the wedge run along y
     (wedge high at +x). vf is the volume factor and pf the plan factor of DBB. */
  var SHAPES = [
    { id: 'box', label: 'Box', vf: 1, pf: 1 }, { id: 'cylinder', label: 'Cylinder', vf: 0.7854, pf: 0.7854 }, { id: 'halfcyl', label: 'Half cylinder', vf: 0.7854, pf: 1 },
    { id: 'cone', label: 'Cone', vf: 0.2618, pf: 0.7854 }, { id: 'pyramid', label: 'Pyramid', vf: 0.3333, pf: 1 }, { id: 'wedge', label: 'Wedge', vf: 0.5, pf: 1 }, { id: 'sphere', label: 'Sphere', vf: 0.5236, pf: 0.7854 }
  ];
  function shapeFactor(id) { for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].id === id) return SHAPES[i].vf; return 1; }
  var triCache = {};
  function shapeTris(kind) {
    if (triCache[kind]) return triCache[kind];
    var T = [], i, n = 32, PI2 = Math.PI * 2;
    function tri(a, b, c) { T.push([a, b, c]); }
    function quad(a, b, c, d) { tri(a, b, c); tri(a, c, d); }
    function extrude(poly) {                                              // a convex profile in (x, z), run along y from -0.5 to 0.5
      var m = poly.length, k;
      for (k = 1; k + 1 < m; k++) { tri([poly[0][0], -0.5, poly[0][1]], [poly[k][0], -0.5, poly[k][1]], [poly[k + 1][0], -0.5, poly[k + 1][1]]); tri([poly[0][0], 0.5, poly[0][1]], [poly[k][0], 0.5, poly[k][1]], [poly[k + 1][0], 0.5, poly[k + 1][1]]); }
      for (k = 0; k < m; k++) { var a = poly[k], b = poly[(k + 1) % m]; quad([a[0], -0.5, a[1]], [b[0], -0.5, b[1]], [b[0], 0.5, b[1]], [a[0], 0.5, a[1]]); }
    }
    if (kind === 'cylinder' || kind === 'cone') {
      for (i = 0; i < n; i++) {
        var a0 = PI2 * i / n, a1 = PI2 * (i + 1) / n, p0 = [0.5 * Math.cos(a0), 0.5 * Math.sin(a0)], p1 = [0.5 * Math.cos(a1), 0.5 * Math.sin(a1)];
        tri([0, 0, -0.5], [p0[0], p0[1], -0.5], [p1[0], p1[1], -0.5]);
        if (kind === 'cylinder') { tri([0, 0, 0.5], [p0[0], p0[1], 0.5], [p1[0], p1[1], 0.5]); quad([p0[0], p0[1], -0.5], [p1[0], p1[1], -0.5], [p1[0], p1[1], 0.5], [p0[0], p0[1], 0.5]); }
        else tri([p0[0], p0[1], -0.5], [p1[0], p1[1], -0.5], [0, 0, 0.5]);
      }
    } else if (kind === 'pyramid') {
      var c = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
      quad([c[0][0], c[0][1], -0.5], [c[1][0], c[1][1], -0.5], [c[2][0], c[2][1], -0.5], [c[3][0], c[3][1], -0.5]);
      for (i = 0; i < 4; i++) tri([c[i][0], c[i][1], -0.5], [c[(i + 1) % 4][0], c[(i + 1) % 4][1], -0.5], [0, 0, 0.5]);
    } else if (kind === 'sphere') {
      var nl = 12, nm = 24, j;
      function sp(la, lo) { return [0.5 * Math.cos(la) * Math.cos(lo), 0.5 * Math.cos(la) * Math.sin(lo), 0.5 * Math.sin(la)]; }
      for (j = 0; j < nl; j++) for (i = 0; i < nm; i++) {
        var la0 = -Math.PI / 2 + Math.PI * j / nl, la1 = -Math.PI / 2 + Math.PI * (j + 1) / nl, lo0 = PI2 * i / nm, lo1 = PI2 * (i + 1) / nm;
        if (j > 0) tri(sp(la0, lo0), sp(la0, lo1), sp(la1, lo1)); if (j < nl - 1) tri(sp(la0, lo0), sp(la1, lo1), sp(la1, lo0));
      }
    } else if (kind === 'halfcyl') {
      var poly = [[-0.5, -0.5], [0.5, -0.5]], na = 20;
      for (i = 1; i <= na; i++) { var an = Math.PI * i / na; poly.push([0.5 * Math.cos(an), -0.5 + Math.sin(an)]); }
      poly.pop(); extrude(poly.slice(0, 1).concat(poly.slice(1)));                 // the last point is at (-0.5, -0.5) again: dropped
    } else if (kind === 'wedge') extrude([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5]]);
    else {
      extrude([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]);
    }
    var m = [0, 0, 0], cnt = 0; T.forEach(function (t) { t.forEach(function (v) { m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; cnt++; }); }); m = m.map(function (v) { return v / cnt; });
    T = T.filter(function (t) { var u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], w = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]]; return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) > 1e-9; });
    T = T.map(function (t) {                                                // every triangle faces outward (all seven shapes are convex)
      var u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], w = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]], nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      return nn[0] * (t[0][0] - m[0]) + nn[1] * (t[0][1] - m[1]) + nn[2] * (t[0][2] - m[2]) < 0 ? [t[0], t[2], t[1]] : t;
    });
    triCache[kind] = T; return T;
  }
  var edgeCache = {};
  function shapeEdges(kind) {                                               // sharp edges (and the outline) of a unit shape, for line drawing
    if (edgeCache[kind]) return edgeCache[kind];
    var T = shapeTris(kind), map = {}, out = [];
    if (kind === 'sphere') { var a, ca, sa, cb, sb; for (a = 0; a < 48; a++) { ca = 2 * Math.PI * a / 48; sa = 2 * Math.PI * (a + 1) / 48; out.push([[0.5 * Math.cos(ca), 0.5 * Math.sin(ca), 0], [0.5 * Math.cos(sa), 0.5 * Math.sin(sa), 0]]); out.push([[0.5 * Math.cos(ca), 0, 0.5 * Math.sin(ca)], [0.5 * Math.cos(sa), 0, 0.5 * Math.sin(sa)]]); out.push([[0, 0.5 * Math.cos(ca), 0.5 * Math.sin(ca)], [0, 0.5 * Math.cos(sa), 0.5 * Math.sin(sa)]]); } edgeCache[kind] = out; return out; }
    function key(v) { return Math.round(v[0] * 1e4) + ',' + Math.round(v[1] * 1e4) + ',' + Math.round(v[2] * 1e4); }
    function nrm(t) { var u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], w = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; }
    T.forEach(function (t) { var nn = nrm(t); for (var e = 0; e < 3; e++) { var a = t[e], b = t[(e + 1) % 3], ka = key(a), kb = key(b), kk = ka < kb ? ka + '|' + kb : kb + '|' + ka; (map[kk] = map[kk] || { a: a, b: b, n: [] }).n.push(nn); } });
    Object.keys(map).forEach(function (k) { var e = map[k]; if (e.n.length === 1 || (e.n.length === 2 && e.n[0][0] * e.n[1][0] + e.n[0][1] * e.n[1][1] + e.n[0][2] * e.n[1][2] < Math.cos(25 * Math.PI / 180))) out.push([e.a, e.b]); });
    edgeCache[kind] = out; return out;
  }
  function blockTris(rows) {                                                // the ticked blocks as triangles in metres
    var out = [];
    rows.forEach(function (r) {
      if (r.on === false) return; var L = Math.abs(r.x1 - r.x0), B = Math.abs(r.y1 - r.y0), H = Math.abs(r.z1 - r.z0); if (!(L > 0.05 && B > 0.05 && H > 0.05)) return;
      var cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, cz = (r.z0 + r.z1) / 2;
      shapeTris(r.shape || 'box').forEach(function (t) { out.push(t.map(function (v) { return [cx + v[0] * L, cy + v[1] * B, cz + v[2] * H]; })); });
    });
    return out;
  }
  function hullTris(hull) {                                                 // a closed solid from the table of offsets: stations joined by strips, the deck closed, the ends capped
    if (!hull || !hull.offsets) return [];
    var of = hull.offsets, nx = of.xs.length, nz = of.zs.length, N = 72, loops = [], i, j, k;
    for (i = 0; i < nx; i++) {
      var js = []; for (j = 0; j < nz; j++) if (of.half[j][i] != null) js.push(j); if (js.length < 2) { loops.push(null); continue; }
      var j0 = js[0], j1 = js[js.length - 1], pts = [[of.xs[i], 0, of.zs[j0]]];
      for (k = 0; k < js.length; k++) pts.push([of.xs[i], -of.half[js[k]][i], of.zs[js[k]]]);
      for (k = js.length - 1; k >= 0; k--) pts.push([of.xs[i], of.half[js[k]][i], of.zs[js[k]]]);
      pts.push([of.xs[i], 0, of.zs[j0]]);                                  // the loop starts and ends on the keel centre; the deck is closed by the line between the two top points
      var len = [0]; for (k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]) + 1e-9);
      var tot = len[len.length - 1], rs = [], q = 0;
      for (k = 0; k < N; k++) { var d = tot * k / N; while (q < len.length - 2 && len[q + 1] < d) q++; var f = (d - len[q]) / Math.max(1e-9, len[q + 1] - len[q]); rs.push([pts[q][0], pts[q][1] + (pts[q + 1][1] - pts[q][1]) * f, pts[q][2] + (pts[q + 1][2] - pts[q][2]) * f]); }
      loops.push(rs);
    }
    var T = [], prev = -1;
    function cap(lp, flip) { var cx = 0, cy = 0, cz = 0; lp.forEach(function (p) { cx += p[0]; cy += p[1]; cz += p[2]; }); var c = [cx / N, cy / N, cz / N]; for (var m = 0; m < N; m++) { var a = lp[m], b = lp[(m + 1) % N]; T.push(flip ? [c, b, a] : [c, a, b]); } }
    var first = -1, last = -1;
    for (i = 0; i < nx; i++) if (loops[i]) { if (first < 0) first = i; last = i; if (prev >= 0 && prev === i - 1) { var A = loops[prev], Bq = loops[i]; for (k = 0; k < N; k++) { var k2 = (k + 1) % N; T.push([A[k], Bq[k], Bq[k2]]); T.push([A[k], Bq[k2], A[k2]]); } } prev = i; }
    if (first < 0) return [];
    cap(loops[first], false); cap(loops[last], true);
    var vol = 0; T.forEach(function (t) { vol += t[0][0] * (t[1][1] * t[2][2] - t[1][2] * t[2][1]) - t[0][1] * (t[1][0] * t[2][2] - t[1][2] * t[2][0]) + t[0][2] * (t[1][0] * t[2][1] - t[1][1] * t[2][0]); });
    return vol < 0 ? T.map(function (t) { return [t[0], t[2], t[1]]; }) : T;
  }
  function stlBinary(tris, name) {                                          // binary STL, metres
    var buf = new ArrayBuffer(84 + 50 * tris.length), dv = new DataView(buf), hd = String(name || 'GA 2D extractor to DBB').slice(0, 79), i, p = 84;
    for (i = 0; i < hd.length; i++) dv.setUint8(i, hd.charCodeAt(i) & 127); dv.setUint32(80, tris.length, true);
    tris.forEach(function (t) {
      var u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], w = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(n[0], n[1], n[2]) || 1, k;
      for (k = 0; k < 3; k++) dv.setFloat32(p + 4 * k, n[k] / l, true); p += 12;
      t.forEach(function (v) { for (k = 0; k < 3; k++) dv.setFloat32(p + 4 * k, v[k], true); p += 12; }); dv.setUint16(p, 0, true); p += 2;
    });
    return buf;
  }
  function crc32(u8) { var c, crc = -1, n, k; if (!crc32.t) { crc32.t = []; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc32.t[n] = c >>> 0; } } for (n = 0; n < u8.length; n++) crc = crc32.t[(crc ^ u8[n]) & 255] ^ (crc >>> 8); return (crc ^ -1) >>> 0; }
  function zipStore(name, bytes) {                                          // a zip with one stored (uncompressed) file: lets a viewer that only saves some extensions hand over an .stl
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), nm = new Uint8Array(name.length), i; for (i = 0; i < name.length; i++) nm[i] = name.charCodeAt(i) & 127;
    var crc = crc32(u8), sz = u8.length, d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var out = new Uint8Array(30 + nm.length + sz + 46 + nm.length + 22), dv = new DataView(out.buffer), p = 0;
    dv.setUint32(p, 0x04034b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 0, true); dv.setUint16(p + 8, 0, true); dv.setUint16(p + 10, time, true); dv.setUint16(p + 12, date, true); dv.setUint32(p + 14, crc, true); dv.setUint32(p + 18, sz, true); dv.setUint32(p + 22, sz, true); dv.setUint16(p + 26, nm.length, true); dv.setUint16(p + 28, 0, true); out.set(nm, p + 30); out.set(u8, p + 30 + nm.length);
    var cd = 30 + nm.length + sz; p = cd;
    dv.setUint32(p, 0x02014b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 20, true); dv.setUint16(p + 8, 0, true); dv.setUint16(p + 10, 0, true); dv.setUint16(p + 12, time, true); dv.setUint16(p + 14, date, true); dv.setUint32(p + 16, crc, true); dv.setUint32(p + 20, sz, true); dv.setUint32(p + 24, sz, true); dv.setUint16(p + 28, nm.length, true); dv.setUint32(p + 42, 0, true); out.set(nm, p + 46);
    p = cd + 46 + nm.length; dv.setUint32(p, 0x06054b50, true); dv.setUint16(p + 8, 1, true); dv.setUint16(p + 10, 1, true); dv.setUint32(p + 12, 46 + nm.length, true); dv.setUint32(p + 16, cd, true);
    return out;
  }

  function buildProject(rows, o) {
    o = o || {};
    var info = o.info || {}, used = {}, blocks = [], n = 0;
    rows.forEach(function (r) {
      if (r.on === false) return;
      var L = Math.abs(r.x1 - r.x0), B = Math.abs(r.y1 - r.y0), Hh = Math.abs(r.z1 - r.z0);
      if (!(L > 0.05 && B > 0.05 && Hh > 0.05)) return;
      n++; used[r.group] = true;
      blocks.push({
        id: 'b' + n, name: r.name || 'Block ' + n, shape: r.shape && SHAPES.some(function (q) { return q.id === r.shape; }) ? r.shape : 'box', group: r.group || 'g_tanks', reqs: [],
        position: [r2((r.x0 + r.x1) / 2), r2((r.y0 + r.y1) / 2), r2((r.z0 + r.z1) / 2)], size: [r2(L), r2(B), r2(Hh)], rotation: [0, 0, 0],
        areaOverride: null, hidden: false, density: typeof r.density === 'number' ? r.density : null, fill: typeof r.fill === 'number' ? r.fill : 100, massOverride: null,
        freeSurface: r.freeSurface === true, deck: r.deck === true, gt: r.gt !== false
      });
    });
    var groups = defaultGroups().filter(function (g) { return g.parent === null && (g.id === 'g_ship' || used.g_cargo) || used[g.id] || (g.id === 'g_task' && used.g_cargo); });
    var hulls = [];
    if (o.hullObj) {
      var go = JSON.parse(JSON.stringify(o.hullObj)); go.id = 'h1'; go.name = (info.name || 'Hull') + (o.hullName || ' hull (guessed from the GA)'); go.visible = true; hulls.push(go);
    } else if (o.hull !== false && info.loa && info.beam && info.depth) {
      hulls.push({ id: 'h1', name: (info.name || 'Hull') + ' hull (illustrative)', type: o.hullType || 'cargo', x: 0, y: 0, loa: info.loa, beam: info.beam, depth: info.depth, draught: info.draught || info.draughtDesign || r2(info.depth * 0.65), visible: true });
    }
    var proj = {
      app: FORMAT, version: VERSION, name: (o.name || info.name || 'GA project'), units: 'm',
      axes: 'x forward from the aft end, y to port from the centreline, z up from the baseline; positions are block centres; rotation is Euler XYZ in degrees',
      taxonomy: 'Levander system based design (editable)',
      groups: groups, requirements: [], waterDensity: 1.025, draught: hulls[0] ? hulls[0].draught : null, waterline: true, float: false,
      blocks: blocks, hulls: hulls
    };
    if (o.meta && o.meta.length) proj.meta = o.meta.map(function (m) { return { key: m.key, label: m.label, value: m.value, unit: m.unit || '' }; });     // information from the drawing that DBB does not use
    return proj;
  }
  function toCSV(rows) {
    var head = ['Name', 'Shape', 'Group', 'X0 (m)', 'X1 (m)', 'Y0 (m)', 'Y1 (m)', 'Z0 (m)', 'Z1 (m)', 'Centre X', 'Centre Y', 'Centre Z', 'Length', 'Beam', 'Height'];
    var lines = [head.join(',')];
    rows.forEach(function (r) {
      if (r.on === false) return;
      var cells = [r.name, r.shape || 'box', GROUP_NAMES[r.group] || r.group, r.x0, r.x1, r.y0, r.y1, r.z0, r.z1, r2((r.x0 + r.x1) / 2), r2((r.y0 + r.y1) / 2), r2((r.z0 + r.z1) / 2), r2(Math.abs(r.x1 - r.x0)), r2(Math.abs(r.y1 - r.y0)), r2(Math.abs(r.z1 - r.z0))];
      lines.push(cells.map(function (c) { var s = String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  var api = { profileOutline: profileOutline, parseTable: parseTable, SHAPES: SHAPES, shapeFactor: shapeFactor, shapeTris: shapeTris, shapeEdges: shapeEdges, blockTris: blockTris, hullTris: hullTris, stlBinary: stlBinary, zipStore: zipStore, smooth: smooth, curvePath: curvePath, curveFn: curveFn, hullFromContours: hullFromContours, linesFromItems: linesFromItems, parseSpec: parseSpec, frameIndex: frameIndex, sectionShape: sectionShape, titleBoxes: titleBoxes, rulerPitch: rulerPitch, frameSpacing: frameSpacing, sheetViews: sheetViews, sheetRoles: sheetRoles, titleRole: titleRole, splitRows: splitRows, splitSheet: splitSheet, dropAxisLines: dropAxisLines, splitViewsCC: splitViewsCC, guessRotationText: guessRotationText, tableBoxes: tableBoxes, parseOcrLines: parseOcrLines, textSegments: textSegments, textBlocks: textBlocks, guessHull: guessHull, segmentsFromOps: segmentsFromOps, inPage: inPage, rotateSegs: rotateSegs, splitViews: splitViews, segsIn: segsIn, runs: runs, bbox: bbox, guessRotation: guessRotation, guessUp: guessUp,
    describeView: describeView, guessRoles: guessRoles, analyse: analyse, suggestTanks: suggestTanks, houseWidth: houseWidth, parseInfo: parseInfo, buildProject: buildProject, toCSV: toCSV, defaultGroups: defaultGroups, GROUP_NAMES: GROUP_NAMES, r2: r2 };
  root.GA2DBB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
