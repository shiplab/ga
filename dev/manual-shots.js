// Screenshots for the manual, made with the three example GAs only (they may be published). Needs: (cd dist && python3 -m http.server 8765)
const { chromium } = require('playwright'); const path = require('path'); const { execFileSync } = require('child_process');
const EX = n => path.join(__dirname, '..', 'examples', n), D = path.join(__dirname, '..', 'docs', 'img') + '/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
  const closeOv = async () => { await p.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove())); await p.waitForTimeout(150); };
  const sel = async i => { await p.evaluate(i => document.querySelector('[data-vsel="' + i + '"]').click(), i); await p.waitForTimeout(300); };
  await p.goto('http://localhost:8765/ga-to-dbb.html'); await p.waitForTimeout(900);
  await p.screenshot({ path: D + '01-start.png' });
  await p.click('#btnExamples'); await p.waitForTimeout(400); await p.screenshot({ path: D + '02-examples.png' }); await closeOv();
  await p.setInputFiles('input[type=file]', EX('GA_Tanker_Example.pdf')); await p.waitForTimeout(9000); await closeOv();
  await p.screenshot({ path: D + '03-opened.png' });
  await p.click('#modeViews'); await p.waitForTimeout(500); await closeOv(); await sel(1); await p.screenshot({ path: D + '04-views.png' });
  // Find blocks in this view: some tank-top blocks removed first, so that the view has something to find
  await p.evaluate(() => { const S = GA_APP; S.rows = S.rows.filter(r => !(Math.abs(r.z0 - 2.4) < 0.2 && r.x0 > 60 && r.x1 < 180)); });
  await p.click('#viewBar [data-role="__find"]'); await p.waitForTimeout(2500); await p.click('#fndSet'); await p.waitForTimeout(300);
  await p.screenshot({ path: D + '05-find-view.png' });
  await p.click('#fndOk'); await p.click('#cvClose').catch(() => {}); await p.waitForTimeout(300);
  await sel(3); await p.click('#viewBar [data-role="__find"]'); await p.waitForTimeout(2500); await p.screenshot({ path: D + '06-section.png' }); await p.click('#fndNo');
  await p.click('#modeBlocks'); await p.waitForTimeout(400); await closeOv(); await p.evaluate(() => { GA_APP.sel = 5; }); await p.click('#btnFit'); await p.waitForTimeout(300); await p.screenshot({ path: D + '07-blocks.png' });
  await p.click('#modeHull'); await p.waitForTimeout(400); await closeOv(); await p.screenshot({ path: D + '08-hull.png' });
  await p.click('#modeBlocks'); await closeOv(); await p.click('[data-tab="d3"]'); await p.waitForTimeout(1200); await p.screenshot({ path: D + '09-3d.png' });
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('#btnPdf')]); await d.saveAs('/tmp/ga-report.pdf');
  // a picture: page 2 of the PSV example as an image (OpenCV finds the compartments, OCR reads the names)
  await p.goto('http://localhost:8765/ga-to-dbb.html'); await p.waitForTimeout(900);
  await p.setInputFiles('input[type=file]', process.argv[2] || '/tmp/g3/psv-scan.pdf');
  await p.waitForFunction(() => GA_APP.words && GA_APP.engineUsed === 'picrooms', null, { timeout: 240000 }).catch(() => {}); await p.waitForTimeout(15000); await closeOv();
  await p.click('#modeViews'); await p.waitForTimeout(400); await closeOv();
  const ti = await p.evaluate(() => GA_APP.roles.indexOf('tank') >= 0 ? GA_APP.roles.indexOf('tank') : GA_APP.roles.findIndex(r => /deck|plan/.test(r)));
  if (ti >= 0) { await p.evaluate(i => { document.getElementById('selGoView').value = String(i); document.getElementById('selGoView').dispatchEvent(new Event('change')); }, ti); await sel(ti); await p.click('#viewBar [data-role="__find"]').catch(() => {}); await p.waitForTimeout(3000); await p.click('#fndSet').catch(() => {}); }
  await p.waitForTimeout(500); await p.screenshot({ path: D + '10-picture.png' });
  await b.close();
  execFileSync('pdftoppm', ['-r', '80', '-png', '-f', '1', '-l', '4', '/tmp/ga-report.pdf', '/tmp/ga-rep']);
  ['1', '2', '4'].forEach((n, i) => execFileSync('cp', ['/tmp/ga-rep-' + n.padStart(2, '0') + '.png', D + '11-report-' + ['page1', 'ga', 'hull'][i] + '.png']));
  console.log('done');
})();
