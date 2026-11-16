export const rupiah = (n: number | null | undefined) => `Rp${(n ?? 0).toLocaleString('id-ID')}`;

const TZ = 'Asia/Jakarta';
export function tanggalWaktu(iso: string | Date) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}.${g('minute')}`;
}
export function tanggal(iso: string | Date) {
  const s = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso.slice(0, 10)) ? iso.slice(0, 10) + 'T12:00:00+07:00' : iso;
  return tanggalWaktu(s).split(' ')[0];
}
export const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const STATUS_KARTU: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  ACTIVE: { label: 'Aktif', tone: 'ok' },
  SUSPENDED: { label: 'Dinonaktifkan sementara', tone: 'warn' },
  LOCKED: { label: 'Terkunci (salah PIN)', tone: 'bad' },
  REPLACED: { label: 'Sudah diganti', tone: 'muted' },
  REVOKED: { label: 'Dicabut', tone: 'muted' },
};
export const STATUS_TAGIHAN: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  UNPAID: { label: 'Belum bayar', tone: 'warn' },
  PARTIAL: { label: 'Dicicil', tone: 'warn' },
  PAID: { label: 'Lunas', tone: 'ok' },
  OVERDUE: { label: 'Menunggak', tone: 'bad' },
  CANCELLED: { label: 'Dibatalkan', tone: 'muted' },
  WAIVED: { label: 'Dibebaskan', tone: 'muted' },
};
export const JENIS_MUTASI: Record<string, string> = { TOPUP: 'Top up', PURCHASE: 'Belanja', REFUND: 'Pengembalian dana', ADJUSTMENT: 'Koreksi', TRANSFER: 'Pindah saldo', BILL_PAYMENT: 'Bayar tagihan' };
export const POCKET_LABEL: Record<string, string> = { SALDO: 'Saldo', JAJAN: 'Jajan', LAUNDRY: 'Laundry', SPP: 'SPP (lama)' };
export const POCKETS = ['SALDO', 'JAJAN', 'LAUNDRY'] as const;

// Istilah untuk wali santri (bahasa sehari-hari)
export const POCKET_NAME: Record<string, string> = { SALDO: 'Saldo', JAJAN: 'Uang jajan', LAUNDRY: 'Uang laundry', SPP: 'Uang SPP (lama)' };
export const JENIS_WALI: Record<string, string> = { TOPUP: 'Isi saldo', PURCHASE: 'Belanja', REFUND: 'Uang dikembalikan', ADJUSTMENT: 'Koreksi', TRANSFER: 'Pindah uang', BILL_PAYMENT: 'Bayar tagihan' };
export const TAGIHAN_WALI: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  UNPAID: { label: 'Belum dibayar', tone: 'warn' }, PARTIAL: { label: 'Dibayar sebagian', tone: 'warn' }, PAID: { label: 'Lunas', tone: 'ok' },
  OVERDUE: { label: 'Lewat jatuh tempo', tone: 'bad' }, CANCELLED: { label: 'Dibatalkan', tone: 'muted' }, WAIVED: { label: 'Dibebaskan', tone: 'muted' },
};
export const METODE_BAYAR: Record<string, string> = { CASH: 'tunai', TRANSFER: 'transfer', WALLET: 'dari saldo' };
/** Ambil nomor rekening dari teks lama bila rekening belum diisi terpisah (angka terpanjang ≥ 8 digit). */
export function accountNumber(info: { bankAccount?: string; bankInfo?: string } | null | undefined): string {
  if (info?.bankAccount?.trim()) return info.bankAccount.trim();
  const runs = (info?.bankInfo ?? '').match(/\d[\d .-]{6,}\d/g) ?? [];
  return (runs.sort((a, b) => b.length - a.length)[0] ?? '').trim();
}
