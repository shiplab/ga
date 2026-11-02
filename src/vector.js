/* Vector drawings other than PDF: DXF (ASCII) and SVG. They give the same lines as a PDF would: [x1, y1, x2, y2, width], y down. */
(function () {
  function finish(segs, texts) {
    if (!segs.length) throw new Error('No lines were found in this file.');
    var x0 = 1e30, y0 = 1e30, x1 = -1e30, y1 = -1e30, i, s;
    for (i = 0; i < segs.length; i++) { s = segs[i]; x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]); }
    var k = 842 / Math.max(x1 - x0, y1 - y0, 1e-9), m = 20, out = new Array(segs.length);
    for (i = 0; i < segs.length; i++) { s = segs[i]; out[i] = [(s[0] - x0) * k + m, (s[1] - y0) * k + m, (s[2] - x0) * k + m, (s[3] - y0) * k + m, 0.6]; }
    return { segs: out, W: (x1 - x0) * k + 2 * m, H: (y1 - y0) * k + 2 * m, texts: texts, k: k };
  }
  /* ---- DXF ---- */
  function pairs(text) { var L = text.split(/\r?\n/), P = [], i; for (i = 0; i + 1 < L.length; i += 2) P.push([parseInt(L[i], 10), L[i + 1].trim(), L[i + 1]]); return P; }
  function arcPts(cx, cy, r, a0, a1, out) { while (a1 <= a0) a1 += 2 * Math.PI; var n = Math.max(6, Math.ceil((a1 - a0) / (Math.PI / 18))), i; for (i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } }
  function bulgePts(p, q, b, out) {                                       // arc from p to q with bulge b (tan of a quarter of the angle)
    var dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy); if (!b || d < 1e-12) { out.push(q); return; }
    var th = 4 * Math.atan(b), sag = Math.abs(b) * d / 2, r = (d * d / 4 + sag * sag) / (2 * sag), off = (r - sag) * (b > 0 ? 1 : -1), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    var cx = mx - dy / d * off, cy = my + dx / d * off;
    var a0 = Math.atan2(p[1] - cy, p[0] - cx), n = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 18))), i;
    for (i = 1; i <= n; i++) { var a = a0 + th * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    out[out.length - 1] = q;
  }
  function parseDXF(text) {
    if (/^AutoCAD Binary DXF/.test(text)) throw new Error('This is a binary DXF. Save it as ASCII DXF, or export a PDF.');
    var P = pairs(text), i = 0, sect = '', blocks = {}, ents = [], cur = null, curBlock = null, texts = [], inPoly = null;
    function push(e) { if (curBlock) curBlock.ents.push(e); else if (sect === 'ENTITIES') ents.push(e); }
    for (i = 0; i < P.length; i++) {
      var c = P[i][0], v = P[i][1];
      if (c === 0) {
        if (cur && cur.t !== 'VERTEX') { if (cur.t === 'POLYLINE') inPoly = cur; push(cur); }
        else if (cur && cur.t === 'VERTEX' && inPoly) inPoly.v.push({ x: cur.x, y: cur.y, b: cur.b || 0 });
        cur = null;
        if (v === 'SECTION') { continue; } if (v === 'ENDSEC') { sect = ''; curBlock = null; continue; }
        if (v === 'BLOCK') { curBlock = { name: '', bx: 0, by: 0, ents: [] }; continue; } if (v === 'ENDBLK') { if (curBlock && curBlock.name) blocks[curBlock.name] = curBlock; curBlock = null; continue; }
        if (v === 'SEQEND') { inPoly = null; continue; }
        cur = { t: v, v: [], x: 0, y: 0, x2: 0, y2: 0, r: 0, a0: 0, a1: 360, sx: 1, sy: 1, rot: 0, flag: 0, s: '', ratio: 1, p0: 0, p1: 2 * Math.PI };
        if (v === 'BLOCK') cur = null; continue;
      }
      if (c === 2 && !cur && !curBlock && sect === '' ) { sect = v; continue; }
      if (c === 2 && !cur && curBlock) { curBlock.name = v; continue; }
      if (curBlock && !cur) { if (c === 10) curBlock.bx = +v; if (c === 20) curBlock.by = +v; continue; }
      if (!cur) continue;
      var n = +v;
      if (cur.t === 'LWPOLYLINE') { if (c === 10) cur.v.push({ x: n, y: 0, b: 0 }); else if (c === 20 && cur.v.length) cur.v[cur.v.length - 1].y = n; else if (c === 42 && cur.v.length) cur.v[cur.v.length - 1].b = n; else if (c === 70) cur.flag = n; continue; }
      if (cur.t === 'SPLINE') { if (c === 10) cur.v.push({ x: n, y: 0, b: 0 }); else if (c === 20 && cur.v.length) cur.v[cur.v.length - 1].y = n; else if (c === 70) cur.flag = n; continue; }
      if (c === 10) cur.x = n; else if (c === 20) cur.y = n; else if (c === 11) cur.x2 = n; else if (c === 21) cur.y2 = n; else if (c === 40) cur.r = n; else if (c === 50) { cur.a0 = n; cur.rot = n; } else if (c === 51) cur.a1 = n;
      else if (c === 41) { cur.sx = n; cur.p0 = n; } else if (c === 42) { cur.sy = n; cur.p1 = n; cur.b = n; } else if (c === 70) cur.flag = n; else if (c === 2) cur.name = v; else if (c === 1 || c === 3) cur.s = (c === 3 ? P[i][2] : '') + (c === 1 ? cur.s + P[i][2] : cur.s);
      if (cur.t === 'ELLIPSE' && c === 40) cur.ratio = n;
    }
    if (cur) { if (cur.t === 'VERTEX' && inPoly) inPoly.v.push({ x: cur.x, y: cur.y, b: cur.b || 0 }); else push(cur); }
    var segs = [];
    function line(a, b) { segs.push([a[0], a[1], b[0], b[1]]); }
    function poly(pts, closed) { for (var j = 1; j < pts.length; j++) line(pts[j - 1], pts[j]); if (closed && pts.length > 2) line(pts[pts.length - 1], pts[0]); }
    function emit(list, T, depth) {
      list.forEach(function (e) {
        var pts = [], j;
        function tp(x, y) { return T(x, y); }
        if (e.t === 'LINE') line(tp(e.x, e.y), tp(e.x2, e.y2));
        else if (e.t === 'LWPOLYLINE' || e.t === 'POLYLINE') { var vs = e.v, cl = e.flag & 1; if (!vs.length) return; pts = [tp(vs[0].x, vs[0].y)]; var raw = [[vs[0].x, vs[0].y]]; for (j = 1; j <= (cl ? vs.length : vs.length - 1); j++) { var a = vs[j - 1], b2 = vs[j % vs.length], seg = []; bulgePts([a.x, a.y], [b2.x, b2.y], a.b, seg); seg.forEach(function (q) { pts.push(tp(q[0], q[1])); }); } poly(pts, false); }
        else if (e.t === 'SPLINE') { poly(e.v.map(function (q) { return tp(q.x, q.y); }), e.flag & 1); }
        else if (e.t === 'ARC') { var o = []; arcPts(e.x, e.y, e.r, e.a0 * Math.PI / 180, e.a1 * Math.PI / 180, o); poly(o.map(function (q) { return tp(q[0], q[1]); }), false); }
        else if (e.t === 'CIRCLE') { var o2 = []; arcPts(e.x, e.y, e.r, 0, 2 * Math.PI - 1e-6, o2); poly(o2.map(function (q) { return tp(q[0], q[1]); }), true); }
        else if (e.t === 'ELLIPSE') { var mj = Math.hypot(e.x2, e.y2), ang = Math.atan2(e.y2, e.x2), o3 = [], t1 = e.p1 > e.p0 ? e.p1 : e.p0 + 2 * Math.PI, nn = 48; for (j = 0; j <= nn; j++) { var tt = e.p0 + (t1 - e.p0) * j / nn, ex = mj * Math.cos(tt), ey = mj * e.ratio * Math.sin(tt); o3.push(tp(e.x + ex * Math.cos(ang) - ey * Math.sin(ang), e.y + ex * Math.sin(ang) + ey * Math.cos(ang))); } poly(o3, false); }
        else if (e.t === 'INSERT' && depth < 5 && blocks[e.name]) {
          var B = blocks[e.name], ca = Math.cos(e.rot * Math.PI / 180), sa = Math.sin(e.rot * Math.PI / 180), sx = e.sx || 1, sy = e.sy || 1;
          emit(B.ents, function (x, y) { var lx = (x - B.bx) * sx, ly = (y - B.by) * sy; return T(e.x + lx * ca - ly * sa, e.y + lx * sa + ly * ca); }, depth + 1);
        } else if (e.t === 'TEXT' || e.t === 'MTEXT' || e.t === 'ATTRIB') { var s = e.s.replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '').replace(/%%[cC]/g, 'dia ').trim(); if (s) texts.push(s); }
      });
    }
    emit(ents, function (x, y) { return [x, -y]; }, 0);                   // DXF y is up, the page y is down
    return finish(segs, texts);
  }
  /* ---- SVG ---- */
  function parseSVG(text) {
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('This file could not be read as SVG.');
    var host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1000px;height:1000px;visibility:hidden'; document.body.appendChild(host);
    var svg = document.importNode(root, true); svg.setAttribute('width', '1000'); svg.setAttribute('height', '1000'); host.appendChild(svg);
    try {
      var segs = [], texts = [], inv = svg.getScreenCTM().inverse(), els = svg.querySelectorAll('line,polyline,polygon,rect,path,circle,ellipse'), cap = 600000;
      Array.prototype.forEach.call(els, function (el) {
        if (segs.length > cap || el.closest('defs,clipPath,mask,symbol,pattern,marker')) return;
        var M = inv.multiply(el.getScreenCTM()), len, d = el.nodeName === 'path' ? el.getAttribute('d') || '' : '';
        function T(x, y) { return [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f]; }
        if (d && /^[\sMmLlHhVvZz\d.,eE+-]*$/.test(d)) {                  // straight segments only: read them exactly (many subpaths per path are common)
          var tk = d.match(/[MmLlHhVvZz]|-?\d*\.?\d+(?:[eE][+-]?\d+)?/g) || [], i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, first = true;
          function num() { return parseFloat(tk[i++]); }
          while (i < tk.length) {
            if (/[A-Za-z]/.test(tk[i])) { cmd = tk[i++]; if (cmd === 'Z' || cmd === 'z') { if (!first && (cx !== sx || cy !== sy)) { var a0 = T(cx, cy), b0 = T(sx, sy); segs.push([a0[0], a0[1], b0[0], b0[1]]); } cx = sx; cy = sy; continue; } }
            var rel = cmd === cmd.toLowerCase(), ox = cx, oy = cy, nx, ny;
            if (cmd === 'H' || cmd === 'h') { nx = num() + (rel ? cx : 0); ny = cy; } else if (cmd === 'V' || cmd === 'v') { nx = cx; ny = num() + (rel ? cy : 0); } else { nx = num() + (rel ? cx : 0); ny = num() + (rel ? cy : 0); }
            if (cmd === 'M' || cmd === 'm') { cx = nx; cy = ny; sx = nx; sy = ny; cmd = rel ? 'l' : 'L'; first = false; continue; }
            var a1 = T(ox, oy), b1 = T(nx, ny); segs.push([a1[0], a1[1], b1[0], b1[1]]); cx = nx; cy = ny;
          }
          return;
        }
        if (el.nodeName === 'line') { var l1 = T(+el.getAttribute('x1') || 0, +el.getAttribute('y1') || 0), l2 = T(+el.getAttribute('x2') || 0, +el.getAttribute('y2') || 0); segs.push([l1[0], l1[1], l2[0], l2[1]]); return; }
        if (el.nodeName === 'polyline' || el.nodeName === 'polygon' || el.nodeName === 'rect') {
          var pts = [];
          if (el.nodeName === 'rect') { var rx = +el.getAttribute('x') || 0, ry = +el.getAttribute('y') || 0, rw = +el.getAttribute('width') || 0, rh = +el.getAttribute('height') || 0; if (!el.getAttribute('rx') && !el.getAttribute('ry')) pts = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh], [rx, ry]]; }
          else { var nn = (el.getAttribute('points') || '').match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g) || [], m2; for (m2 = 0; m2 + 1 < nn.length; m2 += 2) pts.push([+nn[m2], +nn[m2 + 1]]); if (el.nodeName === 'polygon' && pts.length) pts.push(pts[0]); }
          if (pts.length > 1) { for (var m3 = 1; m3 < pts.length; m3++) { var u1 = T(pts[m3 - 1][0], pts[m3 - 1][1]), u2 = T(pts[m3][0], pts[m3][1]); segs.push([u1[0], u1[1], u2[0], u2[1]]); } return; }
        }
        try { len = el.getTotalLength(); } catch (e) { return; } if (!isFinite(len) || len <= 0) return;
        var n = Math.min(3000, Math.max(1, Math.ceil(len / 2))), prev = null, j;
        for (j = 0; j <= n; j++) { var q = el.getPointAtLength(len * j / n), p2 = T(q.x, q.y); if (prev && Math.hypot(q.x - prev[2], q.y - prev[3]) <= 2.5 * len / n + 1e-6) segs.push([prev[0], prev[1], p2[0], p2[1]]); prev = [p2[0], p2[1], q.x, q.y]; }
      });
      Array.prototype.forEach.call(svg.querySelectorAll('text'), function (t) { var s = (t.textContent || '').replace(/\s+/g, ' ').trim(); if (s) texts.push(s); });
      return finish(segs, texts);
    } finally { host.remove(); }
  }
  window.GAVEC = { parseDXF: parseDXF, parseSVG: parseSVG };
})();
