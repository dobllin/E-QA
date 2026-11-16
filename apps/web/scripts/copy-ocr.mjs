// Menyalin berkas OCR (tesseract.js) ke public/ocr supaya dilayani dari server sendiri (tanpa CDN pihak luar).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const out = 'public/ocr';
mkdirSync(`${out}/lang`, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', `${out}/tesseract-core-lstm.wasm.js`],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', `${out}/tesseract-core-simd-lstm.wasm.js`],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/lang/eng.traineddata.gz`],
];
for (const [from, to] of files) {
  if (!existsSync(from)) { console.error(`[copy-ocr] berkas tidak ditemukan: ${from}`); process.exit(1); }
  cpSync(from, to);
}
console.log('[copy-ocr] berkas OCR disalin ke public/ocr');
