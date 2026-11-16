import { Pool, PoolClient } from 'pg';

type Q = Pick<PoolClient, 'query'> | Pick<Pool, 'query'>;

/** Kirim pemberitahuan dalam aplikasi ke semua wali (akun aktif) yang terhubung dengan santri. Ikut commit/rollback bila memakai client transaksi. */
export async function notifyWalsan(q: Q, santriId: string, title: string, body: string, link = '/walsan') {
  await q.query(
    `INSERT INTO notifications(user_id, title, body, link)
     SELECT sw.user_id, $2, $3, $4 FROM santri_walsan sw JOIN users u ON u.id = sw.user_id AND u.is_active WHERE sw.santri_id = $1`,
    [santriId, title, body, link]);
}
export const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

/** Jenis pembayaran yang bisa dinyalakan/dimatikan oleh tiap pengurus. */
export const PAY_TYPES = [
  { key: 'TOPUP_PROOF', label: 'Wali mengirim bukti transfer top up', hint: 'Perlu dicek lalu disetujui.' },
  { key: 'TOPUP_DONE', label: 'Top up sudah masuk ke saldo santri', hint: 'Setelah disetujui/dicocokkan oleh pengurus lain.' },
  { key: 'WALI_PAY', label: 'Wali membayar tagihan dari saldo', hint: 'Lewat portal wali, tanpa ke loket.' },
  { key: 'LOKET_PAY', label: 'Pembayaran tagihan di loket', hint: 'Yang dicatat oleh pengurus lain (bukan oleh Anda sendiri).' },
] as const;
export type PayType = (typeof PAY_TYPES)[number]['key'];
export const PAY_TYPE_KEYS: string[] = PAY_TYPES.map((t) => t.key);

/**
 * Pemberitahuan untuk pengurus (Super Admin, Admin, Bendahara). kind PAYMENT memicu suara "Ada yang bayar" di aplikasi.
 * payType: pengurus yang mematikan jenis ini tidak dikirimi. exceptUserId: pelaku sendiri tidak perlu diberi tahu.
 */
export async function notifyStaff(q: Q, title: string, body: string, link = '/topup', kind: 'INFO' | 'PAYMENT' = 'PAYMENT', opts: { payType?: PayType; exceptUserId?: string } = {}) {
  await q.query(
    `INSERT INTO notifications(user_id, title, body, link, kind, pay_type)
     SELECT u.id, $1, $2, $3, $4, $5 FROM users u LEFT JOIN notification_prefs p ON p.user_id = u.id
      WHERE u.is_active AND u.role IN ('SUPER_ADMIN','ADMIN','BENDAHARA')
        AND ($5::text IS NULL OR p.muted IS NULL OR NOT ($5::text = ANY(p.muted)))
        AND ($6::uuid IS NULL OR u.id <> $6::uuid)`,
    [title, body, link, kind, opts.payType ?? null, opts.exceptUserId ?? null]);
}
