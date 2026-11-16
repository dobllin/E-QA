/** Menyiapkan foto (perkecil + buang EXIF) dan membaca angka rupiah dari screenshot bukti transfer di browser. */
export async function prepareImage(file: File): Promise<{ blob: Blob; canvas: HTMLCanvasElement }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Gagal memproses foto'))), 'image/jpeg', 0.85));
  return { blob, canvas: c };
}

function toInt(tok: string): number {
  let t = tok.replace(/\s/g, '');
  const m = t.match(/^(.*?)[.,](\d{2})$/);
  if (m && (/[.,]/.test(m[1]) || m[1].length >= 4)) t = m[1];   // "51.908,00" / "51908,00" → buang sen
  return Number(t.replace(/[.,]/g, ''));
}
/** Ambil semua angka yang mirip nominal rupiah (1.000 – 100.000.000) dari teks hasil OCR. */
export function extractAmounts(text: string): number[] {
  const found = text.match(/\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{2})?|\d{4,9}(?:[.,]\d{2})?/g) ?? [];
  return [...new Set(found.map(toInt).filter((n) => Number.isInteger(n) && n >= 1000 && n <= 100_000_000))].slice(0, 20);
}

export async function readAmounts(canvas: HTMLCanvasElement): Promise<number[]> {
  const { createWorker } = await import('tesseract.js');
  const o = window.location.origin;
  const worker = await createWorker('eng', 1, { workerPath: `${o}/ocr/worker.min.js`, corePath: `${o}/ocr/`, langPath: `${o}/ocr/lang` });
  try {
    const { data } = await worker.recognize(canvas);
    return extractAmounts(data.text);
  } finally { await worker.terminate(); }
}
