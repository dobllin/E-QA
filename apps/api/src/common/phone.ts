/** Rapikan nomor HP Indonesia ke format internasional tanpa plus (628123456789) untuk tautan WhatsApp. Tidak valid → null. */
export function normalizePhone(raw?: string | null): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return /^62\d{8,13}$/.test(d) ? d : null;
}
