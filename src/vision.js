/* Finds the views of a drawing that is only a picture: plain image analysis, on this computer.
   1) dark pixels, 2) remove very long straight lines (sheet frame, table borders), 3) smear the rest so the lines of one
   view join, 4) take the connected blobs as views. Boxes are returned in the pixels of the image given. */
(function () {
  function otsu(h, n) { var sum = 0, i; for (i = 0; i < 256; i++) sum += i * h[i]; var sB = 0, wB = 0, best = 0, th = 128; for (i = 0; i < 256; i++) { wB += h[i]; if (!wB) continue; var wF = n - wB; if (!wF) break; sB += i * h[i]; var d = wB * wF * Math.pow(sB / wB - (sum - sB) / wF, 2); if (d > best) { best = d; th = i; } } return th; }
  function dilate(a, w, h, r) {
    var t = new Uint8Array(w * h), o = new Uint8Array(w * h), x, y, c, k;
    for (y = 0; y < h; y++) { c = 0; for (x = 0; x < w + r; x++) { if (x < w) c += a[y * w + x]; if (x - 2 * r - 1 >= 0) c -= a[y * w + x - 2 * r - 1]; var xx = x - r; if (xx >= 0 && xx < w) t[y * w + xx] = c > 0 ? 1 : 0; } }
    for (x = 0; x < w; x++) { c = 0; for (y = 0; y < h + r; y++) { if (y < h) c += t[y * w + x]; if (y - 2 * r - 1 >= 0) c -= t[(y - 2 * r - 1) * w + x]; var yy = y - r; if (yy >= 0 && yy < h) o[yy * w + x] = c > 0 ? 1 : 0; } }
    return o;
  }
  // grey levels of img at the scale S0 (at most 1): each output pixel takes the DARKEST pixel of the block it covers, so that thin or faint lines keep their strength
  function grayMin(img, S0, avg) {
    if (avg) {                                                              // the plain smooth reduction
      var w0 = Math.max(1, Math.round(img.width * S0)), h0 = Math.max(1, Math.round(img.height * S0)), c0 = document.createElement('canvas'); c0.width = w0; c0.height = h0; var g0 = c0.getContext('2d', { willReadFrequently: true });
      g0.fillStyle = '#fff'; g0.fillRect(0, 0, w0, h0); g0.imageSmoothingQuality = 'high'; g0.drawImage(img, 0, 0, w0, h0); var d0 = g0.getImageData(0, 0, w0, h0).data, o0 = new Uint8Array(w0 * h0), j;
      for (j = 0; j < w0 * h0; j++) o0[j] = Math.round(0.299 * d0[4 * j] + 0.587 * d0[4 * j + 1] + 0.114 * d0[4 * j + 2]); return { w: w0, h: h0, gray: o0 };
    }
    var W = img.width, H = img.height, c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0);
    var d = g.getImageData(0, 0, W, H).data, w = Math.max(1, Math.round(W * S0)), h = Math.max(1, Math.round(H * S0)), out = new Uint8Array(w * h).fill(255), x, y, ox, oy, v, i;
    for (y = 0; y < H; y++) { oy = Math.min(h - 1, Math.floor(y * S0)); for (x = 0; x < W; x++) { i = (y * W + x) * 4; v = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; ox = Math.min(w - 1, Math.floor(x * S0)); if (v < out[oy * w + ox]) out[oy * w + ox] = v; } }
    return { w: w, h: h, gray: out };
  }
  // how plausible is a set of views for a general arrangement: several long views (profile and plans) of about the same length, no huge blob
  function viewScore(boxes, w, h) {
    var side = Math.max(w, h), lg = boxes.filter(function (q) { var bw = q.x1 - q.x0, bh = q.y1 - q.y0; return bw / bh >= 3.2 && bw >= 0.4 * side; }), sim = 0, i, j, blob = 0;
    for (i = 0; i < lg.length; i++) for (j = i + 1; j < lg.length; j++) { var r = (lg[i].x1 - lg[i].x0) / (lg[j].x1 - lg[j].x0); if (r > 0.8 && r < 1.25) sim++; }
    boxes.forEach(function (q) { var bw = q.x1 - q.x0, bh = q.y1 - q.y0; if (bw * bh > 0.4 * w * h && bw / bh < 2.5) blob = 1; });
    return 3 * Math.min(lg.length, 4) + 2 * Math.min(sim, 3) + 0.4 * Math.min(boxes.length, 8) - 4 * blob;
  }
  function findViews(img, opt) {
    opt = opt || {}; if (opt.th || opt.min) return findViews1(img, opt);
    var sc = Math.min(1, (opt.max || 1000) / Math.max(img.width, img.height)), w = img.width * sc, h = img.height * sc;
    var cands = opt.fast ? [{}, { th: 212 }] : [{}, { th: 212 }, { min: true }, { min: true, th: 240 }, { th: 240 }], best = null;
    [0.012, 0.005].forEach(function (gy) { cands.forEach(function (o) {
      var r = findViews1(img, Object.assign({}, opt, o, { gapY: gy })), sco = viewScore(r.boxes.map(function (q) { return { x0: q.x0 * sc, y0: q.y0 * sc, x1: q.x1 * sc, y1: q.y1 * sc }; }), w, h);
      if (!best || sco > best.score + 1.5) best = { score: sco, r: r };           // the plain reading stays unless another is clearly better
    }); });
    if (!opt.fast) [0.004, 0.003].forEach(function (gy) { var r = findViews1(img, Object.assign({}, opt, { dens: true, gapY: gy })), sco = viewScore(r.boxes.map(function (q) { return { x0: q.x0 * sc, y0: q.y0 * sc, x1: q.x1 * sc, y1: q.y1 * sc }; }), w, h); if (sco > best.score + 1.5) best = { score: sco, r: r }; });
    return best.r;
  }
  // the long views of a sheet share one length (same scale), so pieces in one row are joined while the joined piece is not longer than about 1.25 times the longest single view
  var opt_dbg = false;
  function mergeRows(leaves, w, h, ink) {
    var big = leaves.filter(function (b) { return b.x1 - b.x0 >= 0.04 * w && b.y1 - b.y0 >= 0.02 * h && b.dens < 0.5; }), rows = [];
    big.slice().sort(function (a, b) { return (a.y0 + a.y1) - (b.y0 + b.y1); }).forEach(function (b) {
      var r = rows.filter(function (q) { var o = Math.min(q.y1, b.y1) - Math.max(q.y0, b.y0); return o > 0.6 * Math.min(q.y1 - q.y0, b.y1 - b.y0); })[0];
      if (r) { r.l.push(b); r.y0 = Math.min(r.y0, b.y0); r.y1 = Math.max(r.y1, b.y1); } else rows.push({ l: [b], y0: b.y0, y1: b.y1 });
    });
    if (opt_dbg) console.log("rows", JSON.stringify(rows.map(function (r) { return r.l.map(function (b) { return [b.x0, b.y0, b.x1, b.y1].map(function (v) { return Math.round(v); }); }); })));
    var single = []; big.forEach(function (b) { if ((b.x1 - b.x0) / (b.y1 - b.y0) > 3) single.push(b.x1 - b.x0); });
    var lref = single.length ? Math.max.apply(null, single) : 0, cap = lref * 1.2, gapMax = 0.09 * Math.max(w, h), merged = [], used = [];
    rows.forEach(function (r) {
      if (r.l.length < 2 || !cap) return; var L = r.l.filter(function (q) { return q.x1 - q.x0 >= 0.18 * lref && (q.x1 - q.x0) / (q.y1 - q.y0) >= 1.4; }).sort(function (a, b) { return a.x0 - b.x0; }); if (L.length < 2) return; var L0 = r.l.slice(), grp = [L[0]], groups = [];
      for (var i = 1; i < L.length; i++) { var cur = grp[grp.length - 1], x0 = grp[0].x0, x1 = Math.max(L[i].x1, cur.x1), gp = L[i].x0 - Math.max.apply(null, grp.map(function (q) { return q.x1; })); if (gp <= gapMax && x1 - x0 <= cap) grp.push(L[i]); else { groups.push(grp); grp = [L[i]]; } }
      groups.push(grp);
      groups.forEach(function (g) { if (g.length < 2) return; var x0 = Math.min.apply(null, g.map(function (q) { return q.x0; })), x1 = Math.max.apply(null, g.map(function (q) { return q.x1; })), y0 = Math.min.apply(null, g.map(function (q) { return q.y0; })), y1 = Math.max.apply(null, g.map(function (q) { return q.y1; })), n = 0; g.forEach(function (q) { n += q.ink; used.push(q); }); merged.push({ x0: x0, y0: y0, x1: x1, y1: y1, ink: n, dens: n / ((x1 - x0) * (y1 - y0)) }); });
    });
    return leaves.filter(function (b) { return used.indexOf(b) < 0; }).concat(merged);
  }
  function findViews1(img, opt) {
    opt = opt || {}; var S0 = Math.min(1, (opt.max || 1000) / Math.max(img.width, img.height)), w = Math.round(img.width * S0), h = Math.round(img.height * S0);
    var gm = grayMin(img, S0, !opt.min), gray = gm.gray, hist = new Array(256).fill(0), i; w = gm.w; h = gm.h;
    for (i = 0; i < w * h; i++) hist[gray[i]]++;
    var th = opt.th || Math.min(200, Math.max(90, otsu(hist, w * h))), ink = new Uint8Array(w * h); 
    for (i = 0; i < w * h; i++) ink[i] = gray[i] < th ? 1 : 0;
    var x, y, x0, GT = 3;                                                   // 2) remove the long lines (the sheet frame, table borders), allowing small breaks
    var LH = 0.55 * w, LV = 0.55 * h;
    function strip(get, set, len, minLen) { var i = 0; while (i < len) { if (!get(i)) { i++; continue; } var a0 = i, last = i, gp = 0; while (i < len && gp <= GT) { if (get(i)) { last = i; gp = 0; } else gp++; i++; } if (last - a0 >= minLen) for (var q = a0; q <= last; q++) set(q); } }
    for (y = 0; y < h; y++) (function (yy) { strip(function (i) { return ink[yy * w + i]; }, function (i) { ink[yy * w + i] = 0; }, w, LH); })(y);
    for (x = 0; x < w; x++) (function (xx) { strip(function (i) { return ink[i * w + xx]; }, function (i) { ink[i * w + xx] = 0; }, h, LV); })(x);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (ink[y * w + x]) { var nb = (x > 0 && ink[y * w + x - 1]) + (x < w - 1 && ink[y * w + x + 1]) + (y > 0 && ink[(y - 1) * w + x]) + (y < h - 1 && ink[(y + 1) * w + x]); if (nb === 0) ink[y * w + x] = 0; }
    if (opt.dump) opt.dump({ w: w, h: h, ink: ink });
    // 3) cut the sheet along empty bands: rows first, then columns inside each row, again and again (XY-cut)
    var gap = Math.max(4, Math.round((opt.gap || 0.012) * Math.max(w, h))), gapY = Math.max(3, Math.round((opt.gapY || 0.012) * Math.max(w, h))), leaves = [];
    function bands(x0, y0, x1, y1, horiz) {                                   // runs of rows (or columns) that hold ink
      var len = horiz ? y1 - y0 : x1 - x0, cross = horiz ? x1 - x0 : y1 - y0, tol = Math.max(0, Math.round(cross * (opt.tol != null ? opt.tol : 0.002))), prof = new Int32Array(len), i, j, runs = [], s0 = -1, last = -1;
      for (i = 0; i < len; i++) { var c = 0; for (j = 0; j < cross; j++) c += horiz ? ink[(y0 + i) * w + x0 + j] : ink[(y0 + j) * w + x0 + i]; prof[i] = c; }
      var tl = tol; if (opt.dens && horiz) { var nz = Array.prototype.filter.call(prof, function (v) { return v > 0; }).sort(function (p, q) { return p - q; }); if (nz.length) tl = Math.max(tol, Math.round(0.25 * nz[nz.length >> 1])); }       // dens: a row with little ink (dimension lines, titles) between two plans counts as empty
      for (i = 0; i < len; i++) { if (prof[i] > tl) { if (s0 < 0) s0 = i; else if (i - last > (horiz ? gapY : gap)) { runs.push([s0, last]); s0 = i; } last = i; } }
      if (s0 >= 0) runs.push([s0, last]); return runs;
    }
    function cut(x0, y0, x1, y1, depth) {
      var rr = bands(x0, y0, x1, y1, true); if (!rr.length) return;
      if (rr.length > 1 && depth < 8) { rr.forEach(function (q) { cut(x0, y0 + q[0], x1, y0 + q[1] + 1, depth + 1); }); return; }
      var ty0 = y0 + rr[0][0], ty1 = y0 + rr[0][1] + 1, cc = bands(x0, ty0, x1, ty1, false); if (!cc.length) return;
      if (cc.length > 1 && depth < 8) { cc.forEach(function (q) { cut(x0 + q[0], ty0, x0 + q[1] + 1, ty1, depth + 1); }); return; }
      var tx0 = x0 + cc[0][0], tx1 = x0 + cc[0][1] + 1, n = 0, yy, xx; for (yy = ty0; yy < ty1; yy++) for (xx = tx0; xx < tx1; xx++) n += ink[yy * w + xx];
      leaves.push({ x0: tx0, y0: ty0, x1: tx1, y1: ty1, ink: n, dens: n / ((tx1 - tx0) * (ty1 - ty0)) });
    }
    cut(0, 0, w, h, 0);
    if (!opt.nomerge) leaves = mergeRows(leaves, w, h, ink);                                   // pieces of one long view (a gap inside a plan or a profile) go back together
    var out = leaves.filter(function (b) { var bw = b.x1 - b.x0, bh = b.y1 - b.y0; return bw >= 0.08 * w && bh >= 0.06 * h * 0.8 && b.dens < 0.55 && b.ink > 0.0015 * w * h; });
    out.sort(function (a, b) { return (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0); }); out = out.slice(0, 8);
    var pad = 0.004 * Math.max(w, h);
    return { boxes: out.map(function (b) { return { x0: Math.max(0, b.x0 - pad) / S0, y0: Math.max(0, b.y0 - pad) / S0, x1: Math.min(w, b.x1 + pad) / S0, y1: Math.min(h, b.y1 + pad) / S0, n: 0, title: '' }; }), threshold: th, smear: gap / S0 };
  }
  // which view is which: the widest long view is the profile; a long view of similar width above or below it is the plan
  // a plan is nearly the same above and below its centreline, a profile is not (flat keel, deckhouse and masts on top): 1 = mirror image, 0 = nothing alike
  function symmetry(m, box) {
    var bx0 = Math.round(box.x0 * m.S0), bx1 = Math.round(box.x1 * m.S0), by0 = Math.round(box.y0 * m.S0), by1 = Math.round(box.y1 * m.S0), NX = 160, H = by1 - by0, W = bx1 - bx0; if (H < 6 || W < 20) return 0;
    var g = [], r, c, x, y; for (r = 0; r < H; r++) { var row = new Float32Array(NX); for (c = 0; c < NX; c++) { var xa = bx0 + Math.floor(c * W / NX), xb = bx0 + Math.max(Math.floor((c + 1) * W / NX), Math.floor(c * W / NX) + 1), n = 0; for (x = xa; x < xb; x++) n += m.ink[(by0 + r) * m.w + x]; row[c] = n > 0 ? 1 : 0; } g.push(row); }
    var best = 0, ax, tol = 2; for (ax = Math.round(H * 0.3); ax <= Math.round(H * 0.7); ax++) { var inter = 0, uni = 0, d; for (d = 1; d <= Math.min(ax, H - 1 - ax); d++) for (c = 0; c < NX; c++) { var a = g[ax - d][c], bb = g[ax + d][c]; if (a || bb) { uni++; if (a && bb) inter++; } } if (uni > 0) best = Math.max(best, inter / uni); }
    return best;
  }
  // long horizontal lines: how many separate rows of the view are crossed over at least 75% of its length (keel, deck, waterline of a profile; a plan has the outline curved)
  function straightRows(m, box) {
    var bx0 = Math.round(box.x0 * m.S0), bx1 = Math.round(box.x1 * m.S0), by0 = Math.round(box.y0 * m.S0), by1 = Math.round(box.y1 * m.S0), W = bx1 - bx0, y, x, n = 0, last = -99, cl = 0, gp = Math.max(3, Math.round(0.03 * (by1 - by0)));
    for (y = by0; y < by1; y++) { var best = 0, run = 0, gaps = 0; for (x = bx0; x < bx1; x++) { if (m.ink[y * m.w + x]) { run++; gaps = 0; if (run > best) best = run; } else { gaps++; if (gaps > 3) run = 0; else run++; } } if (best >= 0.75 * W) { if (y - last > gp) cl++; last = y; } }
    return cl;
  }
  function guessRoles(boxes, img) {
    var roles = boxes.map(function () { return 'ignore'; }), maxW = 0, wide = [];
    boxes.forEach(function (b) { maxW = Math.max(maxW, b.x1 - b.x0); });
    boxes.forEach(function (b, j) { var w = b.x1 - b.x0, h = b.y1 - b.y0; if (w / h >= 2.3 && w >= 0.45 * maxW) wide.push(j); });
    boxes.forEach(function (b, j) { var w = b.x1 - b.x0, h = b.y1 - b.y0; if (wide.indexOf(j) < 0 && w / h > 0.6 && w / h < 1.7 && roles.indexOf('section') < 0 && w < 0.3 * maxW) roles[j] = 'section'; });
    if (wide.length) {
      wide.sort(function (a, b2) { return boxes[a].y0 - boxes[b2].y0; });                       // the profile is the view on top, the plans follow below it
      var pj = wide[0], pw = boxes[pj].x1 - boxes[pj].x0; roles[pj] = 'profile';
      var cand = wide.slice(1).filter(function (j) { return boxes[j].x1 - boxes[j].x0 > 0.55 * pw; });
      if (cand.length === 1) roles[cand[0]] = 'tank'; else if (cand.length > 1) { roles[cand[cand.length >= 4 ? 1 : 0]] = 'deck'; roles[cand[cand.length - 1]] = 'tank'; }      // with four or more, the one right under the profile is usually a second (inboard) profile
    }
    return roles;
  }
  // which way up is the picture? Try the four quarter turns: the views must be long and level (profile and plans), the profile above the plan,
  // the plan narrowing to the right (the bow is pointed) and the deckhouse of the profile on the left (most ships have it aft).
  function inkOf(img, max, thFix, minPool) {
    var S0 = Math.min(1, max / Math.max(img.width, img.height)), gm = grayMin(img, S0, !minPool), w = gm.w, h = gm.h, ink = new Uint8Array(w * h), hist = new Array(256).fill(0), i;
    for (i = 0; i < w * h; i++) { hist[gm.gray[i]]++; ink[i] = gm.gray[i]; }
    var th = thFix || Math.min(200, Math.max(90, otsu(hist, w * h))); for (i = 0; i < w * h; i++) ink[i] = ink[i] < th ? 1 : 0; return { w: w, h: h, ink: ink, S0: S0 };
  }
  function colExtent(m, box, x0f, x1f, mode) {                             // median over the columns of a strip: the height of the ink (mode 'ext') or where it starts (mode 'top')
    var bx0 = Math.round(box.x0 * m.S0), bx1 = Math.round(box.x1 * m.S0), by0 = Math.round(box.y0 * m.S0), by1 = Math.round(box.y1 * m.S0), W = bx1 - bx0, vals = [], x, y;
    for (x = bx0 + Math.round(W * x0f); x < bx0 + Math.round(W * x1f); x++) { var a = -1, z = -1; for (y = by0; y < by1; y++) if (m.ink[y * m.w + x]) { if (a < 0) a = y; z = y; } if (a >= 0) vals.push(mode === 'top' ? a - by0 : z - a); }
    if (!vals.length) return null; vals.sort(function (p, q) { return p - q; }); return vals[Math.floor(vals.length / 2)] / Math.max(1, by1 - by0);
  }
  function turnScore(img) {
    var m = inkOf(img, 1000), v = findViews(img, { fast: true }), roles = guessRoles(v.boxes, img), out = { wide: 0, order: 0, taper: 0, house: 0 }, pj = roles.indexOf('profile'), lj = roles.indexOf('tank'); if (lj < 0) lj = roles.indexOf('deck');
    v.boxes.forEach(function (q) { var bw = q.x1 - q.x0, bh = q.y1 - q.y0; if (bw / bh > 2.5) out.wide += bw * bh; }); out.wide /= img.width * img.height;
    if (pj >= 0 && lj >= 0) out.order = v.boxes[pj].y0 < v.boxes[lj].y0 ? 1 : -1;
    if (lj >= 0) { var l = colExtent(m, v.boxes[lj], 0.02, 0.10, 'ext'), r = colExtent(m, v.boxes[lj], 0.90, 0.98, 'ext'); if (l != null && r != null) out.taper = Math.max(-1, Math.min(1, (l - r) / 0.25)); out.l = l; out.r = r; }
    if (pj >= 0) { var tl = colExtent(m, v.boxes[pj], 0.05, 0.20, 'top'), tr = colExtent(m, v.boxes[pj], 0.80, 0.95, 'top'); if (tl != null && tr != null) out.house = Math.max(-1, Math.min(1, (tr - tl) / 0.25)); }
    out.score = out.house + out.order; return out;                          // the narrowing of the plan toward the bow was measured too, but labels and lines made it unreliable
  }
  function guessTurn(img) {                                                  // quarter turns clockwise (0..3) that bring the bow to the right and the profile on top
    var res = [], k, best = null;
    for (k = 0; k < 4; k++) { var sw = k % 2, W = sw ? img.height : img.width, H = sw ? img.width : img.height, c = document.createElement('canvas'); c.width = W; c.height = H; var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.translate(W / 2, H / 2); g.rotate(k * Math.PI / 2); g.drawImage(img, -img.width / 2, -img.height / 2); var t = turnScore(c); t.k = k; res.push(t); }
    var axis = (res[0].wide + res[2].wide) >= (res[1].wide + res[3].wide) ? [0, 2] : [1, 3], maxw = Math.max(res[0].wide, res[1].wide, res[2].wide, res[3].wide);
    if (maxw < 0.05) return { k: 0, sure: false, res: res };                 // no long views found: leave it
    var a = res[axis[0]], b2 = res[axis[1]]; best = a.score >= b2.score ? a : b2;
    if (axis[0] === 1 && !(res[3].score - res[1].score >= 3)) best = res[1];   // a portrait sheet with long views along its height: sheets of this kind (magazine sheets) often have the bow up, which is a quarter turn clockwise
    return { k: best.k, sure: Math.abs(a.score - b2.score) >= 1.2, res: res };
  }

  // Scale and tanks from the picture: the hull outline of the plan gives the length and the breadth (and the centreline), the long lines of the profile
  // give the keel and the main deck, the lines that cross the whole breadth of the tank plan are the transverse bulkheads. All in the pixels of img.
  function runsOf(arr, thr, minLen) { var out = [], a = -1, i; for (i = 0; i <= arr.length; i++) { var on = i < arr.length && arr[i] >= thr; if (on && a < 0) a = i; if (!on && a >= 0) { if (i - a >= (minLen || 1)) out.push([a, i - 1]); a = -1; } } return out; }
  function measure(img, boxes, roles, thFix) {
    if (!thFix) {                                                          // faint lines may need a lighter threshold: keep the measure that finds more tank spans
      var a = measure(img, boxes, roles, -1), b2 = measure(img, boxes, roles, 212);
      if (!a) return b2; if (!b2) return a; return b2.spans.length > a.spans.length ? b2 : a;
    }
    var m = inkOf(img, 2400, thFix > 0 ? thFix : 0), S0 = m.S0, k = 1 / S0, pj = roles.indexOf('profile'), tj = roles.indexOf('tank'), dj = roles.indexOf('deck'); if (pj < 0 || (tj < 0 && dj < 0)) return null;
    function B(b) { return { x0: Math.round(b.x0 * S0), y0: Math.round(b.y0 * S0), x1: Math.round(b.x1 * S0), y1: Math.round(b.y1 * S0) }; }
    var w = m.w, x, y, i, mg = Math.round(0.012 * Math.max(m.w, m.h));
    function rowCount(b, yy) { var c = 0; for (var x2 = b.x0; x2 <= b.x1; x2++) c += m.ink[yy * w + x2]; return c; }
    function outline(b) {                                                  // top and bottom of a plan: the first and last rows crossed by a long line
      var W = b.x1 - b.x0, rows = [], yy, ylo = b.y0 - mg, yhi = b.y1 + mg;
      boxes.forEach(function (o0) { var o = B(o0); if (o.x0 >= b.x1 || o.x1 <= b.x0 || (o.x0 === b.x0 && o.y0 === b.y0 && o.x1 === b.x1)) return; if (o.y1 <= b.y0 + 2) ylo = Math.max(ylo, o.y1 + 1); if (o.y0 >= b.y1 - 2) yhi = Math.min(yhi, o.y0 - 1); });   // do not look into the neighbouring view
      ylo = Math.min(ylo, b.y0); yhi = Math.max(yhi, b.y1);
      for (yy = ylo; yy <= yhi; yy++) rows.push(rowCount(b, yy));
      var lr = runsOf(rows, 0.45 * W, 1); if (!lr.length) return null; var top = ylo + lr[0][0], bot = ylo + lr[lr.length - 1][1]; if (bot - top < 0.05 * W) return null;
      return { top: top, bot: bot, yc: (top + bot) / 2, beam: bot - top };
    }
    function ends(b, o) {                                                  // stern and bow: the cluster of columns with ink (away from the centreline) around the middle of the plan
      var cols = [], xx, yy; for (xx = 0; xx < w; xx++) { var c0 = 0; for (yy = o.top; yy <= o.bot; yy++) if (Math.abs(yy - o.yc) > 0.03 * o.beam) c0 += m.ink[yy * w + xx]; cols.push(c0); }
      var cr = runsOf(cols, 2, 3), cl = [], mid = (b.x0 + b.x1) / 2, gapMax = 0.03 * (b.x1 - b.x0); cr.forEach(function (r) { if (cl.length && r[0] - cl[cl.length - 1][1] <= gapMax) cl[cl.length - 1][1] = r[1]; else cl.push([r[0], r[1]]); });
      var hit = cl.filter(function (r) { return r[0] <= mid && r[1] >= mid; })[0]; return hit ? [hit[0], hit[1]] : null;
    }
    var pb = B(boxes[pj]), db = dj >= 0 ? B(boxes[dj]) : null, tb = tj >= 0 ? B(boxes[tj]) : null;
    var od = db ? outline(db) : null, ot = tb ? outline(tb) : null, hb = od ? db : tb, ho = od || ot; if (!ho) return null;
    var e = ends(hb, ho); if (!e) return null; var xa = e[0], xb = e[1], L = xb - xa;
    var pr = [], c1; for (y = pb.y0 - mg; y <= pb.y1 + mg; y++) { c1 = 0; for (x = xa; x <= xb; x++) c1 += m.ink[y * w + x]; pr.push(c1); }
    var hr = runsOf(pr, 0.8 * L, 1), base = null, deck = null; if (hr.length) { base = pb.y0 - mg + hr[hr.length - 1][1]; deck = pb.y0 - mg + hr[0][0]; if (base - deck < 0.04 * L) deck = null; }
    var spans = [], bk = [];
    if (tb && ot) {                                                        // transverse bulkheads of the tank plan: columns crossed by most of its breadth
      var bcol = [], cc, yy; for (x = xa; x <= xb; x++) { cc = 0; for (yy = ot.top + 2; yy <= ot.bot - 2; yy++) cc += m.ink[yy * w + x]; bcol.push(cc / Math.max(1, ot.beam - 4)); }
      runsOf(bcol, 0.62, 1).map(function (r) { return xa + (r[0] + r[1]) / 2; }).forEach(function (v) { if (!bk.length || v - bk[bk.length - 1] > 0.01 * L) bk.push(v); });
      for (i = 1; i < bk.length; i++) spans.push([bk[i - 1], bk[i]]);
      var len = spans.map(function (q) { return q[1] - q[0]; }).sort(function (p, q) { return p - q; }), med = len.length ? len[Math.floor(len.length / 2)] : 0;
      spans = spans.filter(function (q) { return Math.abs((q[1] - q[0]) - med) <= 0.06 * med; });
    }
    return { xA: xa * k, xB: xb * k, beam: ho.beam * k, ycDeck: od ? od.yc * k : null, ycTank: ot ? ot.yc * k : null, baseY: base == null ? null : base * k, deckY: deck == null ? null : deck * k, spans: spans.map(function (q) { return [q[0] * k, q[1] * k]; }) };
  }
  /* cells in an area the user selected: the long straight lines across it (bulkheads) cut it into cells; a long line along its middle (the centreline) splits them in two.
     img: canvas or image, box: {x0,y0,x1,y1} in its pixels. Returns the lines and cells in the same pixels. */
  function bridged(get, n, gap) {                                         // longest run along a line of pixels, bridging gaps of up to gap pixels; {len, a, b}
    var best = { len: 0, a: 0, b: 0 }, a = -1, last = -1, ink = 0, i;
    for (i = 0; i <= n; i++) {
      var on = i < n && get(i);
      if (on) { if (a < 0) { a = i; ink = 0; } last = i; ink++; }
      if (a >= 0 && (i === n || (!on && i - last > gap))) { var L = last - a + 1; if (L > best.len && ink >= 0.6 * L) best = { len: L, a: a, b: last }; a = -1; }
    }
    return best;
  }
  function findCells(img, box, opt) {
    opt = opt || {};
    var x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0)), x1 = Math.min(img.width, Math.ceil(box.x1)), y1 = Math.min(img.height, Math.ceil(box.y1)), w = x1 - x0, h = y1 - y0;
    if (w < 20 || h < 20) return { lines: [], cells: [], split: null };
    var c = document.createElement('canvas'); c.width = w; c.height = h; var g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, x0, y0, w, h, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h), hist = new Array(256).fill(0), i, x, y;
    for (i = 0; i < w * h; i++) { var v = (d[4 * i] * 77 + d[4 * i + 1] * 150 + d[4 * i + 2] * 29) >> 8; gray[i] = v; hist[v]++; }
    var th = opt.th || Math.min(215, Math.max(100, otsu(hist, w * h) + 25)), ink = new Uint8Array(w * h);
    for (i = 0; i < w * h; i++) ink[i] = gray[i] < th ? 1 : 0;
    var ink2 = new Uint8Array(w * h);                                       // one pixel wider each side, so that a slightly crooked line stays one line
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) ink2[y * w + x] = ink[y * w + x] | (x > 0 ? ink[y * w + x - 1] : 0) | (x < w - 1 ? ink[y * w + x + 1] : 0);
    var gapV = Math.max(3, Math.round(0.035 * h)), cols = new Array(w);
    for (x = 0; x < w; x++) cols[x] = bridged(function (j) { return ink2[j * w + x]; }, h, gapV);
    var lines = [], frac;
    var fr = opt.fracs || [0.6, 0.45, 0.33];
    for (var fi = 0; fi < fr.length; fi++) {
      frac = fr[fi]; lines = []; var cur = null;
      for (x = 0; x <= w; x++) {
        var ok = x < w && cols[x].len >= frac * h;
        if (ok) { if (!cur) cur = { xa: x, xb: x, s: 0, sw: 0, a: [], b: [] }; cur.xb = x; cur.s += x * cols[x].len; cur.sw += cols[x].len; cur.a.push(cols[x].a); cur.b.push(cols[x].b); }
        else if (cur && x - cur.xb > 2) { cur.x = cur.s / cur.sw; cur.a.sort(function (p, q) { return p - q; }); cur.b.sort(function (p, q) { return p - q; }); cur.y0 = cur.a[cur.a.length >> 1]; cur.y1 = cur.b[cur.b.length >> 1]; lines.push(cur); cur = null; }
      }
      lines = lines.filter(function (L) { return L.xb - L.xa <= Math.max(14, 0.04 * w); });          // a thick bar is a block of ink, not a line
      if (lines.length >= 3) break;
    }
    var minW = Math.max(6, 0.025 * w), cells = [], k;
    for (k = 0; k + 1 < lines.length; k++) {
      var A = lines[k], B = lines[k + 1];
      if (B.x - A.x < minW) continue;
      var ya = Math.max(A.y0, B.y0), yb = Math.min(A.y1, B.y1); if (yb - ya < 0.3 * h) { ya = Math.min(A.y0, B.y0); yb = Math.max(A.y1, B.y1); }
      cells.push({ x0: A.x, x1: B.x, y0: ya, y1: yb });
    }
    var split = null;
    if (cells.length) {                                                     // the centreline: a long line along, in the middle of the cells
      var cx0 = Math.round(cells[0].x0), cx1 = Math.round(cells[cells.length - 1].x1), ya0 = Math.min.apply(null, cells.map(function (q) { return q.y0; })), yb0 = Math.max.apply(null, cells.map(function (q) { return q.y1; })), gapH = Math.max(4, Math.round(0.02 * (cx1 - cx0))), best = null;
      for (y = Math.round(ya0 + 0.3 * (yb0 - ya0)); y <= Math.round(ya0 + 0.7 * (yb0 - ya0)); y++) {
        var r = bridged(function (j) { var xx = cx0 + j; return ink[y * w + xx] || (y > 0 && ink[(y - 1) * w + xx]) || (y < h - 1 && ink[(y + 1) * w + xx]); }, cx1 - cx0, gapH);
        if (r.len >= 0.7 * (cx1 - cx0) && (!best || r.len > best.len)) best = { y: y, len: r.len };
      }
      if (best) split = best.y;
    }
    return { lines: lines.map(function (L) { return { x: x0 + L.x, y0: y0 + L.y0, y1: y0 + L.y1 }; }), cells: cells.map(function (q) { return { x0: x0 + q.x0, x1: x0 + q.x1, y0: y0 + q.y0, y1: y0 + q.y1 }; }), split: split == null ? null : y0 + split, th: th };
  }
  window.GAVIS = { viewScore: viewScore, findCells: findCells, findViews1: findViews1, _metrics: function (img, boxes) { var m = inkOf(img, 1000, 212); return boxes.map(function (b) { return { sym: +symmetry(m, b).toFixed(2), str: straightRows(m, b), asp: +((b.x1 - b.x0) / (b.y1 - b.y0)).toFixed(1) }; }); }, dbg: function (v) { opt_dbg = v; }, measure: measure,  guessTurn: guessTurn, turnScore: turnScore,  findViews: findViews, guessRoles: guessRoles };
})();
