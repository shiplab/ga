/* A small PDF writer (no library): pages with text in Helvetica, lines, filled rectangles and JPEG pictures. Everything is made in this page. */
(function () {
  var W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var MAP = { '\u2013': '-', '\u2014': '-', '\u2019': "'", '\u2018': "'", '\u201c': '"', '\u201d': '"', '\u2248': '~', '\u2026': '...', '\u00a0': ' ', '\u2192': '->', '\u00d7': '\u00d7' };
  function clean(s) { s = String(s == null ? '' : s); var o = '', i, c; for (i = 0; i < s.length; i++) { c = s[i]; if (MAP[c] != null) o += MAP[c]; else if (s.charCodeAt(i) > 255) o += '?'; else o += c; } return o; }
  function width(s, size, bold) { s = clean(s); var w = 0, i, c; for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); w += c >= 32 && c <= 126 ? W[c - 32] : 556; } return w * size / 1000 * (bold ? 1.06 : 1); }
  function esc(s) { return clean(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n]+/g, ' '); }
  function rgb(h) { h = h || '#000000'; var n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) / 255 + ' ' + ((n >> 8) & 255) / 255 + ' ' + (n & 255) / 255; }
  function f2(n) { return (Math.round(n * 100) / 100).toString(); }
  function fit(s, size, maxW, bold) { s = clean(s); if (width(s, size, bold) <= maxW) return s; while (s.length > 1 && width(s + '..', size, bold) > maxW) s = s.slice(0, -1); return s + '..'; }

  function Doc(pw, ph) { this.pw = pw; this.ph = ph; this.pages = []; this.images = []; this.cur = null; }
  Doc.prototype.addPage = function () { this.cur = { c: [], imgs: [] }; this.pages.push(this.cur); return this.cur; };
  // y is measured from the TOP of the page, as on the screen
  Doc.prototype.text = function (x, y, s, size, o) { o = o || {}; var X = x; if (o.align === 'right') X = x - width(s, size, o.bold); else if (o.align === 'center') X = x - width(s, size, o.bold) / 2; this.cur.c.push('BT /' + (o.bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + rgb(o.color) + ' rg ' + f2(X) + ' ' + f2(this.ph - y) + ' Td (' + esc(s) + ') Tj ET'); };
  Doc.prototype.rect = function (x, y, w, h, fill, stroke, lw) { var c = ''; if (fill) c += rgb(fill) + ' rg '; if (stroke) c += rgb(stroke) + ' RG ' + (lw || 0.5) + ' w '; c += f2(x) + ' ' + f2(this.ph - y - h) + ' ' + f2(w) + ' ' + f2(h) + ' re ' + (fill && stroke ? 'B' : fill ? 'f' : 'S'); this.cur.c.push(c); };
  Doc.prototype.line = function (x0, y0, x1, y1, color, lw) { this.cur.c.push(rgb(color) + ' RG ' + (lw || 0.5) + ' w ' + f2(x0) + ' ' + f2(this.ph - y0) + ' m ' + f2(x1) + ' ' + f2(this.ph - y1) + ' l S'); };
  Doc.prototype.poly = function (pts, color, lw, close, fill, dash) { if (!pts || pts.length < 2) return; var ph = this.ph, c = (dash ? '[' + dash.join(' ') + '] 0 d ' : '') + (fill ? rgb(fill) + ' rg ' : '') + (color ? rgb(color) + ' RG ' + (lw || 0.5) + ' w ' : '') + '1 j 1 J '; pts.forEach(function (p, i) { c += f2(p[0]) + ' ' + f2(ph - p[1]) + (i ? ' l ' : ' m '); }); if (close) c += 'h '; c += fill && color ? 'B' : fill ? 'f' : 'S'; if (dash) c += ' [] 0 d'; this.cur.c.push(c); };
  Doc.prototype.image = function (jpeg, iw, ih, x, y, w, h) { this.images.push({ data: jpeg, w: iw, h: ih }); var n = this.images.length; this.cur.imgs.push(n); this.cur.c.push('q ' + f2(w) + ' 0 0 ' + f2(h) + ' ' + f2(x) + ' ' + f2(this.ph - y - h) + ' cm /Im' + n + ' Do Q'); };
  Doc.prototype.bytes = function () {
    var parts = [], pos = 0, offs = [], self = this;
    function put(x) { var u = typeof x === 'string' ? latin(x) : x; parts.push(u); pos += u.length; }
    function latin(s) { var u = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
    function obj(n, body) { offs[n] = pos; put(n + ' 0 obj\n'); put(body); put('\nendobj\n'); }
    var np = this.pages.length, nIm = this.images.length, first = 5;           // 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page, content; then images
    put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    var kids = [], i; for (i = 0; i < np; i++) kids.push((first + 2 * i) + ' 0 R');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + np + ' >>');
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var imBase = first + 2 * np;
    this.pages.forEach(function (pg, k) {
      var xo = pg.imgs.map(function (n) { return '/Im' + n + ' ' + (imBase + n - 1) + ' 0 R'; }).join(' ');
      obj(first + 2 * k, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + self.pw + ' ' + self.ph + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ' + xo + ' >> >> /Contents ' + (first + 2 * k + 1) + ' 0 R >>');
      var s = pg.c.join('\n'); obj(first + 2 * k + 1, '<< /Length ' + latin(s).length + ' >>\nstream\n' + s + '\nendstream');
    });
    this.images.forEach(function (im, k) {
      offs[imBase + k] = pos; put((imBase + k) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length + ' >>\nstream\n'); put(im.data); put('\nendstream\nendobj\n');
    });
    var n = imBase + nIm, xref = pos; put('xref\n0 ' + n + '\n0000000000 65535 f \n');
    for (i = 1; i < n; i++) put(('0000000000' + offs[i]).slice(-10) + ' 00000 n \n');
    put('trailer\n<< /Size ' + n + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    var out = new Uint8Array(pos), p = 0; parts.forEach(function (u) { out.set(u, p); p += u.length; }); return out;
  };
  function dataToBytes(url) { var b = atob(url.split(',')[1]), u = new Uint8Array(b.length), i; for (i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  window.GAPDF = { Doc: Doc, width: width, fit: fit, dataToBytes: dataToBytes };
})();
