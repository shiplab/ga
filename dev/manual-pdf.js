/* Builds docs/manual.pdf from docs/manual.md: pandoc makes HTML (images embedded), Chromium prints it. node dev/manual-pdf.js */
const { execFileSync } = require('child_process'); const fs = require('fs'), path = require('path'); const { chromium } = require('playwright');
const docs = path.join(__dirname, '..', 'docs'), tmp = '/tmp';
const css = `@page { size: A4; margin: 20mm; }
html { font: 10pt/1.5 "DejaVu Sans", Arial, sans-serif; color: #172033; }
body { max-width: none; margin: 0; padding: 0; }
header h1.title { font-size: 28pt; margin: 40pt 0 4pt; color: #00509e; } .subtitle { font-size: 13pt; color: #4a5870; margin: 0 0 6pt; } .author, .date { margin: 0; color: #4a5870; }
header { margin-bottom: 20pt; padding-bottom: 12pt; border-bottom: 3pt solid #00509e; }
h1 { font-size: 17pt; margin: 18pt 0 8pt; padding-top: 4pt; border-top: 2pt solid #00509e; color: #00509e; break-after: avoid; }
h2 { font-size: 12.5pt; margin: 14pt 0 4pt; color: #00509e; break-after: avoid; } h3 { font-size: 10.5pt; margin: 10pt 0 3pt; color: #00509e; break-after: avoid; }
p, li { orphans: 3; widows: 3; } p { margin: 0 0 7pt; } ul, ol { margin: 0 0 8pt; padding-left: 18pt; } li { margin-bottom: 2pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.8pt; } th, td { border: .5pt solid #b9c4d2; padding: 3pt 5pt; text-align: left; vertical-align: top; } th { background: #e3e9f1; } tr { break-inside: avoid; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; border-left: 3pt solid #c0762b; background: #fbf3e8; } blockquote p { margin: 0; }
img { max-width: 100%; display: block; margin: 8pt auto 2pt; border: .5pt solid #b9c4d2; break-inside: avoid; } p:has(> img) { break-inside: avoid; margin: 0; } img[src*="11-report"] { max-height: 115mm; width: auto; }
figure { margin: 0; } figcaption, p > em:only-child { color: #4a5870; } figcaption { font-size: 8.5pt; text-align: center; margin: 2pt 0 10pt; }`;
fs.writeFileSync(tmp + '/ga-manual.css', css);
execFileSync('pandoc', [path.join(docs, 'manual.md'), '-f', 'markdown-smart', '-t', 'html5', '-s', '--embed-resources', '--resource-path', docs, '--css', tmp + '/ga-manual.css', '-o', tmp + '/ga-manual.html']);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); await p.goto('file://' + tmp + '/ga-manual.html'); await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: path.join(docs, 'manual.pdf'), format: 'A4', printBackground: true, displayHeaderFooter: true, margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }, outline: true, tagged: true,
    headerTemplate: '<div style="font:7pt sans-serif;color:#6b7788;width:100%;padding:0 20mm;text-align:right">GA 2D extractor to DBB: Manual</div>',
    footerTemplate: '<div style="font:7pt sans-serif;color:#6b7788;width:100%;padding:0 20mm;display:flex;justify-content:space-between"><span>NTNU, educational use only</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' });
  await b.close(); console.log('wrote docs/manual.pdf');
})();
