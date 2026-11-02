/* Compartments from the lines of a vector GA: every enclosed area of every view (plans, profile) becomes a block.
   1) the stroked paths of the PDF (curves followed, dashed lines marked), turned like the sheet;
   2) the views: clusters of lines, each with its title (PROFILE, MAIN DECK, TANK TOP, SUN DECK ...);
   3) per view: the solid lines are drawn, door openings closed, and the white areas they enclose are the compartments;
   4) metres: x from the aft end, y to port (plans), z up (profile), from the scale bar of the sheet or the length;
      each plan gets its deck height (page 1, the order of the plans, the titles); the labels inside name the compartments.
   Everything runs on this computer. Window global: GAROOMS. */
(function () {
  'use strict';
  /* ---------- 1. stroked paths ---------- */
  function polysFromOps(ops, OPS, transform) {
    var out = [], ctm = transform.slice(), stack = [], lw = 1, dash = false, pend = [], i, k;
    var STROKE = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke];
    var DROP = [OPS.fill, OPS.eoFill, OPS.endPath, OPS.clip, OPS.eoClip];
    function mul(m, n) { return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]; }
    function ap(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
    function bez(p0, p1, p2, p3, out2) { for (var t = 1; t <= 8; t++) { var u = t / 8, a = (1 - u) * (1 - u) * (1 - u), b = 3 * (1 - u) * (1 - u) * u, c = 3 * (1 - u) * u * u, d = u * u * u; out2.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]); } }
    for (i = 0; i < ops.fnArray.length; i++) {
      var fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn === OPS.save) stack.push([ctm.slice(), lw, dash]);
      else if (fn === OPS.restore) { var t = stack.pop(); if (t) { ctm = t[0]; lw = t[1]; dash = t[2]; } }
      else if (fn === OPS.setLineWidth) lw = a[0];
      else if (fn === OPS.setDash) dash = !!(a && a[0] && a[0].length);
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (STROKE.indexOf(fn) >= 0) { var sc = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])); pend.forEach(function (p) { if (p.length > 1) out.push({ pts: p, lw: lw * sc, dash: dash }); }); pend = []; }
      else if (DROP.indexOf(fn) >= 0) pend = [];
      else if (fn === OPS.constructPath) {
        var cmds = a[0], c = a[1], cur = null, start = null, sub = null, p;
        k = 0;
        for (var j = 0; j < cmds.length; j++) {
          var cmd = cmds[j];
          if (cmd === OPS.moveTo) { cur = ap(ctm, c[k], c[k + 1]); start = cur; sub = [cur]; pend.push(sub); k += 2; }
          else if (cmd === OPS.lineTo) { p = ap(ctm, c[k], c[k + 1]); k += 2; if (!sub) { sub = [cur || p]; pend.push(sub); } sub.push(p); cur = p; }
          else if (cmd === OPS.curveTo) { var c1 = ap(ctm, c[k], c[k + 1]), c2 = ap(ctm, c[k + 2], c[k + 3]); p = ap(ctm, c[k + 4], c[k + 5]); k += 6; if (cur && sub) bez(cur, c1, c2, p, sub); cur = p; }
          else if (cmd === OPS.curveTo2) { var d2 = ap(ctm, c[k], c[k + 1]); p = ap(ctm, c[k + 2], c[k + 3]); k += 4; if (cur && sub) bez(cur, cur, d2, p, sub); cur = p; }
          else if (cmd === OPS.curveTo3) { var e1 = ap(ctm, c[k], c[k + 1]); p = ap(ctm, c[k + 2], c[k + 3]); k += 4; if (cur && sub) bez(cur, e1, p, p, sub); cur = p; }
          else if (cmd === OPS.rectangle) {
            var x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3]; k += 4;
            var r = [ap(ctm, x, y), ap(ctm, x + w, y), ap(ctm, x + w, y + h), ap(ctm, x, y + h)]; pend.push([r[0], r[1], r[2], r[3], r[0]]); sub = null; cur = r[0];
          } else if (cmd === OPS.closePath) { if (sub && start) sub.push(start); cur = start; }
        }
      }
    }
    return out;
  }
  function rotatePolys(polys, W, H, k) {                                // quarter turns clockwise, like G.rotateSegs
    k = ((k % 4) + 4) % 4; var w = W, h = H, out = polys;
    for (var n = 0; n < k; n++) { var hh = h; out = out.map(function (q) { return { pts: q.pts.map(function (p) { return [hh - p[1], p[0]]; }), lw: q.lw, dash: q.dash }; }); var t = w; w = h; h = t; }
    return { polys: out, W: w, H: h };
  }
  function bboxOf(pts) { var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach(function (p) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }); return { x0: x0, y0: y0, x1: x1, y1: y1 }; }

  /* ---------- 2. views and their titles ---------- */
  var TITLE = /PROFILE|ELEVATION|SECTION|DECK|TANK\s*TOP|PLAN|DOUBLE\s*BOTTOM|INNER\s*BOTTOM|FLAT|PLATFORM|HOLD/i;
  // each title goes to one view and each view takes one title, the closest pairs first; a title is usually under its view or beside it
  function pairTitles(big, titles, maxD) {
    var pairs = [];
    titles.forEach(function (t) {
      var cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2;
      big.forEach(function (b) {
        var dx = Math.max(b.x0 - cx, 0, cx - b.x1), dy;
        if (cy > b.y1) dy = cy - b.y1; else if (cy < b.y0) dy = 2 * (b.y0 - cy) + maxD * 0.375; else dy = dx > 0 ? 0 : 0.5 * (b.y1 - cy);
        var dd = Math.hypot(dx, dy); if (dd <= maxD) pairs.push({ d: dd, t: t, b: b });
      });
    });
    pairs.sort(function (p, q) { return p.d - q.d; }).forEach(function (p) { if (p.b.title || p.t.used) return; p.b.title = p.t.text.replace(/\s+/g, ' ').trim(); p.t.used = true; });
  }
  var TITLE_FULL = /^(.{0,24}\b(DECK|PROFILE|ELEVATION|SECTION|PLAN|FLAT|PLATFORM|HOLD)S?|TANK\s*TOP|DOUBLE\s*BOTTOM|INNER\s*BOTTOM)(\s*PLAN)?$/i;
  function titlesOf(texts) {                                         // the larger texts that name a view (labels inside the views are smaller); the whole text is a view name in capitals
    var caps = texts.filter(function (t) { return /^[A-Z0-9 \/().,&'-]+$/.test(t.text.trim()) && /[A-Z]{2}/.test(t.text); });
    var hs = (caps.length >= 5 ? caps : texts).map(function (t) { return Math.min(t.x1 - t.x0, t.y1 - t.y0); }).sort(function (a, b) { return a - b; }), med = hs[Math.floor(hs.length * 0.3)] || 5;     // the common size of the labels
    return texts.filter(function (t) { var s = t.text.trim(); return TITLE_FULL.test(s) && s === s.toUpperCase() && s.length < 30 && Math.min(t.x1 - t.x0, t.y1 - t.y0) >= 1.25 * med; });
  }
  function roleOf(title) { var tt = title.toUpperCase(); return /PROFILE|ELEVATION/.test(tt) ? 'profile' : /SECTION/.test(tt) ? 'section' : 'plan'; }
  function findViews(polys, texts, W, H) {
    var K = 1.5, w = Math.ceil(W * K), h = Math.ceil(H * K), c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#000'; g.lineWidth = 9; g.lineCap = 'round';   // thick: the lines of one view join
    polys.forEach(function (q) { var b = bboxOf(q.pts); if (b.x1 - b.x0 > 0.9 * W || b.y1 - b.y0 > 0.9 * H) return; g.beginPath(); q.pts.forEach(function (p, i) { if (i) g.lineTo(p[0] * K, p[1] * K); else g.moveTo(p[0] * K, p[1] * K); }); g.stroke(); });
    var d = g.getImageData(0, 0, w, h).data, lab = new Int32Array(w * h), comps = [], st = new Int32Array(w * h), i, n = 0;
    for (i = 0; i < w * h; i++) {
      if (d[4 * i] > 128 || lab[i]) continue; n++; var sp = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; st[sp++] = i; lab[i] = n;
      while (sp) { var p = st[--sp], px = p % w, py = (p - px) / w; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        if (px > 0 && !lab[p - 1] && d[4 * (p - 1)] <= 128) { lab[p - 1] = n; st[sp++] = p - 1; } if (px < w - 1 && !lab[p + 1] && d[4 * (p + 1)] <= 128) { lab[p + 1] = n; st[sp++] = p + 1; }
        if (py > 0 && !lab[p - w] && d[4 * (p - w)] <= 128) { lab[p - w] = n; st[sp++] = p - w; } if (py < h - 1 && !lab[p + w] && d[4 * (p + w)] <= 128) { lab[p + w] = n; st[sp++] = p + w; } }
      comps.push({ x0: x0 / K, y0: y0 / K, x1: x1 / K, y1: y1 / K });
    }
    var big = comps.filter(function (b) { return (b.x1 - b.x0) > 0.12 * W || (b.y1 - b.y0) > 0.12 * H; });
    big = big.filter(function (b) {                                   // tables (particulars, title block): words cover much of the box
      var a = 0; texts.forEach(function (t) { var cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2; if (cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1) a += (t.x1 - t.x0) * (t.y1 - t.y0); });
      return a / ((b.x1 - b.x0) * (b.y1 - b.y0)) < 0.08;
    });
    var titles = titlesOf(texts);
    var views = [];
    pairTitles(big, titles, 40);
    views.big = big.map(function (b) { return [Math.round(b.x0), Math.round(b.y0), Math.round(b.x1), Math.round(b.y1), b.title || '']; });
    big.forEach(function (b) { if (!b.title) return; var tt = b.title.toUpperCase(); views.push({ box: { x0: b.x0 - 1, y0: b.y0 - 1, x1: b.x1 + 1, y1: b.y1 + 1 }, title: b.title, role: /PROFILE|ELEVATION/.test(tt) ? 'profile' : /SECTION/.test(tt) ? 'section' : 'plan' }); });
    return views;
  }

  /* ---------- 3. the frame of a view (page points): aft and fore ends, centreline or baseline ---------- */
  function segsIn(polys, b, solid) {
    var out = [];
    polys.forEach(function (q) { if (solid && q.dash) return; for (var i = 1; i < q.pts.length; i++) { var a = q.pts[i - 1], c = q.pts[i]; if (a[0] < b.x0 || a[0] > b.x1 || c[0] < b.x0 || c[0] > b.x1 || a[1] < b.y0 || a[1] > b.y1 || c[1] < b.y0 || c[1] > b.y1) continue; out.push([a[0], a[1], c[0], c[1], q.dash]); } });
    return out;
  }
  function frameOf(v, polys) {
    var b = v.box, S = segsIn(polys, b, false), al = [], ys = [];
    S.forEach(function (s) { if (s[4]) return; ys.push(s[1], s[3]); var hor = Math.abs(s[1] - s[3]) < 0.05; if (hor && Math.abs(s[0] - s[2]) > 3) return; al.push(s[0], s[2]); });
    if (!al.length) return null;
    var f = { aft: Math.min.apply(null, al), fore: Math.max.apply(null, al), top: Math.min.apply(null, ys), bot: Math.max.apply(null, ys) }, mid = (f.top + f.bot) / 2, L = f.fore - f.aft;
    if (v.role === 'plan') {
      f.cl = mid;
      var best = null;                                                 // the centreline: a long dashed line near the middle
      polys.forEach(function (q) { if (!q.dash) return; var bb = bboxOf(q.pts); if (bb.y1 - bb.y0 > 1 || bb.x1 - bb.x0 < 0.4 * L || bb.x0 < b.x0 - 2 || bb.x1 > b.x1 + 2 || bb.y0 < b.y0 || bb.y1 > b.y1) return; var y = (bb.y0 + bb.y1) / 2; if (Math.abs(y - mid) < 0.15 * (f.bot - f.top) && (best == null || Math.abs(y - mid) < Math.abs(best - mid))) best = y; });
      if (best != null) f.cl = best;
    } else {
      // baseline: the lowest long solid horizontal line (keel); deck: the highest long one under the deckhouse is not needed here
      var lows = S.filter(function (s) { return !s[4] && Math.abs(s[1] - s[3]) < 0.05 && Math.abs(s[0] - s[2]) > 0.25 * L; }).map(function (s) { return s[1]; });
      f.base = lows.length ? Math.max.apply(null, lows) : f.bot;
      f.longs = S.filter(function (s) { return !s[4] && Math.abs(s[1] - s[3]) < 0.05 && Math.abs(s[0] - s[2]) > 0.2 * L; }).map(function (s) { return s[1]; });
      if (v.role === 'section') { var vs = S.filter(function (s) { return Math.abs(s[0] - s[2]) < 0.05 && Math.abs(s[1] - s[3]) > 0.3 * (f.bot - f.top); }).map(function (s) { return s[0]; }); var m2 = (f.aft + f.fore) / 2; f.cl = vs.length ? vs.sort(function (p, q) { return Math.abs(p - m2) - Math.abs(q - m2); })[0] : m2; }
    }
    return f;
  }

  /* ---------- 4. the enclosed areas of a view ---------- */
  function areasOf(v, polys, pxPerPt, gapPt) {
    var b = v.box, K = pxPerPt, w = Math.ceil((b.x1 - b.x0) * K) + 2, h = Math.ceil((b.y1 - b.y0) * K) + 2;
    var c = document.createElement('canvas'); c.width = w; c.height = h; var g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#000'; g.lineWidth = Math.max(1.5, gapPt * K); g.lineCap = 'round'; g.lineJoin = 'round';   // thick lines close the door openings
    polys.forEach(function (q) { if (q.dash) return; var bb = bboxOf(q.pts); if (bb.x1 < b.x0 || bb.x0 > b.x1 || bb.y1 < b.y0 || bb.y0 > b.y1) return; g.beginPath(); q.pts.forEach(function (p, i) { var x = (p[0] - b.x0) * K, y = (p[1] - b.y0) * K; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); });
    var d = g.getImageData(0, 0, w, h).data, N = w * h, lab = new Int32Array(N), st = new Int32Array(N), out = [], n = 0, i;
    for (i = 0; i < N; i++) {
      if (lab[i] || d[4 * i] < 128) continue; n++; var sp = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, cnt = 0, edge = false; st[sp++] = i; lab[i] = n;
      while (sp) { var p = st[--sp], px = p % w, py = (p - px) / w; cnt++; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; if (px === 0 || py === 0 || px === w - 1 || py === h - 1) edge = true;
        if (px > 0 && !lab[p - 1] && d[4 * (p - 1)] >= 128) { lab[p - 1] = n; st[sp++] = p - 1; } if (px < w - 1 && !lab[p + 1] && d[4 * (p + 1)] >= 128) { lab[p + 1] = n; st[sp++] = p + 1; }
        if (py > 0 && !lab[p - w] && d[4 * (p - w)] >= 128) { lab[p - w] = n; st[sp++] = p - w; } if (py < h - 1 && !lab[p + w] && d[4 * (p + w)] >= 128) { lab[p + w] = n; st[sp++] = p + w; } }
      if (edge) continue;
      var r = gapPt / 2;                                                // the thick lines ate half a gap on every side: give it back
      out.push({ id: n, x0: b.x0 + x0 / K - r, y0: b.y0 + y0 / K - r, x1: b.x0 + (x1 + 1) / K + r, y1: b.y0 + (y1 + 1) / K + r, area: cnt / (K * K), perim: 2 * ((x1 - x0 + 1) + (y1 - y0 + 1)) / K });
    }
    out.forEach(function (o) { o.area += o.perim * gapPt / 2; });
    return { areas: out, lab: lab, w: w, K: K, box: b };
  }

  /* ---------- 5. scale ---------- */
  function scaleBar(texts) {                                         // the numbers 0, 10 ... 50 of a scale bar on one row
    var nums = texts.filter(function (t) { return /^\d+\s*m?$/.test(t.text.trim()); }).map(function (t) { return { v: parseInt(t.text, 10), m: /m$/.test(t.text.trim()), x: (t.x0 + t.x1) / 2, y: Math.round((t.y0 + t.y1) / 2) }; });
    var rows = {}; nums.forEach(function (n) { (rows[n.y] = rows[n.y] || []).push(n); });
    var best = null;
    Object.keys(rows).forEach(function (k) { var r = rows[k].sort(function (a, b) { return a.x - b.x; }); if (r.length < 4 || r[0].v !== 0 || !r.some(function (q) { return q.m; })) return; for (var i = 1; i < r.length; i++) if (!(r[i].v > r[i - 1].v)) return; var ppm = (r[r.length - 1].x - r[0].x) / (r[r.length - 1].v - r[0].v); if (!best || r.length > best.n) best = { ppm: ppm, n: r.length }; });
    return best;
  }

  /* ---------- names and groups ---------- */
  function groupOf(name) {
    var s = (name || '').toUpperCase();
    if (/COT|CARGO\s*(TANK|HOLD)|SLOP|HOLD\b/.test(s)) return ['cargo', 'g_cargo'];
    if (/WBT|BALLAST|FW\b|FRESH|FUEL|F\.O|D\.O|HFO|MDO|LFL|BRINE|MUD|CEMENT|BULK|DW\b|DRILL|TANK|PEAK|D\.B|\bDB\b|VOID|COFFERDAM|SEWAGE|SLUDGE|BILGE/.test(s)) return ['tank', 'g_tanks'];
    if (/ENGINE|PUMP|SWITCH|PROPULS|THRUST|THR\.|B\.T\.|STEER|MACHIN|GENERATOR|EMERG|BOILER|SHAFT|AZIMUTH/.test(s)) return ['space', 'g_mach'];
    if (/^\d{3,4}$|CABIN|SUITE|ACCOMM|MESS|GALLEY|LOUNGE|RESTAURANT|BAR\b|DINING|LIBRARY|CAFE|BUFFET|LOBBY|THEATRE|GYM|SPA|CLINIC|HOSPITAL|OFFICE|BRIDGE|WHEELHOUSE|CREW|GAMES|SHOP|LEISURE|SUN DECK|OBSERVATION|DAY ROOM|CHANGING|LAUNDRY|RECEPTION/.test(s)) return ['house', 'g_acc'];
    return ['space', 'g_outfit'];
  }
  function tidy(s) { return s.replace(/\s+/g, ' ').trim().replace(/\b([A-Z])([A-Z]{3,})\b/g, function (m, a, b) { return a + b.toLowerCase(); }); }

  /* heights of the deck plans: stacked plans with no profile from the lowest deck up; with a profile from the titles (tank top, main deck) and the order */
  function deckHeights(plans, hasProfile, info, L, notes) {
    var D = info.depth || null, prof = hasProfile;
    var dh = +info.deckHeight || 3.0, db = info.dbBottom != null && info.dbBottom !== '' ? +info.dbBottom : null;
    plans.forEach(function (v) { v.name = tidy(v.title); });
    var stack = !prof && plans.length >= 4;
    var order = plans.slice().sort(function (a, b) { return b.box.y0 - a.box.y0; });   // lowest on the sheet first
    if (stack) {                                                    // deck plans one above the other, no profile (passenger ships)
      var z = db != null ? db : 1.2, k;
      order.forEach(function (v, i) { if (i) z += dh; if (D && Math.abs(z - D) < dh / 2) z = D; v.z = Math.round(z * 100) / 100; });
      notes.push('Deck heights: the lowest plan at ' + order[0].z + ' m, then ' + dh + ' m per deck' + (D ? ', the deck nearest the depth set to ' + D + ' m' : '') + '.');
    } else {
      var Dz = D || 0.1 * L, dbz = db != null ? db : 0.08 * Dz, mids = [];
      plans.forEach(function (v) { var t = v.title.toUpperCase(); if (/TANK\s*TOP|INNER\s*BOTTOM|DOUBLE\s*BOTTOM/.test(t)) v.z = dbz; else if (/UPPER\s*DECK|MAIN\s*DECK|WEATHER|FREEBOARD|STRENGTH/.test(t)) v.z = Dz; else mids.push(v); });
      var known = plans.filter(function (v) { return v.z != null; });
      if (mids.length) {
        // the others between the tank top and the main deck, in their order on the sheet (higher on the sheet = higher deck)
        var lo = Math.min.apply(null, known.map(function (v) { return v.z; }).concat([dbz])), hi = Math.max.apply(null, known.map(function (v) { return v.z; }).concat([Dz]));
        mids.sort(function (a, b) { return b.box.y0 - a.box.y0; }).forEach(function (v, i) { v.z = lo + (hi - lo) * (i + 1) / (mids.length + 1); });
      }
      plans.forEach(function (v) { v.z = Math.round(v.z * 100) / 100; });
    }
    return stack;
  }

  /* ---------- the analysis ---------- */
  // inp: {polys (turned), W, H, texts [{text,x0,y0,x1,y1}] (turned), info {loa, beam, depth, dbBottom, deckHeight}}
  function analyse(inp) {
    var info = inp.info || {}, texts = inp.texts || [], polys = inp.polys, notes = [];
    var views = findViews(polys, texts, inp.W, inp.H), bigDbg = views.big;
    var plans = views.filter(function (v) { return v.role === 'plan'; }), prof = views.filter(function (v) { return v.role === 'profile'; })[0], sec = views.filter(function (v) { return v.role === 'section'; })[0];
    if (!plans.length) return { ok: false, why: 'no plan views with a title', views: views };
    views.forEach(function (v) { v.f = frameOf(v, polys); });
    views = views.filter(function (v) { return v.f; }); plans = plans.filter(function (v) { return v.f; });
    // the views lie one above the other (or side by side when the sheet is turned): one aft end for all
    var afts = (prof && prof.f ? [prof] : []).concat(plans).map(function (v) { return v.f.aft; }).sort(function (a, b) { return a - b; });
    var aft = afts[0];
    // scale along the length: the scale bar of the sheet, else the length overall
    var sb = scaleBar(texts), lengths = (prof && prof.f ? [prof] : []).concat(plans).map(function (v) { return v.f.fore - v.f.aft; }), Lpt = Math.max.apply(null, lengths), ppm, how;
    if (sb) { ppm = sb.ppm; how = 'the scale bar of the sheet'; }
    else if (info.loa) { ppm = Lpt / info.loa; how = 'the length overall (' + info.loa + ' m) over the longest view'; }
    else { ppm = Lpt / 100; how = 'an assumed length of 100 m'; notes.push('No scale bar and no length overall: 100 m assumed.'); }
    // across and up: the breadth over the widest plan, when it agrees within 8%
    var Bpt = Math.max.apply(null, plans.map(function (v) { return v.f.bot - v.f.top; })), ppmA = ppm;
    if (info.beam) { var r = Bpt / info.beam / ppm; if (r > 0.92 && r < 1.08) ppmA = Bpt / info.beam; else notes.push('The plans are ' + Math.round((r - 1) * 100) + '% off the breadth on page 1 with this scale; the length scale is used across.'); }
    var L = Lpt / ppm, D = info.depth || null, ppmZ = ppmA;
    if (prof && prof.f && D) {                                      // the profile can be drawn taller or lower: its main deck line (the long line nearest the depth) gives the vertical scale
      var want = prof.f.base - D * ppmA, cand = (prof.f.longs || []).filter(function (y) { return y < prof.f.base - 0.5 * D * ppmA && Math.abs(y - want) < 0.15 * D * ppmA; }).sort(function (a, b) { return Math.abs(a - want) - Math.abs(b - want); });
      if (cand.length) { ppmZ = (prof.f.base - cand[0]) / D; if (Math.abs(ppmZ / ppmA - 1) > 0.01) notes.push('The profile is drawn ' + Math.abs(Math.round((ppmZ / ppmA - 1) * 100)) + '% ' + (ppmZ > ppmA ? 'taller' : 'lower') + ' than the plans: its heights use the depth (' + D + ' m) to the main deck line.'); }
    }
    var dh = +info.deckHeight || 3.0, stack = deckHeights(plans, !!prof, info, L, notes);
    var zs = plans.map(function (v) { return v.z; }).sort(function (a, b) { return a - b; });
    function above(z) { var u = zs.filter(function (q) { return q > z + 0.2; }); return u.length ? u[0] : null; }
    // the compartments
    var pxPerPt = Math.min(8, Math.max(3, 24 / ppm)), gapM = info.doorGap || 0.6, gapBig = 1.6, rows = [], minA = 1.0;
    var labOf = function (A, x, y) { var px = Math.floor((x - A.box.x0) * A.K), py = Math.floor((y - A.box.y0) * A.K); if (px < 0 || py < 0 || px >= A.w) return 0; return A.lab[py * A.w + px] || 0; };
    var envV = null;
    var out = { ok: true, views: [], rows: rows, scale: { ppm: ppm, ppmA: ppmA, ppmZ: ppmZ, how: how, aft: aft }, notes: notes, L: L };
    plans.concat(prof && prof.f ? [prof] : []).concat(sec && sec.f ? [sec] : []).forEach(function (v) {
      var A = areasOf(v, polys, pxPerPt, gapM * ppm), f = v.f, isPlan = v.role === 'plan';
      var zTop = isPlan ? above(v.z) : null, top = isPlan && zTop == null;
      if (isPlan && (!envV || v.f.bot - v.f.top > envV.f.bot - envV.f.top + 0.5 || (D && Math.abs(v.z - D) < 0.3))) envV = { v: v, f: v.f, A: A };   // the hull outline: the main deck plan, else the widest
      var vrec = { title: v.title, role: v.role, z: v.z, box: v.box, cl: f.cl, base: f.base, n: 0 }; out.views.push(vrec);
      var inside = texts.filter(function (t) { var cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2; return cx > v.box.x0 && cx < v.box.x1 && cy > v.box.y0 && cy < v.box.y1 && t.text !== v.title; });
      // door openings: closed up to the small gap first; an area that then holds two or more labels (cabins open to a corridor)
      // is cut again with the large gap, which closes the doors too
      var items = A.areas.map(function (a) { return { a: a, A: A }; }), cnt = function (AA, id) { return inside.filter(function (t) { return labOf(AA, (t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2) === id; }).length; };
      if (A.areas.some(function (a) { return cnt(A, a.id) >= 2; })) {
        var A2 = areasOf(v, polys, pxPerPt, gapBig * ppm);
        items = [];
        A.areas.forEach(function (a) {
          if (cnt(A, a.id) < 2) { items.push({ a: a, A: A }); return; }
          var subs = A2.areas.filter(function (b) { var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; return labOf(A, cx, cy) === a.id; });
          if (subs.length >= 2) subs.forEach(function (b) { items.push({ a: b, A: A2 }); }); else items.push({ a: a, A: A });
        });
      }
      items.forEach(function (it) {
        var a = it.a, AA = it.A, m2 = a.area / (ppm * ppmA); if (m2 < minA) return;
        var names = inside.filter(function (t) { return labOf(AA, (t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2) === a.id; }).sort(function (p, q) { return p.y0 - q.y0 || p.x0 - q.x0; }).map(function (t) { return t.text.trim(); }).filter(function (s) { return s && !/^(CL|BL|Ts|Td|H)$/.test(s); });
        var name = names.length ? tidy(names.join(' ')) : null, x0 = (a.x0 - aft) / ppm, x1 = (a.x1 - aft) / ppm, row;
        if (isPlan) {
          var y0 = (f.cl - a.y1) / ppmA, y1 = (f.cl - a.y0) / ppmA, gk = groupOf(name || '');
          var hgt = zTop != null ? zTop - v.z : (name && !/DECK|OPEN/.test(name.toUpperCase()) ? Math.min(dh, 2.8) : 0.5);   // the top plan: rooms a deck high, open deck areas thin
          row = { kind: gk[0], group: gk[1], name: name || (v.name + ' area ' + (vrec.n + 1)), x0: x0, x1: x1, y0: y0, y1: y1, z0: v.z, z1: v.z + hgt, yc: f.cl, src: 'lines: ' + v.name + (name ? '' : ', no label') };
        } else if (v.role === 'profile') {
          var gp = groupOf(name || '');
          row = { kind: gp[0], group: gp[1], name: name || ('Profile area ' + (vrec.n + 1)), x0: x0, x1: x1, z0: (f.base - a.y1) / ppmZ, z1: (f.base - a.y0) / ppmZ, profileOnly: true, src: 'lines: profile' + (name ? '' : ', no label') };
        } else return;
        row.areaM2 = Math.round(m2 * 10) / 10; row.side = row.y0 != null ? (row.y0 > 0.1 ? 'P' : row.y1 < -0.1 ? 'S' : '') : '';
        rows.push(row); vrec.n++;
      });
    });
    // profile areas that the plans already give are dropped; the others get a width: the breadth of the widest plan at that place, halved (an assumption)
    var planRows = rows.filter(function (r) { return !r.profileOnly; });
    out.rows = planRows.concat(rows.filter(function (r) { return r.profileOnly; }).filter(function (r) {
      var ar = (r.x1 - r.x0) * (r.z1 - r.z0);
      return !planRows.some(function (q) { var ix = Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0), iz = Math.min(r.z1, q.z1) - Math.max(r.z0, q.z0); if (ix <= 0 || iz <= 0) return false; var i = ix * iz; return i / (ar + (q.x1 - q.x0) * (q.z1 - q.z0) - i) >= 0.5; });
    }).map(function (r) { var hb = (info.beam || Bpt / ppmA) / 4; r.y0 = -hb; r.y1 = hb; r.widthAssumed = true; return r; }));
    // double bottom under the lowest plan, when it stands higher than 1 m
    var low = plans.slice().sort(function (a, b) { return a.z - b.z; })[0];
    if (low && low.z >= 1.0 && !stack) out.rows.filter(function (r) { return r.z0 === low.z && !r.profileOnly; }).forEach(function (r) { out.rows.push({ kind: 'tank', group: 'g_tanks', name: 'DB under ' + r.name, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, z0: 0, z1: low.z, yc: r.yc, side: r.side, src: 'double bottom under the ' + low.name + ' (assumed)' }); });
    out.rows.forEach(function (r) { ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'].forEach(function (k) { r[k] = Math.round(r[k] * 100) / 100; }); });
    if (envV) {                                                     // half-breadth of the hull along the length (page points), from the areas of that plan
      var E = envV.A, ok = {}, cols = []; E.areas.forEach(function (a) { ok[a.id] = 1; });
      var hgt = E.lab.length / E.w;
      for (var cx = 0; cx < E.w; cx++) { var t0 = -1, t1 = -1; for (var cy = 0; cy < hgt; cy++) if (ok[E.lab[cy * E.w + cx]]) { if (t0 < 0) t0 = cy; t1 = cy; } cols.push(t0 < 0 ? 0 : Math.max(envV.f.cl - (E.box.y0 + t0 / E.K), (E.box.y0 + t1 / E.K) - envV.f.cl)); }
      out.envelope = function (px) { var i = Math.round((px - E.box.x0) * E.K); return i < 0 || i >= cols.length ? 0 : cols[i]; };
      out.beamPt = 2 * Math.max.apply(null, cols);
    }
    out.plans = plans.map(function (v) { return { title: v.title, z: v.z }; }); out.hasProfile = !!prof; out.big = bigDbg;
    return out;
  }
  window.GAROOMS = { groupOf: groupOf, tidy: tidy, scaleBar: scaleBar, pairTitles: pairTitles, titlesOf: titlesOf, roleOf: roleOf, deckHeights: deckHeights, polysFromOps: polysFromOps, rotatePolys: rotatePolys, analyse: analyse, findViews: findViews };
})();
