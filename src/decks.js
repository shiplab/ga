/* Passenger ships: a general arrangement made of stacked deck plans (one hull outline per deck, rooms and cabins coloured by class).
   Plain image analysis on this computer: the hull outlines are the big connected dark lines, the colours inside them are grouped into classes,
   and each class gives boxes (cabin rows, rooms). Pixels of the image given. */
(function () {
  function read(img, opt) {
    opt = opt || {};
    var S0 = Math.min(1, 1600 / Math.max(img.width, img.height)), w = Math.round(img.width * S0), h = Math.round(img.height * S0), c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data, N = w * h, dark = new Uint8Array(N), chroma = new Uint8Array(N), i, k;
    for (i = 0; i < N; i++) { var r = d[4 * i], gg = d[4 * i + 1], b = d[4 * i + 2], gray = (r * 77 + gg * 150 + b * 29) >> 8, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); dark[i] = gray < 150 ? 1 : 0; chroma[i] = mx - mn; }
    // connected dark components (8 neighbours): the hull outlines are the wide, flat ones
    var lab = new Int32Array(N), comps = [], stack = new Int32Array(N), nl = 0;
    for (i = 0; i < N; i++) {
      if (!dark[i] || lab[i]) continue; nl++; var sp = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, cnt = 0; stack[sp++] = i; lab[i] = nl;
      while (sp) { var p = stack[--sp], px = p % w, py = (p - px) / w; cnt++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue; var q = qy * w + qx; if (dark[q] && !lab[q]) { lab[q] = nl; stack[sp++] = q; } } }
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1; if (bw >= 0.22 * w && bw / bh >= 2.6 && bw / bh <= 14 && cnt > 0.5 * bw) comps.push({ id: nl, x0: x0, y0: y0, x1: x1, y1: y1, cnt: cnt });
    }
    comps = comps.filter(function (q) { return !comps.some(function (o) { return o !== q && q.x0 >= o.x0 - 2 && q.x1 <= o.x1 + 2 && q.y0 >= o.y0 - 2 && q.y1 <= o.y1 + 2; }); });     // an outlined strip inside a hull is a room, not a deck
    comps.sort(function (a, b) { return a.y0 - b.y0; });
    var decks = comps.map(function (q) {
      var st = [], n = 48, j;                                              // the outline: for 48 stations along the length, the top and bottom of the hull line
      for (j = 0; j <= n; j++) { var x = Math.round(q.x0 + (q.x1 - q.x0) * j / n), top = -1, bot = -1, y; for (y = q.y0; y <= q.y1; y++) if (lab[y * w + Math.min(w - 1, x)] === q.id) { if (top < 0) top = y; bot = y; } st.push({ x: x / S0, top: top < 0 ? null : top / S0, bot: bot < 0 ? null : bot / S0 }); }
      return { id: q.id, hull: { x0: q.x0 / S0, y0: q.y0 / S0, x1: (q.x1 + 1) / S0, y1: (q.y1 + 1) / S0 }, stations: st };
    });
    var out = { S0: S0, decks: decks, palette: [], zones: [], legend: [] };
    if (!decks.length) return out;
    function inHull(x, y, pad) { for (var j = 0; j < comps.length; j++) { var q = comps[j]; if (x >= q.x0 - pad && x <= q.x1 + pad && y >= q.y0 - pad && y <= q.y1 + pad) return j; } return -1; }
    // colours inside the hulls: group them into classes
    var bins = {}, tot = 0, CH = opt.chroma || 22;
    comps.forEach(function (q) { for (var y = q.y0; y <= q.y1; y++) for (var x = q.x0; x <= q.x1; x++) { var p = y * w + x; if (dark[p] || chroma[p] < CH) continue; var key = (d[4 * p] >> 4) + ',' + (d[4 * p + 1] >> 4) + ',' + (d[4 * p + 2] >> 4), o = bins[key] || (bins[key] = { r: 0, g: 0, b: 0, n: 0 }); o.r += d[4 * p]; o.g += d[4 * p + 1]; o.b += d[4 * p + 2]; o.n++; tot++; } });
    var list = Object.keys(bins).map(function (kk) { var o = bins[kk]; return { c: [o.r / o.n, o.g / o.n, o.b / o.n], n: o.n }; }).sort(function (a, b) { return b.n - a.n; });
    function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
    var pal = [];
    list.forEach(function (e) { if (e.n < 0.004 * tot) return; var near = pal.filter(function (p) { return dist(p.c, e.c) < (opt.merge || 34); })[0]; if (near) { near.c = [(near.c[0] * near.n + e.c[0] * e.n) / (near.n + e.n), (near.c[1] * near.n + e.c[1] * e.n) / (near.n + e.n), (near.c[2] * near.n + e.c[2] * e.n) / (near.n + e.n)]; near.n += e.n; } else if (pal.length < 12) pal.push({ c: e.c.slice(), n: e.n }); });
    pal = pal.filter(function (p) { return p.n >= 0.01 * tot; });
    out.palette = pal.map(function (p, j) { return { id: j, rgb: p.c.map(Math.round), n: p.n }; });
    // legend squares: small solid coloured squares outside every hull
    var seen = new Uint8Array(N);
    for (i = 0; i < N; i++) {
      if (seen[i] || dark[i] || chroma[i] < CH) continue; var x = i % w, y = (i - x) / w; if (inHull(x, y, 2) >= 0) continue;
      var sp2 = 0, a0 = w, b0 = h, a1 = 0, b1 = 0, cn = 0, sr = 0, sg = 0, sb = 0; stack[sp2++] = i; seen[i] = 1;
      while (sp2) { var p2 = stack[--sp2], qx2 = p2 % w, qy2 = (p2 - qx2) / w; cn++; sr += d[4 * p2]; sg += d[4 * p2 + 1]; sb += d[4 * p2 + 2]; if (qx2 < a0) a0 = qx2; if (qx2 > a1) a1 = qx2; if (qy2 < b0) b0 = qy2; if (qy2 > b1) b1 = qy2;
        for (var e2 = 0; e2 < 4; e2++) { var nx = qx2 + (e2 === 0 ? 1 : e2 === 1 ? -1 : 0), ny = qy2 + (e2 === 2 ? 1 : e2 === 3 ? -1 : 0); if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; var q2 = ny * w + nx; if (!seen[q2] && !dark[q2] && chroma[q2] >= CH) { seen[q2] = 1; stack[sp2++] = q2; } } }
      var sw = a1 - a0 + 1, sh = b1 - b0 + 1; if (cn >= 25 && sw >= 5 && sh >= 5 && sw <= 0.06 * w && sw / sh > 0.5 && sw / sh < 2 && cn > 0.6 * sw * sh) out.legend.push({ x0: a0 / S0, y0: b0 / S0, x1: (a1 + 1) / S0, y1: (b1 + 1) / S0, rgb: [Math.round(sr / cn), Math.round(sg / cn), Math.round(sb / cn)] });
    }
    // every legend colour is a class, even a small one
    out.legend.forEach(function (l) { var near = out.palette.filter(function (p) { return dist(p.rgb, l.rgb) < 40; })[0]; if (near) l.cls = near.id; else { var id = out.palette.length; out.palette.push({ id: id, rgb: l.rgb, n: 0 }); l.cls = id; } });
    // boxes: pixels of one class, smeared a little so that the numbers and the thin walls of the cabins do not cut them
    var rx = Math.max(2, Math.round(0.004 * w)), ry = Math.max(1, Math.round(0.0015 * w));
    decks.forEach(function (dk, di) {
      var q = comps[di], bw = q.x1 - q.x0 + 1, bh = q.y1 - q.y0 + 1, cls = new Int8Array(bw * bh).fill(-1), x, y, j;
      for (y = q.y0; y <= q.y1; y++) for (x = q.x0; x <= q.x1; x++) { var p = y * w + x; if (dark[p] || chroma[p] < CH) continue; var best = -1, bd = 46; for (j = 0; j < out.palette.length; j++) { var dd = dist([d[4 * p], d[4 * p + 1], d[4 * p + 2]], out.palette[j].rgb); if (dd < bd) { bd = dd; best = j; } } cls[(y - q.y0) * bw + (x - q.x0)] = best; }
      out.palette.forEach(function (pc, ci) {
        var m = new Uint8Array(bw * bh), any = 0, t; for (t = 0; t < m.length; t++) if (cls[t] === ci) { m[t] = 1; any++; } if (any < 40) return;
        var sm = new Uint8Array(bw * bh), yy, xx; for (yy = 0; yy < bh; yy++) { var run = 0, last = -1e9; for (xx = 0; xx < bw; xx++) { if (m[yy * bw + xx]) { if (xx - last <= rx + 1) for (var f = Math.max(0, last + 1); f <= xx; f++) sm[yy * bw + f] = 1; last = xx; sm[yy * bw + xx] = 1; } } }
        var sm2 = new Uint8Array(bw * bh); for (xx = 0; xx < bw; xx++) { var last2 = -1e9; for (yy = 0; yy < bh; yy++) { if (sm[yy * bw + xx]) { if (yy - last2 <= ry + 1) for (var f2 = Math.max(0, last2 + 1); f2 <= yy; f2++) sm2[f2 * bw + xx] = 1; last2 = yy; sm2[yy * bw + xx] = 1; } } }
        var lb = new Int32Array(bw * bh), nn = 0, st2 = new Int32Array(bw * bh), s;
        for (s = 0; s < sm2.length; s++) {
          if (!sm2[s] || lb[s]) continue; nn++; var sp3 = 0, a0 = bw, b0 = bh, a1 = 0, b1 = 0, area = 0, real = 0; st2[sp3++] = s; lb[s] = nn;
          while (sp3) { var p3 = st2[--sp3], cx = p3 % bw, cy = (p3 - cx) / bw; area++; if (m[p3]) real++; if (cx < a0) a0 = cx; if (cx > a1) a1 = cx; if (cy < b0) b0 = cy; if (cy > b1) b1 = cy;
            for (var e3 = 0; e3 < 4; e3++) { var nx3 = cx + (e3 === 0 ? 1 : e3 === 1 ? -1 : 0), ny3 = cy + (e3 === 2 ? 1 : e3 === 3 ? -1 : 0); if (nx3 < 0 || ny3 < 0 || nx3 >= bw || ny3 >= bh) continue; var q3 = ny3 * bw + nx3; if (sm2[q3] && !lb[q3]) { lb[q3] = nn; st2[sp3++] = q3; } } }
          if (real < 0.0035 * bw * bh || a1 - a0 < 5 || b1 - b0 < 4) continue;
          out.zones.push({ deck: di, cls: ci, x0: (q.x0 + a0) / S0, y0: (q.y0 + b0) / S0, x1: (q.x0 + a1 + 1) / S0, y1: (q.y0 + b1 + 1) / S0, fill: real / ((a1 - a0 + 1) * (b1 - b0 + 1)) });
        }
      });
    });
    return out;
  }
  window.GADECK = { read: read };
})();
