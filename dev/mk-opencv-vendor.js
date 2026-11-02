// vendor/opencv.js for the artifact: the wasm is embedded as a raw binary string literal, which the artifact store refuses
// (control bytes). It is rewritten as atob("base64"), the same string, in plain text.
const fs = require('fs'), path = require('path');
const src = process.argv[2] || path.join(__dirname, '../../ocv-ga/node_modules/@techstark/opencv-js/dist/opencv.js'), dst = process.argv[3] || path.join(__dirname, '../dist/vendor/opencv.js');
let s = fs.readFileSync(src, 'utf8'); const key = "binaryDecode('", a = s.indexOf(key) + key.length - 1;
let i = a + 1; while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === "'") break; i++; }
const lit = s.slice(a, i + 1), str = eval(lit);                       // the exact string value of the literal
let max = 0; for (let k = 0; k < str.length; k++) max = Math.max(max, str.charCodeAt(k)); if (max > 255) throw new Error('not a byte string');
const b64 = Buffer.from(str, 'latin1').toString('base64');
s = s.slice(0, a) + 'atob("' + b64 + '")' + s.slice(i + 1);
const bad = [...s].filter(c => { const q = c.charCodeAt(0); return q < 32 && q !== 9 && q !== 10 && q !== 13; }).length;
fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, s); console.log(dst, s.length, 'wasm bytes', str.length, 'control chars left', bad);
