// open a GA in the built app and save what it proposes (blocks, ship data, engine) as JSON: node dev/dump-app.js <pdf> <out.json>
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const [pdf, out] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.join(__dirname, '..', 'dist', 'ga-to-dbb.html')); await p.waitForTimeout(800);
  await p.setInputFiles('input[type=file]', pdf);
  await p.waitForFunction(() => window.GA_APP && GA_APP.rotd, null, { timeout: 120000 }).catch(() => {});
  await p.waitForFunction(() => GA_APP.ocv && !GA_APP.ocv.busy || GA_APP.raster || !GA_APP.info.loa, null, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(+process.argv[4] || 2500);
  const r = await p.evaluate(() => { const S = GA_APP; return { engine: S.engineUsed, note: (document.getElementById('engineNote') || {}).textContent, info: S.info, est: S.est, rot: S.rot, roles: S.roles, rows: S.rows.filter(r => r.on !== false).map(r => ({ name: r.name, kind: r.kind, group: r.group, x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), y0: Math.min(r.y0, r.y1), y1: Math.max(r.y0, r.y1), z0: Math.min(r.z0, r.z1), z1: Math.max(r.z0, r.z1) })), hull: !!(S.guess && S.guess.hull), rooms: S.rooms && S.rooms.out && { big: S.rooms.out.big, scale: S.rooms.out.scale, notes: S.rooms.out.notes, views: (S.rooms.out.views || []).map(v => ({ title: v.title, role: v.role, z: v.z, box: v.box, cl: v.cl, base: v.base, n: v.n })) } }; });
  r.errors = errs; fs.writeFileSync(out, JSON.stringify(r, null, 1)); console.log(out, r.rows.length, 'blocks,', r.engine, errs.length ? errs : '');
  await b.close();
})();
