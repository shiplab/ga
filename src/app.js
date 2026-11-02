/* GA to DBB: the page. Needs GA2DBB (core.js) and pdfjsLib (pdf.js) loaded first. */
(function () {
  'use strict';
  var G = window.GA2DBB, $ = function (id) { return document.getElementById(id); };
  var FIELDS = [['name', 'Name', 'text', ''], ['type', 'Type', 'text', ''], ['loa', 'Length overall', 'number', 'm'], ['lbp', 'Length bp', 'number', 'm'], ['beam', 'Breadth', 'number', 'm'],
    ['depth', 'Depth, main deck', 'number', 'm'], ['draught', 'Draught', 'number', 'm'], ['dwt', 'Deadweight', 'number', 't'], ['gt', 'Gross tonnage', 'number', 'GT'],
    ['cargoTanks', 'Cargo tanks', 'number', 'no.'], ['slopTanks', 'Slop tanks', 'number', 'no.'], ['cargoVol', 'Cargo volume', 'number', 'm³'], ['ballastVol', 'Water ballast', 'number', 'm³'],
    ['dbSide', 'Double side', 'number', 'm'], ['dbBottom', 'Double bottom', 'number', 'm'], ['speed', 'Service speed', 'number', 'kn'], ['frame0', 'Frame 0 at x', 'number', 'm'], ['frameAfter', 'Letters after fr.', 'number', 'no.'], ['passengers', 'Passengers', 'number', 'no.'], ['cabins', 'Cabins', 'number', 'no.'], ['decks', 'Decks', 'number', 'no.'], ['deckHeight', 'Deck height', 'number', 'm']];
  var ROLES = [['profile', 'Profile'], ['deck', 'Deck plan'], ['tank', 'Tank plan'], ['plan', 'Other plan'], ['section', 'Section'], ['ignore', 'Ignore']];
  var GROUPS = G.defaultGroups(), GCOL = {}; GROUPS.forEach(function (g) { GCOL[g.id] = g.color; });
  var GSEL = ['g_cargo', 'g_tanks', 'g_mach', 'g_acc', 'g_outfit', 'g_struct'];
  var S = { pdf: null, fileName: '', nPages: 0, pageInfo: {}, gaPage: 0, infoPage: 0, rot: 0, page: null, W: 0, H: 0, segsPage: null, rotd: null, views: [], roles: [],
    info: {}, infoSrc: {}, shown: {}, xmeta: [], txtTok: 0, words: null, res: null, levels: [], rows: [], img: null, imgK: 1, view: { k: 1, x: 0, y: 0 }, sel: -1, ov: { views: 1, bulk: 1, lev: 1, blk: 1 }, busy: 0, uid: 0, exSeen: {}, hullMode: 'preset', guess: null, est: {}, manual: null, raster: false, cal: null, rgn: false };
  var cv = $('cv'), ctx = cv.getContext('2d'), dpr = 1;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(v, d) { return v == null || !isFinite(v) ? '' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }); }
  var toastT = 0;
  function toast(msg, bad) { var t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, bad ? 6000 : 3200); }

  /* ---------- open a PDF ---------- */
  function setupPdfJs() {
    if (!window.pdfjsLib) return false;
    return true;
  }
  async function openBuffer(buf, name) {
    if (!setupPdfJs()) { toast('The PDF reader did not load. Reload the page.', true); return; }
    try {
      S.pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
    } catch (e) { toast('This file could not be read as a PDF: ' + (e && e.message ? e.message : e), true); return; }
    S.fileName = name; histReset(); S.cruise = null; S.ocv = null; S.ocvTurned = 0; S.rooms = null; S.polysPage = null; S.picRooms = null; S.labels = null; S.hc = { plan: [], keel: [], deck: [], section: [] }; S.chull = null; if (S.hullMode === 'contour') { S.hullMode = 'preset'; $('selHull').value = 'preset'; } S.nPages = S.pdf.numPages; S.pageInfo = {};
    $('empty').hidden = true; S.busy++; setBusy();
    var best = { text: -1, tp: 0 }, bestGa = { paths: -1, pp: 0 };
    for (var p = 1; p <= Math.min(S.nPages, 12); p++) {
      var pg = await S.pdf.getPage(p), tc = await pg.getTextContent(), ops = await pg.getOperatorList(), paths = 0, i;
      for (i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === pdfjsLib.OPS.constructPath) paths += ops.argsArray[i][0].length;
      var nt = tc.items.filter(function (it) { return it.str.trim(); }).length;
      var img = 0; for (i = 0; i < ops.fnArray.length; i++) { var fn = ops.fnArray[i], ar = ops.argsArray[i]; if (fn === pdfjsLib.OPS.paintImageXObject && ar && ar[1] * ar[2] > img) img = ar[1] * ar[2]; else if (fn === pdfjsLib.OPS.paintInlineImageXObject && ar && ar[0] && ar[0].width * ar[0].height > img) img = ar[0].width * ar[0].height; }
      S.pageInfo[p] = { text: nt, paths: paths, img: img, pic: (img >= 2e6 && (nt < 30 || paths < 150)) || (img >= 6e5 && paths < 300 && nt < 30) };      // a scan with an OCR text layer still counts as a picture when it has almost no lines      // a page that is one big picture and almost no text: a scanned or pasted drawing
    }
    Object.keys(S.pageInfo).forEach(function (k) { var d = S.pageInfo[k]; if (d.paths + (d.pic ? 1e6 : 0) > bestGa.paths) { bestGa = { paths: d.paths + (d.pic ? 1e6 : 0), pp: +k }; } });
    S.gaPage = bestGa.pp;
    Object.keys(S.pageInfo).forEach(function (k) { var d = S.pageInfo[k]; if (+k !== S.gaPage && d.text > best.text) best = { text: d.text, tp: +k }; });
    S.infoPage = best.text >= 20 ? best.tp : 0; S.raster = false; S.exSeen = {}; S.manual = null; S.cal = null;
    if (!$('projName').value || S.projFromFile) { $('projName').value = name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '); S.projFromFile = true; }
    fillPageSelects();
    await loadInfo();
    inputCheck();
    await loadGA(true);
    S.busy--; setBusy();
  }

  /* ---------- a picture (JPG, PNG) instead of a PDF: nothing is found by itself, the scale is set by clicks ---------- */
  function fakePage(img) {
    return { rotate: 0,
      getViewport: function (o) { var r = (((o.rotation || 0) % 360) + 360) % 360, w = img.width * o.scale, h = img.height * o.scale; return r === 90 || r === 270 ? { width: h, height: w, r: r, scale: o.scale } : { width: w, height: h, r: r, scale: o.scale }; },
      render: function (o) { var g = o.canvasContext, vp = o.viewport; return { promise: Promise.resolve().then(function () { g.save(); if (vp.r === 90) { g.translate(vp.width, 0); g.rotate(Math.PI / 2); } else if (vp.r === 180) { g.translate(vp.width, vp.height); g.rotate(Math.PI); } else if (vp.r === 270) { g.translate(0, vp.height); g.rotate(-Math.PI / 2); } g.drawImage(img, 0, 0, img.width * vp.scale, img.height * vp.scale); g.restore(); }) }; } };
  }
  async function openImageFile(f) {
    var url = URL.createObjectURL(f), im = new Image();
    try { await new Promise(function (ok, bad) { im.onload = ok; im.onerror = bad; im.src = url; }); } catch (e) { toast('This picture could not be read.', true); return; }
    var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); URL.revokeObjectURL(url);
    S.pdf = null; S.raster = true; S.srcImg = c; S.fileName = f.name; histReset(); S.cruise = null; S.ocv = null; S.ocvTurned = 0; S.rooms = null; S.polysPage = null; S.picRooms = null; S.labels = null; S.hc = { plan: [], keel: [], deck: [], section: [] }; S.chull = null; if (S.hullMode === 'contour') { S.hullMode = 'preset'; $('selHull').value = 'preset'; }
    S.nPages = 1; S.pageInfo = { 1: { text: 0, paths: 0 } }; S.gaPage = 1; S.infoPage = 0; S.manual = null; S.cal = null; S.est = {}; S.info = {}; S.infoSrc = {}; S.shown = {}; S.xmeta = []; S.spec = null; S.rot = 0; var gt = null; try { gt = GAVIS.guessTurn(c); S.rot = gt.k; } catch (e) { }
    $('empty').hidden = true; $('projName').value = f.name.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' '); S.projFromFile = true;
    fillPageSelects(); $('btnOcr').hidden = true; renderInfo();
    $('infoNote').textContent = 'This is a picture. If the sheet has a table with the main dimensions, press Read part and drag a rectangle around it, or type them. Without them, ' + ASSUME_L + ' m is assumed and the drawing gives the proportions.';
    $('docWarn').hidden = false; $('docWarn').innerHTML = '<div>This is a picture, not a drawing with lines. The app turns it, finds the views and proposes the scale and the tank blocks by image analysis. Check the dashed view boxes and the red points: press <b>Edit views</b> or <b>Set scale</b> to correct them.</div>';
    S.busy++; setBusy(); S.page = fakePage(c); S.W = c.width; S.H = c.height; S.segsPage = []; await setRotation(true); S.busy--; setBusy();
    refineByText();
    if (gt && gt.k) toast(gt.sure ? 'The picture was turned so that the profile is on top and the bow on the right. If it is wrong, press Turn.' : 'The picture was turned, but the direction is a guess: check that the bow is on the right, or press Turn.', !gt.sure);
    else if (gt && !gt.sure) toast('Check the direction of the picture: the bow should be on the right. Press Turn if it is not.', true);
  }

  function setBusy() { document.body.style.cursor = S.busy ? 'progress' : ''; }
  function fillPageSelects() {
    var opts = '', i, a = '', b = '<option value="0">None</option>';
    for (i = 1; i <= S.nPages; i++) { var d = S.pageInfo[i] || { text: 0, paths: 0 }, t = 'Page ' + i + ' (' + d.text + ' text, ' + d.paths + ' lines)'; a += '<option value="' + i + '">' + t + '</option>'; b += '<option value="' + i + '">' + t + '</option>'; }
    $('selGa').innerHTML = a; $('selInfo').innerHTML = b; $('selGa').value = S.gaPage; $('selInfo').value = S.infoPage;
    $('docNote').textContent = S.fileName + ' · ' + S.nPages + (S.nPages === 1 ? ' page' : ' pages');
  }

  /* ---------- particulars ---------- */
  async function textItems(pageNo) {
    var pg = await S.pdf.getPage(pageNo), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    return tc.items.filter(function (it) { return it.str.trim(); }).map(function (it) { var t = pdfjsLib.Util.transform(vp.transform, it.transform); return { s: it.str, x: t[4], y: t[5], w: it.width }; });
  }
  async function loadInfo() {
    S.info = {}; S.infoSrc = {}; S.est = {};
    var ip = S.infoPage || (!S.raster && S.gaPage && (S.pageInfo[S.gaPage] || {}).text >= 20 ? S.gaPage : 0);
    if (ip) {
      var items = await textItems(ip), pi = G.parseInfo(items);
      Object.keys(pi.fields).forEach(function (k) { S.info[k] = pi.fields[k].v; S.infoSrc[k] = pi.fields[k].src; });
      var pt = G.parseTable(items), nt = 0; Object.keys(pt.fields).forEach(function (k) { if (S.info[k] == null || S.info[k] === '') { S.info[k] = pt.fields[k].v; S.infoSrc[k] = pt.fields[k].src; nt++; } });
      $('infoNote').textContent = items.length < 20 ? 'This page has almost no text. Try Read by OCR, or type the values.' : 'Read from page ' + ip + (ip === S.gaPage ? ' (the drawing page itself)' : '') + '. Check the values: a wrong one changes the scale.';
    } else $('infoNote').textContent = 'No page with particulars. If you do not type the length overall, ' + ASSUME_L + ' m is assumed and the drawing gives the proportions.';
    S.spec = null;
    if (S.nPages > 1) {                                                    // a specification: rows without dots and lists of frame ranges on any text page
      var lines = [];
      for (var p = 1; p <= Math.min(S.nPages, 12); p++) if (p !== S.gaPage && S.pageInfo[p] && S.pageInfo[p].text >= 20) lines = lines.concat(G.linesFromItems(await textItems(p)));
      var sp = G.parseSpec(lines), nf = 0;
      Object.keys(sp.fields).forEach(function (k) { if (S.info[k] == null || (k === 'name' && /specification/i.test(S.info[k]))) { S.info[k] = sp.fields[k].v; S.infoSrc[k] = 'Specification: ' + sp.fields[k].src; nf++; } });
      if (sp.ranges.length || nf) { S.spec = sp; if (sp.ranges.length && S.info.frameAfter == null) { S.info.frameAfter = 27; S.infoSrc.frameAfter = 'assumed: letters A to J follow frame 27'; } $('infoNote').textContent += ' Specification: ' + nf + ' values and ' + sp.ranges.length + ' frame ranges found.'; }
    }
    $('btnOcr').hidden = false;
    if (S.info.name && S.projFromFile) $('projName').value = S.info.name;
    renderInfo();
  }
  function loaNote() {
    var n = $('loaNote'); if (!n) return; var on = !!(S.est && S.est.loa && S.info.loa);
    n.hidden = !on; if (!on) return;
    n.innerHTML = S.info.loa === ASSUME_L && /assumed/.test(S.infoSrc.loa || '') ? '<b>Length overall not found: assuming ' + ASSUME_L + ' m.</b> Breadth, depth and every block are in proportion to the drawing. Type the real length in <b>Length overall</b> and every dimension scales with it (typing 250 makes everything 2.5 times larger).' : '<b>Length overall not found: ' + esc(S.info.loa) + '</b>, worked out from the breadth or depth you typed and the proportions of the drawing. Type the real length if you know it.';
  }
  /* the fields: the core ones always, the other ones that the drawing needs only when they have a value (or were added), and the metadata (kept in the file, not used by DBB) in a part of its own */
  var CORE = ['name', 'loa', 'beam', 'depth'], OPT = ['draught', 'draughtDesign', 'cargoTanks', 'slopTanks', 'cargoVol', 'dbSide', 'dbBottom', 'frame0', 'frameAfter', 'deckHeight'],
    META = ['passengers', 'cabins', 'decks', 'type', 'builder', 'owner', 'hullNo', 'imo', 'flag', 'lbp', 'depthUpper', 'dwt', 'dwtDesign', 'gt', 'speed', 'ballastVol', 'hfoVol', 'mdoVol'];
  var EXTRA = [['draughtDesign', 'Design draught', 'number', 'm'], ['depthUpper', 'Depth, upper deck', 'number', 'm'], ['dwtDesign', 'Deadweight, design', 'number', 't'], ['builder', 'Builder', 'text', ''], ['owner', 'Owner', 'text', ''], ['hullNo', 'Hull number', 'text', ''], ['imo', 'IMO number', 'text', ''], ['flag', 'Flag', 'text', ''], ['hfoVol', 'Heavy fuel oil', 'number', 'm³'], ['mdoVol', 'Diesel oil', 'number', 'm³']];
  FIELDS = FIELDS.concat(EXTRA); FIELDS.forEach(function (f) { if (f[0] === 'ballastVol') f[1] = 'Water ballast'; });
  function fieldDef(k) { return FIELDS.filter(function (x) { return x[0] === k; })[0]; }
  function hasField(k) { return (S.info[k] != null && S.info[k] !== '') || !!(S.shown && S.shown[k]); }
  function metaItems() {                                                    // what is saved in the file as metadata: [{ key, label, value, unit }]
    var out = [];
    META.forEach(function (k) { var f = fieldDef(k); if (f && S.info[k] != null && S.info[k] !== '') out.push({ key: k, label: f[1], value: S.info[k], unit: f[3] }); });
    (S.xmeta || []).forEach(function (x) { if (x.label && x.value !== '' && x.value != null) out.push({ key: 'custom', label: x.label, value: x.value, unit: '' }); });
    if (S.fileName) out.push({ key: 'source', label: 'Source file', value: S.fileName, unit: '' });
    return out;
  }
  function renderInfo() {
    loaNote();
    function row(f, rm) {
      var v = S.info[f[0]], est = S.est[f[0]];
      return '<label class="f' + (est ? ' est' : '') + '" title="' + (est ? (f[0] === 'loa' ? 'Assumed, not read: type the real length. ' : 'Measured on the drawing, not read: check it. ') : '') + esc(S.infoSrc[f[0]] ? 'From: ' + S.infoSrc[f[0]] : '') + '"><span>' + f[1] + '</span><input data-k="' + f[0] + '" type="' + (f[2] === 'text' ? 'text' : 'number') + '" step="any" value="' + esc(v == null ? '' : v) + '" ' + (f[0] === 'loa' && v == null ? 'placeholder="optional"' : '') + '><small>' + f[3] + (rm ? '<button class="rmf" data-rm="' + f[0] + '" title="Hide this field and clear its value" aria-label="Remove field">×</button>' : '') + '</small></label>';
    }
    var h = '', hidden = [], hiddenM = [];
    CORE.forEach(function (k) { h += row(fieldDef(k), false); });
    OPT.forEach(function (k) { if (hasField(k)) h += row(fieldDef(k), true); else hidden.push(k); });
    var mh = '';
    META.forEach(function (k) { if (hasField(k)) mh += row(fieldDef(k), true); else hiddenM.push(k); });
    (S.xmeta || []).forEach(function (x, i) { mh += '<label class="f"><span title="' + esc(x.label) + '">' + esc(x.label) + '</span><input data-x="' + i + '" type="text" value="' + esc(x.value) + '"><small><button class="rmf" data-rmx="' + i + '" title="Remove this field" aria-label="Remove field">×</button></small></label>'; });
    if (mh) h += '<div class="metahead" title="These are saved in the file as metadata. DBB does not use them in its calculations.">Other information <small>saved in the file, not used by DBB</small></div>' + mh;
    var opts = '<option value="">+ Add a field…</option>';
    if (hidden.length) opts += '<optgroup label="Used by the app">' + hidden.map(function (k) { return '<option value="' + k + '">' + fieldDef(k)[1] + '</option>'; }).join('') + '</optgroup>';
    if (hiddenM.length) opts += '<optgroup label="Other information">' + hiddenM.map(function (k) { return '<option value="' + k + '">' + fieldDef(k)[1] + '</option>'; }).join('') + '</optgroup>';
    h += '<div class="addf"><select id="addSel" aria-label="Add a field">' + opts + '</select><input id="addName" type="text" placeholder="or a new name" aria-label="Name of a new information field"><button class="btn sm" id="addBtn">Add</button></div>';
    $('infoForm').innerHTML = h;
  }
  $('infoForm').addEventListener('click', function (e) {
    var rm = e.target.getAttribute && e.target.getAttribute('data-rm'), rx = e.target.getAttribute && e.target.getAttribute('data-rmx');
    if (rm) { delete S.info[rm]; delete S.infoSrc[rm]; delete S.est[rm]; delete S.shown[rm]; renderInfo(); reanalyse(true); return; }
    if (rx != null && rx !== '') { S.xmeta.splice(+rx, 1); renderInfo(); return; }
    if (e.target.id === 'addBtn') {
      var nm = $('addName').value.trim(), k = $('addSel').value;
      if (nm) { S.xmeta.push({ label: nm, value: '' }); renderInfo(); var ins = $('infoForm').querySelectorAll('[data-x]'); if (ins.length) ins[ins.length - 1].focus(); }
      else if (k) { S.shown[k] = true; renderInfo(); var el = $('infoForm').querySelector('[data-k="' + k + '"]'); if (el) el.focus(); }
    }
  });
  $('infoForm').addEventListener('change', function (e) {
    var xi = e.target.getAttribute('data-x'); if (xi != null && xi !== '') { S.xmeta[+xi].value = e.target.value.trim(); return; }
    var k = e.target.getAttribute('data-k'); if (!k) return;
    var f = FIELDS.filter(function (x) { return x[0] === k; })[0], v = e.target.value.trim(); delete S.est[k]; S.infoSrc[k] = 'typed';
    if (f[2] === 'text') S.info[k] = v; else { var n = parseFloat(v); if (isFinite(n)) S.info[k] = n; else delete S.info[k]; }
    if (k === 'name' && v) { $('projName').value = v; S.projFromFile = true; }
    renderInfo(); reanalyse(true);
  });

  /* ---------- the drawing ---------- */
  async function loadGA(first) {
    if (!S.gaPage) return;
    S.busy++; setBusy();
    S.page = await S.pdf.getPage(S.gaPage);
    var isPic = !!(S.pageInfo[S.gaPage] || {}).pic;
    if (first) toast(isPic ? 'Page ' + S.gaPage + ' is a picture (a scan): the compartments are found by OpenCV in the image and the text is read by OCR (about a minute). A drawing PDF with lines gives better results, if you have one.' : 'Page ' + S.gaPage + ' is a drawing with lines (vector PDF): the compartments are read from the lines.');
    if (isPic) { await loadPicturePage(first); S.busy--; setBusy(); return; }
    if (S.raster) { S.raster = false; S.srcImg = null; S.img = null; S.manual = null; S.cal = null; S.pvBoxes = null; $('btnOcr').hidden = false; }
    var vp = S.page.getViewport({ scale: 1 }), ops = await S.page.getOperatorList();
    S.W = vp.width; S.H = vp.height;
    S.segsPage = G.inPage(G.segmentsFromOps(ops, pdfjsLib.OPS, vp.transform), vp.width, vp.height);
    try { S.polysPage = window.GAROOMS ? GAROOMS.polysFromOps(ops, pdfjsLib.OPS, vp.transform) : null; } catch (e) { S.polysPage = null; }
    if (first) S.rot = S.segsPage.length ? G.guessRotationText(S.segsPage, S.W, S.H).k : 0;
    if (first && S.segsPage.length) {                                    // the lines say how the sheet is turned; the picture of the page can overrule them when it is sure (the profile on top, the plans below)
      try { var k0 = 2600 / Math.max(S.W, S.H), vq = S.page.getViewport({ scale: k0, rotation: S.page.rotate }), cq = document.createElement('canvas'); cq.width = Math.round(vq.width); cq.height = Math.round(vq.height); var gq = cq.getContext('2d'); gq.fillStyle = '#fff'; gq.fillRect(0, 0, cq.width, cq.height); await S.page.render({ canvasContext: gq, viewport: vq }).promise; var tq = GAVIS.guessTurn(cq); if (window.GA_DBG) console.log("turnimg", JSON.stringify(tq && { k: tq.k, sure: tq.sure }), S.rot); if (tq && tq.sure && tq.k !== S.rot) S.rot = tq.k; } catch (e) { if (window.GA_DBG) console.log("turnimg err", e.message); }
    }
    if (first) {                                                        // most of the text reads one way (80% of the letters): turn the sheet so that it reads upright
      try { var tct = await S.page.getTextContent(), cnt = {}, tot = 0; tct.items.forEach(function (it) { if (!it.str || !it.str.trim() || !/PROFILE|ELEVATION|DECK|PLAN|SECTION|TANK\s*TOP|DOUBLE\s*BOTTOM/i.test(it.str) || it.str.length > 40) return; var m = pdfjsLib.Util.transform(vp.transform, it.transform), a = ((Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI / 90) * 90) % 360 + 360) % 360; var hh = Math.hypot(m[2], m[3]), wgt = it.str.length * hh * hh; cnt[a] = (cnt[a] || 0) + wgt; tot += wgt; });      // big letters (titles) count more than small ones (cabin numbers)
        var ba = null; Object.keys(cnt).forEach(function (a) { if (ba == null || cnt[a] > cnt[ba]) ba = a; });
        if (tot >= 300 && ba != null && cnt[ba] >= 0.75 * tot) { var qt = { 0: 0, 270: 1, 180: 2, 90: 3 }[ba]; if (qt != null) S.rot = qt; }
      } catch (e) { }
    }
    await setRotation(true); inputCheck();
    S.busy--; setBusy();
  }
  /* a PDF page that is one big picture: draw it on a canvas and treat it like a JPG (turn, views, scale, blocks); the other pages still give the particulars */
  async function loadPicturePage(first) {
    var vp1 = S.page.getViewport({ scale: 1 }), k = Math.min(3.5, 3000 / Math.max(vp1.width, vp1.height)), vp = S.page.getViewport({ scale: k });
    var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await S.page.render({ canvasContext: g, viewport: vp }).promise;
    S.raster = true; S.srcImg = c; S.manual = null; S.cal = null; S.pvBoxes = null; S.est = S.est || {}; $('btnOcr').hidden = true;
    var gt = null; if (first) { S.rot = 0; if (!cruiseScan(c)) { try { gt = GAVIS.guessTurn(c); S.rot = gt.k; } catch (e) { } } }
    S.page = fakePage(c); S.W = c.width; S.H = c.height; S.segsPage = [];
    await setRotation(true); inputCheck();
    if (first && gt && gt.k) toast(gt.sure ? 'The picture was turned so that the profile is on top and the bow on the right. If it is wrong, press Turn.' : 'The picture was turned, but the direction is a guess: check that the bow is on the right, or press Turn.', !gt.sure);
    if (first) refineByText();
  }
  async function setRotation(keepRoles) {
    if (!S.segsPage) return;
    S.rotd = G.rotateSegs(S.segsPage, S.W, S.H, S.rot);
    if (S.raster) { S.views = []; S.aSegs = []; S.pv = false; S.sheet = false; S.roles = []; if (S.manual) { S.manual = null; S.cal = null; toast('The drawing was turned: set the scale again.'); } }
    else {
    var sv = G.sheetViews(S.rotd.segs, S.rotd.W, S.rotd.H);
    S.views = sv.views; S.aSegs = sv.segs; S.sheet = sv.mode === 'sheet';
    S.roles = S.sheet ? G.sheetRoles(S.aSegs, S.views) : G.guessRoles(S.aSegs, S.views).map(function (r) { return r.role; });
    addSectionView();
    }
    if (!S.raster) await realLabels();
    if ((S.labels && S.labels.length) || (S.tlabels && S.tlabels.length)) applyTitles(true);
    renderViews();
    ['btnRotL', 'btnRotR', 'btnRescan'].forEach(function (id) { $(id).disabled = false; });
    await renderImage();
    if (S.raster) findPictureViews(false); else imageViewsForVector();
    reanalyse(false);
    fit();
  }
  /* a vector sheet whose views the lines could not separate (views stacked with no empty band between them): the picture of the page is cut by where the ink is thin, and used when it gives clearly better views */
  function imageViewsForVector() {
    if (!S.img || S.raster || !S.rotd) return;
    try {
      var k = S.imgK, W = S.rotd.W, H = S.rotd.H, f = GAVIS.findViews(S.img); if (!f.boxes || f.boxes.length < 2) return;
      var iv = f.boxes.map(function (b) { return { x0: b.x0 / k, y0: b.y0 / k, x1: b.x1 / k, y1: b.y1 / k, n: 0, title: '' }; });
      if (GAVIS.viewScore(iv, W, H) <= GAVIS.viewScore(S.views, W, H) + 1.5) return;
      S.views = iv; S.roles = GAVIS.guessRoles(f.boxes, S.img); S.sheet = true; S.vfromImg = true;
      if ((S.labels && S.labels.length) || (S.tlabels && S.tlabels.length)) applyTitles(true);
      renderViews();
    } catch (e) { }
  }

  /* a picture: propose the scale and the tank blocks from what the image analysis measured (the hull outline, the long lines, the bulkheads) */
  function autoPicture() {
    if (!S.raster || !S.img || !S.pvBoxes) return false;
    var m; try { m = GAVIS.measure(S.vsrc, S.pvBoxes, S.roles); } catch (e) { m = null; }
    if (!m || !(m.xB - m.xA > 100) || !(m.beam > 20)) return false;
    var k = 1, xA = m.xA / k, len = (m.xB - m.xA) / k, beam = m.beam / k, ycT = (m.ycTank != null ? m.ycTank : m.ycDeck) / k, ycD = m.ycDeck != null ? m.ycDeck / k : null, base, hp, depthGuess = false;
    if (m.baseY != null && m.deckY != null) { base = m.baseY / k; hp = (m.baseY - m.deckY) / k; } else { depthGuess = true; var pv = S.views[S.roles.indexOf('profile')]; base = pv ? pv.y1 - 0.02 * len : ycT - beam; hp = 0.09 * len; }
    var xm = xA + len / 2, ycP = ycT;
    S.manual = { xA: xA, baseY: base, yc: ycP, lengthPts: len, beamPts: beam, heightPts: hp, sx: 1, sy: 1, sz: 1, auto: true, ycDeck: ycD, pts: [{ x: xA, y: base }, { x: xA + len, y: base }, { x: xm, y: base - hp }, { x: xm, y: ycP }, { x: xm, y: ycP - beam / 2 }] };
    S.rows = []; S.sel = -1; reanalyse(false);
    var sc = S.res && S.res.scale; if (!sc || sc.sx == null) return false;
    var D = S.info.depth || hp * sc.sz, Bm = S.info.beam || beam * sc.sy, hw = 0.45 * Bm, zb = 0.11 * D, sp = (m.spans || []).map(function (q) { return [(q[0] / k - xA) * sc.sx, (q[1] / k - xA) * sc.sx]; }).filter(function (q) { return q[1] > q[0] && q[0] > -1 && q[1] < len * sc.sx + 1; });
    sp.forEach(function (q, i) {
      var no = sp.length - i;                                            // numbered from the bow
      ['P', 'S'].forEach(function (side) { S.rows.push({ id: ++S.uid, kind: 'cargo', name: 'No.' + no + ' cargo tank ' + side, side: side, x0: G.r2(q[0]), x1: G.r2(q[1]), y0: G.r2(side === 'P' ? 0 : -hw), y1: G.r2(side === 'P' ? hw : 0), z0: G.r2(zb), z1: G.r2(D), group: 'g_cargo', on: true, density: 0.85, fill: 98, deck: false }); });
    });
    if (S.rows.length) { var c1 = S.rows.filter(function (r) { return r.kind === 'cargo'; })[0]; if (c1) c1.deck = true; try { regenDecks(); } catch (e) { } }
    S.pvAuto = { tanks: sp.length, depthGuess: depthGuess };
    renderAll(); renderGuide(); draw(); d3draw();
    return true;
  }
  function turnedSource() {                                             // the picture as it was loaded, turned like the screen: its pixels are the page units
    var im = S.srcImg, k = ((S.rot % 4) + 4) % 4, sw = k % 2, W = sw ? im.height : im.width, H = sw ? im.width : im.height, c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.translate(W / 2, H / 2); g.rotate(k * Math.PI / 2); g.drawImage(im, -im.width / 2, -im.height / 2); return c;
  }
  function findPictureViews(announce) {                                 // views of a picture: image analysis on this computer
    if (!S.raster || !S.img || !S.srcImg) return;
    S.vsrc = turnedSource(); var scan = cruiseScan(S.vsrc); if (scan) { cruiseSetup(scan, announce); return; } S.cruise = null; var v = GAVIS.findViews(S.vsrc), k = 1;
    S.views = v.boxes.map(function (b) { return { x0: b.x0 / k, y0: b.y0 / k, x1: b.x1 / k, y1: b.y1 / k, n: 0, title: '' }; }); S.roles = GAVIS.guessRoles(S.views.map(function (b) { return { x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k }; }), S.vsrc); S.vsel = -1; S.pv = true; S.pvBoxes = S.views.map(function (b) { return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }; }); S.pvAuto = null;
    var did = false; if (S.views.length) { var m0 = S.manual; S.manual = null; did = autoPicture(); if (!did) S.manual = m0; }
    renderViews(); if (S.words) applyLabels();
    var msg = did ? 'From the picture: ' + S.views.length + ' views, a proposed scale (red points) and ' + (S.pvAuto.tanks ? S.pvAuto.tanks * 2 + ' tank blocks' : 'no tank blocks') + (S.pvAuto.depthGuess ? '; the depth line was not found, so the depth is a guess' : '') + '. Check them: Set scale clicks the scale again, Draw block adds blocks.' : S.views.length ? S.views.length + ' views found in the picture. Check them with Edit views, then press Set scale.' : 'No views found in the picture. Add them with Edit views, + View.';
    if (did) $('infoNote').textContent = msg; if (announce || did) toast(msg, !S.views.length);
  }

  /* ---------- the text on a picture: its direction gives the turn, the titles of the views give their roles (OCR on this computer) ---------- */
  var WORDV = /PROFILE|DECK|TANK|SECTION|MIDSHIP|ENGINE|CARGO|HOLD|BALLAST|FORE|PEAK|ACCOMMODATION|BRIDGE|PLAN|SIGNIFICANT|SHIPS|BULKHEAD|COFFERDAM|MACHINERY|CONTAINER/;
  function wordScore(ws) { var g = 0, v = 0; ws.forEach(function (w) { if (w.conf > 60 && /^[A-Za-z]{4,}$/.test(w.text)) { g++; if (WORDV.test(w.text.toUpperCase())) v++; } }); return g + 3 * v; }
  async function refineByText(force) {
    if (!S.raster || !S.srcImg || !window.GAOCR || !GAOCR.ready()) return;
    if (ocrRun) { S.txtPending = true; return; }
    var tok = ++S.txtTok, img = S.srcImg, res = {}, r0 = ((S.rot % 4) + 4) % 4, ks = [r0, (r0 + 2) % 4], i, k;       // the views fix the axis: the text decides between the two directions of it
    S.words = null; ocrRun = true; ocrShow('the text on the sheet to check its direction', false);
    try {
      for (i = 0; i < ks.length; i++) { k = ks[i]; if (tok !== S.txtTok) return; res[k] = await GAOCR.words(img, k, 3200); res[k].score = wordScore(res[k].words); }
      if (tok !== S.txtTok) return;
      var cur = res[ks[0]], other = res[ks[1]], flip = other.score >= 8 && other.score >= 2.5 * cur.score;
      if (flip) { S.words = other; S.wordsRot = ks[1]; S.rot = ks[1]; S.manual = null; S.cal = null; await setRotation(true); toast('The sheet was turned after reading its text, so that the text is upright.'); }
      else if (cur.score >= 4) { S.words = cur; S.wordsRot = ks[0]; applyLabels(); }
      if (S.words && !S.cruise) setTimeout(picRoomsRun, 0);
    } catch (e) { /* the OCR is a help, not a need */ } finally { ocrRun = false; ocrHide(); if (S.txtPending) { S.txtPending = false; setTimeout(refineByText, 50); } }
  }
  function applyLabels() {
    if (S.cruise) return cruiseLabels();
    if (!S.raster || !S.words || S.wordsRot !== ((S.rot % 4) + 4) % 4 || !S.views.length) return false;
    var ws = S.words.words.filter(function (w) { return w.conf > 40 && /[A-Za-z]{3,}/.test(w.text); }).sort(function (a, b) { return a.y0 - b.y0; }), labs = [], used = {}, side = Math.max(S.words.W, S.words.H);
    ws.forEach(function (w, i) {                                            // words of one line become one title
      if (used[i]) return; var cur = { text: w.text.toUpperCase(), x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }, h = w.y1 - w.y0, grew = true; used[i] = 1;
      while (grew) { grew = false; for (var j = 0; j < ws.length; j++) { if (used[j]) continue; var q = ws[j]; if (Math.abs((q.y0 + q.y1) / 2 - (cur.y0 + cur.y1) / 2) < 0.6 * h && q.x0 - cur.x1 < 2.2 * h && q.x0 >= cur.x0) { cur.text += ' ' + q.text.toUpperCase(); cur.x1 = Math.max(cur.x1, q.x1); cur.y0 = Math.min(cur.y0, q.y0); cur.y1 = Math.max(cur.y1, q.y1); used[j] = 1; grew = true; } } }
      labs.push(cur);
    });
    function kind(t) { return /\bPROFILE\b/.test(t) ? 'profile' : /\bSECTION\b|MIDSHIP/.test(t) ? 'section' : /TANK\s*TOP|TANK\s*PLAN|INNER\s*BOTTOM/.test(t) ? 'tank' : /(UPPER|MAIN|WEATHER|FREEBOARD|STRENGTH)\s*DECK|DECK\s*PLAN/.test(t) ? 'deck' : null; }
    var got = {};
    labs.forEach(function (l) {
      var kd = kind(l.text); if (!kd) return; var cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2, bj = -1, bd = 1e9;
      S.views.forEach(function (b, j) { var dx = Math.max(b.x0 - cx, 0, cx - b.x1), dy = Math.max(b.y0 - cy, 0, cy - b.y1), d = Math.sqrt(dx * dx + dy * dy); if (d < bd) { bd = d; bj = j; } });
      if (bj >= 0 && bd <= 0.05 * side && (!got[kd] || bd < got[kd].d)) got[kd] = { j: bj, d: bd };
    });
    if (!got.profile) return false;
    var roles = S.roles.slice(), wasSet = {}; Object.keys(got).forEach(function (kd) { wasSet[got[kd].j] = kd; });
    roles.forEach(function (r, j) { if ((r === 'profile' || r === 'tank' || r === 'deck') && !wasSet[j] && got[r] && got[r].j !== j) roles[j] = 'ignore'; });
    Object.keys(got).forEach(function (kd) { roles[got[kd].j] = kd; });
    if (roles.join() === S.roles.join()) return false;
    S.roles = roles; var m0 = S.manual; if (!m0 || m0.auto) { S.manual = null; var did = autoPicture(); if (!did) S.manual = m0; }
    renderViews(); reanalyse(false); draw(); toast('The roles of the views were set from the titles on the sheet (' + Object.keys(got).join(', ') + ').'); return true;
  }
  async function renderImage() {
    var k = Math.min(4, 2600 / Math.max(S.rotd.W, S.rotd.H)), c = document.createElement('canvas');
    c.width = Math.round(S.rotd.W * k); c.height = Math.round(S.rotd.H * k);
    var vp = S.page.getViewport({ scale: k, rotation: (S.page.rotate + 90 * S.rot) % 360 });
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    var g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    await S.page.render({ canvasContext: g, viewport: vp }).promise;
    S.img = c; S.imgK = c.width / S.rotd.W;
  }
  function viewTitle(b) {                                             // the title of a view: text near it (printed under it, or above it) that names a view
    var best = null, all = (S.labels || []).concat(S.tlabels || []);
    all.forEach(function (l) {
      if (l.table) return; var cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2;
      var t = l.text.replace(/\s+/g, ' ').trim(); if (!G.titleRole(t)) return;
      var dx = Math.max(b.x0 - cx, 0, cx - b.x1), dy = cy < b.y0 ? b.y0 - cy : cy > b.y1 ? cy - b.y1 : 0, inside = dx === 0 && dy === 0;
      if (dx > 40 || dy > 130 || (dx > 10 && dy > 0)) return;
      if (inside && !/^(PROFILE|[A-Z ]*DECK( PLAN)?|TANK ?TOP( PLAN)?|[A-Z ]*SECTION|[A-Z ]*PLAN)$/.test(t.toUpperCase().replace(/[^A-Z ]/g, ''))) return;     // inside a view only a plain title counts (the title often stands by the bow of a plan)
      var d = inside ? 0 : dy * (cy < b.y0 ? 1.5 : 1) + dx;                // under the view is the usual place; above it or by its side is also allowed
      if (!best || d < best.d) best = { d: d, t: t };
    });
    return best ? best.t : '';
  }
  /* a midship section drawn beside the long views is left out by the view splitter (it is small and stands alone): the lines outside every view are grouped, and the group that looks like a section is added */
  function addSectionView() {
    if (S.roles.indexOf('section') >= 0 || !S.views.length) return;
    var segs = S.aSegs, c = 5, W = S.rotd.W, H = S.rotd.H, gw = Math.ceil(W / c) + 2, gh = Math.ceil(H / c) + 2, g = new Uint8Array(gw * gh), n = new Int32Array(gw * gh), i, x, y, maxW = 0;
    S.views.forEach(function (v) { maxW = Math.max(maxW, v.x1 - v.x0); });
    function inView(mx, my) { return S.views.some(function (v) { return mx >= v.x0 - 2 && mx <= v.x1 + 2 && my >= v.y0 - 2 && my <= v.y1 + 2; }); }
    segs.forEach(function (q) {
      var len = Math.hypot(q[2] - q[0], q[3] - q[1]); if (len > 0.5 * maxW) return;                                          // frame lines and long rules are not part of a section
      var st = Math.max(1, Math.ceil(len / c)); for (i = 0; i <= st; i++) { var mx = q[0] + (q[2] - q[0]) * i / st, my = q[1] + (q[3] - q[1]) * i / st; if (inView(mx, my)) continue; var k = Math.floor(my / c + 1) * gw + Math.floor(mx / c + 1); g[k] = 1; n[k]++; }
    });
    var seen = new Uint8Array(gw * gh), best = null, D = 2;
    for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) {
      if (!g[y * gw + x] || seen[y * gw + x]) continue;
      var st2 = [[x, y]], x0 = x, x1 = x, y0 = y, y1 = y, cnt = 0; seen[y * gw + x] = 1;
      while (st2.length) { var p = st2.pop(), px = p[0], py = p[1]; cnt += n[py * gw + px]; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        for (var dy = -D; dy <= D; dy++) for (var dx = -D; dx <= D; dx++) { var qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= gw || qy >= gh) continue; var kk = qy * gw + qx; if (g[kk] && !seen[kk]) { seen[kk] = 1; st2.push([qx, qy]); } } }
      var w = (x1 - x0 + 1) * c, h = (y1 - y0 + 1) * c, asp = w / h;
      if (cnt >= 60 && w >= 0.05 * W && h >= 0.08 * H && asp > 0.45 && asp < 1.8 && w < 0.4 * maxW && (!best || cnt > best.cnt)) best = { cnt: cnt, x0: (x0 - 1) * c, y0: (y0 - 1) * c, x1: (x1 + 1) * c, y1: (y1 + 1) * c };
    }
    if (best) { S.views.push({ x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1, n: 0, title: '' }); S.roles.push('section'); }
  }
  /* the real text of the drawing page (a vector PDF), placed in the turned page like the views: titles of views come from it, with no OCR */
  async function realLabels() {
    S.tlabels = []; if (S.raster || !S.page || !S.rotd) return;
    try {
      var vp = S.page.getViewport({ scale: 1, rotation: (S.page.rotate + 90 * S.rot) % 360 }), tc = await S.page.getTextContent(), T = pdfjsLib.Util.transform;
      tc.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return; var m = it.transform, a = Math.hypot(m[0], m[1]) || 1, ux = m[0] / a, uy = m[1] / a, h = it.height || Math.hypot(m[2], m[3]) || 8, w = it.width;
        var pts = [[m[4], m[5]], [m[4] + ux * w, m[5] + uy * w], [m[4] - uy * h, m[5] + ux * h], [m[4] + ux * w - uy * h, m[5] + uy * w + ux * h]].map(function (q) { var r = T(vp.transform, [1, 0, 0, 1, q[0], q[1]]); return [r[4], r[5]]; });
        var xs = pts.map(function (q) { return q[0]; }), ys = pts.map(function (q) { return q[1]; });
        S.tlabels.push({ text: it.str, x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) });
      });
    } catch (e) { S.tlabels = []; }
  }
  function applyTitles(quiet) {
    var used = {};
    S.views.forEach(function (b, i) {
      var t = viewTitle(b); b.title = t; var r = G.titleRole(t); if (!r) return;
      if ((r === 'profile' || r === 'deck' || r === 'tank') && used[r]) r = 'plan';
      used[r] = 1; S.roles[i] = r;
    });
    if (!quiet) { renderViews(); reanalyse(true); }
  }
  function viewName(i) { var b = S.views[i]; if (S.engineUsed === 'rooms' && b && b.title) return b.title; if (S.cruise) return (S.cruise.dn[i] || 'Deck ' + (S.views.length - i)); var rl = (ROLES.filter(function (r) { return r[0] === S.roles[i]; })[0] || ['', ''])[1]; return rl + (b && b.title ? ' (' + b.title + ')' : ''); }
  function renderGoView() {                                            // the list of views to zoom to
    var sel = $('selGoView'), cur = sel.value; sel.innerHTML = '<option value="">Go to view…</option>' + S.views.map(function (b, i) { return S.roles[i] === 'ignore' ? '' : '<option value="' + i + '">#' + (i + 1) + ' ' + esc(viewName(i)) + '</option>'; }).join('') + (S.views.length ? '<option value="all">Whole sheet</option>' : '');
    sel.value = cur && sel.querySelector('option[value="' + cur + '"]') ? cur : '';
  }
  function goView(v) {                                                 // zoom so that the view fills the window
    if (v === 'all' || v === '') { fit(); return; } var b = S.views[+v]; if (!b || !S.rotd) return;
    var r = cv.parentNode.getBoundingClientRect(), pad = 0.04, w = (b.x1 - b.x0) * (1 + 2 * pad), h = (b.y1 - b.y0) * (1 + 2 * pad), k = Math.min(r.width / w, r.height / h, 40), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    S.view = { k: k, x: r.width / 2 - cx * k, y: r.height / 2 - cy * k }; draw();
  }
  $('selGoView').onchange = function () { goView(this.value); };
  function renderViews() { renderViewList(); viewBarUpdate(); renderGoView(); }
  function renderViewList() {
    $('viewList').innerHTML = S.views.length ? S.views.map(function (b, i) {
      return '<div class="vrow' + (S.vsel === i ? ' on' : '') + '"><span data-vsel="' + i + '" title="Select this view on the drawing">#' + (i + 1) + '</span><select data-v="' + i + '" aria-label="Role of view ' + (i + 1) + '">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (S.roles[i] === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select><button class="btn sm" data-vdel="' + i + '" title="Delete this view">&times;</button></div>' +
        '<p class="note">' + Math.round(b.x1 - b.x0) + ' × ' + Math.round(b.y1 - b.y0) + (S.raster ? ' px' : ' pt, ' + (b.n || 0) + ' lines') + '</p>';
    }).join('') : '<p class="note">No views found. The page may be a scan. You can add views by hand: press Edit views, then + View.</p>';
  }
  $('viewList').addEventListener('click', function (e) {
    var t = e.target, sel = t.getAttribute && t.getAttribute('data-vsel'), del = t.getAttribute && t.getAttribute('data-vdel');
    if (sel != null) { if (S.mode !== 'views') setMode('views'); S.vsel = +sel; renderViews(); var b = S.views[+sel]; if (b) zoomToBox(b); }
    if (del != null) viewDelete(+del);
  });
  $('viewList').addEventListener('change', function (e) {
    var i = e.target.getAttribute('data-v'); if (i == null) return;
    setRole(+i, e.target.value);
  });
  function setRole(i, role) {
    if (role !== 'ignore' && role !== 'section') S.roles = S.roles.map(function (r, j) { return j !== i && r === role ? 'ignore' : r; });
    S.roles[i] = role; renderViews(); reanalyse(true);
  }
  /* the bar over the drawing while editing views: what to do, and the role of the selected view */
  function viewBarUpdate() {
    var b = $('viewBar'); if (!b) return; if (S.vbarClosed && S.vbarSel !== S.vsel) S.vbarClosed = false;      // closed until another view is selected
    if (S.mode !== 'views' || S.vbarClosed || S.fnd) { b.hidden = true; return; }      // the Find bar takes its place while blocks are proposed
    var sel = S.views[S.vsel], h;
    if (!S.views.length) h = '<b>Edit views.</b> No views yet. Press <b>+ View</b>, then drag a rectangle around a view' + (S.raster ? ', or <b>Find views</b>' : '') + '.';
    else if (!sel) h = '<b>Edit views.</b> <b>Click a box</b> on the drawing to select it. Then drag it to move it, drag its edges to resize it, and say what it is here.';
    else h = '<b>View #' + (S.vsel + 1) + '</b> is selected. What is it? ' + ROLES.map(function (r) { return '<button class="btn sm' + (S.roles[S.vsel] === r[0] ? ' on' : '') + '" data-role="' + r[0] + '">' + r[1] + '</button>'; }).join(' ') + ' <button class="btn sm" data-role="__del">Delete</button><br><i>Drag the box to move it, drag its edges or corners to resize it.</i>';
    if (sel && /tank|deck|plan|profile|section/.test(S.roles[S.vsel] || '')) h += ' <button class="btn sm" data-role="__find" title="OpenCV reads this view again and proposes its compartments as blocks (a section gives the heights). Settings are in the bar that opens.">' + (S.roles[S.vsel] === 'section' ? 'Read heights from this section' : 'Find blocks in this view') + '</button>';
    h += ' <button class="btn sm" data-role="__ex">Show example</button> <button class="vbclose" data-role="__x" title="Close this tip" aria-label="Close this tip">\u00d7</button>';
    if (b._h !== h) { b.innerHTML = h; b._h = h; } b.hidden = false;                // rewritten only when it changes, so that its buttons can be clicked
  }
  $('viewBar').addEventListener('click', function (e) {
    var r = e.target.getAttribute && e.target.getAttribute('data-role'), b0 = $('viewBar'); if (!r) return;
    if (r === '__x') { S.vbarClosed = true; S.vbarSel = S.vsel; b0.hidden = true; return; }
    if (r === '__find') { var vb = S.views[S.vsel]; if (vb) scanView(S.vsel); return; }
    if (r === '__ex') showExample('views'); else if (r === '__del') { if (S.vsel >= 0) viewDelete(S.vsel); } else if (S.vsel >= 0) setRole(S.vsel, r);
  });
  $('viewBar').addEventListener('mousedown', function (e) { e.stopPropagation(); });
  $('calMsg').addEventListener('click', function (e) { if (e.target.id === 'calEx') showExample('scale'); });
  $('calMini').addEventListener('click', function (e) { if (e.target.id === 'calMiniX') { S.miniOff = true; calMini(); } });
  $('calMini').addEventListener('mousedown', function (e) { e.stopPropagation(); });

  /* ---------- analysis and the list of blocks ---------- */
  function viewMap() { var m = {}; S.views.forEach(function (b, i) { var r = S.roles[i]; if (r === 'profile' || r === 'deck' || r === 'tank') m[r] = b; }); return m; }
  function rescaleRows(rows, a, b) {                                    // metres under scale a -> metres under scale b, the same place on the picture
    if (!a || !b || (a.sx === b.sx && a.sy === b.sy && a.sz === b.sz && a.xA === b.xA && a.yc === b.yc && a.baseY === b.baseY)) return;
    rows.forEach(function (r) {
      ['x0', 'x1'].forEach(function (k) { if (r[k] != null) r[k] = G.r2(((r[k] / a.sx + a.xA) - b.xA) * b.sx); });
      ['y0', 'y1'].forEach(function (k) { if (r[k] != null) r[k] = G.r2((b.yc - (a.yc - r[k] / a.sy)) * b.sy); });
      ['z0', 'z1'].forEach(function (k) { if (r[k] != null) r[k] = G.r2((b.baseY - (a.baseY - r[k] / a.sz)) * b.sz); });
      if (r.yc != null) r.yc = b.yc;
    });
  }
  var ASSUME_L = 100;                                                    // length used when none is given: the rules that find tanks work in metres, so a 1 m ship would find nothing

  /* ---------- passenger ships: a sheet of stacked deck plans (cabins and rooms instead of tanks) ---------- */
  function cruiseScan(c) {
    if (!window.GADECK) return null; var o; try { o = GADECK.read(c); } catch (e) { return null; }
    var d = o.decks; if (d.length < 4) return null;
    var maxW = Math.max.apply(null, d.map(function (h) { return h.hull.x1 - h.hull.x0; })), lx = d.map(function (h) { return h.hull.x0; });
    if (Math.max.apply(null, lx) - Math.min.apply(null, lx) > 0.06 * maxW) return null;                      // the decks start at the same stern
    if (d.filter(function (h) { return h.hull.x1 - h.hull.x0 >= 0.45 * maxW; }).length < 4) return null;
    return o;
  }
  var CABIN_RE = /cabin|suite|stateroom|berth/i, LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function cruiseSetup(scan, announce) {
    var old = S.cruise; S.cruise = { scan: scan, dn: old && old.scan === scan ? old.dn : {}, cn: old && old.scan === scan ? old.cn : {}, zn: old && old.scan === scan ? old.zn : {}, built: false };
    var pad = 6; S.views = scan.decks.map(function (d) { return { x0: d.hull.x0 - pad, y0: d.hull.y0 - pad, x1: d.hull.x1 + pad, y1: d.hull.y1 + pad, n: 0, title: '' }; });
    if (!old && S.hullMode === 'preset') { S.hullMode = 'guess'; $('selHull').value = 'guess'; }      // the deck outlines give the hull
    S.roles = S.views.map(function () { return 'deck'; }); S.vsel = -1; S.pv = true; S.manual = null; S.pvAuto = null;
    S.pvBoxes = S.views.map(function (b) { return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }; });
    renderViews(); if (S.words) cruiseLabels(true);
    var msg = 'Passenger ship: ' + scan.decks.length + ' deck plans found. The coloured areas of each deck (cabin classes and rooms) are proposed as blocks; the deck height is assumed. Check the colours against the legend, then edit the blocks.';
    $('infoNote').textContent = msg; if (announce) toast(msg);
  }
  function cruiseLabels(quiet) {
    var C = S.cruise; if (!C || !S.words || S.wordsRot !== ((S.rot % 4) + 4) % 4) return false;
    var ws = S.words.words.filter(function (w) { return w.conf > 35 && /[A-Za-z]/.test(w.text); }), sc = C.scan, dn = {}, cn = {}, zn = {};
    function join(list) { return list.sort(function (a, b) { return Math.abs(a.y0 - b.y0) > 0.6 * (a.y1 - a.y0) ? a.y0 - b.y0 : a.x0 - b.x0; }).map(function (w) { return w.text; }).join(' ').replace(/[^A-Za-z0-9 '&\/.-]/g, '').replace(/\s+/g, ' ').trim(); }
    sc.decks.forEach(function (d, i) {
      var h = d.hull, t = join(ws.filter(function (w) { var cy = (w.y0 + w.y1) / 2; return w.x1 <= h.x0 + 8 && cy >= h.y0 - 8 && cy <= h.y1 + 8 && /[A-Za-z]{3,}/.test(w.text); }));
      if (/deck/i.test(t)) dn[i] = t.replace(/\b(\w)(\w*)/g, function (m, a, b) { return a.toUpperCase() + b.toLowerCase(); });
    });
    (sc.legend || []).forEach(function (l) {
      var hh = l.y1 - l.y0, near = ws.filter(function (w) { var cy = (w.y0 + w.y1) / 2; return cy >= l.y0 - 0.4 * hh && cy <= l.y1 + 0.4 * hh && w.x0 >= l.x1 - 2 && w.x0 - l.x1 < 6 * hh; }).sort(function (a, b) { return a.x0 - b.x0; }), out = [], end = l.x1;
      near.forEach(function (w) { if (w.x0 - end < 3.2 * hh) { out.push(w); end = w.x1; } });
      var t = join(out); if (t.length >= 4 && cn[l.cls] == null) cn[l.cls] = t.replace(/\b(\w)(\w*)/g, function (m, a, b) { return a.toUpperCase() + b.toLowerCase(); });
    });
    sc.zones.forEach(function (z, zi) {
      if (cn[z.cls]) return;
      var t = join(ws.filter(function (w) { var cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2; return cx >= z.x0 - 2 && cx <= z.x1 + 2 && cy >= z.y0 - 2 && cy <= z.y1 + 2 && /[A-Za-z]{3,}/.test(w.text) && w.conf > 50; }));
      if (t.length >= 5) zn[zi] = t.replace(/\b(\w)(\w*)/g, function (m, a, b) { return a.toUpperCase() + b.toLowerCase(); });
    });
    C.dn = dn; C.cn = cn; C.zn = zn; C.built = false;
    if (!quiet) { reanalyse(false); draw(); toast('The names of the decks, cabin classes and rooms were read from the picture (OCR). Check them.'); }
    return true;
  }
  function cruiseAnalyse() {
    var C = S.cruise, sc = C.scan, decks = sc.decks, n = decks.length, S0 = sc.S0, i, j;
    var xA = Math.min.apply(null, decks.map(function (d) { return d.hull.x0; })), xB = Math.max.apply(null, decks.map(function (d) { return d.hull.x1; })), lenPx = xB - xA;
    var assumed = !S.info.loa, L = S.info.loa || ASSUME_L, sx = L / lenPx, hmax = Math.max.apply(null, decks.map(function (d) { return d.hull.y1 - d.hull.y0; })), sy = sx;
    if (S.info.beam) { var r = S.info.beam / hmax / sx; if (r > 0.75 && r < 1.3) sy = S.info.beam / hmax; }
    if (!S.info.deckHeight) { S.info.deckHeight = 3.0; S.infoSrc.deckHeight = 'assumed'; S.est.deckHeight = true; renderInfo(); }
    var dh = +S.info.deckHeight || 3.0, zb = 1.0, sz = sx;
    if (!S.info.depth || S.est.depth) { S.info.depth = G.r2(zb + 2 * dh); S.infoSrc.depth = 'assumed: two decks inside the hull'; S.est.depth = true; renderInfo(); }
    if (!S.info.beam) { S.info.beam = G.r2(hmax * sy); S.infoSrc.beam = 'measured on the drawing'; S.est.beam = true; renderInfo(); }
    var ycs = decks.map(function (d) { return (d.hull.y0 + d.hull.y1) / 2; }), yLow = ycs[n - 1];
    var st = decks.reduce(function (a, d) { return a.length >= d.stations.length ? a : d.stations; }, []);
    var env = decks[0].stations.map(function (q, k) { var best = 0; decks.forEach(function (d, di) { var s2 = d.stations[k], x = xA + (xB - xA) * 0; if (s2 && s2.top != null && s2.bot != null) { best = Math.max(best, s2.bot - s2.top); } }); return best / 2; });
    function envelope(px) {                                              // half-breadth in page pixels at x, over all decks (each deck on its own length scale of 48 stations)
      var best = 0; decks.forEach(function (d) { var x0 = d.hull.x0, x1 = d.hull.x1; if (px < x0 || px > x1) return; var t = (px - x0) / (x1 - x0) * (d.stations.length - 1), a = Math.floor(t), b2 = Math.min(d.stations.length - 1, a + 1), sa = d.stations[a], sb = d.stations[b2]; if (!sa || !sb || sa.top == null || sb.top == null) return; var ha = (sa.bot - sa.top) / 2, hb = (sb.bot - sb.top) / 2; best = Math.max(best, ha + (hb - ha) * (t - a)); }); return best;
    }
    var res = { notes: ['Passenger ship: the decks are plans, one above the other. The deck height (' + dh + ' m) is assumed: change it under Ship data.'], scale: { sx: sx, sy: sy, sz: sz, xA: xA, yc: yLow, lengthPts: lenPx, beamPts: hmax, heightPts: S.info.depth / sz, baseY: null, deckY: null, lengthHow: 'longest deck outline' },
      levels: [], bulkheads: [], spans: [], spanPts: [], tanks: [], checks: [], ext: { a: xA, b: xB }, envelope: envelope, deckPlan: { yc: yLow, segs: [] }, X: function (px) { return (px - xA) * sx; }, Zf: function () { return null; } };
    S.res = res;
    if (assumed) res.notes.push('Length overall not found: ' + ASSUME_L + ' m is assumed. Type the real length and everything scales.');
    // levels: the floor of every deck
    S.levels = decks.map(function (d, di) { var z = zb + (n - 1 - di) * dh; return { z: G.r2(z), x0: G.r2((d.hull.x0 - xA) * sx), x1: G.r2((d.hull.x1 - xA) * sx), len: G.r2((d.hull.x1 - d.hull.x0) * sx), main: false, use: false, name: C.dn[di] || 'Deck ' + (n - di) }; });
    // blocks: the coloured areas
    var key = n + ':' + sx.toFixed(5) + ':' + sy.toFixed(5) + ':' + dh;
    if (!C.built || C.key !== key) {
      var keep = S.rows.filter(function (r) { return r.kind === 'user'; }), rows = [], longDecks = {}, isCab = {};
      sc.zones.forEach(function (z) { if ((z.x1 - z.x0) / Math.max(1, z.y1 - z.y0) >= 3) { longDecks[z.cls] = longDecks[z.cls] || {}; longDecks[z.cls][z.deck] = 1; } });
      /* the legend lists the cabin classes; without it the classes that make long rows on several decks are cabins */
      sc.palette.forEach(function (p) { isCab[p.id] = Object.keys(C.cn).length >= 2 ? !!C.cn[p.id] : Object.keys(longDecks[p.id] || {}).length >= 3; });
      sc.zones.forEach(function (z, zi) {
        var d = decks[z.deck], yc = ycs[z.deck], di = z.deck, cab = isCab[z.cls], cname = C.cn[z.cls] || ('Colour ' + LETTERS[z.cls % 26]), dname = C.dn[di] || ('Deck ' + (n - di)), cy = (z.y0 + z.y1) / 2, side = cab ? (cy < yc ? 'P' : 'S') : '';
        var y0 = (yc - z.y1) * sy, y1 = (yc - z.y0) * sy, z0 = zb + (n - 1 - di) * dh;
        var nm = cab ? cname + ' ' + side + ' (' + dname + ')' : (C.zn[zi] || 'Room, colour ' + LETTERS[z.cls % 26]) + ' (' + dname + ')';
        rows.push({ id: ++S.uid, kind: cab ? 'cabin' : 'space', name: nm, side: side, x0: G.r2((z.x0 - xA) * sx), x1: G.r2((z.x1 - xA) * sx), y0: G.r2(y0), y1: G.r2(y1), z0: G.r2(z0), z1: G.r2(z0 + dh), group: cab ? 'g_acc' : 'g_outfit', on: true, yc: yc, deck: di, cls: z.cls });
      });
      rows.sort(function (a, b) { return a.z0 - b.z0 || a.x0 - b.x0 || b.y1 - a.y1; });
      S.rows = rows.concat(keep); C.built = true; C.key = key; S.sel = -1;
    }
    S.section = null; S.guess = G.guessHull(res, S.info, {});
    renderScale(); renderHull(); renderAll(); renderGuide();
    if (!H.busy) setTimeout(histCommit, 0);
  }



  /* ---------- compartments on a picture (scan), with OpenCV: every enclosed area of every view becomes a block ---------- */
  function ocrLines(words) {                                          // OCR words of one line joined (titles have two or more words)
    var ws = words.slice().sort(function (a, b) { return a.y0 - b.y0 || a.x0 - b.x0; }), used = {}, out = [];
    ws.forEach(function (w, i) {
      if (used[i]) return; var cur = { text: w.text, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }, h = w.y1 - w.y0, grew = true; used[i] = 1;
      while (grew) { grew = false; for (var j = 0; j < ws.length; j++) { if (used[j]) continue; var q = ws[j]; if (Math.abs((q.y0 + q.y1) / 2 - (cur.y0 + cur.y1) / 2) < 0.6 * h && q.x0 - cur.x1 < 1.6 * h && q.x0 >= cur.x0) { cur.text += ' ' + q.text; cur.x1 = Math.max(cur.x1, q.x1); cur.y0 = Math.min(cur.y0, q.y0); cur.y1 = Math.max(cur.y1, q.y1); used[j] = 1; grew = true; } } }
      out.push(cur);
    });
    return out;
  }
  async function picRoomsRun() {
    if (S.engine !== 'auto' || !S.raster || S.cruise || !S.vsrc || !window.GAOCV || !S.views.length) return;
    var sc = S.res && S.res.scale || {};
    if (sc.sx == null || sc.xA == null) {                               // no scale from the picture analysis: a first guess from the widest view and the length; the areas give the real one
      if (!(S.words && S.wordsRot === S.rot) || !S.info.loa) return;
      var wv = Math.max.apply(null, S.views.map(function (b) { return b.x1 - b.x0; })); sc = { sx: S.info.loa / wv, sy: S.info.loa / wv, sz: S.info.loa / wv, xA: Math.min.apply(null, S.views.map(function (b) { return b.x0; })) };
    }
    var key = [S.fileName, S.gaPage, S.rot, JSON.stringify(S.views), S.roles.join(), sc.sx.toFixed(6), JSON.stringify(S.cvSet), (S.words && S.wordsRot === S.rot) ? S.words.words.length : 0].join('|');
    if (S.picRooms && S.picRooms.key === key) { if (S.picRooms.rows && S.picRooms.rows.length >= 10 && S.engineUsed !== 'picrooms') picApply(S.picRooms.rows, S.picRooms.views, S.picRooms.named, false); return; }
    S.picRooms = { key: key, busy: true }; var gen0 = S.anaGen; ocvStatus('OpenCV: looking for the compartments of every view…');
    var h0 = histSer(), tok = S.picTok = (S.picTok || 0) + 1, rows = [], r2 = G.r2, notes = [], vframe = {};
    try {
      var ppm = 1 / sc.sx, ppmA = 1 / (sc.sy || sc.sx), ppmZ = 1 / (sc.sz || sc.sx), aft = sc.xA, D = S.info.depth || (sc.heightPts ? sc.heightPts * (sc.sz || sc.sx) : 0.1 * (S.info.loa || 100)), B = S.info.beam || (sc.beamPts ? sc.beamPts * (sc.sy || sc.sx) : 0.16 * (S.info.loa || 100));
      var words = S.words && S.wordsRot === S.rot ? S.words.words.filter(function (w) { return w.conf > 45 && /[A-Za-z0-9]/.test(w.text); }) : [];
      var db = S.info.dbBottom ? +S.info.dbBottom : 0.08 * D, dh = +S.info.deckHeight || 3, R = window.GAROOMS;
      // the views: their titles read by OCR (PROFILE, MAIN DECK, TANK TOP ...) give the roles and the deck heights; without OCR the roles of the picture analysis
      var texts = ocrLines(words), boxes = S.views.map(function (b) { return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }; }), vs;
      if (R && texts.length) R.pairTitles(boxes, R.titlesOf(texts), 0.05 * Math.max(S.vsrc.width, S.vsrc.height));
      var titled = boxes.filter(function (b) { return b.title; });
      if (R && titled.some(function (b) { return R.roleOf(b.title) === 'plan'; })) {
        // every view: the role of its title; the profile keeps its role when its title names a deck (deck names are written inside profiles), and views without a title keep the role found from the picture
        vs = boxes.map(function (b, i) {
          var tr = b.title ? R.roleOf(b.title) : null, pr = S.roles[i];
          if (tr && !(pr === 'profile' && tr === 'plan')) return { i: i, b: b, box: b, title: b.title, role: tr };
          if (/profile|tank|deck|plan/.test(pr || '')) { if (pr === 'profile') b.title = 'PROFILE'; else if (!b.title) b.title = pr === 'tank' ? 'TANK TOP' : pr === 'deck' ? 'UPPER DECK' : 'DECK'; return { i: i, b: b, box: b, title: b.title, role: pr === 'profile' ? 'profile' : 'plan' }; }
          return null;
        }).filter(function (v) { return v && v.role !== 'section' && v.role !== 'ignore' && v.role; });
        var sb = R.scaleBar(texts); if (sb) { ppm = ppmA = ppmZ = sb.ppm; notes.push('scale from the scale bar'); }
      } else {
        var wMax = Math.max.apply(null, S.views.map(function (b) { return b.x1 - b.x0; }));
        // a long view left without a role is most likely a deck plan: it is read as one (its height between the tank top and the deck)
        vs = S.views.map(function (b, i) { var ro = S.roles[i]; if (ro === 'ignore' && b.x1 - b.x0 >= 0.7 * wMax && (b.x1 - b.x0) > 2.5 * (b.y1 - b.y0)) ro = 'plan'; return { i: i, b: b, box: b, role: ro, title: (ROLES.filter(function (q) { return q[0] === ro; })[0] || ['', 'Plan'])[1] }; }).filter(function (v) { return /profile|tank|deck|plan/.test(v.role); });
      }
      var plans = vs.filter(function (v) { return v.role !== 'profile'; }), hasProf = vs.some(function (v) { return v.role === 'profile'; });
      var Lm = S.info.loa || 100;
      if (titled.length && R) R.deckHeights(plans, hasProf, S.info, Lm, notes);
      else { plans.forEach(function (v) { v.z = v.role === 'tank' ? db : v.role === 'deck' ? D : null; }); var mids = plans.filter(function (v) { return v.z == null; }); mids.forEach(function (v, i) { v.z = db + (D - db) * (i + 1) / (mids.length + 1); }); if (plans.length === 1) plans[0].z = D; }
      var zs = plans.map(function (v) { return v.z; }).sort(function (a, b) { return a - b; });
      // the compartments of every view first, then the frame from them: the aft end (all views), the centreline (plans), the bottom (profile)
      for (var vi = 0; vi < vs.length; vi++) { vs[vi].A = await GAOCV.areas(S.vsrc, vs[vi].b, cvOpts(ppm, words)); if (tok !== S.picTok) return; }
      var afts = vs.map(function (v) { return v.A.areas.length ? Math.min.apply(null, v.A.areas.map(function (a) { return a.x0; })) : 1e9; });
      if (titled.length) {
        aft = Math.min.apply(null, afts);
        // the scale: the length overall over the longest plan (its areas run from the stern to the stem), when no scale bar was read
        if (!notes.some(function (n) { return /scale bar/.test(n); }) && S.info.loa) {
          var Lpx = Math.max.apply(null, plans.map(function (v) { return v.A.areas.length ? Math.max.apply(null, v.A.areas.map(function (a) { return a.x1; })) - Math.min.apply(null, v.A.areas.map(function (a) { return a.x0; })) : 0; }));
          if (Lpx > 0) { var k2 = Lpx / S.info.loa; if (Math.abs(k2 / ppm - 1) < 0.25 || !(S.res && S.res.scale && S.res.scale.sx)) { ppm = k2; ppmA = ppmZ = k2; } }
          var Bpx = Math.max.apply(null, plans.map(function (v) { return v.A.areas.length ? Math.max.apply(null, v.A.areas.map(function (a) { return a.y1; })) - Math.min.apply(null, v.A.areas.map(function (a) { return a.y0; })) : 0; }));
          if (S.info.beam && Bpx > 0 && Math.abs(Bpx / S.info.beam / ppm - 1) < 0.08) ppmA = ppmZ = Bpx / S.info.beam;
        }
      }
      function above(z) { var u = zs.filter(function (q) { return q > z + 0.2; }); return u.length ? u[0] : null; }
      for (var vi = 0; vi < vs.length; vi++) {
        var v = vs[vi], A = v.A, isPlan = v.role !== 'profile', cl = null, base = sc.baseY;
        if (!isPlan && titled.length && A.areas.length) base = Math.max.apply(null, A.areas.map(function (a) { return a.y1; }));
        if (isPlan) {                                                   // the centreline: the middle of the areas found (the hull is symmetric), or the one the scale gave
          var ys = A.areas.map(function (a) { return [a.y0, a.y1]; }), lo = Math.min.apply(null, ys.map(function (q) { return q[0]; })), hi = Math.max.apply(null, ys.map(function (q) { return q[1]; }));
          cl = titled.length ? (lo + hi) / 2 : v.role === 'tank' && sc.yc != null && sc.yc > v.b.y0 && sc.yc < v.b.y1 ? sc.yc : v.role === 'deck' && S.res.deckPlan && S.res.deckPlan.yc > v.b.y0 && S.res.deckPlan.yc < v.b.y1 ? S.res.deckPlan.yc : (lo + hi) / 2;
        }
        var zTop = isPlan ? above(v.z) : null;
        vframe[v.i] = { aft: aft, ppm: ppm, ppmA: ppmA, ppmZ: ppmZ, cl: cl, base: base, z: isPlan ? v.z : null, zTop: zTop };      // the frame of this view, for Draw block and Find blocks in this view
        A.areas.forEach(function (a, k) {
          var m2 = a.areaPx / (ppm * ppmA); if (m2 < 1) return;
          var names = words.filter(function (w) { return A.at((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2) === a.id; }).sort(function (p, q) { return p.y0 - q.y0 || p.x0 - q.x0; }).map(function (w) { return w.text; });
          var name = names.length ? names.join(' ').replace(/\s+/g, ' ').trim() : null, gk = window.GAROOMS ? GAROOMS.groupOf(name || '') : ['space', 'g_outfit'], row;
          var x0 = (a.x0 - aft) / ppm, x1 = (a.x1 - aft) / ppm;
          if (isPlan) {
            var hgt = zTop != null ? zTop - v.z : (name ? 2.8 : 0.5);
            row = { kind: gk[0], group: gk[1], name: name || ((R ? R.tidy(v.title) : v.title) + ' area ' + (k + 1)), x0: x0, x1: x1, y0: (cl - a.y1) / ppmA, y1: (cl - a.y0) / ppmA, z0: v.z, z1: v.z + hgt, yc: cl, src: 'OpenCV on the picture' };
          } else {
            if (base == null) return;
            row = { kind: gk[0], group: gk[1], name: name || ('Profile area ' + (k + 1)), x0: x0, x1: x1, z0: (base - a.y1) / ppmZ, z1: (base - a.y0) / ppmZ, profileOnly: true, src: 'OpenCV on the picture, profile' };
          }
          row.areaM2 = r2(m2); rows.push(row);
        });
      }
      var planRows = rows.filter(function (r) { return !r.profileOnly; });
      rows = planRows.concat(rows.filter(function (r) { return r.profileOnly; }).filter(function (r) {
        var ar = (r.x1 - r.x0) * (r.z1 - r.z0);
        return !planRows.some(function (q) { var ix = Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0), iz = Math.min(r.z1, q.z1) - Math.max(r.z0, q.z0); if (ix <= 0 || iz <= 0) return false; var i = ix * iz; return i / (ar + (q.x1 - q.x0) * (q.z1 - q.z0) - i) >= 0.5; });
      }).map(function (r) { r.y0 = -B / 4; r.y1 = B / 4; r.widthAssumed = true; return r; }));
      rows.forEach(function (r) { ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'].forEach(function (k) { r[k] = r2(r[k]); }); r.side = r.y0 > 0.1 ? 'P' : r.y1 < -0.1 ? 'S' : ''; });
    } catch (e) { S.picRooms = { key: key, err: (e && e.message) || String(e) }; ocvStatus(); return; }
    S.picRooms = { key: key, rows: rows, views: vs.length, named: words.length > 0, vframe: vframe };
    if (rows.length < 10) { ocvStatus('OpenCV found only ' + rows.length + ' compartments on the picture: the blocks of the picture analysis are kept.'); return; }
    if (histSer() !== h0 && S.anaGen === gen0) { ocvStatus('OpenCV found ' + rows.length + ' compartments, but you changed the blocks meanwhile: yours were kept. Press Re-scan drawing to use them.'); return; }
    picApply(rows, vs.length, words.length > 0, true);
  }
  function userNow() { return (S.rows || []).filter(function (r) { return r.kind === 'user'; }); }
  function picApply(rows, nv, named, announce) {
    S.vframe = S.picRooms && S.picRooms.vframe || null;
    var uk0 = userNow();
    S.rows = rows.map(function (q) { var row = Object.assign({ id: ++S.uid, on: true, shape: 'box' }, q); if (row.kind === 'cargo') { row.density = 0.85; row.fill = 98; } else if (row.kind === 'tank') { row.density = 1.0; row.fill = 98; } return row; }); S.rows = S.rows.concat(uk0);
    S.engineUsed = 'picrooms'; S.sel = -1;
    try { var gp = hullFromDecks(S.info, S.section); if (gp) { S.guess = gp; if (S.hullMode === 'preset') { S.hullMode = 'guess'; $('selHull').value = 'guess'; } } } catch (e) { }
    renderAll(); histCommit();
    ocvStatus('A picture (scan): OpenCV found ' + rows.length + ' compartments in ' + nv + ' views' + (named ? ', named from the text read by OCR.' : '. Read text (OCR) names them.'));
    if (announce) toast('OpenCV read the picture: ' + rows.length + ' compartments.');
  }
  /* ---------- compartments from the lines (vector PDF): every enclosed area of every titled view becomes a block ---------- */
  function roomsKey() { return [S.fileName, S.gaPage, S.rot, S.info.loa, S.info.beam, S.info.depth, S.info.dbBottom, S.info.deckHeight, (S.tlabels || []).length].join('|'); }
  function roomsRun() {
    if (!window.GAROOMS || !S.polysPage || !S.tlabels || !S.tlabels.length) return null;
    var key = roomsKey(); if (S.rooms && S.rooms.key === key) return S.rooms.out;
    var out; try { var rp = GAROOMS.rotatePolys(S.polysPage, S.W, S.H, S.rot); out = GAROOMS.analyse({ polys: rp.polys, W: rp.W, H: rp.H, texts: S.tlabels, info: S.info }); } catch (e) { out = { ok: false, why: e.message }; }
    S.rooms = { key: key, out: out }; return out;
  }
  /* the hull from the blocks: the half-breadth of every deck plan along the length (metres); the highest plan gives the waterline shape, the lowest one how full the sections are */
  function deckOutlines(rows, L) {
    var lv = {}, nx = 41; rows.forEach(function (r) { if (r.profileOnly || r.widthAssumed || r.on === false || /^DB under/.test(r.name || '')) return; var k = (Math.round(r.z0 * 2) / 2).toFixed(1); (lv[k] = lv[k] || []).push(r); });
    var out = Object.keys(lv).map(function (k) {
      var rs = lv[k], b = [], i; if (rs.length < 3) return null;
      for (i = 0; i < nx; i++) { var x = L * i / (nx - 1), h = 0; rs.forEach(function (r) { if (x >= r.x0 - 0.3 && x <= r.x1 + 0.3) h = Math.max(h, Math.abs(r.y0), Math.abs(r.y1)); }); b.push(h); }
      for (i = 1; i + 1 < nx; i++) if (!b[i] && b[i - 1] && b[i + 1]) b[i] = (b[i - 1] + b[i + 1]) / 2;     // a station between two blocks
      return { z: +k, b: b, n: rs.length, span: b.filter(function (v) { return v > 0; }).length };
    }).filter(function (d) { return d && d.span >= 8; }).sort(function (a, b) { return a.z - b.z; });
    return out;
  }
  function hullFromDecks(info, section) {
    var L = info.loa, D = info.depth; if (!(L > 0) || !S.rows || !S.rows.length) return null;
    var ds = deckOutlines(S.rows, L); if (!ds.length) return null;
    var top = ds.filter(function (d) { return !D || d.z <= D + 0.5; }).pop() || ds[ds.length - 1], low = ds[0] !== top && ds[0].z >= 0.5 ? ds[0] : null;
    var res = { scale: { sx: 1, sy: 1, sz: 1, xA: 0, lengthPts: L }, envelope: function (x) { var i = Math.round(x / L * 40); return i < 0 || i > 40 ? 0 : top.b[i]; } };
    if (!info.beam) return null;
    var mx = Math.max.apply(null, top.b), f = (info.beam / 2) / mx; if (!(f > 0.7 && f < 1.4)) return null;     // the plans must agree with the beam (within 30%), then they are scaled to it
    ds.forEach(function (d) { d.b = d.b.map(function (v) { return Math.min(info.beam / 2, v * f); }); });
    var g = G.guessHull(res, info, { section: section, low: low ? { z: low.z, b: low.b } : null, decks: ds.filter(function (d) { return d !== top; }) });
    if (g) g.decks = ds.length;
    return g;
  }
  function roomsApply(res) {
    var o = roomsRun(); if (!o || !o.ok || o.rows.length < 10) return false;
    var sc = res.scale, r2 = G.r2, prof = o.views.filter(function (v) { return v.role === 'profile'; })[0], plans = o.views.filter(function (v) { return v.role === 'plan'; });
    sc.sx = 1 / o.scale.ppm; sc.sy = sc.sz = 1 / o.scale.ppmA; sc.xA = o.scale.aft; sc.lengthPts = o.L * o.scale.ppm; sc.lengthHow = 'compartments: ' + o.scale.how;
    if (prof) sc.baseY = prof.base; var tp = plans.slice().sort(function (a, b) { return a.z - b.z; })[0], up = plans.slice().sort(function (a, b) { return b.z - a.z; })[0];
    if (tp) sc.yc = tp.cl; res.deckPlan = Object.assign({ segs: [] }, res.deckPlan || {}, { yc: up ? up.cl : sc.yc });
    S.vframe = {}; o.views.forEach(function (v, i) { var above = plans.filter(function (q) { return q.z > v.z + 0.2; }).sort(function (a, b) { return a.z - b.z; })[0]; S.vframe[i] = { aft: o.scale.aft, ppm: o.scale.ppm, ppmA: o.scale.ppmA, ppmZ: o.scale.ppmZ || o.scale.ppmA, cl: v.cl, base: v.base, z: v.role === 'plan' ? v.z : null, zTop: v.role === 'plan' ? (above ? above.z : null) : null }; });
    S.views = o.views.map(function (v) { return { x0: v.box.x0, y0: v.box.y0, x1: v.box.x1, y1: v.box.y1, n: v.n, title: v.title }; });
    S.roles = o.views.map(function (v) { var t = v.title.toUpperCase(); return v.role !== 'plan' ? v.role : v === tp ? 'tank' : v === up ? 'deck' : 'plan'; });
    S.levels = plans.map(function (v) { return { z: v.z, x0: 0, x1: r2(o.L), len: r2(o.L), main: v === up, use: false, name: v.title }; }).sort(function (a, b) { return a.z - b.z; });
    var uk0 = userNow();
    S.rows = o.rows.map(function (q) { var row = Object.assign({ id: ++S.uid, on: true, shape: 'box' }, q); if (row.kind === 'cargo') { row.density = 0.85; row.fill = 98; } else if (row.kind === 'tank') { row.density = 1.0; row.fill = 98; } return row; }); S.rows = S.rows.concat(uk0);
    res.notes = ['Compartments from the lines of the PDF: ' + o.rows.length + ' blocks from ' + o.views.length + ' views (scale from ' + o.scale.how + ').'].concat(o.notes);
    res.tankNote = null; S.engineUsed = 'rooms';
    if (o.beamPt) { sc.beamPts = o.beamPt; sc.beamRatio = S.info.beam ? o.beamPt / o.scale.ppmA / S.info.beam : null; }
    if (S.info.depth) { sc.heightPts = S.info.depth * o.scale.ppmZ; sc.depthRatio = 1; }
    try { var gd = hullFromDecks(S.info, S.section); if (o.envelope && !(gd && gd.decks >= 2)) { res.envelope = o.envelope; gd = G.guessHull(res, S.info, {}); } if (gd) { S.guess = gd; if (S.hullMode === 'preset') { S.hullMode = 'guess'; $('selHull').value = 'guess'; } } } catch (e) { }
    renderViews();
    return true;
  }
  /* ---------- the OpenCV engine (PDF drawings): image analysis of the page, the lines of the PDF as the fallback ---------- */
  S.engine = 'auto';
  try { var se0 = localStorage.getItem('ga2dbb.engine'); if (se0 === 'lines' || se0 === 'auto' || se0 === 'ocv') S.engine = se0; } catch (e) { }
  $('selEngine').value = S.engine;
  $('selEngine').onchange = function () { S.engine = this.value; try { localStorage.setItem('ga2dbb.engine', S.engine); } catch (e) { } reanalyse(true); };
  function ocvKey() { return [S.fileName, S.gaPage, S.rot, S.info.loa, S.info.beam, S.info.dbBottom, S.info.draught, S.info.draughtDesign].join('|'); }
  function ocvUse() { var o = S.ocv; return S.engine !== 'lines' && o && o.key === ocvKey() && o.res && o.res.ok && o.res.TK && (o.res.TK.blocks.length + o.res.EN.blocks.length) > 0; }
  function ocvStatus(msg) {
    var n = $('engineNote'); if (!n) return; var o = S.ocv;
    if (msg) { n.textContent = msg; return; }
    if (S.raster) { n.textContent = S.engineUsed === 'picrooms' ? 'A picture (scan): ' + S.rows.length + ' compartments found by OpenCV in the image.' : 'A picture (scan): read by image analysis; OpenCV looks for the compartments once the scale is known.'; return; }
    if (S.engine === 'lines') { n.textContent = 'Read from the lines of the PDF.'; return; }
    if (S.engineUsed === 'rooms' && S.rooms && S.rooms.out) { n.textContent = 'Compartments from the lines: ' + S.rows.length + ' blocks in ' + S.rooms.out.views.length + ' views (' + S.rooms.out.plans.map(function (p) { return p.title + ' ' + p.z + ' m'; }).join(', ') + ').'; return; }
    if (!S.info.loa) { n.textContent = 'OpenCV needs the length overall: type it, then the drawing is read again.'; return; }
    if (!o || o.key !== ocvKey()) { n.textContent = 'OpenCV: waiting.'; return; }
    if (o.busy) { n.textContent = 'OpenCV: reading the drawing…'; return; }
    if (o.err) { n.textContent = 'OpenCV could not run here (' + o.err + '): read from the lines of the PDF.'; return; }
    if (ocvUse()) { n.textContent = 'Read with OpenCV in ' + (o.res.ms / 1000).toFixed(1) + ' s: ' + (o.res.TK.blocks.length + o.res.EN.blocks.length) + ' blocks, ' + o.res.BH.list.length + ' bulkheads, ' + o.res.LV.levels.length + ' levels' + (o.res.HU ? ', hull table' : '') + '.'; return; }
    n.textContent = 'OpenCV found no blocks (' + (o.res && o.res.fail || 'no regular tank spans') + '): read from the lines of the PDF.';
  }
  async function ocvRun() {
    if (S.engine === 'lines' || S.raster || S.manual || !S.pdf || !S.page || !window.GAOCV || !S.info.loa || S.cruise) return;
    var key = ocvKey(); if (S.ocv && S.ocv.key === key) return;
    var tok = S.ocvTok = (S.ocvTok || 0) + 1, h0 = histSer();
    S.ocv = { key: key, busy: true }; ocvStatus();
    try {
      var RM = { profile: 'profile', deck: 'deck plan', tank: 'tank plan', section: 'section' };
      var r = await GAOCV.analyse(S.page, S.rot, S.info, { views: S.views.map(function (b, i) { return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, role: RM[S.roles[i]] }; }).filter(function (v) { return v.role; }) });
      if (tok !== S.ocvTok) return;
      if (r.turn && (S.ocvTurned || 0) < 1) { S.ocvTurned = (S.ocvTurned || 0) + 1; S.ocv = null; S.rot = (S.rot + r.turn) % 4; await setRotation(true); toast('The sheet was turned so that its text reads upright.'); return; }
      S.ocv = { key: key, res: r };
    } catch (e) { if (tok !== S.ocvTok) return; S.ocv = { key: key, err: (e && e.message) || String(e) }; }
    if (!ocvUse()) { ocvStatus(); return; }
    if (histSer() !== h0) { ocvStatus('OpenCV finished after you changed the blocks, so your blocks were kept. Press Re-scan drawing to use the OpenCV result.'); return; }
    var before = S.rows.length; reanalyse(false); fit();
    if (ocvUse()) toast('Read with OpenCV: ' + S.rows.length + ' blocks (the lines of the PDF gave ' + before + ').');
  }
  var OCV_GROUP = { 'Cargo tanks': ['cargo', 'g_cargo'], 'Slop tanks': ['slop', 'g_cargo'], 'Ballast tanks': ['tank', 'g_tanks'], Machinery: ['space', 'g_mach'], Accommodation: ['house', 'g_acc'], 'Other spaces': ['space', 'g_outfit'] };
  function ocvName(s) { return String(s).replace(/\s*\(([PS])\)/g, ' ($1)').replace(/\s+/g, ' ').replace(/\b([A-Z])([A-Z]{3,})\b/g, function (m, a, b) { return a + b.toLowerCase(); }).trim(); }
  function ocvApply(res) {
    var o = S.ocv.res, kR = o.kR, F = o.frames, pr = F.profile, pl = F.tank || F.deck, dk = F.deck || F.tank, r2 = G.r2;
    var sc = res.scale; sc.sx = kR / o.k; sc.sy = sc.sz = kR / o.ky; sc.xA = pr.outline.x / kR; sc.baseY = pr.baseline / kR; sc.yc = pl.centreline / kR;
    sc.lengthPts = pr.lengthPx / kR; sc.beamPts = pl.breadthPx / kR; sc.heightPts = (pr.baseline - pr.mainDeck) / kR; sc.lengthHow = 'OpenCV: profile outline'; sc.beamRatio = S.info.beam ? pl.breadthPx / o.ky / S.info.beam : null; sc.depthRatio = S.info.depth ? (pr.baseline - pr.mainDeck) / o.ky / S.info.depth : null;
    res.deckY = pr.mainDeck / kR; res.deckPlan = Object.assign({ segs: [] }, res.deckPlan || {}, { yc: dk.centreline / kR });
    res.bulkheads = o.BH.list.map(function (b) { return b.x; }); res.tankNote = o.TK.cargo.length + ' regular cargo tank spans (OpenCV)';
    res.notes = ['Read with OpenCV (image analysis of the page). Choose "Lines of the PDF only" under Engine to compare.'].concat(o.notes || []);
    S.levels = o.LV.levels.map(function (l) { return { z: l.z, x0: l.x0, x1: l.x1, len: l.length, main: l.kind === 'main deck', use: false, name: l.kind }; });
    var deckYc = dk.centreline / kR, rows = [];
    o.TK.blocks.concat(o.EN.blocks).forEach(function (b) {
      var m = OCV_GROUP[b.group] || ['space', 'g_outfit'], kind = /forecastle/i.test(b.name) ? 'house' : m[0];
      var x0 = b.position[0] - b.size[0] / 2, y0 = b.position[1] - b.size[1] / 2, z0 = b.position[2] - b.size[2] / 2, yc0 = b.position[1];
      var row = { id: ++S.uid, kind: kind, name: ocvName(b.name), side: yc0 > 0.05 ? 'P' : yc0 < -0.05 ? 'S' : '', x0: r2(x0), x1: r2(x0 + b.size[0]), y0: r2(y0), y1: r2(y0 + b.size[1]), z0: r2(z0), z1: r2(z0 + b.size[2]), group: m[1], on: true, src: 'OpenCV: ' + (b.source || '') };
      if (kind === 'cargo' || kind === 'slop') { row.density = 0.85; row.fill = 98; row.deck = false; } else if (kind === 'tank') { row.density = 1.025; row.fill = 100; }
      if (kind === 'house') row.yc = deckYc;
      rows.push(row);
    });
    var c1 = rows.filter(function (r) { return r.kind === 'cargo'; })[0]; if (c1) c1.deck = true;
    S.rows = rows.concat(userNow()); S.engineUsed = 'opencv';
    var HU = o.HU;
    if (HU && HU.xs && HU.xs.length > 3) {
      var D = HU.D, T = Math.min(D, S.info.draughtDesign || S.info.draught || 0.65 * D), vol = 0, i, j, B = S.info.beam || HU.B, L = S.info.loa || HU.L;
      for (i = 0; i + 1 < HU.xs.length; i++) for (j = 0; j + 1 < HU.zs.length; j++) { if (HU.zs[j + 1] > T + 1e-9) continue; var a = HU.half[j][i] || 0, b2 = HU.half[j][i + 1] || 0, a2 = HU.half[j + 1][i] || 0, b3 = HU.half[j + 1][i + 1] || 0; vol += (a + b2 + a2 + b3) / 4 * 2 * (HU.xs[i + 1] - HU.xs[i]) * (HU.zs[j + 1] - HU.zs[j]); }
      var top = HU.half[HU.half.length - 1];
      S.guess = { hull: { type: 'offsets', offsets: { zs: HU.zs, xs: HU.xs, half: HU.half }, x: 0, y: 0, loa: r2(HU.L), beam: r2(HU.B), depth: r2(D), draught: r2(T) }, cb: vol / (L * B * T), plan: HU.xs.map(function (x, q) { return [x, top[q] || 0]; }), fromOcv: true };
      if (S.hullMode === 'preset') { S.hullMode = 'guess'; $('selHull').value = 'guess'; }
    }
  }
  function reanalyse(notify, again) {
    S.anaGen = (S.anaGen || 0) + 1; S.vframe = null;
    if (!S.rotd) return;
    if (S.cruise && S.raster) { cruiseAnalyse(); if (notify) toast('Blocks updated: ' + S.rows.length + '.'); return; }
    if (!again) ['loa', 'beam', 'depth'].forEach(function (k) { if (S.est[k]) { delete S.info[k]; delete S.est[k]; delete S.infoSrc[k]; } });   // values that were only measured or assumed are measured again
    var assumed = !S.info.loa, infoA = assumed ? Object.assign({}, S.info, { loa: ASSUME_L }) : S.info;
    var res = G.analyse(S.aSegs, viewMap(), infoA); S.ruler = null;
    if (S.sheet && res.scale.sx != null && S.info.loa && !assumed) {                 // a sheet with a ruler of frame ticks: it gives the scale
      var rp = G.rulerPitch(S.aSegs);
      if (rp) {
        var fs = G.frameSpacing(rp.pitch, S.info.loa, res.scale.lengthPts, S.info.frameMM);
        if (fs) { S.ruler = { pitch: rp.pitch, spacing: fs, ticks: rp.n, sheetMM: S.info.frameMM, x0: rp.x0 }; res = G.analyse(S.aSegs, viewMap(), S.info, { ptsPerM: rp.pitch / fs }); }
      }
    }
    if (S.manual) {                                                      // clicked geometry; the scale follows the length, breadth and depth now in the form
      var Mn = S.manual, L2 = infoA.loa; Mn.sx = L2 / Mn.lengthPts; Mn.sy = S.info.beam ? S.info.beam / Mn.beamPts : Mn.sx; Mn.sz = S.info.depth ? S.info.depth / Mn.heightPts : Mn.sx;
      res.scale = Object.assign({}, res.scale, Mn); res.notes = [Mn.auto ? 'The scale was proposed from the picture.' : 'The scale was set by clicks.'];
      if (Mn.ycDeck != null) res.deckPlan = { yc: Mn.ycDeck };
    }
    if (assumed && res.scale.sx != null) {                               // no length: from a typed breadth or depth and the proportions of the drawing, else a ship of length 1
      var L1 = ASSUME_L, sc0 = res.scale;
      if (S.info.beam && sc0.beamPts) L1 = S.info.beam * sc0.lengthPts / sc0.beamPts; else if (S.info.depth && sc0.heightPts) L1 = S.info.depth * sc0.lengthPts / sc0.heightPts;
      S.info.loa = G.r2(L1); S.est.loa = true; S.infoSrc.loa = L1 === ASSUME_L ? 'assumed to be ' + ASSUME_L + ': not found. Type the real length and everything scales.' : 'from the typed ' + (S.info.beam ? 'breadth' : 'depth') + ' and the proportions of the drawing';
      renderInfo(); return reanalyse(notify, true);
    }
    if (res.scale.sx != null) {                                          // breadth and depth missing: take them from the drawing (measured with the length scale), marked as estimates
      var chg = false, r2e = G.r2;
      if (!S.info.beam && res.scale.beamPts) { S.info.beam = r2e(res.scale.beamPts * res.scale.sx); S.infoSrc.beam = 'measured on the drawing'; S.est.beam = true; chg = true; }
      if (!S.info.depth && res.scale.heightPts) { S.info.depth = r2e(res.scale.heightPts * res.scale.sx); S.infoSrc.depth = 'measured on the drawing'; S.est.depth = true; chg = true; }
      if (chg && !S.manual) { renderInfo(); return reanalyse(notify, true); }
      if (chg) renderInfo();
    }
    var keep = S.manual ? S.rows : null; if (keep && S.manual._p) rescaleRows(keep, S.manual._p, S.manual);       // blocks drawn over a picture keep their place on the drawing when the scale changes
    if (S.manual) S.manual._p = { sx: S.manual.sx, sy: S.manual.sy, sz: S.manual.sz, xA: S.manual.xA, yc: S.manual.yc, baseY: S.manual.baseY };
    S.userKeep = (S.rows || []).filter(function (r) { return r.kind === 'user'; });      // blocks you drew or found stay when the drawing is read again
    S.res = res; S.levels = []; S.rows = keep || S.userKeep.slice(); if (!keep) S.sel = -1;
    if (res.scale.sx != null && !S.manual) {
      var D = S.info.depth || (res.scale.heightPts ? res.scale.heightPts * res.scale.sz : 0);
      S.levels = res.levels.filter(function (l) { return l.len >= 5; }).map(function (l) {
        var span = l.x1 - l.x0, isMain = D && Math.abs(l.z - D) < 0.6;
        return { z: l.z, x0: l.x0, x1: l.x1, len: l.len, main: isMain, use: !!D && l.z > D + 1.0 && span <= 0.2 * (S.info.loa || 1e9) && l.len >= 10, runs: l.runs };
      });
      (function () {                                                      // the first floor of the house shares its height with a rail or pipe line that runs the whole length: take the run that is as long as the house
        var up = S.levels.filter(function (l) { return l.use; }); if (!up.length) return;
        var hx0 = Math.min.apply(null, up.map(function (l) { return l.x0; })), hx1 = Math.max.apply(null, up.map(function (l) { return l.x1; })), hl = hx1 - hx0;
        S.levels.forEach(function (l) {
          if (l.use || !D || !(l.z > D + 1.0) || !l.runs) return;
          var sr = l.runs.filter(function (q) { return q[1] - q[0] >= 0.8 * hl && q[1] - q[0] <= 1.3 * hl && q[0] >= hx0 - 0.1 * hl && q[1] <= hx1 + 0.1 * hl; })[0];
          if (sr) { l.x0 = sr[0]; l.x1 = sr[1]; l.len = sr[1] - sr[0]; l.use = true; }
        });
      })();
      var rows = G.suggestTanks(res, S.info);
      rows.forEach(function (r) { if (r.kind === 'cargo') { r.density = 0.85; r.fill = 98; r.deck = false; } r.id = ++S.uid; });
      var named = nameSpaces(rows, res);
      var er = S.spec && S.spec.ranges.length && S.ruler || named.engine ? null : engineRoom(); if (er) { er.id = ++S.uid; rows.push(er); }
      specRows().forEach(function (r) { r.id = ++S.uid; rows.push(r); });
      S.rows = rows.concat(S.userKeep || []);
      if (S.rows.length) { var first = S.rows.filter(function (r) { return r.kind === 'cargo'; })[0]; if (first) first.deck = true; }
      regenDecks();
    }
    S.section = null;
    if (res.scale.sx != null && !S.manual) {                              // a section view gives the transverse shape: take the one whose width fits the breadth best
      var Bm = S.info.beam || (res.scale.beamPts ? res.scale.beamPts * res.scale.sy : 0), Dm = S.info.depth || (res.scale.heightPts ? res.scale.heightPts * res.scale.sz : 0), ppm = 1 / res.scale.sx;
      S.views.forEach(function (b, i) {
        if (S.roles[i] !== 'section' || !(Bm > 0 && Dm > 0)) return;
        var sh = G.sectionShape(S.aSegs, b, ppm, Dm, Bm); if (!sh) return;
        var err = Math.abs(sh.wmaxM - Bm / 2) / (Bm / 2); if (err > 0.15) return;
        if (!S.section || err < S.section.err) { sh.err = err; sh.view = i; S.section = sh; }
      });
    }
    S.guess = res.scale.sx != null ? G.guessHull(res, S.info, { section: S.section }) : null;
    S.engineUsed = 'lines'; if (!S.manual && !S.raster && ocvUse()) ocvApply(res);
    if (!S.manual && !S.raster && S.engine === 'auto') roomsApply(res);
    ocvStatus(); if (!S.raster && !S.manual && S.engineUsed !== 'rooms') setTimeout(ocvRun, 0);
    if (S.raster && !S.cruise) setTimeout(picRoomsRun, 0);
    renderScale(); renderHull(); renderAll(); renderGuide();
    if (!H.busy) setTimeout(histCommit, 0);
    if (notify) toast(S.rows.length ? 'Suggestions updated: ' + S.rows.length + ' blocks.' : 'No tank blocks found with these views and values.');
  }
  /* Compartments and tanks from the specification: x from the frame numbers (frame 0 and the frame spacing come from the ruler), y and z from the names. These y and z are placeholders. */
  function specRows() {
    var sp = S.spec, sc = S.res && S.res.scale, out = [];
    if (!sp || !sp.ranges.length || !S.ruler || !sc || sc.sx == null) return out;
    if (S.info.frame0 == null || S.infoSrc.frame0 === 'ruler') { S.info.frame0 = G.r2((S.ruler.x0 - sc.xA) * sc.sx); S.infoSrc.frame0 = 'ruler'; }
    var sps = S.ruler.spacing, f0 = +S.info.frame0 || 0, after = S.info.frameAfter != null ? +S.info.frameAfter : 27, B = S.info.beam || 0, D = S.info.depth || 0;
    if (!(B > 0 && D > 0 && sps > 0)) return out;
    var hw = 0.45 * B;
    sp.ranges.forEach(function (r) {
      var x0 = f0 + G.frameIndex(r.f0, after) * sps, x1 = f0 + G.frameIndex(r.f1, after) * sps, y0, y1, z0, z1, grp, row;
      if (x1 < x0) { var t = x0; x0 = x1; x1 = t; }
      if (r.kind === 'space') {
        y0 = -hw; y1 = hw; z0 = 0; z1 = D;
        grp = /engine|thruster|machin/i.test(r.name) ? 'g_mach' : /accommod|cabin/i.test(r.name) ? 'g_acc' : /cargo|hold/i.test(r.name) ? 'g_cargo' : 'g_outfit';
        row = { kind: 'space', name: r.name + ' (fr. ' + r.f0 + '…' + r.f1 + ')', group: grp, on: false };
      } else {
        var side = r.side === 'S' ? -1 : r.side === 'P' || r.side === 'S2' ? 1 : 0;
        if (r.dbb) { z0 = 0; z1 = Math.min(1.0, 0.25 * D); } else if (r.wing) { z0 = 0.1 * D; z1 = 0.7 * D; } else { z0 = 0; z1 = 0.5 * D; }
        if (r.wing && side) { y0 = side > 0 ? 0.7 * hw : -hw; y1 = side > 0 ? hw : -0.7 * hw; }
        else if (side) { y0 = side > 0 ? 0 : -hw; y1 = side > 0 ? hw : 0; }
        else { y0 = -0.5 * hw; y1 = 0.5 * hw; }
        grp = 'g_tanks'; row = { kind: 'tank', name: r.name + ' (fr. ' + r.f0 + '…' + r.f1 + ')', group: grp, on: true, density: /fuel|oil/i.test(r.name) ? 0.86 : 1.0, fill: 98 };
      }
      row.x0 = G.r2(x0); row.x1 = G.r2(x1); row.y0 = G.r2(y0); row.y1 = G.r2(y1); row.z0 = G.r2(z0); row.z1 = G.r2(z1); row.side = r.side || ''; row.fromSpec = true;
      out.push(row);
    });
    return out;
  }
  /* Names for the spaces between the bulkheads, from the words printed in the plan (ENGINE ROOM, PUMP ROOM, STEERING GEAR ROOM, FORE PEAK). */
  var SPACE_NAMES = [[/engine\s*room|machinery/i, 'Engine room', 'g_mach'], [/pump\s*room/i, 'Pump room', 'g_mach'], [/steering/i, 'Steering gear room', 'g_mach'], [/fore\s*peak|bow\s*thr|thruster/i, 'Fore peak tank', 'g_tanks'], [/aft\s*peak/i, 'Aft peak tank', 'g_tanks']];
  function nameSpaces(rows, res) {
    var out = { engine: false }, lab = (S.tlabels || []).concat(S.labels || []), sc = res.scale; if (!lab.length || sc.sx == null) return out;
    var pj = S.roles.indexOf('tank'); if (pj < 0) pj = S.roles.indexOf('deck'); var box = pj >= 0 ? S.views[pj] : null; if (!box) return out;
    rows.forEach(function (r) {
      if (r.kind !== 'space') return;
      var a = sc.xA + r.x0 / sc.sx, b = sc.xA + r.x1 / sc.sx, hit = null;
      lab.forEach(function (l) { if (!l.text) return; var cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2; if (cx < a || cx > b || cy < box.y0 || cy > box.y1) return; SPACE_NAMES.forEach(function (n) { if (!hit && n[0].test(l.text)) hit = n; }); });
      if (!hit) return; r.name = hit[1]; r.group = hit[2]; r.on = true; if (hit[1] === 'Engine room') out.engine = true;
    });
    return out;
  }
  function engineRoom() {
    var r = S.res, sc = r.scale; if (!r.bulkheads || !r.bulkheads.length || sc.sx == null) return null;
    var xb = r.bulkheads[0], L = S.info.loa || 0;
    if (!(xb > 3 && xb < 0.2 * L)) return null;
    var D = S.info.depth || sc.heightPts * sc.sz, skin = S.info.dbSide != null ? S.info.dbSide : 2.4, pxm = sc.xA + (xb / 2) / sc.sx, hw = (r.envelope ? r.envelope(pxm) * sc.sy : (S.info.beam || 40) / 2) - skin;
    if (!(hw > 1)) return null;
    return { kind: 'mach', name: 'Engine room', side: '', x0: 0, x1: G.r2(xb), y0: G.r2(-hw), y1: G.r2(hw), z0: 0, z1: G.r2(D), group: 'g_mach', on: false };
  }
  function regenDecks() {
    S.rows = S.rows.filter(function (r) { return r.kind !== 'deck'; });
    var res = S.res; if (!res || res.scale.sx == null) return;
    var D = S.info.depth || res.scale.heightPts * res.scale.sz, used = S.levels.filter(function (l) { return l.use; }).sort(function (a, b) { return a.z - b.z; }), seq = [], i, n = 0;
    if (!used.length) return;
    seq.push({ z: D, x0: used[0].x0, x1: used[0].x1, base: true }); used.forEach(function (l) { seq.push(l); });
    for (i = 0; i + 1 < seq.length; i++) {
      var a = seq[i], b = seq[i + 1], h = b.z - a.z; if (h < 1.5) continue;
      var x0 = a.base ? b.x0 : Math.min(a.x0, b.x0), x1 = a.base ? b.x1 : Math.max(a.x1, b.x1), w = G.houseWidth(res, x0, x1, S.info) || 0.6 * (S.info.beam || 30);
      n++; S.rows.push({ id: ++S.uid, kind: 'deck', name: 'Accommodation deck ' + n, side: '', x0: G.r2(x0), x1: G.r2(x1), y0: G.r2(-w / 2), y1: G.r2(w / 2), z0: G.r2(a.z), z1: G.r2(b.z), group: 'g_acc', on: true });
    }
  }

  /* ---------- the panels ---------- */
  function renderScale() {
    var r = S.res, sc = r ? r.scale : {}, out = [];
    if (!r || sc.sx == null) { $('scaleOut').innerHTML = '<dt>Scale</dt><dd class="warn">needs length</dd>'; $('scaleNote').textContent = (r && r.notes.join(' ')) || 'Choose a profile or plan view and enter the length overall.'; return; }
    function cls(p) { return Math.abs(p) < 3 ? 'ok' : Math.abs(p) < 8 ? 'warn' : 'bad'; }
    if (S.ruler) out.push(['Ruler', fmt(S.ruler.pitch, 1) + ' pt = ' + fmt(S.ruler.spacing * 1000, 0) + ' mm (frame)' + (S.ruler.sheetMM && Math.abs(S.ruler.sheetMM - S.ruler.spacing * 1000) > 1 ? ', not the ' + S.ruler.sheetMM + ' read from the sheet' : ''), 'ok|' + S.ruler.ticks + ' ticks']);
    out.push(['Length', fmt(sc.lengthPts, 0) + ' pt' + (S.ruler ? ' = ' + fmt(sc.lengthPts * sc.sx, 1) + ' m (sheet: ' + fmt(S.info.loa, 2) + ')' : ' = ' + fmt(S.info.loa, 1) + ' m'), '']);
    out.push(['m per pt', fmt(sc.sx, 4), '']);
    if (sc.beamPts) { var pb = sc.beamRatio ? (sc.beamRatio - 1) * 100 : null; out.push(['Beam', fmt(sc.beamPts * sc.sx, 1) + ' m by length scale', pb == null ? '' : cls(pb) + '|' + (pb > 0 ? '+' : '') + fmt(pb, 1) + '% vs sheet']); }
    if (sc.heightPts) { var pd = sc.depthRatio ? (sc.depthRatio - 1) * 100 : null; out.push(['Depth', fmt(sc.heightPts * sc.sx, 1) + ' m by length scale', pd == null ? '' : cls(pd) + '|' + (pd > 0 ? '+' : '') + fmt(pd, 1) + '% vs sheet']); }
    $('scaleOut').innerHTML = out.map(function (o) { var p = o[2].split('|'); return '<dt>' + o[0] + '</dt><dd class="' + (p.length > 1 ? p[0] : '') + '">' + esc(o[1]) + (p.length > 1 ? '<br>' + esc(p[1]) : '') + '</dd>'; }).join('');
    $('scaleNote').textContent = 'Widths and heights are fitted to the breadth and depth from the particulars when they agree within 10%.' + (r.notes.length ? ' ' + r.notes.join(' ') : '');
  }
  function renderHull() {
    var g = S.guess, n = $('hullNote');
    if (S.hullMode === 'contour') { n.textContent = S.chull ? 'Hull from the contours of Edit hull: Cb ' + fmt(S.chull.cb, 2) + ' at the draught.' : 'No contours yet: press Edit hull.'; return; }
    if (S.hullMode === 'guess' && !g) { n.textContent = 'No outline found in the plan views, so the preset shape is used.'; return; }
    n.textContent = g && g.fromSection ? 'Half-breadths along the length are read from the plan outline; the cross-section is read from view #' + (S.section.view + 1) + ' (width within ' + Math.round(S.section.err * 100) + '% of the breadth) and pulled in toward the ends by an assumed amount. Below 40% of the depth the section is not read: a bilge arc is assumed. The keel rise aft (' + fmt(g.rise, 1) + ' m) is assumed. Cb at the draught: ' + fmt(g.cb, 2) + '. Refine it in the hull tool.' : g ? 'Half-breadths are read from the plan outline. The bilge radius (' + fmt(g.bilge, 1) + ' m) and the rise of the keel aft (' + fmt(g.rise, 1) + ' m) are assumed, the sides are vertical and the deck is flat. Cb at the draught: ' + fmt(g.cb, 2) + '. Refine it in the hull tool.' : 'Needs the length overall and a plan view.';
  }
  $('selHull').onchange = function () { S.hullMode = this.value; renderHull(); renderChecks(); draw(); d3draw(); };
  function groupOpts(sel) { return GSEL.map(function (g) { return '<option value="' + g + '"' + (g === sel ? ' selected' : '') + '>' + G.GROUP_NAMES[g] + '</option>'; }).join(''); }
  function vol(r) { return G.shapeFactor(r.shape || 'box') * Math.abs(r.x1 - r.x0) * Math.abs(r.y1 - r.y0) * Math.abs(r.z1 - r.z0); }
  function renderBlocks() {
    var head = '<tr><th></th><th>Name</th><th>Group</th><th>Shape</th><th class="num">X from</th><th class="num">X to</th><th class="num">Y from</th><th class="num">Y to</th><th class="num">Z from</th><th class="num">Z to</th><th class="num">m³</th><th></th></tr>';
    $('blkTbl').innerHTML = head + S.rows.map(function (r, i) {
      function n(k) { return '<td class="num"><input type="number" step="0.1" data-k="' + k + '" value="' + r[k] + '" aria-label="' + k + '"></td>'; }
      return '<tr class="pick' + (r.on === false ? ' off' : '') + (S.sel === i ? ' sel' : '') + '" data-i="' + i + '"><td><input type="checkbox" data-k="on" ' + (r.on !== false ? 'checked' : '') + ' aria-label="Use this block"></td>' +
        '<td><span class="sw" style="background:' + (GCOL[r.group] || '#888') + '"></span><input type="text" data-k="name" value="' + esc(r.name) + '" spellcheck="false"></td>' +
        '<td><select data-k="group">' + groupOpts(r.group) + '</select></td><td><select data-k="shape">' + G.SHAPES.map(function (q) { return '<option value="' + q.id + '"' + ((r.shape || 'box') === q.id ? ' selected' : '') + '>' + q.label + '</option>'; }).join('') + '</select></td>' + n('x0') + n('x1') + n('y0') + n('y1') + n('z0') + n('z1') +
        '<td class="num">' + fmt(vol(r), 0) + '</td><td><button class="btn sm" data-del="' + i + '" title="Remove this block">×</button></td></tr>';
    }).join('');
    var on = S.rows.filter(function (r) { return r.on !== false; }), cargo = on.filter(function (r) { return r.kind === 'cargo'; }).reduce(function (a, r) { return a + vol(r); }, 0);
    $('blkSum').textContent = on.length + ' of ' + S.rows.length + ' blocks ticked' + (cargo ? ' · cargo tanks as boxes ' + fmt(cargo, 0) + ' m³' + (S.info.cargoVol ? ' (sheet ' + fmt(S.info.cargoVol, 0) + ' m³)' : '') : '');
    $('bdgBlocks').textContent = on.length;
    $('btnSave').disabled = !on.length; $('btnCsv').disabled = !on.length; $('btnPdf').disabled = !S.rotd;
  }
  $('blkTbl').addEventListener('change', function (e) {
    var tr = e.target.closest('tr[data-i]'), k = e.target.getAttribute('data-k'); if (!tr || !k) return;
    var r = S.rows[+tr.getAttribute('data-i')];
    if (k === 'on') r.on = e.target.checked; else if (k === 'name' || k === 'group' || k === 'shape') r[k] = e.target.value; else { var v = parseFloat(e.target.value); if (isFinite(v)) r[k] = v; }
    renderBlocks(); draw();
  });
  $('blkTbl').addEventListener('click', function (e) {
    var d = e.target.getAttribute('data-del');
    if (d != null) { S.rows.splice(+d, 1); S.sel = -1; renderBlocks(); draw(); return; }
    var tr = e.target.closest('tr[data-i]'); if (!tr || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    S.sel = +tr.getAttribute('data-i'); renderBlocks(); draw();
  });
  $('btnAddRow').addEventListener('click', function () {
    var D = S.info.depth || 10, L = S.info.loa || 50, B = S.info.beam || 20;
    S.rows.push({ id: ++S.uid, kind: 'user', name: 'New block', shape: S.shape || 'box', side: '', x0: 0, x1: G.r2(L * 0.1), y0: G.r2(-B / 4), y1: G.r2(B / 4), z0: 0, z1: G.r2(D / 2), group: 'g_tanks', on: true });
    S.sel = S.rows.length - 1; renderBlocks(); draw();
    var tr = $('blkTbl').querySelector('tr[data-i="' + S.sel + '"]');
    if (tr) { tr.scrollIntoView({ block: 'nearest' }); var inp = tr.querySelector('input[data-k="name"]'); if (inp) { inp.focus(); inp.select(); } }
    toast('New block added at the end of the table. Type its name and set its x, y and z limits in metres.');
  });
  function renderLevels() {
    var sb = $('tab-levels').querySelector('.subbar'); if (sb && !sb.getAttribute('data-orig')) sb.setAttribute('data-orig', sb.textContent);
    if (sb) sb.textContent = S.cruise ? 'Passenger ship: the floor of each deck, in metres above the keel. The deck height is assumed (Ship data: Deck height); the blocks follow it.' : sb.getAttribute('data-orig');
    if (S.cruise) { $('levTbl').innerHTML = '<tr><th>Deck</th><th class="num">z floor (m)</th><th class="num">z ceiling (m)</th><th class="num">Length (m)</th></tr>' + S.levels.map(function (l) { return '<tr><td>' + esc(l.name || '') + '</td><td class="num">' + fmt(l.z, 2) + '</td><td class="num">' + fmt(l.z + (+S.info.deckHeight || 3), 2) + '</td><td class="num">' + fmt(l.len, 1) + '</td></tr>'; }).join(''); $('bdgLevels').textContent = S.levels.length; return; }
    var head = '<tr><th>Deck</th><th class="num">z (m)</th><th class="num">x from</th><th class="num">x to</th><th class="num">Line length</th><th></th></tr>';
    $('levTbl').innerHTML = head + S.levels.map(function (l, i) {
      return '<tr class="' + (l.use ? '' : 'off') + '"><td><input type="checkbox" data-l="' + i + '" ' + (l.use ? 'checked' : '') + ' aria-label="Use this level as a deck"></td><td class="num">' + fmt(l.z, 2) + '</td><td class="num">' + fmt(l.x0, 1) + '</td><td class="num">' + fmt(l.x1, 1) + '</td><td class="num">' + fmt(l.len, 1) + '</td><td>' + (l.main ? '<span class="chip ok">main deck</span>' : '') + '</td></tr>';
    }).join('');
    $('bdgLevels').textContent = S.levels.filter(function (l) { return l.use; }).length;
  }
  $('levTbl').addEventListener('change', function (e) {
    var i = e.target.getAttribute('data-l'); if (i == null) return;
    S.levels[+i].use = e.target.checked; regenDecks(); renderAll();
  });
  function renderChecks() {
    var li = [], r = S.res, sc = r ? r.scale : {};
    function add(t, c) { li.push('<li class="' + (c || '') + '">' + esc(t) + '</li>'); }
    if (!r) { $('chkList').innerHTML = '<li>Open a PDF first.</li>'; return; }
    if (sc.sx == null) add('Overall length is missing, so the scale is not set.', 'warn');
    r.notes.forEach(function (n) { add(n, 'warn'); });
    if (S.cruise) {
      var nd = S.cruise.scan.decks.length, cab = S.rows.filter(function (x) { return x.kind === 'cabin'; }), sp = S.rows.filter(function (x) { return x.kind === 'space'; });
      add('Deck plans found: ' + nd + (S.info.decks ? ' (particulars: ' + S.info.decks + ' decks' + (nd === S.info.decks + 1 ? '; the top deck is an open deck, so it is usually not counted' : '') + ').' : '.'), !S.info.decks || nd === S.info.decks || nd === S.info.decks + 1 ? 'good' : 'warn');
      add('Cabin blocks: ' + cab.length + ' rows of cabins' + (S.info.cabins ? ' (the sheet gives ' + S.info.cabins + ' cabins: a block holds a whole row, not one cabin)' : '') + '; other coloured areas: ' + sp.length + '.');
      var cv2 = cab.reduce(function (a, x) { return a + vol(x); }, 0); if (cv2 && S.info.cabins) add('Cabin blocks take ' + fmt(cv2, 0) + ' m³, which is ' + fmt(cv2 / S.info.cabins, 0) + ' m³ per cabin on average (a cabin of 24 to 85 m² and 3 m high is 70 to 250 m³).');
      if (!Object.keys(S.cruise.cn).length) add('The names of the cabin classes were not read from the legend: check the colours and rename the blocks.', 'warn');
      if (S.hullMode === 'guess' && S.guess) add('Hull guessed from the deck outlines: Cb ' + fmt(S.guess.cb, 2) + ' at the draught of ' + fmt(S.guess.hull.draught, 1) + ' m.', 'good');
      add('Every block is a box. The deck height is assumed, and so are the depth and the draught: edit them in Ship data.');
      $('chkList').innerHTML = li.join(''); return;
    }
    var cargo = S.rows.filter(function (x) { return x.kind === 'cargo'; }), slop = S.rows.filter(function (x) { return x.kind === 'slop'; });
    if (S.info.cargoTanks) add('Cargo tank blocks found: ' + cargo.length + ' (particulars: ' + S.info.cargoTanks + ').', cargo.length === S.info.cargoTanks ? 'good' : 'warn');
    if (S.info.slopTanks) add('Slop tank blocks found: ' + slop.length + ' (particulars: ' + S.info.slopTanks + ').', slop.length === S.info.slopTanks ? 'good' : 'warn');
    if (cargo.length && S.info.cargoVol) { var v = cargo.reduce(function (a, x) { return a + vol(x); }, 0), p = (v / S.info.cargoVol - 1) * 100; add('Cargo boxes ' + fmt(v, 0) + ' m³ against ' + fmt(S.info.cargoVol, 0) + ' m³ on the sheet (' + (p > 0 ? '+' : '') + fmt(p, 1) + '%). Boxes ignore the tapered ends and the tank top camber.', Math.abs(p) < 10 ? 'good' : 'warn'); }
    if (r.tankNote) add(r.tankNote + '.');
    if (!S.rows.some(function (x) { return x.kind === 'deck'; })) add('No deck blocks yet: tick levels in the Levels tab.');
    if (S.hullMode === 'contour' && S.chull) add('Hull from contours: Cb ' + fmt(S.chull.cb, 2) + ' at the draught of ' + fmt(S.chull.hull.draught, 1) + ' m' + (S.chull.cb > 0.9 || S.chull.cb < 0.4 ? ' (outside the usual range: check the contours).' : '.'), S.chull.cb > 0.9 || S.chull.cb < 0.4 ? 'warn' : 'good');
    if (S.hullMode === 'guess' && S.guess) add('Guessed hull: Cb ' + fmt(S.guess.cb, 2) + ' at the draught of ' + fmt(S.guess.hull.draught, 1) + ' m' + (S.guess.cb > 0.9 || S.guess.cb < 0.55 ? ' (outside the usual range: check the plan view and the breadth).' : '.'), S.guess.cb > 0.9 || S.guess.cb < 0.55 ? 'warn' : 'good');
    add('Every block is a box. Tapered tanks, the hull form and the superstructure shape need editing in DBB.');
    $('chkList').innerHTML = li.join('');
  }
  function renderAll() { renderBlocks(); renderLevels(); renderChecks(); draw(); if (typeof renderGuide === 'function') renderGuide(); }

  /* ---------- the viewer ---------- */
  function size() {
    var r = cv.parentNode.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); draw();
  }
  function fit() {
    if (!S.rotd) return;
    var r = cv.parentNode.getBoundingClientRect(), k = Math.min(r.width / S.rotd.W, r.height / S.rotd.H) * 0.97;
    S.view = { k: k, x: (r.width - S.rotd.W * k) / 2, y: (r.height - S.rotd.H * k) / 2 }; draw();
  }
  function zoomAt(f, cx, cy) {
    var v = S.view, nk = Math.min(40, Math.max(0.05, v.k * f)); f = nk / v.k;
    v.x = cx - (cx - v.x) * f; v.y = cy - (cy - v.y) * f; v.k = nk; draw();
  }
  function planMap() {
    var r = S.res; if (!r || r.scale.sx == null) return null;
    var sc = r.scale, tankBox = viewMap().tank, deckBox = viewMap().deck;
    return { sx: sc.sx, sy: sc.sy, sz: sc.sz, xA: sc.xA, baseY: sc.baseY, tankYc: sc.yc, deckYc: r.deckPlan ? r.deckPlan.yc : null, tankBox: tankBox, deckBox: deckBox };
  }
  function shapePath(c, shape, view, x0, y0, x1, y1) {                  // the outline of a block shape as seen in the plan or in the profile (y0 top, y1 bottom, on the screen)
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0; c.beginPath();
    if (shape === 'sphere' || (view === 'plan' && (shape === 'cylinder' || shape === 'cone'))) c.ellipse(cx, cy, Math.max(0.1, w / 2), Math.max(0.1, h / 2), 0, 0, 6.2832);
    else if (view === 'prof' && (shape === 'cone' || shape === 'pyramid')) { c.moveTo(x0, y1); c.lineTo(x1, y1); c.lineTo(cx, y0); c.closePath(); }
    else if (view === 'prof' && shape === 'halfcyl') { c.moveTo(x0, y1); c.lineTo(x1, y1); c.ellipse(cx, y1, Math.max(0.1, w / 2), Math.max(0.1, h), 0, 0, Math.PI, true); c.closePath(); }
    else if (view === 'prof' && shape === 'wedge') { c.moveTo(x0, y1); c.lineTo(x1, y1); c.lineTo(x1, y0); c.closePath(); }
    else c.rect(x0, y0, w, h);
  }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    $('hud').hidden = !S.img;
    if (!S.img) return;
    var v = S.view; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(S.img, v.x, v.y, S.rotd.W * v.k, S.rotd.H * v.k);
    function X(p) { return v.x + p * v.k; } function Y(p) { return v.y + p * v.k; }
    var css = getComputedStyle(document.documentElement), acc = css.getPropertyValue('--accent').trim() || '#1d4fd7', selc = css.getPropertyValue('--sel').trim() || '#ff2e93';
    ctx.lineWidth = 1.2; ctx.font = '600 11px Barlow, sans-serif';
    if (S.ov.views || S.mode === 'views') S.views.forEach(function (b, i) {
      var ign = S.roles[i] === 'ignore'; if (ign && S.mode !== 'views') return;
      var isel = S.mode === 'views' && S.vsel === i;
      if (isel) { ctx.fillStyle = 'rgba(29,79,215,.08)'; ctx.fillRect(X(b.x0), Y(b.y0), (b.x1 - b.x0) * v.k, (b.y1 - b.y0) * v.k); }
      ctx.lineWidth = isel ? 2.4 : 1.2; ctx.setLineDash(isel ? [] : [6, 4]); ctx.strokeStyle = ign ? 'rgba(120,130,145,.8)' : acc; ctx.strokeRect(X(b.x0), Y(b.y0), (b.x1 - b.x0) * v.k, (b.y1 - b.y0) * v.k); ctx.setLineDash([]); ctx.lineWidth = 1.2;
      var lab = '#' + (i + 1) + ' ' + (S.cruise ? (S.cruise.dn[i] || 'Deck ' + (S.views.length - i)).toUpperCase() : S.engineUsed === 'rooms' && b.title ? b.title.toUpperCase() : (ROLES.filter(function (r) { return r[0] === S.roles[i]; })[0] || ['', ''])[1].toUpperCase()); ctx.fillStyle = ign ? 'rgba(120,130,145,.95)' : acc; ctx.fillText(S.mode === 'views' ? lab : lab.replace(/^#\d+ /, ''), X(b.x0) + 3, Y(b.y0) - 4);
      if (isel) { ctx.fillStyle = '#fff'; ctx.strokeStyle = acc; [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1], [(b.x0 + b.x1) / 2, b.y0], [(b.x0 + b.x1) / 2, b.y1], [b.x0, (b.y0 + b.y1) / 2], [b.x1, (b.y0 + b.y1) / 2]].forEach(function (c) { ctx.fillRect(X(c[0]) - 4, Y(c[1]) - 4, 8, 8); ctx.strokeRect(X(c[0]) - 4, Y(c[1]) - 4, 8, 8); }); }
    });
    var m = planMap();
    if (m) {
      var pb = viewMap().profile;
      if (S.ov.bulk && pb && m.baseY != null && S.res.deckY != null) { ctx.strokeStyle = '#e07a1f'; ctx.lineWidth = 1.6; S.res.bulkheads.forEach(function (xm) { var px = X(m.xA + xm / m.sx); ctx.beginPath(); ctx.moveTo(px, Y(S.res.deckY)); ctx.lineTo(px, Y(m.baseY)); ctx.stroke(); }); }
      if (S.ov.lev && pb && m.baseY != null) S.levels.forEach(function (l) {
        var py = Y(m.baseY - l.z / m.sz); ctx.strokeStyle = l.use ? '#17a35a' : '#8c97a8'; ctx.lineWidth = l.use ? 2 : 0.8; ctx.setLineDash(l.use ? [] : [3, 3]);
        ctx.beginPath(); ctx.moveTo(X(m.xA + l.x0 / m.sx), py); ctx.lineTo(X(m.xA + l.x1 / m.sx), py); ctx.stroke(); ctx.setLineDash([]);
      });
      if (S.ov.blk && S.hullMode === 'guess' && S.guess && m.tankBox && m.tankYc != null) {
        var of = S.guess.hull.offsets, zi = of.zs.length - 1; ctx.strokeStyle = '#8a3ffc'; ctx.lineWidth = 1.6; ctx.setLineDash([]);
        [1, -1].forEach(function (sg) { ctx.beginPath(); of.xs.forEach(function (xm, q) { var yv = of.half[zi][q] || 0, px = X(m.xA + xm / m.sx), py = Y(m.tankYc - sg * yv / m.sy); if (q) ctx.lineTo(px, py); else ctx.moveTo(px, py); }); ctx.stroke(); });
      }
      if (S.ov.blk) S.rows.forEach(function (r, i) {
        if (r.on === false) return;
        var col = GCOL[r.group] || '#888', sel = i === S.sel, px0 = X(m.xA + Math.min(r.x0, r.x1) / m.sx), px1 = X(m.xA + Math.max(r.x0, r.x1) / m.sx);
        function box(yTop, yBot, view) {
          var shp = r.shape || 'box'; ctx.globalAlpha = 0.28; ctx.fillStyle = col; shapePath(ctx, shp, view, px0, yTop, px1, yBot); ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = sel ? selc : col; ctx.lineWidth = sel ? 2.4 : 1.2; ctx.stroke();
          if (sel && S.mode === 'blocks') { var mx = (px0 + px1) / 2, my = (yTop + yBot) / 2; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.2; [[px0, yTop], [px1, yTop], [px0, yBot], [px1, yBot], [mx, yTop], [mx, yBot], [px0, my], [px1, my]].forEach(function (c) { ctx.fillRect(c[0] - 3.5, c[1] - 3.5, 7, 7); ctx.strokeRect(c[0] - 3.5, c[1] - 3.5, 7, 7); }); } }
        var yc = r.kind === 'deck' && m.deckYc != null ? m.deckYc : m.tankYc;
        if (r.yc != null) box(Y(r.yc - Math.max(r.y0, r.y1) / m.sy), Y(r.yc - Math.min(r.y0, r.y1) / m.sy), 'plan');
        else if (!r.profileOnly && (r.kind === 'deck' ? m.deckBox : m.tankBox) && yc != null) box(Y(yc - Math.max(r.y0, r.y1) / m.sy), Y(yc - Math.min(r.y0, r.y1) / m.sy), 'plan');
        if (pb && m.baseY != null) box(Y(m.baseY - Math.max(r.z0, r.z1) / m.sz), Y(m.baseY - Math.min(r.z0, r.z1) / m.sz), 'prof');
      });
    }
    if (S.mode === 'hull') hcOverlay(ctx, X, Y);
    if (S.cal) { ctx.lineWidth = 1.6; ctx.strokeStyle = '#e0245e'; ctx.fillStyle = '#e0245e'; ctx.font = '700 12px Barlow, sans-serif'; S.cal.pts.forEach(function (p, i) { ctx.beginPath(); ctx.moveTo(X(p.x) - 8, Y(p.y)); ctx.lineTo(X(p.x) + 8, Y(p.y)); ctx.moveTo(X(p.x), Y(p.y) - 8); ctx.lineTo(X(p.x), Y(p.y) + 8); ctx.stroke(); ctx.fillText(String(i + 1), X(p.x) + 6, Y(p.y) - 6); }); }
    if (!S.cal && S.manual && S.manual.pts && S.rotd) { ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(224,36,94,.85)'; ctx.fillStyle = 'rgba(224,36,94,.9)'; ctx.font = '700 11px Barlow, sans-serif'; S.manual.pts.forEach(function (p, i) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 4.5, 0, 6.2832); ctx.stroke(); ctx.fillText(String(i + 1), X(p.x) + 7, Y(p.y) - 6); }); }
    if (S.fnd && S.fnd.ov && S.cvSet.show) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(S.fnd.ov.c, X(S.fnd.ov.x0), Y(S.fnd.ov.y0), S.fnd.ov.w * v.k, S.fnd.ov.h * v.k); ctx.restore(); }
    if (S.fnd) { ctx.save(); ctx.lineWidth = 2; ctx.setLineDash([6, 3]); ctx.strokeStyle = '#f08c00'; ctx.fillStyle = 'rgba(240,140,0,.16)'; ctx.font = '700 11px Barlow, sans-serif'; S.fnd.cand.forEach(function (c) { var qx = X(c.q.x0), qy = Y(Math.min(c.q.y0, c.q.y1)), qw = (c.q.x1 - c.q.x0) * v.k, qh = Math.abs(c.q.y1 - c.q.y0) * v.k; ctx.fillRect(qx, qy, qw, qh); ctx.strokeRect(qx, qy, qw, qh); ctx.fillStyle = '#b36200'; ctx.fillText(c.row.name, qx + 4, qy + 13); ctx.fillStyle = 'rgba(240,140,0,.16)'; }); ctx.restore(); }
    if (S.rubber) { ctx.strokeStyle = selc; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]); ctx.strokeRect(X(Math.min(S.rubber.x0, S.rubber.x1)), Y(Math.min(S.rubber.y0, S.rubber.y1)), Math.abs(S.rubber.x1 - S.rubber.x0) * v.k, Math.abs(S.rubber.y1 - S.rubber.y0) * v.k); ctx.setLineDash([]); }
    var h = $('hud'); h.textContent = Math.round(v.k * 100) + '%  ·  turned ' + (S.rot * 90) + '° clockwise';
  }
  var drag = null;
  function toPage(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - S.view.x) / S.view.k, y: (e.clientY - r.top - S.view.y) / S.view.k }; }
  cv.addEventListener('pointerdown', function (e) {
    cv.setPointerCapture(e.pointerId);
    if (S.mode === 'hull' && !S.hcPick && S.rotd) {                       // Edit hull: drag a handle, right-click removes it
      var hq = toPage(e), hi = hcNear(hq);
      if (hi >= 0 && e.button === 2) { S.hc[S.hcAct].splice(hi, 1); hcUpdate(true); return; }
      if (hi >= 0 && e.button === 0) { S.hcSelPt = { k: S.hcAct, i: hi }; draw(); drag = { pt: true, i: hi, k: S.hcAct }; cv.style.cursor = 'grabbing'; return; }
    }
    if (S.mode === 'views' && S.rotd && e.button === 0 && !e.shiftKey) {                      // Edit views: add by dragging, or select, move and resize
      var vq = toPage(e);
      vwSnap();
      if (S.vadd) { drag = { vnew: true, x0: vq.x, y0: vq.y }; S.rubber = { x0: vq.x, y0: vq.y, x1: vq.x, y1: vq.y }; return; }
      var vh = vhit(vq);
      if (vh) { S.vsel = vh.i; renderViews(); drag = { vw: true, i: vh.i, h: vh.h, q0: vq, o: { x0: S.views[vh.i].x0, x1: S.views[vh.i].x1, y0: S.views[vh.i].y0, y1: S.views[vh.i].y1 }, moved: false }; draw(); return; }
      S.vsel = -1; renderViews(); draw();
    }
    if (S.mode === 'blocks' && !S.draw && S.rotd && S.res && S.res.scale.sx != null && e.button === 0 && !e.shiftKey) {       // Edit blocks: drag a block or its edges
      var bq = toPage(e), bh = bhit(bq);
      if (bh) { var rw = S.rows[bh.i]; if (S.sel !== bh.i) { S.sel = bh.i; renderBlocks(); var tr0 = $('blkTbl').querySelector('tr[data-i="' + bh.i + '"]'); if (tr0) tr0.scrollIntoView({ block: 'nearest' }); }
        drag = { bw: true, i: bh.i, v: bh.v, h: bh.h, q0: bq, moved: false, o: bh.v === 'plan' ? { x0: Math.min(rw.x0, rw.x1), x1: Math.max(rw.x0, rw.x1), a0: Math.min(rw.y0, rw.y1), a1: Math.max(rw.y0, rw.y1) } : { x0: Math.min(rw.x0, rw.x1), x1: Math.max(rw.x0, rw.x1), a0: Math.min(rw.z0, rw.z1), a1: Math.max(rw.z0, rw.z1) } }; draw(); return; }
    }
    if (S.fnr && S.rotd && e.button === 0 && !e.shiftKey) { var fq = toPage(e); drag = { fnr: true }; S.rubber = { x0: fq.x, y0: fq.y, x1: fq.x, y1: fq.y }; return; }
    if (S.rgn && S.rotd && e.button === 0) { var rq = toPage(e); drag = { rgn: true, x0: rq.x, y0: rq.y }; S.rubber = { x0: rq.x, y0: rq.y, x1: rq.x, y1: rq.y }; return; }
    var pan = e.button === 1 || e.button === 2 || e.shiftKey || !(S.draw && S.rotd);          // in Draw block mode: drag draws, shift or middle button pans
    if (!pan) { var q = toPage(e); drag = { draw: true, x0: q.x, y0: q.y, cx: e.clientX, cy: e.clientY, moved: false }; if (!S.corner) S.rubber = { x0: q.x, y0: q.y, x1: q.x, y1: q.y }; return; }
    drag = { x: e.clientX, y: e.clientY, vx: S.view.x, vy: S.view.y, moved: false }; cv.classList.add('drag');
  });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  cv.addEventListener('pointermove', function (e) {
    if (drag && drag.fnr) { var fq2 = toPage(e); S.rubber.x1 = fq2.x; S.rubber.y1 = fq2.y; draw(); return; }
    if (drag && drag.rgn) { var rq2 = toPage(e); S.rubber.x1 = rq2.x; S.rubber.y1 = rq2.y; draw(); return; }
    if (drag && drag.bw) { drag.moved = true; bwApply(drag, toPage(e)); draw(); return; }
    if (!drag && S.mode === 'blocks' && S.rotd && !S.draw && S.res && S.res.scale.sx != null) { var hb = bhit(toPage(e)); cv.style.cursor = hb ? (VCUR[hb.h] || 'move') : ''; }
    if (drag && drag.vnew) { var vq2 = toPage(e); S.rubber.x1 = vq2.x; S.rubber.y1 = vq2.y; draw(); return; }
    if (drag && drag.vw) { drag.moved = true; vwApply(drag, toPage(e)); draw(); return; }
    if (!drag && S.mode === 'views' && S.rotd && !S.vadd) { var hv = vhit(toPage(e)); cv.style.cursor = hv ? VCUR[hv.h] || 'move' : ''; }
    if (drag && drag.pt) { var pp = hcFromPage(drag.k, toPage(e), true); if (pp) { S.hc[drag.k][drag.i] = pp; hcUpdate(true); } return; }
    if (!drag) { if (S.mode === 'hull' && !S.hcPick && S.rotd) cv.style.cursor = hcNear(toPage(e)) >= 0 ? 'grab' : ''; if (S.corner && S.rubber) { var q0 = toPage(e); S.rubber.x1 = q0.x; S.rubber.y1 = q0.y; draw(); } return; }
    if (drag.draw) { if (Math.abs(e.clientX - drag.cx) + Math.abs(e.clientY - drag.cy) > 4) drag.moved = true; if (S.corner && !drag.moved) return; var q = toPage(e); S.rubber.x1 = q.x; S.rubber.y1 = q.y; draw(); return; }
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > (S.mode === 'scale' ? 7 : 3)) drag.moved = true; if (drag.moved) { S.view.x = drag.vx + dx; S.view.y = drag.vy + dy; draw(); }
  });
  cv.addEventListener('pointerup', function (e) {
    cv.classList.remove('drag');
    if (drag && drag.fnr) { var rb2 = S.rubber; S.rubber = null; drag = null; draw(); if (rb2) findBlocksIn(rb2); return; }
    if (drag && drag.rgn) { var rb1 = S.rubber; S.rubber = null; drag = null; draw(); if (rb1) readPart(rb1); return; }
    if (drag && drag.bw) { var db = drag; drag = null; if (db.moved) { renderBlocks(); draw(); d3draw(); } else draw(); return; }
    if (drag && drag.vnew) { var rb0 = S.rubber; S.rubber = null; drag = null; if (rb0 && Math.abs(rb0.x1 - rb0.x0) > 8 && Math.abs(rb0.y1 - rb0.y0) > 8) { var nb = { x0: Math.min(rb0.x0, rb0.x1), x1: Math.max(rb0.x0, rb0.x1), y0: Math.min(rb0.y0, rb0.y1), y1: Math.max(rb0.y0, rb0.y1), n: 0, title: '' }; S.views.push(nb); S.roles.push('ignore'); S.vsel = S.views.length - 1; S.vadd = false; $('vwAdd').classList.remove('on'); cv.style.cursor = ''; viewsChanged('View added. Set its role in Views (left panel): Profile, Tank plan, Deck plan, Section.'); } else draw(); return; }
    if (drag && drag.vw) { var dv = drag; drag = null; if (dv.moved) { vwNorm(S.views[dv.i]); viewsChanged(); } else draw(); return; }
    if (drag && drag.pt) { hcSort(drag.k); drag = null; cv.style.cursor = ''; hcUpdate(true); return; }
    if (drag && drag.draw) {
      var d = drag; drag = null;
      if (d.moved) { var rb = S.rubber; S.rubber = null; S.corner = false; makeBlock(rb); draw(); return; }
      var q = toPage(e);                                                  // a click: the first click sets one corner, the second the opposite one
      if (!S.corner) { S.corner = true; S.rubber = { x0: q.x, y0: q.y, x1: q.x, y1: q.y }; toast('Click the opposite corner. Esc cancels.'); }
      else { var r2 = S.rubber; r2.x1 = q.x; r2.y1 = q.y; S.rubber = null; S.corner = false; makeBlock(r2); }
      draw(); return;
    }
    if (drag && !drag.moved) { if (S.mode === 'hull' && S.hcPick) hcClick(e); else if (S.mode === 'scale') calClick({ clientX: drag.x, clientY: drag.y }); else pick(e); } drag = null;
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.corner) { S.corner = false; S.rubber = null; draw(); } });
  cv.addEventListener('wheel', function (e) { e.preventDefault(); var r = cv.getBoundingClientRect(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; zoomAt(Math.exp(-Math.max(-120, Math.min(120, dy)) * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  function pick(e) {                                                  // click a block drawn on the drawing to select its row
    var m = planMap(); if (!m) return; var r = cv.getBoundingClientRect(), v = S.view, px = (e.clientX - r.left - v.x) / v.k, py = (e.clientY - r.top - v.y) / v.k, hit = -1;
    S.rows.forEach(function (row, i) {
      if (row.on === false) return;
      var x0 = m.xA + Math.min(row.x0, row.x1) / m.sx, x1 = m.xA + Math.max(row.x0, row.x1) / m.sx, yc = row.kind === 'user' && row.yc != null ? row.yc : row.kind === 'deck' && m.deckYc != null ? m.deckYc : m.tankYc;
      if (px < x0 || px > x1) return;
      var inPlan = yc != null && py >= yc - Math.max(row.y0, row.y1) / m.sy && py <= yc - Math.min(row.y0, row.y1) / m.sy, inProf = m.baseY != null && py >= m.baseY - Math.max(row.z0, row.z1) / m.sz && py <= m.baseY - Math.min(row.z0, row.z1) / m.sz;
      if (inPlan || inProf) hit = i;
    });
    S.sel = hit; renderBlocks(); draw();
    if (hit >= 0) { var tr = $('blkTbl').querySelector('tr[data-i="' + hit + '"]'); if (tr) tr.scrollIntoView({ block: 'nearest' }); }
  }
  /* A block from a rectangle drawn on the drawing. On a plan it gives x and y, on the profile x and z; the other limits are a first guess to edit. */
  function viewAt(px, py) { var hit = -1; S.views.forEach(function (b, i) { if (px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1 && (hit < 0 || (b.x1 - b.x0) * (b.y1 - b.y0) < (S.views[hit].x1 - S.views[hit].x0) * (S.views[hit].y1 - S.views[hit].y0))) hit = i; });
    return hit; }
  function blockRect(rb) {                                              // a rectangle in page units on a plan or the profile -> the limits of a block (or an error text)
    var sc = S.res && S.res.scale;
    if (!rb || !sc || sc.sx == null) return { err: 'No scale yet: press Set scale and click the five points, or open a drawing with lines.' };
    var ax = Math.min(rb.x0, rb.x1), bx = Math.max(rb.x0, rb.x1), ay = Math.min(rb.y0, rb.y1), by = Math.max(rb.y0, rb.y1);
    if (bx - ax < 3 || by - ay < 3) return { quiet: true };
    var vi = viewAt((ax + bx) / 2, (ay + by) / 2), role = vi >= 0 ? S.roles[vi] : null, D = S.info.depth || (sc.heightPts ? sc.heightPts * sc.sz : 5), B = S.info.beam || 10;
    var x0 = (ax - sc.xA) * sc.sx, x1 = (bx - sc.xA) * sc.sx, r, ycUsed = null, F = S.vframe && vi >= 0 ? S.vframe[vi] : null;
    if (F && F.ppm && (role === 'profile' ? F.base != null : F.cl != null && F.z != null)) {      // the frame the compartments were read with: its own aft end, centreline, bottom and deck height
      x0 = (ax - F.aft) / F.ppm; x1 = (bx - F.aft) / F.ppm;
      if (role === 'profile') r = { x0: G.r2(x0), x1: G.r2(x1), y0: G.r2(-B / 4), y1: G.r2(B / 4), z0: G.r2(Math.max(0, (F.base - by) / F.ppmZ)), z1: G.r2((F.base - ay) / F.ppmZ) };
      else r = { x0: G.r2(x0), x1: G.r2(x1), y0: G.r2((F.cl - by) / F.ppmA), y1: G.r2((F.cl - ay) / F.ppmA), z0: G.r2(F.z), z1: G.r2(F.zTop != null ? F.zTop : F.z + 2.8) };
      return { r: r, role: role, yc: role === 'profile' ? null : F.cl };
    }
    if (role === 'profile' && sc.baseY != null) {
      r = { x0: G.r2(x0), x1: G.r2(x1), y0: G.r2(-B / 4), y1: G.r2(B / 4), z0: G.r2(Math.max(0, (sc.baseY - by) * sc.sz)), z1: G.r2((sc.baseY - ay) * sc.sz) };
    } else if (role === 'tank' || role === 'deck' || role === 'plan') {
      var box = S.views[vi], yc = role === 'tank' ? sc.yc : role === 'deck' && S.res.deckPlan ? S.res.deckPlan.yc : (box.y0 + box.y1) / 2;
      var z0 = role === 'tank' ? (S.info.dbBottom || 0) : 0, z1 = D;
      if (role === 'plan') { z0 = D; z1 = D + 2.5; }
      ycUsed = yc;
      r = { x0: G.r2(x0), x1: G.r2(x1), y0: G.r2((yc - by) * sc.sy), y1: G.r2((yc - ay) * sc.sy), z0: G.r2(z0), z1: G.r2(z1) };
    } else return { err: 'Draw inside a profile or a plan view.' };
    return { r: r, role: role, yc: ycUsed };
  }
  function makeBlock(rb) {
    var o = blockRect(rb); if (o.quiet) return; if (o.err) { toast(o.err, true); return; } var r = o.r;
    S.rows.push({ id: ++S.uid, kind: 'user', shape: S.shape || 'box', name: 'Block ' + (S.rows.filter(function (q) { return q.kind === 'user'; }).length + 1), side: '', x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, z0: r.z0, z1: r.z1, group: 'g_tanks', on: true, yc: o.yc });
    S.sel = S.rows.length - 1; renderBlocks(); draw();
    var tr = $('blkTbl').querySelector('tr[data-i="' + S.sel + '"]'); if (tr) { tr.scrollIntoView({ block: 'nearest' }); var inp = tr.querySelector('input[data-k="name"]'); if (inp) { inp.focus(); inp.select(); } }
    toast(o.role === 'profile' ? 'Block drawn on the profile. Check its y limits (a guess) and rename it.' : 'Block drawn on a plan. Check its z limits (a guess) and rename it.');
  }
  /* ---------- OpenCV settings: how a view is read (the same for the whole drawing; Auto = as found best on the example GAs) ---------- */
  var CV_DEF = { th: null, gapM: 0.6, markM: 1.2, minM2: 1, text: true, show: true };
  S.cvSet = Object.assign({}, CV_DEF); try { var cs0 = JSON.parse(localStorage.getItem('ga2dbb.cvset') || 'null'); if (cs0) Object.assign(S.cvSet, cs0); } catch (e) { }
  function cvSave() { try { localStorage.setItem('ga2dbb.cvset', JSON.stringify(S.cvSet)); } catch (e) { } }
  function cvOpts(ppm, words) { var c = S.cvSet; return { pxPerM: ppm, gapM: c.gapM, markM: c.markM, minM2: c.minM2, th: c.th, text: c.text, textBoxes: words }; }
  function maskCanvas(A, k) {                                           // the ink OpenCV saw (red) and the compartments it found (light colours), drawn over the view
    if (!A.mask) return null; var c = document.createElement('canvas'); c.width = A.mw; c.height = A.mh; var g = c.getContext('2d'), im = g.createImageData(A.mw, A.mh), d = im.data, ok = {}, i;
    A.areas.forEach(function (a, q) { ok[a.id] = q + 1; });
    for (i = 0; i < A.mask.length; i++) { var o = i * 4; if (A.mask[i]) { d[o] = 214; d[o + 1] = 40; d[o + 2] = 40; d[o + 3] = 120; } else { var id = A.at(A.mx + i % A.mw, A.my + Math.floor(i / A.mw)), q = ok[id]; if (q) { var hue = (q * 67) % 360, rgb = hsl(hue); d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 70; } } }
    g.putImageData(im, 0, 0); return { c: c, x0: A.mx / k, y0: A.my / k, w: A.mw / k, h: A.mh / k };
  }
  function hsl(h) { var f = function (n) { var k = (n + h / 30) % 12, a = 0.55 * Math.min(0.6, 1 - 0.6); return Math.round(255 * (0.6 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; }
  /* Find blocks in one view with OpenCV: every closed compartment of the view is proposed as a block (plans and profile); a section gives the heights */
  async function scanView(vi, box) {
    var sc = S.res && S.res.scale, role = S.roles[vi], vb = box || S.views[vi]; if (!vb) return;
    if (!sc || sc.sx == null) { toast('No scale yet: press Set scale first.', true); return; }
    if (!window.GAOCV) { toast('OpenCV is not loaded here.', true); return; }
    if (!/tank|deck|plan|profile|section/.test(role || '')) { toast('Say first what this view is (a plan, the profile or a section), then press Find blocks again.', true); return; }
    var src = S.raster ? S.vsrc : S.img, k = S.raster ? 1 : S.imgK; if (!src) return;
    var ppm = k / sc.sx, words = [];
    if (S.raster && S.words && S.wordsRot === S.rot) words = S.words.words.filter(function (w) { return w.conf > 45 && /[A-Za-z0-9]/.test(w.text); });
    else if (!S.raster) words = (S.tlabels || []).map(function (l) { return { text: l.text, x0: l.x0 * k, y0: l.y0 * k, x1: l.x1 * k, y1: l.y1 * k }; });
    var A; S.busy++; setBusy();
    try { A = await GAOCV.areas(src, { x0: vb.x0 * k, y0: vb.y0 * k, x1: vb.x1 * k, y1: vb.y1 * k }, Object.assign(cvOpts(ppm, words), { mask: true })); }
    catch (e) { toast('OpenCV failed: ' + ((e && e.message) || e), true); return; } finally { S.busy--; setBusy(); }
    var cand = [], dup = 0, ov = maskCanvas(A, k), info = '';
    if (role === 'section') {                                           // the heights: the top and bottom edges of the wide compartments, from the bottom of the hull
      var base = Math.max.apply(null, A.areas.map(function (a) { return a.y1; })), wid = Math.max.apply(null, A.areas.map(function (a) { return a.x1; })) - Math.min.apply(null, A.areas.map(function (a) { return a.x0; })), hs = [];
      A.areas.forEach(function (a) { if (a.x1 - a.x0 < 0.3 * wid) return; [a.y0, a.y1].forEach(function (y) { var z = (base - y) / ppm; if (z > 0.3 && !hs.some(function (h) { return Math.abs(h - z) < 0.4; })) hs.push(z); }); });
      hs = hs.map(function (z) { return G.r2(z); }).sort(function (a, b) { return a - b; });
      var dbz = hs.filter(function (z) { return z >= 0.6 && z <= 3.5; })[0];
      S.fnd = { cand: [], ov: ov, vi: vi, box: box, sec: dbz || null };
      $('fndTxt').textContent = A.areas.length + ' compartments in the section. Heights above the bottom: ' + (hs.length ? hs.join(', ') + ' m' : 'none found') + '.' + (dbz ? ' Double bottom about ' + dbz + ' m.' : '');
      $('fndOk').textContent = dbz ? 'Use double bottom ' + dbz + ' m' : 'Add them'; $('fndOk').disabled = !dbz; $('fndBar').hidden = false; viewBarUpdate(); draw(); return;
    }
    A.areas.forEach(function (a, q) {
      var pq = { x0: a.x0 / k, y0: a.y0 / k, x1: a.x1 / k, y1: a.y1 / k }, br = blockRect(pq); if (!br.r) return; var r = br.r;
      var exists = S.rows.some(function (e) { if (e.on === false) return false; var ox = Math.min(e.x1, r.x1) - Math.max(e.x0, r.x0); if (!(ox > 0.6 * (r.x1 - r.x0))) return false; if (role === 'profile') { var oz = Math.min(e.z1, r.z1) - Math.max(e.z0, r.z0); return oz > 0.5 * (r.z1 - r.z0); } var oy = Math.min(Math.max(e.y0, e.y1), Math.max(r.y0, r.y1)) - Math.max(Math.min(e.y0, e.y1), Math.min(r.y0, r.y1)); return oy > 0.5 * Math.abs(r.y1 - r.y0) && e.z1 > r.z0 && e.z0 < r.z1; });
      if (exists) { dup++; return; }
      var nm = words.filter(function (w) { return A.at((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2) === a.id; }).sort(function (p, o) { return p.y0 - o.y0 || p.x0 - o.x0; }).map(function (w) { return w.text; }).join(' ').replace(/\s+/g, ' ').trim();
      var gk = nm && window.GAROOMS ? GAROOMS.groupOf(nm) : ['user', S.cruise ? 'g_outfit' : 'g_tanks'];
      var side = role === 'profile' ? '' : r.y0 > 0.1 ? 'P' : r.y1 < -0.1 ? 'S' : '';
      cand.push({ q: pq, row: { id: 0, kind: 'user', shape: S.shape || 'box', name: nm || ('Block ' + (cand.length + 1)), side: side, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, z0: r.z0, z1: r.z1, group: gk[1], on: true, yc: br.yc, profileOnly: role === 'profile' || undefined, src: 'OpenCV, one view' } });
    });
    S.fnd = { cand: cand, dup: dup, ov: ov, vi: vi, box: box };
    $('fndOk').textContent = 'Add them'; $('fndOk').disabled = !cand.length;
    $('fndTxt').textContent = cand.length + ' new block' + (cand.length === 1 ? '' : 's') + ' found by OpenCV in this ' + (role === 'profile' ? 'profile' : 'plan') + (dup ? ' (' + dup + ' already exist)' : '') + '. Red is what it took as lines. Missing a line? Change the settings.';
    $('fndBar').hidden = false; viewBarUpdate(); draw();
  }
  function cvPanel() {                                                  // the settings under the Find bar; every change reads the view again
    var p = $('cvSet'); if (!p) return; var c = S.cvSet;
    p.innerHTML = '<label title="What counts as a line: Auto lets the picture decide (Otsu). Lower keeps only dark lines, higher also takes grey lines.">Line darkness <input type="checkbox" data-c="thAuto"' + (c.th == null ? ' checked' : '') + '> auto <input type="range" min="60" max="245" step="5" data-c="th" value="' + (c.th == null ? 160 : c.th) + '"' + (c.th == null ? ' disabled' : '') + '> <b>' + (c.th == null ? '' : c.th) + '</b></label>' +
      '<label title="Gaps in lines up to this width are closed (doors, dashed lines). Too large and narrow compartments close up.">Close gaps <input type="number" min="0" max="3" step="0.1" data-c="gapM" value="' + c.gapM + '"> m</label>' +
      '<label title="Pieces of ink smaller than this every way are dropped as text or marks. Lower it if a short bulkhead is lost.">Drop marks under <input type="number" min="0" max="5" step="0.1" data-c="markM" value="' + c.markM + '"> m</label>' +
      '<label title="Compartments smaller than this are not proposed.">Smallest <input type="number" min="0.1" max="20" step="0.1" data-c="minM2" value="' + c.minM2 + '"> m²</label>' +
      '<label title="Blank the text read on the drawing before looking for lines. Turn it off if a word box cuts a line.">Ignore text <input type="checkbox" data-c="text"' + (c.text ? ' checked' : '') + '></label>' +
      '<label title="Show what OpenCV took as lines (red) and the compartments it found (colours).">Show what OpenCV sees <input type="checkbox" data-c="show"' + (c.show ? ' checked' : '') + '></label>' +
      ' <button class="btn sm" data-c="reset">Defaults</button>';
  }
  /* Find blocks in an area: the bulkhead lines inside the rectangle cut it into cells (image analysis on this computer); the cells are shown first and added when accepted */
  function findBlocksIn(rb) {
    var sc = S.res && S.res.scale; if (!sc || sc.sx == null) { toast('No scale yet: press Set scale first.', true); return; }
    var src = S.raster ? S.vsrc : S.img, k = S.raster ? 1 : S.imgK; if (!src) return;
    var ax = Math.min(rb.x0, rb.x1), bx = Math.max(rb.x0, rb.x1), ay = Math.min(rb.y0, rb.y1), by = Math.max(rb.y0, rb.y1);
    if (bx - ax < 20 || by - ay < 10) { toast('Drag a larger rectangle around the tanks.', true); return; }
    var vi = viewAt((ax + bx) / 2, (ay + by) / 2), role = vi >= 0 ? S.roles[vi] : null;
    if (role !== 'tank' && role !== 'deck' && role !== 'plan') { toast('Drag the rectangle inside a plan view (the tank plan).', true); return; }
    var f = GAVIS.findCells(src, { x0: ax * k, y0: ay * k, x1: bx * k, y1: by * k });
    if (!f.cells.length) { toast('No bulkhead lines were found in that area. Make the rectangle tighter around the tanks, or use Draw block.', true); return; }
    var rects = [];
    f.cells.forEach(function (c, ci) {
      var q = { x0: c.x0 / k, x1: c.x1 / k, y0: c.y0 / k, y1: c.y1 / k };
      if (f.split != null) { var ys = f.split / k; if (role === 'tank' && sc.yc != null && Math.abs(ys - sc.yc) < 0.03 * Math.abs(by - ay) + 3) ys = sc.yc; rects.push({ q: { x0: q.x0, x1: q.x1, y0: q.y0, y1: ys }, side: 'P', no: f.cells.length - ci }); rects.push({ q: { x0: q.x0, x1: q.x1, y0: ys, y1: q.y1 }, side: 'S', no: f.cells.length - ci }); }       // the picture is upright with the bow to the right: the upper half is the port side
      else rects.push({ q: q, side: '', no: f.cells.length - ci });
    });
    var cand = [], dup = 0;
    rects.forEach(function (o) {
      var br = blockRect(o.q); if (!br.r) return; var r = br.r, no = o.no;
      var exists = S.rows.some(function (e) { if (e.on === false) return false; var ox = Math.min(e.x1, r.x1) - Math.max(e.x0, r.x0), oy = Math.min(Math.max(e.y0, e.y1), Math.max(r.y0, r.y1)) - Math.max(Math.min(e.y0, e.y1), Math.min(r.y0, r.y1)); return ox > 0.6 * (r.x1 - r.x0) && oy > 0.5 * Math.abs(r.y1 - r.y0); });
      if (exists) { dup++; return; }
      cand.push({ q: o.q, row: { id: 0, kind: 'user', shape: S.shape || 'box', name: 'Block ' + no + (o.side ? ' ' + o.side : ''), side: o.side, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, z0: r.z0, z1: r.z1, group: S.cruise ? 'g_outfit' : 'g_tanks', on: true, yc: br.yc } });
    });
    S.fnd = { cand: cand, dup: dup, lines: f.lines.length };
    if (!cand.length) { S.fnd = null; toast('The ' + f.cells.length + ' cells found there are blocks already.'); draw(); return; }
    $('fndTxt').textContent = cand.length + ' new block' + (cand.length > 1 ? 's' : '') + ' found from ' + f.lines.length + ' bulkhead lines' + (f.split != null ? ' and the centreline' : '') + (dup ? ' (' + dup + ' already exist)' : '') + '.'; $('fndBar').hidden = false; draw();
  }
  function fndEnd(ok) {
    var F = S.fnd; S.fnd = null; $('fndBar').hidden = true; viewBarUpdate(); $('fndOk').textContent = 'Add them'; $('fndOk').disabled = false;
    if (ok && F && F.sec) { S.info.dbBottom = F.sec; S.infoSrc.dbBottom = 'midship section, OpenCV'; renderInfo(); reanalyse(true); histCommit(); toast('Double bottom set to ' + F.sec + ' m from the section.'); draw(); return; }
    if (ok && F) { F.cand.forEach(function (c) { c.row.id = ++S.uid; S.rows.push(c.row); }); S.sel = S.rows.length - 1; renderBlocks(); try { regenDecks(); } catch (e) { } histCommit(); toast(F.cand.length + ' blocks added. Check their names and the z limits (a guess).'); }
    draw();
  }
  function cvToggle(open) {
    var p = $('cvPanel'); if (open == null) open = p.hidden; if (open) cvPanel(); p.hidden = !open;
    $('fndSet').setAttribute('aria-expanded', open ? 'true' : 'false'); $('btnCvSet').setAttribute('aria-expanded', open ? 'true' : 'false'); $('btnCvSet').classList.toggle('on', open);
    $('cvFoot').textContent = S.fnd && S.fnd.vi != null ? 'Changes read the view again straight away.' : S.raster ? 'Changes read the picture again (all views). To try them on one view: Edit views, select it, Find blocks in this view.' : 'Used by Find blocks in this view (Edit views) and by OpenCV on pictures. Vector PDFs are read from their lines.';
  }
  $('fndSet').onclick = function () { cvToggle(); }; $('btnCvSet').onclick = function () { cvToggle(); }; $('cvClose').onclick = function () { cvToggle(false); };
  var cvTimer = null;
  function cvChanged(e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-c'); if (!k) return; var c = S.cvSet;
    if (k === 'reset') { S.cvSet = Object.assign({}, CV_DEF); cvSave(); cvPanel(); }
    else if (k === 'thAuto') { c.th = t.checked ? null : 160; cvPanel(); }
    else if (k === 'th') { c.th = +t.value; var bb = t.parentNode.querySelector('b'); if (bb) bb.textContent = t.value; }
    else if (k === 'text' || k === 'show') c[k] = t.checked;
    else { var n = parseFloat(t.value); if (isFinite(n) && n >= 0) c[k] = n; else return; }
    cvSave(); if (k === 'show') { draw(); return; }
    clearTimeout(cvTimer); cvTimer = setTimeout(function () { if (S.fnd && S.fnd.vi != null) scanView(S.fnd.vi, S.fnd.box); else if (S.raster && !S.cruise) picRoomsRun(); }, 400);      // the open view, or the whole picture      // the view is read again with the new settings
  }
  $('cvSet').addEventListener('change', cvChanged); $('cvSet').addEventListener('click', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-c') === 'reset') cvChanged(e); });
  $('fndOk').onclick = function () { fndEnd(true); }; $('fndNo').onclick = function () { fndEnd(false); };
  $('btnFind').onclick = function () { S.fnr = !S.fnr; S.draw = false; S.corner = false; S.rubber = null; $('btnDraw').classList.remove('on'); this.classList.toggle('on', S.fnr); this.setAttribute('aria-pressed', S.fnr ? 'true' : 'false'); cv.style.cursor = S.fnr ? 'crosshair' : ''; if (S.fnr) toast('Drag a rectangle around the tanks in the plan. The app looks for the bulkhead lines inside it.'); };
  $('btnDraw').onclick = function () { S.draw = !S.draw; S.corner = false; S.rubber = null; this.setAttribute('aria-pressed', S.draw ? 'true' : 'false'); this.classList.toggle('on', S.draw); cv.style.cursor = S.draw ? 'crosshair' : ''; if (S.draw) toast('Drag a rectangle, or click two opposite corners. Shift or middle button drags the view.'); };
  window.addEventListener('resize', size);
  window.addEventListener('keydown', function (e) { if ((e.key === 'f' || e.key === 'F') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) fit(); });
  window.addEventListener('keydown', function (e) { if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && S.views[+e.key - 1]) { $('selGoView').value = String(+e.key - 1); goView(+e.key - 1); } });
  $('btnFit').onclick = fit;
  $('btnZin').onclick = function () { var r = cv.getBoundingClientRect(); zoomAt(1.4, r.width / 2, r.height / 2); };
  $('btnZout').onclick = function () { var r = cv.getBoundingClientRect(); zoomAt(1 / 1.4, r.width / 2, r.height / 2); };
  document.querySelectorAll('[data-ov]').forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-ov'); S.ov[k] = S.ov[k] ? 0 : 1; b.setAttribute('aria-pressed', S.ov[k] ? 'true' : 'false'); draw(); }; });
  document.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { var k = t.getAttribute('data-tab'); document.querySelectorAll('.tab').forEach(function (o) { o.setAttribute('aria-selected', o === t ? 'true' : 'false'); $('tab-' + o.getAttribute('data-tab')).hidden = o !== t; }); }; });

  /* ---------- turning, pages, files ---------- */
  async function turn(d) { S.rot = (S.rot + d + 4) % 4; S.busy++; setBusy(); await setRotation(); S.busy--; setBusy(); }
  $('btnRotL').onclick = function () { turn(-1); }; $('btnRotR').onclick = function () { turn(1); };
  $('btnRescan').onclick = async function () {
    if (!S.gaPage || S.busy) return;
    if (S.pdf) { histCommit(); S.manual = null; S.cal = null; S.vedited = false; await loadGA(true); histCommit(); toast('The drawing was read again: turn, views and scale were found from scratch. Undo brings back the old ones.'); }
    else if (S.raster && S.srcImg) { histCommit(); var gt = null; try { gt = GAVIS.guessTurn(S.srcImg); S.rot = gt.k; } catch (e) { } S.manual = null; S.cal = null; S.vedited = false; S.words = null; await setRotation(true); histCommit(); refineByText(); toast('The picture was read again: turn, views and scale were found from scratch. Undo brings back the old ones.'); }
    else toast('For a DXF or SVG drawing, open the file again to start over.');
  };
  $('selGa').onchange = async function () { S.gaPage = +this.value; await loadGA(true); };

  /* ---------- a DXF or SVG drawing: lines come straight from the file, text in the file fills the particulars ---------- */
  function fakeVecPage(segs, W, H) {
    return { rotate: 0,
      getViewport: function (o) { var r = (((o.rotation || 0) % 360) + 360) % 360, w = W * o.scale, h = H * o.scale; return r === 90 || r === 270 ? { width: h, height: w, r: r, scale: o.scale } : { width: w, height: h, r: r, scale: o.scale }; },
      render: function (o) { var g = o.canvasContext, vp = o.viewport; return { promise: Promise.resolve().then(function () { g.save(); if (vp.r === 90) { g.translate(vp.width, 0); g.rotate(Math.PI / 2); } else if (vp.r === 180) { g.translate(vp.width, vp.height); g.rotate(Math.PI); } else if (vp.r === 270) { g.translate(0, vp.height); g.rotate(-Math.PI / 2); }
        g.strokeStyle = '#000'; g.lineWidth = Math.max(1, 0.6 * vp.scale); g.lineCap = 'round'; g.beginPath(); var k = vp.scale; segs.forEach(function (q) { g.moveTo(q[0] * k, q[1] * k); g.lineTo(q[2] * k, q[3] * k); }); g.stroke(); g.restore(); }) }; } };
  }
  async function openVectorFile(f, kind) {
    var txt, v;
    try { txt = await f.text(); v = kind === 'dxf' ? GAVEC.parseDXF(txt) : GAVEC.parseSVG(txt); } catch (e) { toast((e && e.message) || 'This file could not be read.', true); return; }
    S.pdf = null; S.raster = false; S.exSeen = {}; S.fileName = f.name; histReset(); S.cruise = null; S.ocv = null; S.ocvTurned = 0; S.rooms = null; S.polysPage = null; S.picRooms = null; S.labels = null; S.hc = { plan: [], keel: [], deck: [], section: [] }; S.chull = null; if (S.hullMode === 'contour') { S.hullMode = 'preset'; $('selHull').value = 'preset'; }
    S.nPages = 1; S.pageInfo = { 1: { text: v.texts.length, paths: v.segs.length } }; S.gaPage = 1; S.infoPage = 0; S.manual = null; S.cal = null; S.est = {}; S.info = {}; S.infoSrc = {}; S.shown = {}; S.xmeta = []; S.spec = null; S.rot = 0;
    var lines = []; v.texts.forEach(function (t) { t.split(/\n/).forEach(function (x) { if (x.trim()) lines.push(x); }); });
    var fo = G.parseOcrLines(lines), nf = 0; Object.keys(fo).forEach(function (k) { S.info[k] = fo[k].v; S.infoSrc[k] = 'text in the file: ' + fo[k].src; nf++; });
    $('empty').hidden = true; $('projName').value = f.name.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' '); S.projFromFile = true;
    fillPageSelects(); $('btnOcr').hidden = true; renderInfo();
    var K = kind.toUpperCase();
    $('infoNote').textContent = nf ? 'Read ' + nf + ' values from the text in the ' + K + ' file. Check them.' : 'No particulars in the text of this ' + K + ' file. Type the length, breadth and depth, or press Read part.';
    $('docWarn').hidden = false; $('docWarn').innerHTML = '<div>' + K + ' drawing: ' + v.segs.length + ' lines read from the file. Its units are not known, so the scale comes from the length overall you give. Turn the drawing so that the bow is on the right.</div>';
    S.busy++; setBusy(); S.page = fakeVecPage(v.segs, v.W, v.H); S.W = v.W; S.H = v.H; S.segsPage = v.segs; await setRotation(true); S.busy--; setBusy();
  }
  $('selInfo').onchange = async function () { S.infoPage = +this.value; await loadInfo(); reanalyse(true); };
  function pickFile() { $('fileIn').click(); }
  $('btnOpen').onclick = pickFile; $('btnOpen2').onclick = pickFile;

  /* ---------- the example GAs: published next to the page (examples/*.pdf), free to use for teaching ---------- */
  var EXAMPLES = [
    { file: 'GA_PSV_Example.pdf', name: 'PSV, 92 m', what: 'Platform supply vessel with an X-Bow-like bow: profile, main deck, tank deck and tank top. Dry bulk, mud and brine tanks, machinery aft and forward.' },
    { file: 'GA_River_Cruise_Example.pdf', name: 'River cruise ship, 150 m', what: 'Inland passenger ship: eight deck plans, about 230 cabins, restaurants and lounges. No profile: the deck heights come from page 1 and the order of the plans.' },
    { file: 'GA_Tanker_Example.pdf', name: 'Tanker, 115,000 dwt', what: 'Double-hull crude / product tanker on a turned sheet: profile, upper deck, tank top and midship section. Six pairs of cargo tanks, wing and double-bottom ballast.' }
  ];
  function showExamples() {
    var ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = '<div class="dialog help" role="dialog" aria-modal="true" aria-label="Examples"><h2>Examples</h2><p class="note">Three simplified general arrangements made for teaching (educational examples, not for professional use). Each opens with page 1 (particulars) and page 2 (the drawing). The PDF can also be saved, to try it elsewhere.</p>' +
      EXAMPLES.map(function (e, i) { return '<div class="exrow"><div><b>' + esc(e.name) + '</b><p class="note">' + esc(e.what) + '</p></div><div class="actions"><button class="btn primary" data-open="' + i + '">Open</button><button class="btn" data-save="' + i + '">Save PDF</button></div></div>'; }).join('') +
      '<div class="helpfoot"><div class="actions"><button class="btn" data-x="close">Close</button></div></div></div>';
    document.body.appendChild(ov);
    function close() { ov.remove(); }
    async function get(e) { var r = await fetch('examples/' + e.file); if (!r.ok) throw new Error('not found'); return r.arrayBuffer(); }
    ov.addEventListener('click', async function (ev) {
      var t = ev.target; if (t === ov || t.getAttribute('data-x') === 'close') { close(); return; }
      var io = t.getAttribute('data-open'), is = t.getAttribute('data-save');
      if (io != null) { var e = EXAMPLES[+io]; try { var buf = await get(e); close(); S.projFromFile = true; $('projName').value = ''; await openBuffer(buf, e.file); } catch (er) { toast('The example could not be loaded here (' + er.message + '). It is in the examples folder next to the page.', true); } }
      if (is != null) { var e2 = EXAMPLES[+is]; try { var b2 = new Uint8Array(await get(e2)); var dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; if (dl) await dl.save({ filename: e2.file, data: new Blob([b2], { type: 'application/pdf' }) }); else { var u = URL.createObjectURL(new Blob([b2], { type: 'application/pdf' })), a = document.createElement('a'); a.href = u; a.download = e2.file; document.body.appendChild(a); a.click(); a.remove(); } } catch (er2) { toast('The PDF could not be saved here: ' + er2.message, true); } }
    });
  }
  $('btnExamples').onclick = showExamples;
  $('fileIn').onchange = function () { var f = this.files[0]; if (f) readFile(f); this.value = ''; };
  function readFile(f) { if (/\.dxf$/i.test(f.name)) { openVectorFile(f, 'dxf'); return; } if (/\.svg$/i.test(f.name) || f.type === 'image/svg+xml') { openVectorFile(f, 'svg'); return; } if (/^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)) { openImageFile(f); return; } S.projFromFile = true; var fr = new FileReader(); fr.onload = function () { openBuffer(fr.result, f.name); }; fr.readAsArrayBuffer(f); }
  var vpEl = $('viewport');
  ['dragenter', 'dragover'].forEach(function (n) { vpEl.addEventListener(n, function (e) { e.preventDefault(); $('empty').classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (n) { vpEl.addEventListener(n, function (e) { e.preventDefault(); $('empty').classList.remove('over'); }); });
  vpEl.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readFile(f); });

  /* ---------- OCR progress bar over the drawing ---------- */
  var ocrTimer = null;
  function ocrShow(what, perBlock) {
    var b = $('ocrBar'), t0 = Date.now(); b.hidden = false; b.classList.add('ind'); $('ocrFill').style.width = '';
    GAOCR.progress(function (m) {
      var st = String(m.status || ''), pc = Math.round((m.progress || 0) * 100);
      if (perBlock && /recogniz/.test(st)) return;
      if (/recogniz/.test(st)) { b.classList.remove('ind'); $('ocrFill').style.width = pc + '%'; $('ocrTxt').textContent = 'Reading ' + what + ': ' + pc + '%'; }
      else { b.classList.add('ind'); $('ocrTxt').textContent = 'Starting the OCR engine on this computer (first time only)...'; }
    });
    $('ocrTxt').textContent = 'Starting the OCR engine on this computer (first time only)...';
    clearInterval(ocrTimer); ocrTimer = setInterval(function () { if (!b.classList.contains('ind')) return; if (Date.now() - t0 > 8000) $('ocrTxt').textContent = 'Reading ' + what + '... ' + Math.round((Date.now() - t0) / 1000) + ' s'; }, 1000);
  }
  function ocrHide() { clearInterval(ocrTimer); GAOCR.progress(null); $('ocrBar').hidden = true; }
  /* ---------- OCR: local, text drawn as outlines or as an image ---------- */
  var ocrRun = false;
  $('btnOcr').onclick = async function () {
    if (ocrRun) { GAOCR.stop(); return; }
    if (!S.rotd) { toast('Open a PDF first.', true); return; }
    if (!GAOCR.ready()) { toast('The OCR files are not in this copy of the page.', true); return; }
    ocrRun = true; var btn = this, was = btn.textContent; btn.textContent = 'Stop'; ocrShow('the drawing text', true);
    try {
      var t0 = Date.now();
      S.labels = await GAOCR.readPage(S.rotd.segs, S.rotd.W, S.rotd.H, function (i, n) { $('infoNote').textContent = 'Reading text ' + i + ' of ' + n + '. Nothing leaves this page.'; $('ocrTxt').textContent = 'Reading the drawing text: block ' + i + ' of ' + n; $('ocrBar').classList.remove('ind'); $('ocrFill').style.width = Math.round(100 * i / Math.max(1, n)) + '%'; });
      var lines = []; S.labels.forEach(function (l) { l.text.split(/\n/).forEach(function (x) { lines.push(x); }); });
      var f = G.parseOcrLines(lines), n = 0;
      Object.keys(f).forEach(function (k) { if (S.info[k] == null) { S.info[k] = f[k].v; S.infoSrc[k] = 'OCR: ' + f[k].src; n++; } });
      renderInfo(); applyTitles(true); renderViews(); reanalyse(true);
      $('infoNote').textContent = 'OCR read ' + S.labels.length + ' text blocks in ' + Math.round((Date.now() - t0) / 1000) + ' s and filled ' + n + ' values. Check them: OCR can lose a decimal comma.';
    } catch (e) { toast('OCR failed: ' + (e && e.message ? e.message : e), true); }
    ocrHide(); ocrRun = false; btn.textContent = was;
  };


  /* ---------- the hull editor: contours, picked on the drawing ---------- */
  S.mode = 'blocks'; S.hc = { plan: [], keel: [], deck: [], section: [] }; S.hcAct = 'plan'; S.hcPick = false; S.chull = null;
  var HC_COLS = { plan: ['x from aft (m)', 'Half-breadth (m)'], keel: ['x from aft (m)', 'Height z (m)'], deck: ['x from aft (m)', 'Height z (m)'], section: ['Half-width y (m)', 'Height z (m)'] };
  function hcViewBox() {                                              // the view that receives the clicks of the active contour
    var m = planMap(); if (!m) return null;
    if (S.hcAct === 'plan') return m.tankBox || m.deckBox; if (S.hcAct === 'section') { var f = sectionFrame(); return f && f.box; } return viewMap().profile;
  }
  function zoomToBox(b) {
    if (!b) return; var r = cv.parentNode.getBoundingClientRect(), k = Math.min(r.width / (b.x1 - b.x0), r.height / (b.y1 - b.y0)) * 0.92;
    S.view = { k: k, x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k }; draw();
  }
  function hcDims() {
    var sc = S.res && S.res.scale, ok = sc && sc.sx != null;
    return { L: S.info.loa || (ok ? sc.lengthPts * sc.sx : 0), B: S.info.beam || (ok && sc.beamPts ? sc.beamPts * sc.sy : 0), D: S.info.depth || (ok && sc.heightPts ? sc.heightPts * sc.sz : 0), T: S.info.draughtDesign || S.info.draught || 0 };
  }
  function hcSort() { }                                               // points keep their order: an outline may curl back
  function hcAdd(k, p) {                                              // a new point goes where it lengthens the path least: at an end, or between two neighbours
    var L = S.hc[k], n = L.length, best = n, bc = Infinity, i;
    function dd(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
    if (n < 2) { L.push(p); return; }
    bc = dd(p, L[n - 1]); best = n;
    if (dd(p, L[0]) < bc) { bc = dd(p, L[0]); best = 0; }
    for (i = 0; i + 1 < n; i++) { var c = dd(p, L[i]) + dd(p, L[i + 1]) - dd(L[i], L[i + 1]); if (c < bc - 1e-9) { bc = c; best = i + 1; } }
    L.splice(best, 0, p);
  }
  function hcUpdate(edited) {
    var d = hcDims(); S.chull = d.L && d.B && d.D ? G.hullFromContours({ L: d.L, B: d.B, D: d.D, T: d.T, plan: S.hc.plan, keel: S.hc.keel, deck: S.hc.deck, section: S.hc.section }) : null;
    if (edited && S.chull) { S.hullMode = 'contour'; $('selHull').value = 'contour'; }
    renderHc(); renderChecks(); draw(); d3draw();
  }
  function renderHc() {
    var k = S.hcAct, cols = HC_COLS[k], pts = S.hc[k];
    $('hcTbl').innerHTML = '<tr><th class="num">#</th><th class="num">' + cols[0] + '</th><th class="num">' + cols[1] + '</th><th></th></tr>' + pts.map(function (p, i) {
      return '<tr><td class="num">' + (i + 1) + '</td><td class="num"><input type="number" step="0.1" data-i="' + i + '" data-j="0" value="' + p[0] + '"></td><td class="num"><input type="number" step="0.1" data-i="' + i + '" data-j="1" value="' + p[1] + '"></td><td><button class="btn sm" data-del="' + i + '" title="Remove this point">&times;</button></td></tr>';
    }).join('') || '<tr><td colspan="4" class="note">No points. Press Click on drawing and click along the contour, or Fill from drawing.</td></tr>';
    var d = S.chull;
    $('hcSum').textContent = S.chull ? 'Hull: Cb ' + fmt(S.chull.cb, 2) + ' at the draught' : 'Needs at least two plan points and the particulars (length, breadth, depth)';
    document.querySelectorAll('#hcSel [data-c]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-c') === k); });
    $('hcPick').setAttribute('aria-pressed', S.hcPick ? 'true' : 'false'); $('hcPick').classList.toggle('on', S.hcPick);
  }
  $('hcSel').onclick = function (e) { var c = e.target.getAttribute && e.target.getAttribute('data-c'); if (!c) return; S.hcAct = c; renderHc(); zoomToBox(hcViewBox()); };
  $('hcPick').onclick = function () { S.hcPick = !S.hcPick; cv.style.cursor = S.hcPick ? 'crosshair' : ''; if (S.hcPick) toast({ plan: 'Click along half of the outline in the tank or deck plan, from aft to forward.', keel: 'Click along the keel line in the profile.', deck: 'Click along the deck edge in the profile.', section: 'Click along half of the midship section, from the keel up to the deck.' }[S.hcAct]); renderHc(); };
  $('hcClear').onclick = function () { S.hc[S.hcAct] = []; hcUpdate(true); };
  $('hcTbl').addEventListener('change', function (e) { var i = e.target.getAttribute('data-i'); if (i == null) return; var v = parseFloat(e.target.value); if (!isFinite(v)) return; S.hc[S.hcAct][+i][+e.target.getAttribute('data-j')] = v; hcSort(S.hcAct); hcUpdate(true); });
  $('hcTbl').addEventListener('click', function (e) { var d = e.target.getAttribute && e.target.getAttribute('data-del'); if (d == null) return; S.hc[S.hcAct].splice(+d, 1); hcUpdate(true); });
  function sectionFrame() {                                           // the centreline and keel of the section view, in drawing coordinates
    var i = S.section ? S.section.view : S.roles.indexOf('section'); if (i < 0 || !S.views[i]) return null;
    var b = S.views[i]; return { box: b, cx: S.section ? S.section.cx : (b.x0 + b.x1) / 2, keelY: S.section ? S.section.keelY : b.y1 - 20 };
  }
  function hcToPage(k, p) {                                           // a contour point (metres) to drawing coordinates, on the side where its handles are drawn
    var m = planMap(); if (!m) return null;
    if (k === 'plan') { var yc = m.tankBox ? m.tankYc : m.deckYc; return yc == null ? null : [m.xA + p[0] / m.sx, yc - p[1] / m.sy]; }
    if (k === 'keel' || k === 'deck') return m.baseY == null ? null : [m.xA + p[0] / m.sx, m.baseY - p[1] / m.sz];
    var fr = sectionFrame(); return fr ? [fr.cx + p[0] / m.sx, fr.keelY - p[1] / m.sx] : null;
  }
  function hcFromPage(k, q, quiet) {                                  // drawing coordinates to a contour point (metres). No limits: a point may lie outside the view, below the baseline or beyond the ends
    var m = planMap(), r2 = G.r2; function say(t) { if (!quiet) toast(t, true); return null; }
    if (!m) return say('Needs the scale first: the length overall and a plan view.');
    if (k === 'plan') { var yc = m.tankBox ? m.tankYc : m.deckYc; if (yc == null) return say('No plan view to measure from.'); return [r2((q.x - m.xA) * m.sx), r2(Math.abs(yc - q.y) * m.sy)]; }
    if (k === 'keel' || k === 'deck') { if (m.baseY == null) return say('No profile view to measure from.'); return [r2((q.x - m.xA) * m.sx), r2((m.baseY - q.y) * m.sz)]; }
    var fr = sectionFrame(); if (!fr) return say('No section view to measure from.'); return [r2(Math.abs(q.x - fr.cx) * m.sx), r2((fr.keelY - q.y) * m.sx)];
  }
  function hcNear(q) {                                                // the handle of the active contour under the pointer, if any
    var k = S.hcAct, best = -1, bd = 9 / S.view.k; S.hc[k].forEach(function (p, i) { var c = hcToPage(k, p); if (!c) return; var d = Math.hypot(c[0] - q.x, c[1] - q.y); if (d < bd) { bd = d; best = i; } }); return best;
  }
  function hcClick(e) { var p = hcFromPage(S.hcAct, toPage(e)); if (!p) return; hcAdd(S.hcAct, p); hcUpdate(true); }
  cv.addEventListener('dblclick', function (e) {                      // double-click on the drawing adds a point to the active contour
    if (S.mode !== 'hull') return; var p = hcFromPage(S.hcAct, toPage(e)); if (!p) return; hcAdd(S.hcAct, p); hcUpdate(true);
  });
  $('hcFill').onclick = function () {
    var g = S.guess, d = hcDims();
    if ((!g || !g.plan) && d.L && d.B && d.D && S.res && S.res.scale.sx != null) {                  // no outline was found (a picture): a plain ship shape to drag onto the drawing
      var r2d = G.r2, hb = d.B / 2, Ld = d.L;
      S.hc.plan = [[0, 0.7 * hb], [0.04 * Ld, 0.9 * hb], [0.12 * Ld, hb], [0.78 * Ld, hb], [0.9 * Ld, 0.72 * hb], [0.97 * Ld, 0.3 * hb], [Ld, 0]].map(function (p) { return [r2d(p[0]), r2d(p[1])]; });
      S.hc.keel = [[0, r2d(0.08 * d.D)], [r2d(0.2 * Ld), 0], [r2d(Ld), 0]]; S.hc.deck = [[0, r2d(d.D)], [r2d(Ld), r2d(d.D)]];
      var rB0 = 0.06 * d.B; S.hc.section = [0, 0.25, 0.5, 0.75, 1].map(function (f) { var z = rB0 * f; return [r2d(hb - rB0 + Math.sqrt(Math.max(0, rB0 * rB0 - (rB0 - z) * (rB0 - z)))), r2d(z)]; }).concat([[r2d(hb), r2d(d.D)]]);
      hcUpdate(true); zoomToBox(hcViewBox()); toast('A plain hull shape was put on the plan. Drag the points onto the outline in the drawing.'); return;
    }
    if (!g || !g.plan) { toast('Nothing to fill from: the app needs the scale and a plan view first.', true); return; }
    var r2 = G.r2; S.hc.plan = g.plan.filter(function (_, i) { return i % 2 === 0 || i === g.plan.length - 1; });
    S.hc.keel = g.runH > 0.01 ? [[0, r2(g.runH)], [r2(g.runL), 0], [r2(d.L), 0]] : [[0, 0], [r2(d.L), 0]]; S.hc.deck = [[0, r2(d.D)], [r2(d.L), r2(d.D)]];
    var sec = S.section, hb = d.B / 2;
    if (sec) { var step = Math.max(1, Math.floor(sec.zs.length / 9)); S.hc.section = sec.zs.map(function (z, i) { return [r2(sec.s[i] * hb), r2(z)]; }).filter(function (_, i) { return i % step === 0; }); }
    else { var rB = 0.06 * d.B; S.hc.section = [0, 0.25, 0.5, 0.75, 1].map(function (f) { var z = rB * f; return [r2(hb - rB + Math.sqrt(Math.max(0, rB * rB - (rB - z) * (rB - z)))), r2(z)]; }).concat([[r2(hb), r2(d.D)]]); }
    hcUpdate(true); zoomToBox(hcViewBox()); toast('Contours filled from the drawing. The keel rise, the bilge and the sheer are assumed: edit them.');
  };
  function hcOverlay(ctx, X, Y) {                                     // the contours drawn on the views
    var m = planMap(); if (!m) return; var pts = S.hc;
    function curve(list, f, act, ix) {                                  // the smooth curve the hull uses, with the handles on top
      if (list.length < 3) return line(list, f, act);
      var pts = G.curvePath(list, ix);
      ctx.strokeStyle = act ? '#8a3ffc' : 'rgba(138,63,252,.55)'; ctx.lineWidth = act ? 2 : 1.3; ctx.beginPath(); pts.forEach(function (p, i) { var c = f(p); if (i) ctx.lineTo(c[0], c[1]); else ctx.moveTo(c[0], c[1]); }); ctx.stroke();
      if (act) { ctx.fillStyle = '#8a3ffc'; list.forEach(function (p, pi) { var c = f(p), sp = S.hcSelPt && S.hcSelPt.k === S.hcAct && S.hcSelPt.i === pi; ctx.beginPath(); ctx.arc(c[0], c[1], sp ? 5.5 : 3.2, 0, 6.3); ctx.fill(); if (sp) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); } }); }
    }
    function line(list, f, act) { if (!list.length) return; ctx.strokeStyle = act ? '#8a3ffc' : 'rgba(138,63,252,.55)'; ctx.fillStyle = '#8a3ffc'; ctx.lineWidth = act ? 2 : 1.3; ctx.beginPath(); list.forEach(function (p, i) { var c = f(p); if (i) ctx.lineTo(c[0], c[1]); else ctx.moveTo(c[0], c[1]); }); ctx.stroke(); if (act) list.forEach(function (p) { var c = f(p); ctx.beginPath(); ctx.arc(c[0], c[1], 3.2, 0, 6.3); ctx.fill(); }); }
    var yc = m.tankBox ? m.tankYc : m.deckYc;
    if (yc != null) [1, -1].forEach(function (sg) { curve(pts.plan, function (p) { return [X(m.xA + p[0] / m.sx), Y(yc - sg * p[1] / m.sy)]; }, S.hcAct === 'plan' && sg === 1, 0); });
    if (m.baseY != null) { line(pts.keel, function (p) { return [X(m.xA + p[0] / m.sx), Y(m.baseY - p[1] / m.sz)]; }, S.hcAct === 'keel'); line(pts.deck, function (p) { return [X(m.xA + p[0] / m.sx), Y(m.baseY - p[1] / m.sz)]; }, S.hcAct === 'deck'); }
    var fr = sectionFrame(); if (fr) [1, -1].forEach(function (sg) { curve(pts.section, function (p) { return [X(fr.cx + sg * p[0] / m.sx), Y(fr.keelY - p[1] / m.sx)]; }, S.hcAct === 'section' && sg === 1, 1); });
  }



  /* ---------- read a part of the drawing by OCR (a table, a note), for vector sheets and for pictures ---------- */
  $('btnRegion').onclick = function () {
    if (!S.rotd) { toast('Open a drawing first.', true); return; }
    S.rgn = !S.rgn; S.draw = false; S.corner = false; this.classList.toggle('on', S.rgn); cv.style.cursor = S.rgn ? 'crosshair' : '';
    if (S.rgn) toast('Drag a rectangle around the table or the note with the main dimensions (length, breadth, depth).'); else S.rubber = null;
  };
  async function readPart(rb) {
    var box = { x0: Math.min(rb.x0, rb.x1), x1: Math.max(rb.x0, rb.x1), y0: Math.min(rb.y0, rb.y1), y1: Math.max(rb.y0, rb.y1) };
    if (box.x1 - box.x0 < 8 || box.y1 - box.y0 < 8) { toast('That rectangle is too small.', true); return; }
    $('infoNote').textContent = 'Reading the selected part. Nothing leaves this page.'; S.busy++; setBusy(); $('btnRegion').disabled = true; ocrShow('the selected part');
    try {
      var r = S.raster ? await GAOCR.readImage(S.img, { x0: box.x0 * S.imgK, y0: box.y0 * S.imgK, x1: box.x1 * S.imgK, y1: box.y1 * S.imgK }) : await GAOCR.readRegion(S.rotd.segs, box);
      var lines = r.text.split(/\n/).filter(function (x) { return x.trim(); }), f = G.parseOcrLines(lines), n = 0, got = [];
      Object.keys(f).forEach(function (k) { S.info[k] = f[k].v; S.infoSrc[k] = 'OCR of the selected part: ' + f[k].src; delete S.est[k]; n++; if (['loa', 'beam', 'depth', 'lbp', 'draught'].indexOf(k) >= 0) got.push(k + ' ' + f[k].v); });
      renderInfo(); reanalyse(true);
      $('infoNote').textContent = n ? 'Read ' + n + ' values from the selected part' + (got.length ? ' (' + got.join(', ') + ')' : '') + '. Check them: OCR can lose a decimal point.' : 'Nothing was recognised in the selected part (' + lines.length + ' lines read, confidence ' + r.conf + '%). Try a tighter rectangle, or type the values.';
      if (!n) toast('Nothing recognised there. Try a tighter rectangle, or type the values.', true);
    } catch (e) { toast('OCR failed: ' + (e && e.message ? e.message : e), true); }
    ocrHide(); $('btnRegion').disabled = false; S.busy--; setBusy(); S.rgn = false; $('btnRegion').classList.remove('on'); cv.style.cursor = '';
  }

  /* ---------- adjustable layout: the drawing against the tables, the left panel, and Expand ---------- */
  var LAY = { drawerH: null, leftW: 310, shut: false };
  try { var ls = JSON.parse(localStorage.getItem('ga2dbb-layout') || 'null'); if (ls) { LAY.drawerH = ls.drawerH || null; LAY.leftW = ls.leftW || 310; } } catch (e) { }
  function layApply() {
    var main = document.querySelector('.main'), cen = document.querySelector('.center'), ch = cen.getBoundingClientRect().height || 600;
    main.style.setProperty('--left-w', Math.max(200, Math.min(640, LAY.leftW)) + 'px');
    var h = LAY.drawerH == null ? 0.42 * (window.innerHeight || 800) : LAY.drawerH; h = Math.max(90, Math.min(ch - 200, h));
    $('drawer').style.setProperty('--drawer-h', h + 'px'); $('drawer').classList.toggle('shut', LAY.shut);
    size();
  }
  function laySave() { try { localStorage.setItem('ga2dbb-layout', JSON.stringify({ drawerH: LAY.drawerH, leftW: LAY.leftW })); } catch (e) { } }
  function splitDrag(el, onMove) {
    el.addEventListener('pointerdown', function (e) { if (e.button !== 0) return; el.setPointerCapture(e.pointerId); el.classList.add('on'); el._d = true; e.preventDefault(); });
    el.addEventListener('pointermove', function (e) { if (el._d) onMove(e); });
    ['pointerup', 'pointercancel'].forEach(function (n) { el.addEventListener(n, function () { if (!el._d) return; el._d = false; el.classList.remove('on'); laySave(); if (S.rotd) fit(); }); });
  }
  splitDrag($('splitV'), function (e) { var cen = document.querySelector('.center').getBoundingClientRect(); LAY.shut = false; LAY.drawerH = cen.bottom - e.clientY - 4; layApply(); });
  splitDrag($('splitH'), function (e) { var m = document.querySelector('.main').getBoundingClientRect(); LAY.leftW = e.clientX - m.left - 4; layApply(); });
  $('splitV').ondblclick = function () { LAY.shut = !LAY.shut; layApply(); if (S.rotd) fit(); };
  $('splitH').ondblclick = function () { LAY.leftW = 310; layApply(); laySave(); };
  $('splitV').addEventListener('keydown', function (e) { if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return; e.preventDefault(); var cur = $('drawer').getBoundingClientRect().height; LAY.shut = false; LAY.drawerH = cur + (e.key === 'ArrowUp' ? 40 : -40); layApply(); laySave(); });
  $('splitH').addEventListener('keydown', function (e) { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); LAY.leftW += e.key === 'ArrowRight' ? 30 : -30; layApply(); laySave(); });
  function setFocus(on) { document.querySelector('.main').classList.toggle('focus', on); $('btnFocus').classList.toggle('on', on); $('btnFocus').setAttribute('aria-pressed', on ? 'true' : 'false'); $('btnFocus').textContent = on ? 'Show panels' : 'Expand'; size(); if (S.rotd) fit(); d3draw(); }
  $('btnFocus').onclick = function () { setFocus(!document.querySelector('.main').classList.contains('focus')); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.querySelector('.main').classList.contains('focus')) setFocus(false); });
  window.addEventListener('resize', layApply);
  layApply();

  /* ---------- the next step: what to do, in order, and why (most useful when the drawing is messy) ---------- */
  function focusField(sel, key) {
    var el = document.querySelector(sel); if (!el) return; $('leftPanel').scrollTop = Math.max(0, el.getBoundingClientRect().top - $('leftPanel').getBoundingClientRect().top + $('leftPanel').scrollTop - 120);
    var f = el.closest('.f, .vrow') || el; f.classList.add('hl'); setTimeout(function () { f.classList.remove('hl'); }, 2500); el.focus();
  }
  function renderGuide() {
    var g = $('guide'); if (!S.rotd) { g.hidden = true; return; }
    var r = S.res, sc = r ? r.scale : {}, hasScale = sc.sx != null, pb = hasScale && sc.beamRatio ? (sc.beamRatio - 1) * 100 : null, on = S.rows.filter(function (q) { return q.on !== false; }).length;
    var roleOk = S.roles.some(function (x) { return x === 'profile' || x === 'tank' || x === 'deck'; });
    var steps = [
      { t: S.est.loa ? (/assumed/.test(S.infoSrc.loa || '') ? 'Length overall: ' + ASSUME_L + ' m assumed' : 'Length overall (from the drawing)') : !S.info.loa ? 'Length overall (optional)' : 'Length overall (m)', done: true, why: (S.est.loa ? (/assumed/.test(S.infoSrc.loa || '') ? 'The length was not found, so the ship is assumed to be <b>' + ASSUME_L + ' m</b> long. Nothing is blocked: the blocks, breadth and depth are in proportion to the drawing. When you know the real length, type it in <b>Length overall</b> (or use <b>Read part</b> on a table that has it) and every dimension scales with it.' : 'The length was worked out from the breadth or depth you typed and the proportions of the drawing. Type the real length if you know it.') : 'Set <b>Length overall</b>. Type it in <b>Ship data</b>, or press <b>Read text (OCR)</b> or <b>Read part</b> if the sheet has the particulars as a table or a picture. If you do not know it, leave it: a length of '+ASSUME_L+' m is assumed and the drawing gives the proportions.'), act: [['Go to Length overall', function () { focusField('#infoForm [data-k="loa"]'); }]] },
      { t: 'Views and their roles', done: hasScale, why: S.raster ? (S.manual && S.manual.auto ? 'The views, the scale (red points 1 to 5) and the tank blocks were proposed from the picture. Check the dashed boxes with <b>Edit views</b> and the red points on the drawing. If the scale is wrong, press <b>Set scale</b> and click the five points.' : (S.views.length ? S.views.length + ' views were found in the picture (dashed boxes). Check them with <b>Edit views</b>. ' : '') + 'The scale could not be measured from the picture. Press <b>Set scale</b> and click, in the order shown: the stern and the bow of the profile, the deck line, the centreline of the plan and the hull side at midship.'): !S.views.length ? 'No views were found: the page is probably a scan or a picture. Press <b>Set scale</b> to click the scale by hand, or open a vector PDF.' : !roleOk ? 'The app could not tell which view is which. In <b>Views in the drawing</b>, set one view to <b>Profile</b> and one to <b>Tank plan</b> or <b>Deck plan</b>, and <b>Ignore</b> the clutter (title block, tables, details). Use <b>Turn</b> if the drawing is sideways. If a view box is wrong or covers the whole page, press <b>Edit views</b>.' : 'A scale was not found with these views and this length. Check that the profile and the plan are the right views, that none of them is merged with another drawing, and that the length is the one printed for this drawing. Use <b>Turn</b> if the drawing is sideways.' + (r && r.notes && r.notes.length ? ' The app says: ' + esc(r.notes.join(' ')) : ''), act: [['Set scale by clicks', function () { setMode('scale'); }], ['Edit views', function () { setMode('views'); }], ['Go to the views', function () { focusField('#viewList select'); }], ['Turn', function () { $('btnRotR').click(); }]] },
      { t: 'Breadth and depth (m)', done: !!(S.info.beam && S.info.depth) && !S.est.beam && !S.est.depth && (pb == null || Math.abs(pb) < 8), why: (S.est.beam || S.est.depth) ? 'The sheet gave no ' + (S.est.beam && S.est.depth ? 'breadth and depth' : S.est.beam ? 'breadth' : 'depth') + ', so ' + (S.est.beam && S.est.depth ? 'they were' : 'it was') + ' <b>measured on the drawing</b> (shown in italic). That is usually good to a few percent. Type the real value if you have it, or accept the measured one.' : !(S.info.beam && S.info.depth) ? 'Enter <b>Breadth</b> and <b>Depth</b>: they set the width and the height of the blocks and the hull.' : 'The beam measured on the drawing is ' + fmt(Math.abs(pb), 0) + '% ' + (pb > 0 ? 'wider' : 'narrower') + ' than the breadth you entered. Either the length, the breadth or a view is wrong. Fix it before trusting the blocks.', act: [].concat((S.est.beam || S.est.depth) ? [['Accept the measured values', function () { S.est = {}; renderInfo(); renderGuide(); }]] : [], [['Go to Breadth', function () { focusField('#infoForm [data-k="beam"]'); }]]) },
      { t: 'Blocks: check or add', done: hasScale && on > 0, why: S.rows.length ? S.rows.length + ' blocks were suggested but none is ticked. Tick the ones that are right in the <b>Blocks</b> table below (check their x, y and z), and press <b>Draw block</b> to add what is missing.' : 'No tank blocks were found automatically. Press <b>Draw block</b> and click two opposite corners of a tank in the plan (or drag a rectangle). You can also add a row in the Blocks table.', act: [['Draw block', function () { if (S.mode !== 'blocks') setMode('blocks'); if (!S.draw) $('btnDraw').click(); }]] },
      { t: 'Hull: check the contours', done: S.hullMode !== 'preset', why: 'Press <b>Edit hull</b>. The outline is filled from the drawing. Drag the points that are wrong, double-click to add one, right-click to remove one. The result shows in the 3D tab.', act: [['Edit hull', function () { setMode('hull'); }]] },
      { t: 'Save the DBB file', done: false, why: 'Everything checked? Press <b>Save DBB file</b> (top right). Only the ticked blocks and the hull are saved.', act: [['Save DBB file', function () { $('btnSave').click(); }]] }
    ];
    var cur = steps.findIndex(function (x) { return !x.done; }); if (cur < 0) cur = steps.length - 1;
    g.hidden = false;
    g.innerHTML = '<h3>Next step</h3><ol>' + steps.map(function (x, i) { return '<li class="' + (x.done ? 'done' : i === cur ? 'now' : '') + '"><i>' + (x.done ? '&#10003;' : i === cur ? '&#9656;' : (i + 1)) + '</i><span>' + x.t + '</span></li>'; }).join('') + '</ol><p class="why">' + steps[cur].why + '</p><div class="acts"></div>';
    var box = g.querySelector('.acts'); steps[cur].act.forEach(function (a) { var b = document.createElement('button'); b.className = 'btn sm' + (box.children.length ? '' : ' primary'); b.textContent = a[0]; b.onclick = a[1]; box.appendChild(b); });
  }



  /* ---------- blocks on the drawing: select one, drag it, drag its edges (in the plan: x and y, in the profile: x and z) ---------- */
  function blkRects(r, m) {                                           // where a block is drawn: its plan rectangle and its profile rectangle, in drawing coordinates
    var out = [], pb = viewMap().profile, x0 = m.xA + Math.min(r.x0, r.x1) / m.sx, x1 = m.xA + Math.max(r.x0, r.x1) / m.sx, yc = r.kind === 'deck' && m.deckYc != null ? m.deckYc : m.tankYc;
    if (r.yc != null) yc = r.yc;
    var hasPlan = r.yc != null ? true : !r.profileOnly && (r.kind === 'deck' ? m.deckBox : m.tankBox) && yc != null;
    if (hasPlan) out.push({ v: 'plan', yc: yc, x0: x0, x1: x1, y0: yc - Math.max(r.y0, r.y1) / m.sy, y1: yc - Math.min(r.y0, r.y1) / m.sy });
    if (pb && m.baseY != null) out.push({ v: 'prof', x0: x0, x1: x1, y0: m.baseY - Math.max(r.z0, r.z1) / m.sz, y1: m.baseY - Math.min(r.z0, r.z1) / m.sz });
    return out;
  }
  function bhit(q) {
    var m = planMap(); if (!m) return null; var e = 7 / S.view.k, best = null, bi = Infinity;
    function edges(b) { var inX = q.x >= b.x0 - e && q.x <= b.x1 + e, inY = q.y >= b.y0 - e && q.y <= b.y1 + e, h = ''; if (inX && Math.abs(q.y - b.y0) <= e) h += 'n'; if (inX && Math.abs(q.y - b.y1) <= e) h += 's'; if (inY && Math.abs(q.x - b.x0) <= e) h += 'w'; if (inY && Math.abs(q.x - b.x1) <= e) h += 'e'; return h; }
    function inside(b) { return q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1; }
    if (S.sel >= 0 && S.rows[S.sel] && S.rows[S.sel].on !== false) {
      var rs = blkRects(S.rows[S.sel], m), k;
      for (k = 0; k < rs.length; k++) { var h = edges(rs[k]); if (h) return { i: S.sel, v: rs[k].v, h: h }; }
      for (k = 0; k < rs.length; k++) if (inside(rs[k])) return { i: S.sel, v: rs[k].v, h: 'm' };
    }
    S.rows.forEach(function (r, i) { if (r.on === false) return; blkRects(r, m).forEach(function (b) { if (inside(b)) { var a = (b.x1 - b.x0) * (b.y1 - b.y0); if (a < bi) { bi = a; best = { i: i, v: b.v, h: 'm' }; } } }); });
    return best;
  }
  function bwApply(d, q) {
    var m = planMap(), r = S.rows[d.i], o = d.o, dx = (q.x - d.q0.x) * m.sx, dy = q.y - d.q0.y, g = G.r2;
    function lim(lo, hi) { return [Math.min(lo, hi), Math.max(lo, hi)]; }
    var v = d.v === 'plan' ? -dy * m.sy : -dy * m.sz;                        // up on the drawing is more y (plan) or more z (profile)
    var x0 = o.x0, x1 = o.x1, a0 = o.a0, a1 = o.a1;
    if (d.h === 'm') { x0 += dx; x1 += dx; a0 += v; a1 += v; }
    else { if (d.h.indexOf('w') >= 0) x0 += dx; if (d.h.indexOf('e') >= 0) x1 += dx; if (d.h.indexOf('n') >= 0) a1 += v; if (d.h.indexOf('s') >= 0) a0 += v; }
    var lx = lim(x0, x1), la = lim(a0, a1); r.x0 = g(lx[0]); r.x1 = g(lx[1]);
    if (d.v === 'plan') { r.y0 = g(la[0]); r.y1 = g(la[1]); } else { r.z0 = g(la[0]); r.z1 = g(la[1]); }
  }

  /* ---------- edit views: select a view box, drag it, drag its edges, add or delete one ---------- */
  S.vsel = -1; S.vadd = false;
  function viewCount(b) { b.n = G.segsIn(S.aSegs || [], b, 1).length; }
  function vwSnap() { S.vpre = histSer(); }
  function viewsChanged(msg) { if (H.i < 0 && S.vpre) { H.stack = [S.vpre]; H.i = 0; } S.vedited = true; S.views.forEach(viewCount); reanalyse(false); renderViews(); draw(); if (msg) toast(msg); }
  function viewDelete(i) { if (i < 0 || i >= S.views.length) return; vwSnap(); S.views.splice(i, 1); S.roles.splice(i, 1); S.vsel = -1; viewsChanged('View deleted. The blocks were suggested again from the views that are left.'); }
  function vhit(q) {                                                   // what is under the pointer: {i, h} with h = 'm' (inside) or the edges 'n','s','e','w' (corners: 'nw'...)
    var k = S.view.k, e = 7 / k, i, best = -1;
    function edges(b) { var inX = q.x >= b.x0 - e && q.x <= b.x1 + e, inY = q.y >= b.y0 - e && q.y <= b.y1 + e, h = ''; if (inX && Math.abs(q.y - b.y0) <= e) h += 'n'; if (inX && Math.abs(q.y - b.y1) <= e) h += 's'; if (inY && Math.abs(q.x - b.x0) <= e) h += 'w'; if (inY && Math.abs(q.x - b.x1) <= e) h += 'e'; return h; }
    function inside(b) { return q.x >= b.x0 && q.x <= b.x1 && q.y >= b.y0 && q.y <= b.y1; }
    if (S.vsel >= 0 && S.views[S.vsel]) { var hs = edges(S.views[S.vsel]); if (hs) return { i: S.vsel, h: hs }; }
    S.views.forEach(function (b, j) { if (inside(b) && (best < 0 || (b.x1 - b.x0) * (b.y1 - b.y0) < (S.views[best].x1 - S.views[best].x0) * (S.views[best].y1 - S.views[best].y0))) best = j; });
    if (S.vsel >= 0 && S.views[S.vsel] && inside(S.views[S.vsel])) return { i: S.vsel, h: 'm' };
    return best >= 0 ? { i: best, h: 'm' } : null;
  }
  var VCUR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', m: 'move' };
  function vwApply(d, q) {
    var o = d.o, b = S.views[d.i], dx = q.x - d.q0.x, dy = q.y - d.q0.y;
    if (d.h === 'm') { b.x0 = o.x0 + dx; b.x1 = o.x1 + dx; b.y0 = o.y0 + dy; b.y1 = o.y1 + dy; return; }
    if (d.h.indexOf('w') >= 0) b.x0 = o.x0 + dx; if (d.h.indexOf('e') >= 0) b.x1 = o.x1 + dx; if (d.h.indexOf('n') >= 0) b.y0 = o.y0 + dy; if (d.h.indexOf('s') >= 0) b.y1 = o.y1 + dy;
  }
  function vwNorm(b) { var x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1); if (x1 - x0 < 10) x1 = x0 + 10; if (y1 - y0 < 10) y1 = y0 + 10; b.x0 = x0; b.x1 = x1; b.y0 = y0; b.y1 = y1; }
  $('vwAdd').onclick = function () { S.vadd = !S.vadd; this.classList.toggle('on', S.vadd); this.setAttribute('aria-pressed', S.vadd ? 'true' : 'false'); cv.style.cursor = S.vadd ? 'crosshair' : ''; if (S.vadd) toast('Drag a rectangle around the view. Then set its role in Views.'); };
  $('vwDel').onclick = function () { if (S.vsel < 0) { toast('Select a view first: click it on the drawing.', true); return; } viewDelete(S.vsel); };
  $('vwTidy').onclick = function () { var b = S.views[S.vsel]; if (!b) { toast('Select a view first: click it on the drawing.', true); return; } var sg = G.segsIn(S.aSegs, b, 0); vwSnap(); if (!sg.length) { toast('No lines inside this view.', true); return; } var bb = G.bbox(sg); b.x0 = bb.x0 - 2; b.y0 = bb.y0 - 2; b.x1 = bb.x1 + 2; b.y1 = bb.y1 + 2; viewsChanged(); };
  $('vwReset').onclick = function () { if (S.raster) { vwSnap(); findPictureViews(true); viewsChanged(); return; } S.vsel = -1; var keep = S.labels; setRotation(false); };
  window.addEventListener('keydown', function (e) {                      // Delete (Backspace on a Mac): the selected block, or the selected hull point
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || document.querySelector('.overlay') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (S.mode === 'blocks' && !S.cal && S.sel >= 0 && S.sel < S.rows.length) { e.preventDefault(); S.rows.splice(S.sel, 1); S.sel = -1; renderBlocks(); draw(); try { regenDecks(); } catch (x) { } histCommit(); }
    else if (S.mode === 'hull' && S.hcSelPt && S.hcSelPt.k === S.hcAct && S.hc[S.hcAct] && S.hc[S.hcAct][S.hcSelPt.i]) { e.preventDefault(); S.hc[S.hcAct].splice(S.hcSelPt.i, 1); S.hcSelPt = null; hcUpdate(true); }
  });
  window.addEventListener('keydown', function (e) { if (S.mode !== 'views' || document.querySelector('.overlay') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return; if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (S.vsel >= 0) viewDelete(S.vsel); } if (e.key === 'Escape' && S.vadd) $('vwAdd').click(); });



  /* ---------- example sketches: where to click (pictures) and what a view box is ---------- */
  function gaSketch(kind) {
    var ln = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"', th = 'fill="none" stroke="currentColor" stroke-width=".9" opacity=".55"', o = '';
    // profile: hull from the stern (x 40) to the bow (x 640), keel y 140, main deck y 80
    o += '<path d="M40,80 L640,80 L626,108 Q610,140 584,140 L66,140 Q40,138 40,124 Z" ' + ln + '/><rect x="62" y="52" width="62" height="28" ' + ln + '/><rect x="76" y="34" width="34" height="18" ' + ln + '/><path d="M140,80 V140 M240,80 V140 M340,80 V140 M440,80 V140 M540,80 V140" ' + th + '/>';
    o += '<text x="40" y="22" class="sk">PROFILE (side view)</text>';
    // plan: half-breadth 58, centreline y 270
    o += '<path d="M40,212 L500,208 Q620,214 660,270 Q620,326 500,332 L40,328 Z" ' + ln + '/><path d="M140,212 V328 M240,210 V330 M340,209 V331 M440,208 V332 M40,270 H640" ' + th + '/><rect x="62" y="226" width="64" height="88" ' + th + '/>';
    o += '<text x="40" y="196" class="sk">PLAN (from above)</text>';
    if (kind !== 'scale') o += '<text x="690" y="164" class="sk" text-anchor="middle">SECTION</text><path d="M652,180 H728 V252 H652 Z M668,190 V244 M712,190 V244 M690,190 V244" ' + th + '/>';
    function mk(n, x, y) { return '<g data-n="' + n + '"><circle cx="' + x + '" cy="' + y + '" r="11" fill="var(--accent)"/><text x="' + x + '" y="' + (y + 4.5) + '" text-anchor="middle" class="mk">' + n + '</text></g>'; }
    function box(x0, y0, x1, y1, t) { return '<rect x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) + '" height="' + (y1 - y0) + '" fill="var(--accent)" fill-opacity=".08" stroke="var(--accent)" stroke-width="2" stroke-dasharray="7 4"/><rect x="' + x0 + '" y="' + (y0 - 1) + '" width="' + (t.length * 7.2 + 12) + '" height="17" fill="var(--accent)"/><text x="' + (x0 + 6) + '" y="' + (y0 + 11.5) + '" class="mk" style="font-size:11px">' + t + '</text>'; }
    if (kind === 'scale') {
      o += '<path d="M640,80 V140 M40,140 V152" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="3 3" fill="none"/>';
      o += '<path d="M40,270 H640" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="3 3" fill="none"/>';
      o += mk(1, 40, 140) + mk(2, 640, 140) + mk(3, 360, 80) + mk(4, 290, 270) + mk(5, 360, 209);
      o += '<text x="640" y="170" text-anchor="middle" class="sk" style="fill:var(--accent)">bow (right)</text><text x="40" y="170" class="sk" style="fill:var(--accent)">stern (left)</text>';
    } else {
      o += box(26, 26, 654, 152, 'Profile') + box(26, 200, 676, 340, 'Tank plan or Deck plan') + box(640, 168, 744, 262, 'Section');
    }
    return '<svg viewBox="0 0 760 350" class="sketch" role="img" aria-label="' + (kind === 'scale' ? 'Sketch of a general arrangement with five numbered points to click' : 'Sketch of a general arrangement with a box around each view') + '">' + o + '</svg>';
  }
  var GUIDES = {
    scale: { title: 'Set scale: five clicks on the picture', body: gaSketch('scale') + '<ol class="steps"><li><b>1</b> Stern end of the keel line (left end of the profile, at the bottom of the hull).</li><li><b>2</b> Bow end: the foremost point of the hull. Only its position along the length counts. The bow must be on the right: use <b>Turn</b> if it is not.</li><li><b>3</b> Main deck line, anywhere along it (at midship is best).</li><li><b>4</b> Centreline of the plan (the line down the middle seen from above).</li><li><b>5</b> Side of the hull at its widest point, in the plan.</li></ol><p>The app divides the length, the depth and the breadth you typed by these distances. <b>Backspace</b> goes back one click, <b>Esc</b> stops. Zoom in first for a better click: the scale is only as good as the clicks.</p>' },
    views: { title: 'Edit views: one box around each view', body: gaSketch('views') + '<ol class="steps"><li><b>Click</b> a box on the drawing to select it. Its edges and corners get handles.</li><li><b>Drag</b> inside to move it. <b>Drag an edge or corner</b> to resize it.</li><li>Use the bar on top of the drawing to say <b>what it is</b>: Profile, Deck plan, Tank plan, Section, or Ignore (title, tables, notes).</li><li><b>+ View</b> draws a new box. <b>Delete view</b> removes the selected one. <b>Find views</b> starts again.</li></ol><p>For a picture the boxes are found by looking for empty bands between the views. Check them: a box that also takes in a title is fine, but two views in one box are not.</p>' }
  };
  function showExample(kind) {
    var g = GUIDES[kind]; if (!g) return; var old = document.querySelector('.overlay.ex'); if (old) old.remove();
    var ov = document.createElement('div'); ov.className = 'overlay ex';
    ov.innerHTML = '<div class="dialog ex" role="dialog" aria-modal="true" aria-label="' + g.title + '"><h2>' + g.title + '</h2><div class="exbody">' + g.body + '</div><div class="helpfoot"><div class="actions"><label class="check" style="margin-right:auto"><input type="checkbox" data-x="never"> Do not show this again</label><button class="btn primary" data-x="close">Got it</button></div></div></div>';
    document.body.appendChild(ov);
    function close() { var nv = ov.querySelector('[data-x="never"]'); if (nv && nv.checked) { try { localStorage.setItem('ga2dbb-noex-' + kind, '1'); } catch (e) { } } S.exSeen[kind] = true; ov.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey); ov.addEventListener('click', function (e) { if (e.target === ov || e.target.getAttribute('data-x') === 'close') close(); });
    var b = ov.querySelector('.btn.primary'); if (b) b.focus();
  }
  function maybeExample(kind) { var no = false; try { no = localStorage.getItem('ga2dbb-noex-' + kind) === '1'; } catch (e) { } if (!no && !S.exSeen[kind]) { S.exSeen[kind] = true; showExample(kind); } }
  /* ---------- set the scale by clicks: for pictures, and for sheets where the views are not found ---------- */
  var CAL_STEPS = [
    'Profile (side view): click the <b>stern end</b> of the hull, on the keel line.',
    'Profile: click the <b>bow end</b> of the hull, on the keel line. The bow must be on the right: if not, Turn the drawing.',
    'Profile: click the <b>main deck line</b>, anywhere above the keel (at midship).',
    'Plan (view from above): click the <b>centreline</b> of the hull, anywhere along it.',
    'Plan: click the <b>side of the hull at its widest point</b> (midship).'
  ];
  function calMini() {                                                  // a small copy of the example sketch in the corner while clicking: the current point is lit, the next ones dimmed
    var mi = $('calMini'); if (!mi) return; var c = S.cal;
    if (!c || S.mode !== 'scale' || S.miniOff) { mi.hidden = true; return; }
    if (!mi._svg) { mi.innerHTML = '<button class="x" id="calMiniX" title="Hide this sketch" aria-label="Hide the sketch">&times;</button>' + gaSketch('scale') + '<div class="cap" id="calMiniCap"></div>'; mi._svg = mi.querySelector('svg'); }
    mi._svg.querySelectorAll('[data-n]').forEach(function (g) { var n = +g.getAttribute('data-n') - 1; g.style.opacity = n === c.step ? 1 : n < c.step ? 0.25 : 0.55; g.style.transformBox = 'fill-box'; g.style.transformOrigin = 'center'; g.style.transform = n === c.step ? 'scale(1.45)' : 'none'; });
    $('calMiniCap').textContent = 'Point ' + (c.step + 1) + ' of 5';
    mi.hidden = false;
  }
  function calMsg() {
    calMini();
    var c = S.cal, m = $('calMsg'); if (!c || S.mode !== 'scale') { m.hidden = true; return; }
    m.hidden = false; m.innerHTML = '<b>Set scale, step ' + (c.step + 1) + ' of 5.</b> ' + CAL_STEPS[c.step] + ' <i>Backspace goes back, Esc stops.</i> <span class="panhint">Drag to pan, wheel to zoom.</span> <button class="btn sm" id="calEx">Show example</button>';
  }
  function calNeeds() { return true; }                                   // missing length, breadth or depth are assumed or measured, never asked first
  function calClick(e) {
    var c = S.cal; if (!c) return; var q = toPage(e), P = c.pts, L = S.info.loa || 1;
    P.push({ x: q.x, y: q.y });
    if (c.step === 1) {
      if (Math.abs(P[1].x - P[0].x) < 20) { P.pop(); toast('The bow and the stern are too close: click the two ends.', true); return; }
      if (P[1].x < P[0].x) { P.pop(); toast('The bow is on the left. Turn the drawing half a turn (Turn twice) and set the scale again.', true); return; }
    }
    if (c.step === 2 && !(P[0].y + P[1].y) / 2 - q.y > 5) { P.pop(); toast('The deck line must be above the keel line. Click higher.', true); return; }
    if (c.step < 4) { c.step++; calMsg(); draw(); return; }
    var lenPx = P[1].x - P[0].x, baseY = (P[0].y + P[1].y) / 2, hpx = baseY - P[2].y, yc = P[3].y, half = Math.abs(P[4].y - yc);
    if (half < 5) { P.pop(); toast('Click the side of the hull, away from the centreline.', true); return; }
    var xA = P[0].x, L0 = S.info.loa || 1;
    var oldM = S.manual, snap = oldM && oldM._p ? Object.assign({}, oldM._p) : null;
    S.manual = { xA: xA, baseY: baseY, yc: yc, lengthPts: lenPx, beamPts: 2 * half, heightPts: hpx, sx: L0 / lenPx, sy: L0 / lenPx, sz: L0 / lenPx, pts: P.map(function (q) { return { x: q.x, y: q.y }; }) }; if (snap) S.manual._p = snap;
    var hasV = S.views.some(function (b, i) { return S.roles[i] === 'profile'; }) && S.views.some(function (b, i) { return S.roles[i] === 'tank' || S.roles[i] === 'deck'; });
    if (!hasV) { S.views = [{ x0: xA - 0.02 * lenPx, x1: xA + 1.02 * lenPx, y0: baseY - hpx * 2.6, y1: baseY + 0.15 * hpx, n: 0, title: '' }, { x0: xA - 0.02 * lenPx, x1: xA + 1.02 * lenPx, y0: yc - half * 1.3, y1: yc + half * 1.3, n: 0, title: '' }]; S.roles = ['profile', 'tank']; }
    S.cal = null; S.vsel = -1; setMode('blocks'); reanalyse(false); renderViews(); draw(); d3draw();
    toast('Scale set' + (S.est.loa ? ' (length assumed to be ' + ASSUME_L + ' m: type the real length to scale the ship)' : ': ' + fmt(L / lenPx * 100, 2) + ' m per 100 points') + '. Now draw the blocks (Draw block, two corners) and the hull (Edit hull).');
  }
  window.addEventListener('keydown', function (e) {
    if (S.mode !== 'scale' || !S.cal || document.querySelector('.overlay') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'Escape') { setMode('blocks'); } else if (e.key === 'Backspace') { e.preventDefault(); if (S.cal.pts.length) { S.cal.pts.pop(); S.cal.step = Math.max(0, S.cal.step - 1); calMsg(); draw(); } }
  });

  /* ---------- 3D preview: hull stations, waterlines and the ticked blocks, drawn as lines ---------- */
  var D3 = { yaw: -0.7, pitch: 0.45, zoom: 1 }, d3cv = $('d3cv'), d3 = d3cv.getContext('2d'), d3drag = null;
  function hullNow() { return S.hullMode === 'contour' && S.chull ? S.chull.hull : S.hullMode === 'guess' && S.guess ? S.guess.hull : null; }
  var D3o = { hull: true, blocks: true, lines: true, mesh: false, solid: false, clear: true, water: true };
  function d3draw(tgt) {
    if (!tgt && $('tab-d3').hidden) return;
    var r, dp; if (tgt) { r = { width: tgt.w, height: tgt.h }; dp = 1; } else { r = d3cv.parentNode.getBoundingClientRect(); dp = window.devicePixelRatio || 1; d3cv.width = Math.max(1, Math.round(r.width * dp)); d3cv.height = Math.max(1, Math.round(r.height * dp)); }
    d3.setTransform(dp, 0, 0, dp, 0, 0); if (tgt) { d3.fillStyle = '#ffffff'; d3.fillRect(0, 0, r.width, r.height); } else d3.clearRect(0, 0, r.width, r.height);
    var css = getComputedStyle(document.documentElement), dim = css.getPropertyValue('--fg-dim').trim() || '#566679', d = hcDims(), L = d.L || 30, B = d.B || 8, Dd = d.D || 4;
    var cy = Math.cos(D3.yaw), sy = Math.sin(D3.yaw), cp = Math.cos(D3.pitch), sp = Math.sin(D3.pitch), sc = D3.zoom * d3base(r, L, B, Dd);
    function P(x, y, z) { x -= L / 2; var a = x * cy - y * sy, b = x * sy + y * cy, c = z - Dd / 2; return [r.width / 2 + a * sc, r.height / 2 - (c * cp + b * sp) * sc, c * sp - b * cp]; }   // screen x, screen y, nearness
    function poly(list, col, w) { d3.strokeStyle = col; d3.lineWidth = w; d3.beginPath(); var on = false; list.forEach(function (p) { if (!p) { on = false; return; } var q = P(p[0], p[1], p[2]); if (on) d3.lineTo(q[0], q[1]); else d3.moveTo(q[0], q[1]); on = true; }); d3.stroke(); }
    var faces = [], h = hullNow(), mode = D3o.solid;
    function face(pts, rgb, alpha, edge) {                                    // a flat piece for the painter's sort: shaded by how much it faces the viewer
      var q = pts.map(function (p) { return P(p[0], p[1], p[2]); }), u = [q[1][0] - q[0][0], q[1][1] - q[0][1]], v = [q[2][0] - q[0][0], q[2][1] - q[0][1]];
      var n3 = [(pts[1][1] - pts[0][1]) * (pts[2][2] - pts[0][2]) - (pts[1][2] - pts[0][2]) * (pts[2][1] - pts[0][1]), (pts[1][2] - pts[0][2]) * (pts[2][0] - pts[0][0]) - (pts[1][0] - pts[0][0]) * (pts[2][2] - pts[0][2]), (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0])], nl = Math.hypot(n3[0], n3[1], n3[2]) || 1;
      var xr = n3[0] / nl, yr = n3[1] / nl, zr = n3[2] / nl, xx = (xr - L * 0) * cy - yr * sy, bb = xr * sy + yr * cy, nv = Math.abs(zr * sp - bb * cp), li = Math.abs(0.5 * zr + 0.3 * xx + 0.2 * bb);
      var k = 0.45 + 0.4 * nv + 0.25 * li, depth = q.reduce(function (a, c) { return a + c[2]; }, 0) / q.length;
      faces.push({ q: q, c: 'rgba(' + Math.min(255, Math.round(rgb[0] * k)) + ',' + Math.min(255, Math.round(rgb[1] * k)) + ',' + Math.min(255, Math.round(rgb[2] * k)) + ',' + alpha + ')', e: edge, z: depth });
    }
    var alpha = D3o.clear ? 0.4 : 1;
    if (D3o.hull) {
      if (h) {
        var of = h.offsets, nx = of.xs.length, nz = of.zs.length, i, j, st = Math.max(1, Math.round(nx / 14)), stz = Math.max(1, Math.round(nz / 7)), step = D3o.mesh ? 1 : 3, stepz = D3o.mesh ? 1 : 3;
        if (mode) for (i = 0; i + 1 < nx; i++) for (j = 0; j + 1 < nz; j++) {
          var c4 = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]; if (c4.some(function (c) { return of.half[c[1]][c[0]] == null; })) continue;
          [1, -1].forEach(function (sg) { face(c4.map(function (c) { return [of.xs[c[0]], sg * of.half[c[1]][c[0]], of.zs[c[1]]]; }), [138, 63, 252], alpha, null); });
        }
        else if (D3o.lines || D3o.mesh) {
          for (i = 0; i < nx; i += step) { var stn = []; for (j = nz - 1; j >= 0; j--) if (of.half[j][i] != null) stn.push([of.xs[i], of.half[j][i], of.zs[j]]); for (j = 0; j < nz; j++) if (of.half[j][i] != null) stn.push([of.xs[i], -of.half[j][i], of.zs[j]]); poly(stn, D3o.mesh ? 'rgba(138,63,252,.7)' : '#8a3ffc', D3o.mesh ? 0.7 : 1); }
          for (j = 0; j < nz; j += stepz) { var wl1 = [], wl2 = []; for (i = 0; i < nx; i++) if (of.half[j][i] != null) { wl1.push([of.xs[i], of.half[j][i], of.zs[j]]); wl2.push([of.xs[i], -of.half[j][i], of.zs[j]]); } poly(wl1, 'rgba(138,63,252,.6)', 0.7); poly(wl2, 'rgba(138,63,252,.6)', 0.7); }
        }
        if (mode && (D3o.lines || D3o.mesh)) {                                // lines over the surface
          for (i = 0; i < nx; i += step) { var stn2 = []; for (j = nz - 1; j >= 0; j--) if (of.half[j][i] != null) stn2.push([of.xs[i], of.half[j][i], of.zs[j]]); for (j = 0; j < nz; j++) if (of.half[j][i] != null) stn2.push([of.xs[i], -of.half[j][i], of.zs[j]]); faces.push({ line: stn2, c: 'rgba(60,20,120,.45)', z: -1e9 }); }
        }
        if (D3o.lines || D3o.mesh) {                                          // the deck edge
          var dk1 = [], dk2 = []; for (i = 0; i < nx; i++) { var top = null; for (j = nz - 1; j >= 0; j--) if (of.half[j][i] != null) { top = j; break; } if (top != null) { dk1.push([of.xs[i], of.half[top][i], of.zs[top]]); dk2.push([of.xs[i], -of.half[top][i], of.zs[top]]); } } poly(dk1, '#8a3ffc', 1.8); poly(dk2, '#8a3ffc', 1.8);
        }
        if (D3o.water) { var T = h.draught || 0.65 * Dd, wl = [[0, -B * 0.8, T], [L, -B * 0.8, T], [L, B * 0.8, T], [0, B * 0.8, T]]; d3.fillStyle = 'rgba(31,155,209,.13)'; d3.beginPath(); wl.forEach(function (p, q) { var c = P(p[0], p[1], p[2]); if (q) d3.lineTo(c[0], c[1]); else d3.moveTo(c[0], c[1]); }); d3.closePath(); d3.fill(); poly(wl.concat([wl[0]]), 'rgba(31,155,209,.8)', 1); }
      } else { var bx = [[0, 1, 0], [L, 1, 0], [L, -1, 0], [0, -1, 0], [0, 1, 0]].map(function (p) { return [p[0], p[1] * B / 2, 0]; }); poly(bx, dim, 1);
        d3.fillStyle = dim; d3.font = '12px system-ui, sans-serif'; d3.fillText('The hull is the DBB preset: it is made when the file opens in DBB. Choose "Guess from the plan view" or press Edit hull to see one here.', 12, r.height - 12); }
    }
    poly([[0, 0, 0], [L, 0, 0]], dim, 0.6);
    if (D3o.blocks) S.rows.forEach(function (rw) {
      if (rw.on === false) return; var x0 = Math.min(rw.x0, rw.x1), x1 = Math.max(rw.x0, rw.x1), y0 = Math.min(rw.y0, rw.y1), y1 = Math.max(rw.y0, rw.y1), z0 = Math.min(rw.z0, rw.z1), z1 = Math.max(rw.z0, rw.z1), col = GCOL[rw.group] || '#888';
      var shp = rw.shape || 'box', cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, sxl = x1 - x0, syl = y1 - y0, szl = z1 - z0;
      function W(v) { return [cx + v[0] * sxl, cy + v[1] * syl, cz + v[2] * szl]; }
      if (mode) {
        var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(col), rgb = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [140, 140, 140], a = D3o.clear ? 0.55 : 1;
        if (shp === 'box') [[[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]].forEach(function (f) { face(f, rgb, a, col); });
        else G.shapeTris(shp).forEach(function (t) { face(t.map(W), rgb, a, null); });
      } else if (shp === 'box') {
        [z0, z1].forEach(function (z) { poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z]], col, 1); });
        [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(function (c) { poly([[c[0], c[1], z0], [c[0], c[1], z1]], col, 1); });
      } else G.shapeEdges(shp).forEach(function (e) { poly([W(e[0]), W(e[1])], col, 1); });
    });
    faces.sort(function (a, b) { return a.z - b.z; });                         // far to near
    faces.forEach(function (f) {
      if (f.line) { d3.strokeStyle = f.c; d3.lineWidth = 0.6; d3.beginPath(); f.line.forEach(function (p, q) { var c = P(p[0], p[1], p[2]); if (q) d3.lineTo(c[0], c[1]); else d3.moveTo(c[0], c[1]); }); d3.stroke(); return; }
      d3.fillStyle = f.c; d3.beginPath(); f.q.forEach(function (c, q) { if (q) d3.lineTo(c[0], c[1]); else d3.moveTo(c[0], c[1]); }); d3.closePath(); d3.fill();
      if (f.e) { d3.strokeStyle = f.e; d3.lineWidth = 0.8; d3.stroke(); }
    });
  }
  function d3snap(w, h, view, opts) {                                     // the 3D view drawn on its own canvas (for the report), with the options given
    var c = document.createElement('canvas'); c.width = w; c.height = h; var k = { g: d3, v: D3, o: D3o };
    d3 = c.getContext('2d'); D3 = { yaw: view.yaw, pitch: view.pitch, zoom: view.zoom || 1 }; D3o = Object.assign({}, D3o, opts);
    try { d3draw({ w: w, h: h }); } finally { d3 = k.g; D3 = k.v; D3o = k.o; }
    return c;
  }
  function d3base(r, L, B, Dd) { return Math.min(r.width / (L * 1.15 + B * 0.5), r.height / (L * 0.45 + Dd * 2)); }
  function d3view(v) {                                                          // standard views, fitted to the hull
    var r = d3cv.parentNode.getBoundingClientRect(), d = hcDims(), L = d.L || 30, B = d.B || 8, Dd = d.D || 4, b0 = d3base(r, L, B, Dd), want;
    if (v === 'iso') { D3.yaw = -0.7; D3.pitch = 0.45; D3.zoom = 1; d3draw(); return; }
    if (v === 'side') { D3.yaw = 0; D3.pitch = 0; want = Math.min(r.width / (L * 1.15), r.height / (Dd * 1.5)); }
    else if (v === 'top') { D3.yaw = 0; D3.pitch = Math.PI / 2; want = Math.min(r.width / (L * 1.15), r.height / (B * 1.3)); }
    else { D3.yaw = -Math.PI / 2; D3.pitch = 0; want = Math.min(r.width / (B * 1.3), r.height / (Dd * 1.5)); }
    D3.zoom = Math.max(0.3, Math.min(20, want / b0)); d3draw();
  }
  document.querySelectorAll('#d3opts [data-o]').forEach(function (c) { c.checked = !!D3o[c.getAttribute('data-o')]; c.addEventListener('change', function () { D3o[c.getAttribute('data-o')] = c.checked; $('d3clearL').hidden = !D3o.solid; d3draw(); }); });
  document.querySelectorAll('#d3views [data-v]').forEach(function (b) { b.onclick = function () { d3view(b.getAttribute('data-v')); }; });
  $('d3clearL').hidden = !D3o.solid;
  d3cv.addEventListener('pointerdown', function (e) { d3cv.setPointerCapture(e.pointerId); d3drag = { x: e.clientX, y: e.clientY, yaw: D3.yaw, pitch: D3.pitch }; });
  d3cv.addEventListener('pointermove', function (e) { if (!d3drag) return; D3.yaw = d3drag.yaw + (e.clientX - d3drag.x) * 0.01; D3.pitch = Math.max(-1.5708, Math.min(1.5708, d3drag.pitch + (e.clientY - d3drag.y) * 0.01)); d3draw(); });
  d3cv.addEventListener('pointerup', function () { d3drag = null; });
  d3cv.addEventListener('wheel', function (e) { e.preventDefault(); D3.zoom = Math.max(0.3, Math.min(20, D3.zoom * Math.exp(-e.deltaY * 0.0015))); d3draw(); }, { passive: false });
  $('d3Reset').onclick = function () { d3view('iso'); };
  window.addEventListener('resize', d3draw);

  /* ---------- the mode: edit blocks or edit the hull ---------- */
  function setMode(m) {
    if (m !== S.mode) S.vbarClosed = false; S.mode = m; S.hcPick = false; S.fnr = false; S.fnd = null; $('fndBar').hidden = true; $('btnFind').classList.remove('on'); S.draw = false; S.corner = false; S.rubber = null; cv.style.cursor = '';
    $('modeBlocks').classList.toggle('on', m === 'blocks'); $('modeBlocks').setAttribute('aria-pressed', m === 'blocks'); $('modeHull').classList.toggle('on', m === 'hull'); $('modeHull').setAttribute('aria-pressed', m === 'hull');
    $('modeScale').classList.toggle('on', m === 'scale'); $('modeScale').setAttribute('aria-pressed', m === 'scale');
    if (m === 'scale') { if (!calNeeds()) return; S.miniOff = false; S.cal = { step: 0, pts: [] }; cv.style.cursor = 'crosshair'; } else S.cal = null; calMsg(); if (m === 'views') maybeExample('views');
    $('modeViews').classList.toggle('on', m === 'views'); $('modeViews').setAttribute('aria-pressed', m === 'views'); $('vwTools').hidden = m !== 'views'; S.vadd = false; $('vwAdd').classList.remove('on'); S.vsel = m === 'views' ? S.vsel : -1; renderViews();
    $('btnDraw').hidden = m !== 'blocks'; $('btnFind').hidden = m !== 'blocks'; $('btnDraw').classList.remove('on');
    document.querySelectorAll('[data-bl]').forEach(function (e) { if (e.id !== 'btnDraw') e.hidden = m === 'hull'; }); document.querySelectorAll('[data-hl]').forEach(function (e) { e.hidden = m !== 'hull'; });
    var want = m === 'hull' ? 'hull' : 'blocks'; var t = document.querySelector('.tab[data-tab="' + want + '"]'); if (t) t.click();
    if (m === 'hull') { if (!S.hc.plan.length && ((S.guess && S.guess.plan) || (S.manual && S.res && S.res.scale.sx != null))) $('hcFill').onclick(); else { renderHc(); zoomToBox(hcViewBox()); } } else draw();
  }
  $('modeBlocks').onclick = function () { setMode('blocks'); }; $('modeScale').onclick = function () { setMode('scale'); }; $('modeViews').onclick = function () { setMode('views'); }; $('modeHull').onclick = function () { setMode('hull'); };
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { if (t.getAttribute('data-tab') === 'd3') setTimeout(d3draw, 0); }); });




  /* ---------- undo and redo: blocks, levels, hull contours and the hull choice ---------- */
  var H = { stack: [], i: -1, busy: false }; window.GA_H = H;
  function histSer() { return JSON.stringify({ rows: S.rows, levels: S.levels, hc: S.hc, hullMode: S.hullMode, views: S.views, roles: S.roles, manual: S.manual }); }
  function histButtons() { $('btnUndo').disabled = H.i <= 0; $('btnRedo').disabled = H.i >= H.stack.length - 1; }
  function histCommit() {
    if (H.busy || !S.rotd || !S.res || (S.res.scale.sx == null && !S.vedited)) return; var t = histSer();
    if (H.i >= 0 && H.stack[H.i] === t) return;
    H.stack.splice(H.i + 1); H.stack.push(t); if (H.stack.length > 100) H.stack.shift(); H.i = H.stack.length - 1; histButtons();
  }
  function histReset() { H.stack = []; H.i = -1; S.vedited = false; S.vpre = null; S.txtTok++; S.words = null; histButtons(); }
  function histGo(d) {
    var j = H.i + d; if (j < 0 || j >= H.stack.length) return;
    H.busy = true; H.i = j; var st = JSON.parse(H.stack[j]);
    if (st.views && JSON.stringify({ v: S.views, r: S.roles, m: S.manual }) !== JSON.stringify({ v: st.views, r: st.roles, m: st.manual })) { S.views = st.views; S.roles = st.roles; S.manual = st.manual || null; S.vsel = -1; reanalyse(false); renderViews(); }
    S.rows = st.rows; S.levels = st.levels; S.hc = st.hc; S.hullMode = st.hullMode; $('selHull').value = S.hullMode; S.sel = -1;
    var dd = hcDims(); S.chull = dd.L && dd.B && dd.D ? G.hullFromContours({ L: dd.L, B: dd.B, D: dd.D, T: dd.T, plan: S.hc.plan, keel: S.hc.keel, deck: S.hc.deck, section: S.hc.section }) : null;
    renderHc(); renderHull(); renderAll(); d3draw(); histButtons(); H.busy = false;
  }
  $('btnUndo').onclick = function () { histGo(-1); }; $('btnRedo').onclick = function () { histGo(1); };
  ['pointerup', 'change', 'click', 'keyup', 'dblclick'].forEach(function (ev) { document.addEventListener(ev, function () { setTimeout(histCommit, 30); }, true); });
  window.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || ''; if (/INPUT|SELECT|TEXTAREA/.test(tag) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (!(e.ctrlKey || e.metaKey)) return; var k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); histGo(e.shiftKey ? 1 : -1); } else if (k === 'y') { e.preventDefault(); histGo(1); }
  });

  /* ---------- input check, How to and About ---------- */
  function inputCheck() {
    var w = [], n = S.nPages, ga = S.pageInfo[S.gaPage] || { text: 0, paths: 0 };
    if (n < 2) w.push('One page only. The best input is two pages: page 1 with the main particulars as text (name, length, breadth, depth, tanks, volumes), page 2 with the drawing.');
    else if (!S.infoPage) w.push('No page with text was found. Particulars can be typed, or read by OCR from the drawing.');
    if (ga.pic) w.push('Page ' + S.gaPage + ' is a picture (a scanned or pasted drawing), not a drawing with lines. The app turns it, finds the views and proposes the scale and the tank blocks by image analysis. If it chose the wrong page or the wrong views, change Drawing page, press Re-scan, or use Edit views and Set scale.');
    else if (ga.paths < 3000) w.push('The drawing page has few vector lines (' + ga.paths + '). It may be a scan: it opens, but views, scale and suggestions will not work. Draw blocks and hull by hand, or use a vector PDF.');
    if (n > 2 && !S.spec) w.push('More than two pages and no specification text was recognised: the particulars may be incomplete.');
    $('docWarn').hidden = !w.length; $('docWarn').innerHTML = w.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('');
  }
  var HELP = {
    start: '<h3>What works best</h3><p>A <b>vector drawing</b> of the general arrangement: a PDF (best), or a DXF or SVG file. It should show the <b>profile</b> (side view) and at least one <b>plan</b> (deck plan or tank plan) with the bow on one side, and ideally a midship <b>section</b>. The main particulars (length, breadth, depth) help but are not needed: they can be on the same sheet, on another page of the PDF as text, or typed. A specification of several pages also works: the app reads values and frame ranges from every text page.</p>' +
      '<p>A <b>picture</b> (JPG, PNG, WebP or a scan) also works. The app turns it upright, finds the views, measures the hull in the plan, proposes the scale and the cargo tanks, and shows them on the drawing in red points and coloured blocks. You check them and correct what is wrong. Clean drawings with clear lines work best; crowded sheets with many overlapping views need the views to be fixed by hand.</p>' +
      '<h3>Steps</h3><ol><li><b>Open GA.</b> The app picks the drawing page and the particulars page. Check both in Document, and the alert under it. If it chose the wrong page or the wrong views, change Drawing page or press <b>Re-scan drawing</b>.</li><li><b>Ship data.</b> Check the values. If the length is missing, 100 m is assumed and everything is in proportion; type the real length and all dimensions scale. Read part reads a table with OCR on this computer; Read text (OCR) reads the whole drawing text when it is not real text. Only the fields that are needed or found are shown; <b>+ field</b> adds another, and information DBB does not use is kept as notes (Metadata) in the saved file.</li><li><b>Views.</b> The drawing is turned upright and split into views. Set the role of each: profile, deck plan, tank plan, section. In Edit views a bar over the drawing says what to do.</li><li><b>Scale.</b> It comes from the length overall (or the frame ruler of a sheet), or, for a picture, from the measured hull (red points 1 to 5). Check it in Scale and in Checks. Set scale lets you click the five points yourself.</li><li><b>Edit blocks.</b> Tick the suggested blocks, edit the table, add blocks with Draw block: drag a rectangle, or click two opposite corners. Drag a block to move it, drag its edges to resize it, press Delete to remove the selected one. If tanks were missed, press <b>Find blocks in area</b> and drag a rectangle around them: the app looks for the bulkhead lines inside it and shows the cells it found; <b>Add them</b> accepts.</li><li><b>Edit hull.</b> Fill from drawing, then correct the contours (plan, keel, sheer, section), or click them on the drawing. The 3D tab shows the result. Delete removes the selected point.</li><li><b>Save DBB file</b> and open it in the DBB editor, or save an STL, a Blocks CSV, or a <b>Report PDF</b> with the ship data, the blocks and a picture of the drawing with the blocks on it.</li></ol>' +
      '<h3>If the length is not known</h3><p>The app assumes <b>100 m</b> (a note says so and the field is in italics) and measures breadth and depth from the drawing in proportion. Type the real length and every dimension, and every block, scales with it. If you type only the breadth or the depth, the length follows from the proportions of the drawing.</p>' +
      '<h3>Pictures: check the proposal</h3><p>The red points on the drawing are the five measurements used for the scale: the stern and the bow at keel level, the main deck line, the centreline of the plan and the side of the hull. If one is wrong, press <b>Set scale</b> and click the five points yourself (a small sketch shows where; drag to pan, wheel to zoom). Blocks keep their place on the drawing when the scale changes. If the picture was turned the wrong way, press <b>Turn</b>.</p>' +
      '<h3>A messy drawing</h3><p>The <b>Next step</b> box at the top of the left panel always shows what to do. For a crowded sheet: 1) in <b>Views</b>, set one view to Profile and one to Tank or Deck plan, and set the rest to Ignore; 2) if a view box is wrong (for example it covers the whole page), press <b>Edit views</b>: click a box and drag it, drag its edges to resize it, <b>+ View</b> adds one, <b>Delete view</b> removes one; 3) if the scale still fails, press <b>Set scale</b> and click it, then draw the blocks by hand (<b>Draw block</b>) and click the hull contours in <b>Edit hull</b>. Drag the grey bars to make the drawing bigger, or press <b>Expand</b>.</p>' +
      '<h3>Examples</h3><p>Press <b>Examples</b> for three GAs made for teaching (a PSV, a river cruise ship and a tanker). Open one to see the whole process, or save its PDF.</p>' +
      '<h3>Compartments from the lines</h3><p>For a PDF drawing made of lines, every enclosed area of every titled view (the plans and the profile) becomes a block, named by the label inside it: tanks, rooms, cabins and open deck areas. The scale comes from the scale bar of the sheet (or the length overall), the height of each plan from page 1 and the order of the plans. Door openings are closed up to 0.6 m, and up to 1.6 m where an area holds several labels (cabins on a corridor). Areas seen only in the profile get a width of half the breadth (an assumption). This is the first choice under Engine; OpenCV and the lines of the PDF are used when it finds no titled plans.</p>' +
      '<h3>Other engines</h3><p>A PDF drawing is also read First from the lines of the PDF (quick), then by <b>OpenCV</b>, image analysis of the page, which also finds the wing and double-bottom ballast tanks, the spaces at the ends, the forecastle, the deckhouse tiers and a hull table of offsets. When OpenCV finds blocks, its result replaces the first one; otherwise the first one stays. The Engine list in the Document panel chooses, and the note under it says which engine was used. Pictures (JPG, PNG, scanned pages) use the image analysis of this app.</p>' +
      '<h3>Passenger ships</h3><p>A sheet of stacked deck plans (cruise ships, ferries) is recognised: each plan is a deck, and the coloured areas become blocks: cabin classes (named from the legend, with P and S for the sides of the corridor) and rooms (named from the text on the plan). The deck height (3 m) and the depth are assumed: change them under Ship data and the blocks follow. Colours that are too pale are not found: draw those blocks.</p>' +
      '<h3>Everything is estimated</h3><p>Blocks are boxes unless you pick another shape. The hull is interpolated from three contours, and the bilge, keel rise and sheer are assumed unless you set them.</p>',
    keys: '<table class="keytbl"><tr><td>Ctrl+Z</td><td>Undo (blocks, levels and hull contours)</td></tr><tr><td>Ctrl+Shift+Z or Ctrl+Y</td><td>Redo</td></tr><tr><td>1 to 9, or Go to view</td><td>Zoom to view number 1 to 9 (the profile, a plan, a deck): the list is above the drawing</td></tr><tr><td>Wheel</td><td>Zoom around the cursor (Ctrl: faster)</td></tr><tr><td>Drag</td><td>Pan the drawing</td></tr><tr><td>Shape library</td><td>Pick a shape (box, cylinder, half cylinder, cone, pyramid, wedge, sphere) above the Blocks table: it sets the selected block and the next ones you draw</td></tr><tr><td>STL</td><td>Saves the ticked blocks and the hull as one solid model (STL)</td></tr><tr><td>Block</td><td>Click a block to select it, drag it to move it, drag its edges or corners to resize it (plan: x and y, profile: x and z)</td></tr><tr><td>Draw block</td><td>Drag a rectangle, or click two opposite corners; <kbd>Esc</kbd> cancels</td></tr><tr><td>Find blocks in area</td><td>Drag a rectangle around a group of spaces in a plan (tanks, cabins, rooms): the lines inside it cut it into cells, named Block 1, Block 2 and so on, shown in orange; Add them accepts, Cancel drops them</td></tr><tr><td>Delete (Backspace on a Mac)</td><td>Removes the selected block (Edit blocks) or the selected hull point (Edit hull)</td></tr><tr><td>Re-scan drawing</td><td>Reads the page again: views, roles and the proposal (Document panel)</td></tr><tr><td>Report PDF</td><td>A PDF with the ship data, the blocks table with volumes and the drawing with the blocks on it</td></tr><tr><td>Shift + drag, or middle button</td><td>Pan while Draw block or Click on drawing is on</td></tr><tr><td>Edit hull</td><td>Drag a purple point to move it; double-click the drawing to add a point; right-click a point to remove it; Click on drawing adds points one after another</td></tr></table>',
    gloss: '<dl><dt>Profile</dt><dd>Side view of the ship.</dd><dt>Plan</dt><dd>View from above (deck plan or tank plan).</dd><dt>Section</dt><dd>View across the ship; the midship section gives the transverse shape.</dd><dt>Contour</dt><dd>A line that defines the hull: half-breadth along the length (plan), keel and sheer height along the length (profile), half-width against height (section).</dd><dt>Frame</dt><dd>A numbered transverse position. Spacing is read from the ruler of the sheet; letters A to J follow frame 27 (editable).</dd><dt>Offsets table</dt><dd>Half-breadths on a grid of stations and heights: the hull format of DBB.</dd><dt>Cb</dt><dd>Block coefficient: underwater volume over length × breadth × draught.</dd><dt>OCR</dt><dd>Reading text from the picture of the drawing.</dd></dl>',
    about: '<p><b>GA to DBB</b> turns a two-dimensional general arrangement into a project file for the Ship Design Building Block Editor (DBB). It reads the drawing, finds the profile and the plans, measures the scale, and suggests the main decks, bulkheads, cargo and other tank blocks and a hull. You check each suggestion, edit what is wrong, and save a DBB file (or an STL solid) for the early-design work in DBB.</p>' +
      '<h3>How it works</h3><p>For PDF drawings it runs OpenCV (image analysis of the rendered page, no AI model) for the views, bulkheads, levels, tanks, ends and hull, with the lines of the PDF as the fallback. For vector files (PDF, DXF, SVG) it also reads the lines themselves: long horizontal and vertical lines give decks and bulkheads, and the hull outline gives the breadth and the contours. For pictures it uses plain image analysis, with no AI model: it looks for the empty bands between the views, measures the hull outline, the keel and deck lines and the lines that cross the whole breadth of the tank plan. Text is read by OCR (Tesseract) only when you ask for it. Everything runs in this page, on this computer: the drawing never leaves it.</p>' +
      '<h3>What to expect</h3><p>On the tanker test drawings the length, breadth and depth were measured within a few per cent, and the cargo tanks within about one metre on a 250 m ship. Clean drawings with a clear profile and plan work best; crowded sheets need the views set by hand. The results are estimates for early design and teaching. They must not be used for design approval, class or flag-state documentation, or any safety-critical decision. Provided as it is, without warranty.</p>' +
      '<h3>Educational use</h3><p>GA to DBB is an <b>educational and research tool</b>, made for teaching ship design at NTNU and for early-stage concept work. The drawings, tanks, volumes and hull it produces are <b>estimates read from a picture or a drawing</b>: they are approximate and can be wrong. They are not a substitute for the original ship data, class or flag-state documents, or a naval architect\'s judgement, and must not be used for design approval, certification, stability or safety-critical decisions, or for any commercial purpose. Always check the results against the source. The drawings you open stay on your computer and are not uploaded anywhere. Respect the copyright of the drawings you use: they remain the property of their owners. The software is provided as it is, without warranty of any kind, and NTNU and the author accept no liability for its use.</p><h3>Credits</h3><p>Developed by Henrique Gaspar, NTNU, 2026, to be merged into DBB. Citing: Gaspar, H.M. (2026). <i>GA to DBB</i> [Computer software]. NTNU. Uses pdf.js (Apache-2.0), OpenCV.js (Apache-2.0), Tesseract.js (Apache-2.0) and the fonts Barlow and IBM Plex Mono (SIL OFL).</p>' +
      '<h3>Earlier work</h3><p>This work was inspired by an early attempt published in:</p><ul><li>Legaz, M.J., Gaspar, H.M. (2024). Computer vision for reverse engineering in the design, simulation and operation of maritime systems. <i>Communications of the ECMS</i>, 38(1). <a href="https://doi.org/10.7148/2024-0234" target="_blank" rel="noopener">doi.org/10.7148/2024-0234</a></li></ul><p>An earlier use of OpenCV by the author, for cameras as sensors in a digital twin:</p><ul><li>Fonseca, I.A., Gaspar, H.M. (2020). Fundamentals of digital twins applied to a plastic toy boat and a ship scale model. <i>Communications of the ECMS</i>, 34(1). <a href="https://doi.org/10.7148/2020-0207" target="_blank" rel="noopener">doi.org/10.7148/2020-0207</a></li></ul>'
  };
  function showHelp(first) {
    var ov = document.createElement('div'); ov.className = 'overlay';
    var tabs = [['start', 'Start'], ['keys', 'Shortcuts'], ['gloss', 'Glossary'], ['about', 'About']], f0 = typeof first === 'string' ? first : 'start';
    ov.innerHTML = '<div class="dialog help" role="dialog" aria-modal="true" aria-label="How to"><h2>How to</h2><div class="helptabs" role="tablist">' + tabs.map(function (t, i) { return '<button class="tab" role="tab" data-ht="' + t[0] + '" aria-selected="' + (t[0] === f0) + '">' + t[1] + '</button>'; }).join('') + '</div><div class="helpbody">' + tabs.map(function (t, i) { return '<div data-hp="' + t[0] + '"' + (t[0] !== f0 ? ' hidden' : '') + '>' + HELP[t[0]] + '</div>'; }).join('') + '</div><div class="helpfoot"><div class="actions"><button class="btn primary" data-x="close">Got it</button></div></div></div>';
    document.body.appendChild(ov);
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); } function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.getAttribute('data-x') === 'close') { close(); return; }
      var t = e.target.getAttribute && e.target.getAttribute('data-ht'); if (!t) return;
      ov.querySelectorAll('[data-ht]').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-ht') === t ? 'true' : 'false'); }); ov.querySelectorAll('[data-hp]').forEach(function (p) { p.hidden = p.getAttribute('data-hp') !== t; });
    });
  }
  $('btnHelp').onclick = function () { showHelp('start'); };

  /* ---------- save ---------- */
  function stamp() { var d = new Date(), p = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); }
  async function deliver(name, text, what) {
    try {
      var dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) { await dl.save({ filename: name, data: text }); toast(what + ' saved.'); return; }
    } catch (e) { if (e && e.code === 'declined') return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast(what + ' ready.');
  }
  function baseName() { return ($('projName').value || S.info.name || 'GA project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_'); }
  $('btnSave').onclick = function () {
    var proj = G.buildProject(S.rows, { meta: metaItems(), info: S.info, name: $('projName').value || S.info.name, hull: S.hullMode !== 'none', hullObj: S.hullMode === 'guess' && S.guess ? S.guess.hull : S.hullMode === 'contour' && S.chull ? S.chull.hull : null, hullName: S.hullMode === 'contour' ? ' hull (from contours)' : undefined });
    deliver(baseName() + '_' + stamp() + '.json', JSON.stringify(proj, null, 2), 'DBB file');
  };
  $('btnCsv').onclick = function () { deliver(baseName() + '_blocks_' + stamp() + '.csv', G.toCSV(S.rows), 'Blocks table'); };


  /* ---------- the shape library (the primitives of DBB) and STL export ---------- */
  S.shape = 'box';
  var SHP_ICON = {
    box: '<path d="M12 3l8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10" fill="none"/>',
    cylinder: '<path d="M5 6v12c0 1.7 3 3 7 3s7-1.3 7-3V6"/><ellipse cx="12" cy="6" rx="7" ry="3"/>',
    halfcyl: '<path d="M3 18a9 12 0 0 1 18 0z"/>',
    cone: '<path d="M12 3L5 17c0 1.7 3 3 7 3s7-1.3 7-3z"/>',
    pyramid: '<path d="M12 3L3 18l9 3 9-3z"/><path d="M12 3v18" fill="none"/>',
    wedge: '<path d="M3 19L21 19 21 6z"/>',
    sphere: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.5" fill="none"/>'
  };
  function renderShapes() {
    var sel = S.sel >= 0 && S.rows[S.sel] ? (S.rows[S.sel].shape || 'box') : S.shape;
    $('shapeLib').innerHTML = '<span class="lab">Shape</span>' + G.SHAPES.map(function (q) { return '<button class="shp' + (sel === q.id ? ' on' : '') + '" data-shape="' + q.id + '" title="' + q.label + (S.sel >= 0 ? ': sets the shape of the selected block and of the next blocks you draw' : ': the shape of the next blocks you draw') + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + SHP_ICON[q.id] + '</svg>' + q.label + '</button>'; }).join('');
  }
  $('shapeLib').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-shape]'); if (!b) return; var id = b.getAttribute('data-shape'); S.shape = id;
    if (S.sel >= 0 && S.rows[S.sel]) S.rows[S.sel].shape = id;
    renderBlocks(); draw(); d3draw(); renderShapes();
  });
  var _rb = renderBlocks; renderBlocks = function () { _rb(); renderShapes(); $('btnStl').disabled = $('btnSave').disabled; };
  renderShapes();
  function stlDialog() {
    var ov = document.createElement('div'), hullOk = !!hullNow(); ov.className = 'overlay';
    ov.innerHTML = '<div class="dialog" role="dialog" aria-modal="true" aria-label="Save STL"><h2>Save STL</h2><p>A solid model in metres: x forward from the aft end, y to port, z up. It opens in CAD programs, and DBB can import it as one shape (Import STL, up axis Z).</p>' +
      '<div class="row"><label class="check"><input type="checkbox" data-s="blocks" checked> The ticked blocks, with their shapes</label><label class="check"><input type="checkbox" data-s="hull" ' + (hullOk ? 'checked' : 'disabled') + '> The hull' + (hullOk ? '' : ' (choose Guess or From contours first)') + '</label></div>' +
      '<p class="note" id="stlInfo"></p><div class="actions"><button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="save">Save STL</button></div></div>';
    document.body.appendChild(ov);
    function tris() { var T = []; if (ov.querySelector('[data-s="blocks"]').checked) T = T.concat(G.blockTris(S.rows)); if (ov.querySelector('[data-s="hull"]').checked && hullNow()) T = T.concat(G.hullTris(hullNow())); return T; }
    function info() { var n = tris().length; ov.querySelector('#stlInfo').textContent = n.toLocaleString('en-US') + ' triangles, about ' + Math.round((84 + 50 * n) / 1024).toLocaleString('en-US') + ' kB.'; ov.querySelector('[data-x="save"]').disabled = !n; }
    function close() { ov.remove(); }
    ov.addEventListener('change', info); info();
    ov.addEventListener('click', function (e) { if (e.target === ov || e.target.getAttribute('data-x') === 'cancel') close(); else if (e.target.getAttribute('data-x') === 'save') { var T = tris(); close(); deliverBin(baseName() + '_' + stamp() + '.stl', G.stlBinary(T, baseName()), 'STL file'); } });
  }
  async function deliverBin(name, buf, what) {
    try {
      var dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) { await dl.save({ filename: name.replace(/\.stl$/i, '.zip'), data: G.zipStore(name, buf) }); toast(what + ' saved inside a zip (the page here saves only some file types). Unzip it to get the .stl.'); return; }
    } catch (e) { if (e && e.code === 'declined') return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'model/stl' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast(what + ' ready.');
  }

  /* ---------- the report: a PDF with the ship data, the picture with the blocks on it and the blocks table ---------- */
  function reportImage() {                                              // the drawing with its overlays, as a JPEG, cropped to the page
    if (!S.rotd) return null;
    var keep = { x: S.view.x, y: S.view.y, k: S.view.k }, rub = S.rubber, fnd = S.fnd, img = null;
    try {
      S.rubber = null; S.fnd = null; fit();
      var r = cv.getBoundingClientRect(), q = cv.width / r.width, x = S.view.x * q, y = S.view.y * q, w = S.rotd.W * S.view.k * q, h = S.rotd.H * S.view.k * q;
      var c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(cv, x, y, w, h, 0, 0, c.width, c.height);
      img = { bytes: GAPDF.dataToBytes(c.toDataURL('image/jpeg', 0.88)), w: c.width, h: c.height };
    } catch (e) { img = null; }
    S.view = keep; S.rubber = rub; S.fnd = fnd; draw(); return img;
  }
  function buildReport() {
    var PW = 841.89, PH = 595.28, M = 36, doc = new GAPDF.Doc(PW, PH), BLUE = '#00509e', GREY = '#5b6675', LINE = '#c9d1db';
    var on = S.rows.filter(function (r) { return r.on !== false; }), off = S.rows.length - on.length, name = $('projName').value || S.info.name || 'GA project', today = new Date().toISOString().slice(0, 10);
    var pageNo = 0, pages = [];
    function newPage() { var pg = doc.addPage(); pages.push(pg); pageNo++; doc.rect(0, 0, PW, 40, BLUE); doc.text(M, 26, 'GA to DBB  |  Block report', 14, { bold: true, color: '#ffffff' }); doc.text(PW - M, 26, name + '  |  ' + today, 10, { align: 'right', color: '#ffffff' }); return pg; }
    function foot() { pages.forEach(function (pg, i) { doc.cur = pg; doc.line(M, PH - 30, PW - M, PH - 30, LINE, 0.5); doc.text(M, PH - 18, 'Educational use only. Values are estimates read from a drawing; not for design approval, class or safety-critical decisions. Check them against the source.', 7, { color: GREY }); doc.text(PW - M, PH - 18, 'Page ' + (i + 1) + ' of ' + pages.length, 7.5, { align: 'right', color: GREY }); }); }
    newPage();
    // left column: ship data
    var y = 64, x = M; doc.text(x, y, 'Ship data', 12, { bold: true, color: BLUE }); y += 8; doc.line(x, y, x + 250, y, BLUE, 1); y += 14;
    function kv(label, val, unit, est) { if (val == null || val === '') return; if (y > PH - 50) return; doc.text(x, y, label, 8.5, { color: GREY }); var v = (typeof val === 'number' ? fmt(val, Math.abs(val) >= 100 ? 1 : 2) : String(val)) + (unit ? ' ' + unit : '') + (est ? ' (estimated)' : ''); doc.text(x + 250, y, GAPDF.fit(v, 8.5, 112, false), 8.5, { align: 'right' }); y += 13; }
    CORE.concat(OPT).forEach(function (k) { var f = fieldDef(k); if (f && S.info[k] != null && S.info[k] !== '') kv(f[1], S.info[k], f[3], S.est[k]); });
    var mi = metaItems(); if (mi.length) { y += 6; doc.text(x, y, 'Other information', 10, { bold: true, color: BLUE }); y += 12; mi.forEach(function (m) { kv(m.label, m.value, m.unit, false); }); }
    y += 6; doc.text(x, y, 'Source', 10, { bold: true, color: BLUE }); y += 12; kv('File', S.fileName || '', '', false); if (S.est.loa) { doc.text(x, y, GAPDF.fit('The length was not found: 100 m was assumed and everything is in proportion.', 8, 250, false), 8, { color: '#a24b00' }); y += 12; }
    var cargo = on.filter(function (r) { return r.kind === 'cargo'; }).reduce(function (a, r) { return a + vol(r); }, 0), tot = on.reduce(function (a, r) { return a + vol(r); }, 0);
    y += 6; doc.text(x, y, 'Blocks', 10, { bold: true, color: BLUE }); y += 12; kv('Blocks listed', on.length + (off ? ' (' + off + ' not ticked)' : ''), '', false); kv('Volume of all listed blocks', tot, 'm³', false); if (cargo) kv('Cargo tanks (as boxes)', cargo, 'm³', false); if (S.info.cargoVol) kv('Cargo volume on the sheet', S.info.cargoVol, 'm³', false);
    // right column: the drawing with the blocks
    var im = reportImage(), bx = 312, bw = PW - M - bx, bh = PH - 50 - 56;
    if (im) { var sc = Math.min(bw / im.w, bh / im.h), dw = im.w * sc, dh = im.h * sc; doc.rect(bx, 56, bw, bh, '#ffffff', LINE, 0.5); doc.image(im.bytes, im.w, im.h, bx + (bw - dw) / 2, 56 + (bh - dh) / 2, dw, dh); doc.text(bx, 56 + bh + 10, 'The drawing as read by the app, with the ticked blocks.', 7.5, { color: GREY }); }
    // ---------- the general arrangement drawn again from the blocks: the profile and one plan per deck ----------
    var hl = hullNow(), Lr = S.info.loa || (hl && hl.loa) || Math.max.apply(null, on.map(function (r) { return Math.max(r.x0, r.x1); }).concat([10])), Br = S.info.beam || (hl && hl.beam) || 2 * Math.max.apply(null, on.map(function (r) { return Math.max(Math.abs(r.y0), Math.abs(r.y1)); }).concat([2]));
    var Dr = S.info.depth || (hl && hl.depth) || 0, ztop = Math.max.apply(null, on.map(function (r) { return Math.max(r.z0, r.z1); }).concat([Dr || 1])), xmin = Math.min.apply(null, on.map(function (r) { return Math.min(r.x0, r.x1); }).concat([0])), xmax = Math.max.apply(null, on.map(function (r) { return Math.max(r.x0, r.x1); }).concat([Lr]));
    function tint(hex, k) { var n = parseInt((hex || '#888888').slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; function m(c) { return Math.round(c + (255 - c) * k).toString(16).padStart(2, '0'); } return '#' + m(r) + m(g) + m(b); }
    function halfAt(z, i) {                                             // the half-breadth of the hull at station i and height z (null: no hull there)
      var of = hl.offsets, zs = of.zs, j; if (z < zs[0] || z > zs[zs.length - 1]) return z > zs[zs.length - 1] ? of.half[zs.length - 1][i] : null;
      for (j = 0; j + 1 < zs.length; j++) if (z <= zs[j + 1]) { var a = of.half[j][i], b = of.half[j + 1][i]; if (a == null || b == null) return a == null ? b : a; return a + (b - a) * (z - zs[j]) / (zs[j + 1] - zs[j]); }
      return null;
    }
    var lv = {}; on.forEach(function (r) { if (r.profileOnly || r.widthAssumed) return; var k = (Math.round(Math.min(r.z0, r.z1) * 10) / 10).toFixed(1); (lv[k] = lv[k] || []).push(r); });
    var levels = Object.keys(lv).filter(function (k) { return lv[k].length >= 2; }).map(Number).sort(function (a, b) { return b - a; });
    var levelName = {}; (S.levels || []).forEach(function (q) { if (q.name) levelName[(Math.round(q.z * 10) / 10).toFixed(1)] = q.name; });
    if (on.length) {
      var gx0 = M + 46, gw = PW - M - gx0 - 6, s = gw / (xmax - xmin || 1), X0 = function (x) { return gx0 + (x - xmin) * s; };
      var profH = Math.min(150, (ztop + 1) * s), planH = Br * s, gap = 26, ys = 74;
      function gaPage(title) { newPage(); doc.text(M, 60, title, 12, { bold: true, color: BLUE }); doc.text(PW - M, 60, 'Drawn from the ' + on.length + ' ticked blocks. Scale 1:' + Math.round(1000 / (s / 2.8346)) + ' on A4 landscape', 8, { align: 'right', color: GREY }); return 74; }
      function ruler(y) { for (var xm = Math.ceil(xmin / 10) * 10; xm <= xmax + 1e-6; xm += 10) { doc.line(X0(xm), y, X0(xm), y + 3, GREY, 0.4); doc.text(X0(xm), y + 10, String(xm), 6, { align: 'center', color: GREY }); } doc.text(X0(xmax) + 2, y + 10, 'x m', 6, { color: GREY }); }
      function label(r, x, y, w, h) { if (w < 14 || h < 6 || /\barea \d+$|^Block \d+$/i.test(r.name || '')) return;      // generic names are left out: they say nothing on a drawing
        var fs = Math.max(4, Math.min(6.5, h * 0.55)), t = GAPDF.fit(r.name || '', fs, w - 3, false); if (t) doc.text(x + w / 2, y + h / 2 + fs * 0.35, t, fs, { align: 'center', color: '#1d2633' }); }
      var y = gaPage('General arrangement from the blocks'), sz = Math.min(s, profH / (ztop + 1));
      // the profile: every block seen from the side, the hull outline from the offsets
      var pb = y + 10 + (ztop + 0.5) * sz, Z0 = function (z) { return pb - z * sz; };
      doc.text(M, y + 8, 'PROFILE', 8, { bold: true, color: BLUE });
      var srt = on.slice().sort(function (a, b) { return Math.abs(b.y1 - b.y0) - Math.abs(a.y1 - a.y0); });
      srt.forEach(function (r) { var c = GCOL[r.group] || '#888888', x = X0(Math.min(r.x0, r.x1)), w = Math.abs(r.x1 - r.x0) * s, yy = Z0(Math.max(r.z0, r.z1)), h = Math.abs(r.z1 - r.z0) * sz; doc.rect(x, yy, w, h, tint(c, 0.78), c, 0.35); });
      if (hl && hl.offsets) { var of = hl.offsets, top = [], bot = []; of.xs.forEach(function (x, i) { var lo = null, hi = null; of.zs.forEach(function (z, j) { if (of.half[j][i] != null) { if (lo == null) lo = z; hi = z; } }); if (lo != null) { top.push([X0(x), Z0(hi)]); bot.push([X0(x), Z0(lo)]); } }); doc.poly(bot.concat(top.reverse()), '#1d2633', 0.9, true); if (hl.draught) doc.line(X0(xmin), Z0(hl.draught), X0(xmax), Z0(hl.draught), '#1f9bd1', 0.6); }
      doc.line(X0(xmin), Z0(0), X0(xmax), Z0(0), GREY, 0.5); levels.forEach(function (z) { doc.line(gx0 - 6, Z0(z), gx0 - 1, Z0(z), BLUE, 0.6); doc.text(gx0 - 8, Z0(z) + 2, z.toFixed(1), 5.5, { align: 'right', color: BLUE }); });
      srt.forEach(function (r) { if (r.profileOnly || !levels.length) label(r, X0(Math.min(r.x0, r.x1)), Z0(Math.max(r.z0, r.z1)), Math.abs(r.x1 - r.x0) * s, Math.abs(r.z1 - r.z0) * sz); });
      ruler(pb + 3); y = pb + 22;
      // one plan per deck, from the highest
      levels.forEach(function (z) {
        if (y + planH + 20 > PH - 40) y = gaPage('General arrangement from the blocks (continued)');
        var cl = y + 10 + planH / 2, Y0 = function (yy) { return cl - yy * s; }, nm = levelName[z.toFixed(1)] || '';
        doc.text(M, y + 8, (nm ? nm.toUpperCase() + '  ' : 'PLAN  ') + 'z = ' + z.toFixed(2) + ' m', 8, { bold: true, color: BLUE });
        if (hl && hl.offsets) { var up = [], dn = []; hl.offsets.xs.forEach(function (x, i) { var hb = halfAt(z + 0.05, i); if (hb != null) { up.push([X0(x), Y0(hb)]); dn.push([X0(x), Y0(-hb)]); } }); if (up.length > 1) doc.poly(up.concat(dn.reverse()), '#1d2633', 0.8, true); }
        doc.poly([[X0(xmin), cl], [X0(xmax), cl]], GREY, 0.4, false, null, [4, 2]);
        var pr = lv[z.toFixed(1)].slice().sort(function (a, b) { return Math.abs((b.x1 - b.x0) * (b.y1 - b.y0)) - Math.abs((a.x1 - a.x0) * (a.y1 - a.y0)); }), bx2 = function (r) { return [X0(Math.min(r.x0, r.x1)), Y0(Math.max(r.y0, r.y1)), Math.abs(r.x1 - r.x0) * s, Math.abs(r.y1 - r.y0) * s]; };
        pr.forEach(function (r) { var c = GCOL[r.group] || '#888888', q = bx2(r); doc.rect(q[0], q[1], q[2], q[3], tint(c, 0.72), c, 0.4); }); pr.forEach(function (r) { var q = bx2(r); label(r, q[0], q[1], q[2], q[3]); });      // large blocks first, the names last so that no block covers them
        y = cl + planH / 2 + 14;
      });
      if (y + 30 < PH - 40) ruler(y - 8);
      // legend of the groups used
      var used = {}, lx = M; on.forEach(function (r) { used[r.group] = 1; }); Object.keys(used).forEach(function (g) { var t = G.GROUP_NAMES[g] || g; doc.rect(lx, PH - 50, 8, 6, tint(GCOL[g] || '#888888', 0.6), GCOL[g] || '#888888', 0.4); doc.text(lx + 11, PH - 44.5, t, 6.5, { color: GREY }); lx += 18 + GAPDF.width(t, 6.5); });
      if (!levels.length) doc.text(M, PH - 60, 'No deck plans: the blocks were found in the profile only, so their widths are assumed.', 7, { color: GREY });
    }
    // ---------- the hull: lines, numbers, 3D ----------
    newPage(); doc.text(M, 60, 'Hull', 12, { bold: true, color: BLUE });
    var hsrc = !hl ? 'The DBB preset (no hull was guessed here: DBB makes one from its own parameters when the file opens).' : S.hullMode === 'contour' ? 'Drawn from the hull contours picked on the drawing (Edit hull).' : S.guess && S.guess.fromDecks ? 'Guessed from the deck plans: ' + (S.guess.decks || '') + ' plan outlines, interpolated between the decks, round bilge under the lowest one.' : S.guess && S.guess.fromSection ? 'Guessed from the plan outline and the midship section.' : S.guess && S.guess.fromOcv ? 'Read by OpenCV from the hull table of the drawing.' : 'Guessed from the outline of the main plan, with a round bilge (assumed radius 6% of the beam).';
    var hy = 80; function hk(l, v) { doc.text(M, hy, l, 8.5, { color: GREY }); doc.text(M + 190, hy, v, 8.5, { align: 'right', bold: true }); hy += 13; }
    if (hl) {
      var T = hl.draught || 0, cbv = null, of2 = hl.offsets;
      if (of2 && T > 0) { var vv = 0; for (var i = 0; i + 1 < of2.xs.length; i++) for (var j = 0; j + 1 < of2.zs.length; j++) { if (of2.zs[j + 1] > T + 1e-9) continue; var a1 = of2.half[j][i] || 0, b1 = of2.half[j][i + 1] || 0, a2 = of2.half[j + 1][i] || 0, b2 = of2.half[j + 1][i + 1] || 0; vv += (a1 + b1 + a2 + b2) / 4 * 2 * (of2.xs[i + 1] - of2.xs[i]) * (of2.zs[j + 1] - of2.zs[j]); } cbv = vv / ((hl.loa || Lr) * (hl.beam || Br) * T); }
      hk('Length overall', fmt(hl.loa, 2) + ' m'); hk('Beam', fmt(hl.beam, 2) + ' m'); hk('Depth', fmt(hl.depth, 2) + ' m'); hk('Draught', fmt(T, 2) + ' m');
      if (cbv) { hk('Block coefficient Cb (estimate)', fmt(cbv, 3)); hk('Displaced volume (estimate)', fmt(cbv * hl.loa * hl.beam * T, 0) + ' m³'); hk('Displacement in sea water (estimate)', fmt(1.025 * cbv * hl.loa * hl.beam * T, 0) + ' t'); }
    } else hk('Hull', 'DBB preset');
    hy += 4; var hw = 250; (function (t) { var words = t.split(' '), line = ''; words.forEach(function (w) { if (GAPDF.width(line + ' ' + w, 7.5) > hw && line) { doc.text(M, hy, line, 7.5, { color: GREY }); hy += 10; line = w; } else line = line ? line + ' ' + w : w; }); if (line) { doc.text(M, hy, line, 7.5, { color: GREY }); hy += 10; } })('Source: ' + hsrc + ' Cb = displaced volume / (L x B x T), with the length overall: it is lower than the Cb on the waterline length.');
    if (hl && hl.offsets) {                                             // body plan: the stations, aft half on the left, fore half on the right
      var of3 = hl.offsets, bpS = Math.min(200 / (hl.beam || Br), 150 / (hl.depth || 1)), bcx = M + 125, bby = 470;
      doc.text(M, bby - (hl.depth || 1) * bpS - 14, 'BODY PLAN (aft half left, fore half right)', 7.5, { bold: true, color: BLUE });
      of3.xs.forEach(function (x, i) { if (i % 2) return; var sg = x < (hl.loa || Lr) / 2 ? -1 : 1, pts = []; of3.zs.forEach(function (z, j) { if (of3.half[j][i] != null) pts.push([bcx + sg * of3.half[j][i] * bpS, bby - z * bpS]); }); doc.poly(pts, '#7a3fe0', 0.5); });
      doc.line(bcx, bby + 4, bcx, bby - (hl.depth || 1) * bpS - 4, GREY, 0.4); doc.line(bcx - (hl.beam || Br) / 2 * bpS - 4, bby, bcx + (hl.beam || Br) / 2 * bpS + 4, bby, GREY, 0.4);
      if (hl.draught) doc.poly([[bcx - (hl.beam || Br) / 2 * bpS - 4, bby - hl.draught * bpS], [bcx + (hl.beam || Br) / 2 * bpS + 4, bby - hl.draught * bpS]], '#1f9bd1', 0.5, false, null, [3, 2]);
    }
    var vx = 312, vw = PW - M - vx;
    try {
      var c1 = d3snap(1400, 700, { yaw: -0.7, pitch: 0.45 }, { hull: true, blocks: true, solid: true, clear: true, lines: true, water: true }), c2 = d3snap(1400, 500, { yaw: -0.55, pitch: 0.22, zoom: 1.5 }, { hull: true, blocks: false, solid: true, clear: false, lines: true, water: true });
      var i1 = GAPDF.dataToBytes(c1.toDataURL('image/jpeg', 0.9)), i2 = GAPDF.dataToBytes(c2.toDataURL('image/jpeg', 0.9)), h1 = vw * 0.5, h2 = vw * 500 / 1400;
      doc.text(vx, 74, '3D: hull and blocks', 8, { bold: true, color: BLUE }); doc.image(i1, 1400, 700, vx, 80, vw, h1); doc.rect(vx, 80, vw, h1, null, LINE, 0.5);
      doc.text(vx, 80 + h1 + 16, '3D: hull', 8, { bold: true, color: BLUE }); doc.image(i2, 1400, 500, vx, 80 + h1 + 22, vw, h2); doc.rect(vx, 80 + h1 + 22, vw, h2, null, LINE, 0.5);
    } catch (e) { doc.text(vx, 80, '3D view not available: ' + e.message, 8, { color: GREY }); }
    // ---------- how the drawing was read ----------
    newPage(); doc.text(M, 60, 'How the drawing was read', 12, { bold: true, color: BLUE });
    var ry = 80; function para(t, sz2, o2) { var words = String(t).split(' '), line = '', mw = PW - 2 * M; sz2 = sz2 || 8.5; words.forEach(function (w) { if (GAPDF.width(line + ' ' + w, sz2, o2 && o2.bold) > mw && line) { if (ry < PH - 44) doc.text(M, ry, line, sz2, o2); ry += sz2 + 3.5; line = w; } else line = line ? line + ' ' + w : w; }); if (line) { if (ry < PH - 44) doc.text(M, ry, line, sz2, o2); ry += sz2 + 3.5; } }
    var engTxt = { rooms: 'Compartments from the lines of the PDF (vector drawing): every closed area of every titled view became a block.', opencv: 'OpenCV on the rendered drawing (tank spans between the regular bulkheads).', picrooms: 'A picture (scan): OpenCV found the closed compartments of each view in the image; names from the text read by OCR.', lines: 'The lines of the drawing (bulkheads, decks) and the particulars.' }[S.engineUsed] || 'The lines of the drawing.';
    para('Drawing: ' + (S.fileName || '') + ', page ' + (S.gaPage || '') + ' (' + (S.raster ? 'a picture' : 'a vector drawing') + '), turned ' + (S.rot * 90) + ' degrees clockwise.');
    para('Engine: ' + engTxt);
    var scl = S.res && S.res.scale; if (scl && scl.sx) para('Scale: ' + fmt(1 / scl.sx, 3) + ' drawing units per metre along the length' + (scl.lengthHow ? ' (' + scl.lengthHow + ')' : '') + '.');
    ry += 4; para('Views', 10, { bold: true, color: BLUE });
    S.views.forEach(function (v, i) { para('#' + (i + 1) + '  ' + (S.roles[i] || '') + (v.title ? '  "' + v.title + '"' : '') + (levels.length && S.levels && S.levels[i] ? '' : ''), 8); });
    if (S.levels && S.levels.length) { ry += 4; para('Deck heights', 10, { bold: true, color: BLUE }); S.levels.forEach(function (q) { para((q.name || 'Level') + ': z = ' + fmt(q.z, 2) + ' m', 8); }); }
    if (S.res && S.res.notes && S.res.notes.length) { ry += 4; para('Notes of the analysis', 10, { bold: true, color: BLUE }); S.res.notes.forEach(function (n) { para('- ' + n, 8); }); }
    if (S.raster) { var cs = S.cvSet; ry += 4; para('OpenCV settings', 10, { bold: true, color: BLUE }); para('Line darkness ' + (cs.th == null ? 'auto (Otsu)' : cs.th) + ', gaps closed up to ' + cs.gapM + ' m, marks under ' + cs.markM + ' m dropped, smallest compartment ' + cs.minM2 + ' m2, text ' + (cs.text ? 'ignored' : 'kept') + '.', 8); }
    ry += 4; para('Assumptions', 10, { bold: true, color: BLUE });
    ['A block of a deck plan reaches from its deck up to the next plan above; on the highest plan it is 2.8 m high when named, 0.5 m when an open area.', 'Blocks found only in the profile get half the beam as their width, centred (marked "width assumed").', 'A double bottom is added under the lowest plan when it stands 1 m or more above the baseline.', 'Volumes are those of the block shapes (box, cylinder ...), not of the real tanks: they ignore the hull shape and the structure.', 'All values are estimates read from a drawing. Check them before any use.'].forEach(function (t) { para('- ' + t, 8); });
    // the blocks table
    var cols = [['#', 20, 'c'], ['Name', 168, 'l'], ['Group', 100, 'l'], ['Shape', 64, 'l'], ['X from', 52, 'r'], ['X to', 52, 'r'], ['Y from', 52, 'r'], ['Y to', 52, 'r'], ['Z from', 52, 'r'], ['Z to', 52, 'r'], ['Volume m³', 0, 'r']], used = 0; cols.forEach(function (c) { used += c[1]; }); cols[10][1] = PW - 2 * M - used;
    var shapeName = {}; G.SHAPES.forEach(function (q) { shapeName[q.id] = q.label || q.id; });
    function head(yy) { doc.rect(M, yy - 10, PW - 2 * M, 15, '#e3e9f1'); var cx = M; cols.forEach(function (c) { var tx = c[2] === 'r' ? cx + c[1] - 4 : c[2] === 'c' ? cx + c[1] / 2 : cx + 4; doc.text(tx, yy, c[0], 8, { bold: true, align: c[2] === 'r' ? 'right' : c[2] === 'c' ? 'center' : 'left' }); cx += c[1]; }); }
    function startTable() { newPage(); doc.text(M, 62, 'Blocks (' + on.length + ')', 12, { bold: true, color: BLUE }); head(84); return 100; }
    var ty = startTable();
    if (!on.length) doc.text(M, ty + 4, 'No block is ticked.', 9, { color: GREY });
    on.forEach(function (r, i) {
      if (ty > PH - 56) ty = startTable();
      if (i % 2) doc.rect(M, ty - 9.5, PW - 2 * M, 13, '#f5f7fa');
      var cells = [String(i + 1), r.name, G.GROUP_NAMES[r.group] || r.group || '', shapeName[r.shape || 'box'] || 'Box', fmt(r.x0, 2), fmt(r.x1, 2), fmt(r.y0, 2), fmt(r.y1, 2), fmt(r.z0, 2), fmt(r.z1, 2), fmt(vol(r), 0)], cx = M;
      cols.forEach(function (c, j) { var tx = c[2] === 'r' ? cx + c[1] - 4 : c[2] === 'c' ? cx + c[1] / 2 : cx + 4; doc.text(tx, ty, GAPDF.fit(cells[j], 8, c[1] - 8, false), 8, { align: c[2] === 'r' ? 'right' : c[2] === 'c' ? 'center' : 'left' }); cx += c[1]; });
      ty += 13;
    });
    if (on.length) {                                                    // totals by group
      var by = {}; on.forEach(function (r) { var k = G.GROUP_NAMES[r.group] || r.group || 'Other'; by[k] = by[k] || { n: 0, v: 0 }; by[k].n++; by[k].v += vol(r); });
      var keys = Object.keys(by); if (ty > PH - 60 - 13 * (keys.length + 2)) ty = startTable(); ty += 10; doc.text(M, ty, 'Totals by group', 10, { bold: true, color: BLUE }); ty += 14;
      keys.forEach(function (k) { doc.text(M, ty, k, 8.5); doc.text(M + 230, ty, by[k].n + (by[k].n === 1 ? ' block' : ' blocks'), 8.5, { align: 'right' }); doc.text(M + 330, ty, fmt(by[k].v, 0) + ' m³', 8.5, { align: 'right' }); ty += 12; });
      doc.line(M, ty - 6, M + 330, ty - 6, LINE, 0.5); doc.text(M, ty + 4, 'All listed blocks', 8.5, { bold: true }); doc.text(M + 230, ty + 4, on.length + ' blocks', 8.5, { align: 'right', bold: true }); doc.text(M + 330, ty + 4, fmt(tot, 0) + ' m³', 8.5, { align: 'right', bold: true });
      doc.text(M, ty + 22, 'Coordinates in metres: x forward from the aft end, y to port (negative to starboard), z up from the baseline. Volumes are those of the block shapes, not of the real tanks.', 7.5, { color: GREY });
    }
    foot(); return doc.bytes();
  }
  $('btnPdf').onclick = async function () {
    if (!S.rotd) return; var bytes; try { bytes = buildReport(); } catch (e) { toast('The report could not be made: ' + e.message, true); return; }
    var name = baseName() + '_report_' + stamp() + '.pdf';
    try {
      var dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) { try { await dl.save({ filename: name, data: bytes }); toast('Report saved.'); return; } catch (e) { if (e && e.code === 'declined') return; await dl.save({ filename: name.replace(/\.pdf$/, '.zip'), data: G.zipStore(name, bytes) }); toast('Report saved inside a zip (the page here saves only some file types). Unzip it to get the PDF.'); return; } }
    } catch (e) { if (e && e.code === 'declined') return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Report ready.');
  };
  $('btnStl').onclick = stlDialog;

  size();
  window.GA_APP = S;
})();
