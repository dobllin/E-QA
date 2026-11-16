import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'crypto';

// 32 karakter tanpa yang membingungkan (0/O, 1/I). 256 % 32 == 0 jadi distribusi merata.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Token barcode: 16 karakter = 80 bit entropi. Tidak bisa ditebak dan bukan NIS. */
export function newBarcodeToken(): string {
  return Array.from(randomBytes(16)).map((b) => ALPHABET[b % 32]).join('');
}
export const hashBarcode = (token: string) =>
  createHash('sha256').update(token.trim().toUpperCase()).digest('hex');

export const newInitialPin = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** PIN 6 angka, tolak yang terlalu mudah ditebak. */
export function validatePin(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'PIN harus 6 angka';
  if (/^(\d)\1{5}$/.test(pin)) return 'PIN terlalu mudah ditebak (angka sama semua)';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'PIN terlalu mudah ditebak (urutan angka)';
  return null;
}

export const MAX_PIN_ATTEMPTS = Number(process.env.MAX_PIN_ATTEMPTS ?? 3);

// Kunci enkripsi token: CARD_TOKEN_KEY (disarankan), atau diturunkan dari JWT_SECRET bila tidak diisi.
const tokenKey = () => createHash('sha256').update('eqa-card-token:' + (process.env.CARD_TOKEN_KEY || process.env.JWT_SECRET || '')).digest();

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decryptToken(enc: string): string {
  const b = Buffer.from(enc, 'base64');
  const d = createDecipheriv('aes-256-gcm', tokenKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
