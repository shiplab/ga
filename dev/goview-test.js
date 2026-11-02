// Go to view: the list holds the views, choosing one zooms to it, the number keys do the same
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const errs = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'ga-to-dbb.html')); await p.waitForTimeout(800);
  await p.setInputFiles('input[type=file]', process.argv[2] || path.join(__dirname, '..', 'examples', 'GA_Tanker_Example.pdf')); await p.waitForFunction(() => window.GA_APP && GA_APP.rows.length, null, { timeout: 120000 }); await p.waitForTimeout(1500);
  const n = await p.evaluate(() => document.querySelectorAll('#selGoView option').length); ok(n >= 4, 'the list holds the views: ' + n + ' entries');
  const k0 = await p.evaluate(() => GA_APP.view.k);
  await p.selectOption('#selGoView', '2'); await p.waitForTimeout(300);
  const v = await p.evaluate(() => { const b = GA_APP.views[2], r = document.getElementById('cv').getBoundingClientRect(), V = GA_APP.view; return { k: V.k, l: V.x + b.x0 * V.k, rr: V.x + b.x1 * V.k, w: r.width }; });
  ok(v.k > 1.5 * k0 && v.l >= -1 && v.rr <= v.w + 1 && v.rr - v.l > 0.85 * v.w, 'view 3 fills the window (zoom ' + (v.k / k0).toFixed(1) + 'x)');
  await p.keyboard.press('1'); await p.waitForTimeout(200); const k1 = await p.evaluate(() => GA_APP.view.k); ok(k1 !== v.k, 'key 1 goes to view 1');
  await p.selectOption('#selGoView', 'all'); await p.waitForTimeout(200); const k2 = await p.evaluate(() => GA_APP.view.k); ok(Math.abs(k2 - k0) < 1e-6, 'Whole sheet = Fit');
  console.log(errs); ok(!errs.length, 'no page errors'); await b.close();
})();
