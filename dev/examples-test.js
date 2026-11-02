// Examples menu (needs the page served over http: python3 -m http.server 8765 in dist): open each example, check the compartments engine
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8765/ga-to-dbb.html'); await p.waitForTimeout(800);
  for (const [i, min] of [[0, 250], [1, 600], [2, 300]]) {
    if (await p.$('.overlay [data-x=close]')) await p.click('.overlay [data-x=close]');
    await p.click('#btnExamples'); await p.click('[data-open="' + i + '"]');
    await p.waitForFunction(() => window.GA_APP && GA_APP.engineUsed === 'rooms', null, { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({ n: GA_APP.rows.length, e: GA_APP.engineUsed, f: GA_APP.fileName, note: document.getElementById('engineNote').textContent }));
    ok(r.e === 'rooms' && r.n >= min, r.f + ': ' + r.n + ' blocks (' + r.note.slice(0, 120) + ')');
    await p.screenshot({ path: '/tmp/g3/ex-' + i + '.png' });
  }
  console.log(errs); ok(!errs.length, 'no page errors'); await b.close();
})();
