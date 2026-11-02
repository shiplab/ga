// node build.js [--local]  -> dist/ga-to-dbb.html (artifact) or dist/local.html (test, node_modules pdf.js)
const fs = require('fs'), path = require('path');
const local = process.argv.includes('--local'), R = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const V = '3.11.174', CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + V + '/';
const base = path.join(__dirname, 'node_modules/pdfjs-dist/build/');
const libSrc = local ? 'file://' + base + 'pdf.min.js' : CDN + 'pdf.min.js';
const worker = local ? 'file://' + base + 'pdf.worker.min.js' : CDN + 'pdf.worker.min.js';
const b64 = f => fs.readFileSync(path.join(__dirname, f)).toString('base64');
const shimTxt = Buffer.from('x').toString('base64');
const fontFace = (fam, w, file) => `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${b64(file)}) format('woff2');}`;
const fonts = [['Barlow', 400, 'node_modules/@fontsource/barlow/files/barlow-latin-400-normal.woff2'], ['Barlow', 500, 'node_modules/@fontsource/barlow/files/barlow-latin-500-normal.woff2'], ['Barlow', 600, 'node_modules/@fontsource/barlow/files/barlow-latin-600-normal.woff2'],
  ['Barlow Condensed', 500, 'node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2'], ['Barlow Condensed', 600, 'node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2'],
  ['IBM Plex Mono', 400, 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'], ['IBM Plex Mono', 500, 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2']].map(f => fontFace(...f)).join('\n');
const assets = { core: b64('node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'), wk: b64('node_modules/tesseract.js/dist/worker.min.js'), lang: b64('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz') };
const html = `<meta charset="utf-8">
<title>GA to DBB</title>
<link rel="icon" type="image/png" href="data:image/png;base64,${b64('src/ntnu.png')}">
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${fonts}
${R('src/style.css')}
</style>
${R('src/body.html')}
<script>
${R('node_modules/pdfjs-dist/build/pdf.min.js')}
</script>
<script>
${R('node_modules/pdfjs-dist/build/pdf.worker.min.js')}
</script>
<script>
${R('node_modules/tesseract.js/dist/tesseract.min.js')}
</script>
<script>window.GA_ASSETS=${JSON.stringify(assets)};</script>
<script>
${R('src/core.js')}
</script>
<script>
${R('src/vision.js')}
${R('src/decks.js')}
</script>
<script>
${R('src/gacv.js')}
${R('src/ocv.js')}
${R('src/rooms.js')}
</script>
<script>
${R('src/vector.js')}
</script>
<script>
${R('src/ocr.js')}
</script>
<script>
${R('src/pdf.js')}
</script>
<script>
${R('src/app.js')}
</script>
`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', local ? 'local.html' : 'ga-to-dbb.html');
fs.writeFileSync(out, html); console.log(out, html.length);
// OpenCV.js is its own file next to the page (13 MB): loaded only when a PDF is analysed
fs.mkdirSync(path.join(__dirname, 'dist', 'vendor'), { recursive: true });
const cvSrc = path.join(__dirname, 'node_modules/@techstark/opencv-js/dist/opencv.js'), cvDst = path.join(__dirname, 'dist', 'vendor', 'opencv.js');
if (fs.existsSync(cvSrc) && (!fs.existsSync(cvDst) || fs.statSync(cvDst).mtimeMs < fs.statSync(cvSrc).mtimeMs)) require('child_process').execFileSync('node', [path.join(__dirname, 'dev/mk-opencv-vendor.js'), cvSrc, cvDst], { stdio: 'inherit' });
// the example GAs (copyright free, made for teaching) next to the page
fs.mkdirSync(path.join(__dirname, 'dist', 'examples'), { recursive: true });
['GA_PSV_Example.pdf', 'GA_River_Cruise_Example.pdf', 'GA_Tanker_Example.pdf'].forEach(f => fs.copyFileSync(path.join(__dirname, 'examples', f), path.join(__dirname, 'dist', 'examples', f)));

// node build.js --pages: the page as index.html and OpenCV in vendor/, at the top of the repository (GitHub Pages)
if (process.argv.includes('--pages')) { fs.copyFileSync(out, path.join(__dirname, 'index.html')); fs.mkdirSync(path.join(__dirname, 'vendor'), { recursive: true }); if (fs.existsSync(cvDst)) fs.copyFileSync(cvDst, path.join(__dirname, 'vendor', 'opencv.js')); console.log('index.html and vendor/opencv.js updated'); }
