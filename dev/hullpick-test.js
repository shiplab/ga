// Edit hull: a handle of the profile (keel) or of the section can be grabbed and dragged; no block gets selected
const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'ga-to-dbb.html')); await p.waitForTimeout(800);
  await p.setInputFiles('input[type=file]', path.join(__dirname, '..', 'examples', 'GA_Tanker_Example.pdf')); await p.waitForTimeout(9000);
  await p.click('#modeHull'); await p.waitForTimeout(300); await p.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove()));
  await p.click('#hcFill'); await p.waitForTimeout(800); await p.click('#btnFit'); await p.waitForTimeout(300);
  for (const k of ['keel', 'section']) {
    const sc = await p.evaluate(k => { const S = GA_APP, r = document.getElementById('cv').getBoundingClientRect(), pts = S.hc[k]; for (let i = 0; i < pts.length; i++) { const c = S.hcToPage(k, pts[i]); if (c) return { i, x: r.left + S.view.x + c[0] * S.view.k, y: r.top + S.view.y + c[1] * S.view.k, before: JSON.stringify(pts[i]), sel: S.sel }; } return null; }, k);
    if (!sc) { ok(false, k + ': no handle on the drawing'); continue; }
    await p.mouse.move(sc.x, sc.y); await p.mouse.down(); await p.mouse.move(sc.x + 12, sc.y - 8, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(200);
    const after = await p.evaluate(k => ({ act: GA_APP.hcAct, pts: JSON.stringify(GA_APP.hc[k]), sel: GA_APP.sel }), k);
    ok(after.act === k, k + ': it became the active contour (' + after.act + ')');
    ok(after.pts.indexOf(sc.before) < 0, k + ': the handle moved');
    ok(after.sel === sc.sel, k + ': no block was selected');
  }
  console.log(errs); ok(!errs.length, 'no page errors'); await b.close(); })();
