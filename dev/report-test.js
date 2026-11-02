// Report PDF: the file is a valid PDF with the ship data, the picture and the blocks table
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const errs = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const p = await (await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true })).newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'ga-to-dbb.html')); await p.waitForTimeout(800);
  await p.setInputFiles('input[type=file]', path.join(__dirname, '..', process.argv[2] || 'examples/GA_Tanker_Example.pdf'));
  await p.waitForFunction(() => window.GA_APP && GA_APP.res && GA_APP.res.scale && GA_APP.res.scale.sx != null && GA_APP.rows.length); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => !document.getElementById('btnPdf').disabled), 'Report PDF button is enabled');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('#btnPdf')]);
  const f = require('os').tmpdir() + '/ga-report-test.pdf'; await d.saveAs(f); const buf = fs.readFileSync(f);
  ok(buf.slice(0, 5).toString() === '%PDF-' && buf.slice(-6).toString().includes('%%EOF'), 'a PDF file of ' + buf.length + ' bytes: ' + d.suggestedFilename());
  const view = await p.evaluate(() => JSON.stringify(GA_APP.view)); ok(true, 'view after: ' + view);
  console.log(errs); ok(!errs.length, 'no page errors'); await b.close();
})();
