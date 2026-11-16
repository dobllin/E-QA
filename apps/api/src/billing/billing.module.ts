import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, MinLength } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { notifyStaff, notifyWalsan, rp } from '../common/notify';
import { AuthUser, CurrentUser, Roles } from '../common/auth';

export const EFFECTIVE_STATUS = `CASE WHEN i.status IN ('UNPAID','PARTIAL') AND i.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'OVERDUE' ELSE i.status END`;

/**
 * Keadaan pengingat sebuah tagihan (alias tabel invoices = i): NULL bila tidak menunggak;
 * NEVER = belum pernah diingatkan; AGAIN = sudah diingatkan tetapi lewat batas hari pengingat ulang dan masih belum lunas; WAIT = baru diingatkan.
 * Batas hari diambil dari pengaturan reminder_repeat_days (0 = tidak ada pengingat ulang).
 */
export const REMIND_DAYS_SQL = `COALESCE((SELECT NULLIF(value, '')::int FROM app_settings WHERE key = 'reminder_repeat_days'), 3)`;
export const REMIND_STATE_SQL = `CASE
  WHEN NOT (i.status IN ('UNPAID','PARTIAL') AND i.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date) THEN NULL
  WHEN i.last_reminded_at IS NULL THEN 'NEVER'
  WHEN ${REMIND_DAYS_SQL} > 0 AND i.last_reminded_at <= now() - make_interval(days => ${REMIND_DAYS_SQL}) THEN 'AGAIN'
  ELSE 'WAIT' END`;

export const NUMBER_SQL = `'INV-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMM') || '-' || lpad(nextval('invoice_seq')::text, 6, '0')`;

class GenerateDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Periode format YYYY-MM, contoh 2026-11' }) period: string;
  @IsString() @MinLength(2) title: string;
  @IsOptional() @IsInt() @Min(1000) @Max(100_000_000) amount?: number;   // nominal umum / cadangan
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Tanggal jatuh tempo format YYYY-MM-DD' }) dueDate: string;
  @IsOptional() @IsString() kelas?: string;
  @IsOptional() @IsBoolean() usePerStudent?: boolean;                      // pakai nominal SPP masing-masing santri
}
class CreateInvoiceDto {
  @IsUUID() santriId: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Periode format YYYY-MM' }) period: string;
  @IsString() @MinLength(2) title: string;
  @IsInt() @Min(1000) @Max(100_000_000) amount: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Tanggal jatuh tempo format YYYY-MM-DD' }) dueDate: string;
}
class EditInvoiceDto {
  @IsOptional() @IsString() @MinLength(2) title?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Tanggal jatuh tempo format YYYY-MM-DD' }) dueDate?: string;
  @IsOptional() @IsInt() @Min(1000) @Max(100_000_000) total?: number;
  @IsOptional() @IsString() @MinLength(3, { message: 'Alasan perubahan wajib diisi' }) reason?: string;
}
class PayDto {
  @IsUUID() invoiceId: string;
  @IsInt() @Min(1000) amount: number;
  @IsIn(['CASH', 'TRANSFER']) method: string;
  @IsString() @MinLength(8) idempotencyKey: string;
  @IsOptional() @IsString() note?: string;
}

@Controller('billing')
@Roles('BENDAHARA')
class BillingController {
  constructor(private db: Db) {}

  /**
   * Buat tagihan massal. Aman dijalankan ulang: tidak akan membuat tagihan ganda.
   * Dengan `usePerStudent`, tiap santri memakai nominal SPP miliknya sendiri; yang belum punya memakai `amount` (jika diisi), kalau tidak dilewati.
   */
  @Post('generate')
  async generate(@CurrentUser() u: AuthUser, @Body() b: GenerateDto) {
    const per = !!b.usePerStudent;
    if (!per && !b.amount) throw appErr(400, 'AMOUNT_REQUIRED', 'Isi nominal tagihan');
    const rowCount = (await this.db.query(
      `WITH ins AS (
         INSERT INTO invoices(number, santri_id, period, title, due_date, total)
         SELECT ${NUMBER_SQL}, s.id, $1, $2, $3::date, ${per ? 'COALESCE(s.spp_amount, $4::int)' : '$4::int'}
           FROM santri s WHERE s.status = 'ACTIVE' AND ($5::text IS NULL OR s.kelas = $5)
            ${per ? 'AND (s.spp_amount IS NOT NULL OR $4::int IS NOT NULL)' : ''}
         ON CONFLICT (santri_id, period, title) DO NOTHING
         RETURNING santri_id, total
       ), n AS (
         INSERT INTO notifications(user_id, title, body, link)
         SELECT sw.user_id, 'Tagihan baru', $2 || ' ' || $1 || ' sebesar Rp' || to_char(ins.total, 'FM999G999G999') || ', jatuh tempo ' || to_char($3::date, 'DD/MM/YYYY'), '/walsan'
           FROM ins JOIN santri_walsan sw ON sw.santri_id = ins.santri_id JOIN users u ON u.id = sw.user_id AND u.is_active
         RETURNING 1
       )
       SELECT (SELECT count(*) FROM ins)::int AS created`,
      [b.period, b.title.trim(), b.dueDate, b.amount ?? null, b.kelas || null])).rows[0].created as number;
    const skipped = per && !b.amount
      ? (await this.db.query(`SELECT count(*)::int AS n FROM santri s WHERE s.status = 'ACTIVE' AND ($1::text IS NULL OR s.kelas = $1) AND s.spp_amount IS NULL`, [b.kelas || null])).rows[0].n
      : 0;
    await audit(this.db.pool, u.id, 'INVOICE_GENERATE', 'invoice', undefined, { ...b, created: rowCount, skippedNoRate: skipped });
    return { created: rowCount ?? 0, skippedNoRate: skipped };
  }

  /** Tagihan untuk SATU santri (nominal bebas), mis. SPP yang berbeda, uang gedung, seragam. */
  @Post('invoices')
  async createOne(@CurrentUser() u: AuthUser, @Body() b: CreateInvoiceDto) {
    try {
      const { rows } = await this.db.query(
        `INSERT INTO invoices(number, santri_id, period, title, due_date, total)
         SELECT ${NUMBER_SQL}, s.id, $2, $3, $4::date, $5 FROM santri s WHERE s.id = $1 RETURNING id, number`,
        [b.santriId, b.period, b.title.trim(), b.dueDate, b.amount]);
      if (!rows[0]) throw appErr(404, 'SANTRI_NOT_FOUND', 'Santri tidak ditemukan');
      await notifyWalsan(this.db.pool, b.santriId, 'Tagihan baru', `${b.title.trim()} ${b.period} sebesar ${rp(b.amount)}, jatuh tempo ${b.dueDate.split('-').reverse().join('/')}`);
      await audit(this.db.pool, u.id, 'INVOICE_CREATE', 'invoice', rows[0].id, { santriId: b.santriId, title: b.title, period: b.period, amount: b.amount });
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw appErr(409, 'INVOICE_EXISTS', `Santri ini sudah punya tagihan "${b.title.trim()}" untuk periode ${b.period}. Ubah tagihan yang ada.`);
      throw e;
    }
  }

  /**
   * Ubah tagihan yang sudah dibuat (judul, jatuh tempo, total). Total tidak boleh kurang dari yang sudah dibayar.
   * Perubahan total wajib beralasan dan tercatat (nilai lama dan baru) di audit log.
   */
  @Patch('invoices/:id')
  async edit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: EditInvoiceDto) {
    return this.db.tx(async (c) => {
      const inv = (await c.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!inv) throw appErr(404, 'INVOICE_NOT_FOUND', 'Tagihan tidak ditemukan');
      if (['CANCELLED', 'WAIVED'].includes(inv.status)) throw appErr(409, 'INVOICE_CLOSED', `Tagihan berstatus ${inv.status} tidak bisa diubah`);
      const total = b.total ?? inv.total;
      if (b.total !== undefined && b.total !== inv.total && !b.reason) throw appErr(422, 'REASON_REQUIRED', 'Alasan perubahan nominal wajib diisi');
      if (total < inv.paid) throw appErr(422, 'BELOW_PAID', `Total tidak boleh kurang dari yang sudah dibayar (Rp${inv.paid.toLocaleString('id-ID')})`);
      const status = total === inv.paid ? 'PAID' : inv.paid > 0 ? 'PARTIAL' : 'UNPAID';
      try {
        await c.query('UPDATE invoices SET title = $2, due_date = $3::date, total = $4, status = $5 WHERE id = $1',
          [id, b.title?.trim() ?? inv.title, b.dueDate ?? inv.due_date, total, status]);
      } catch (e: any) {
        if (e.code === '23505') throw appErr(409, 'INVOICE_EXISTS', 'Santri ini sudah punya tagihan dengan judul dan periode yang sama');
        throw e;
      }
      await audit(c, u.id, 'INVOICE_EDIT', 'invoice', id, { before: { title: inv.title, dueDate: inv.due_date, total: inv.total }, after: { title: b.title ?? inv.title, dueDate: b.dueDate ?? inv.due_date, total }, reason: b.reason ?? null });
      return { ok: true, total, status };
    });
  }

  @Roles('BENDAHARA', 'ADMIN') @Get('invoices')
  async list(@Query('status') status?: string, @Query('santriId') santriId?: string, @Query('period') period?: string, @Query('q') q?: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM (
         SELECT i.id, i.number, i.title, i.period, i.due_date AS "dueDate", i.total, i.paid, (i.total - i.paid) AS remaining,
                ${EFFECTIVE_STATUS} AS status, i.last_reminded_at AS "lastRemindedAt", ${REMIND_STATE_SQL} AS "remindState", s.id AS "santriId", s.full_name AS "santriName", s.nis, s.kelas
           FROM invoices i JOIN santri s ON s.id = i.santri_id
          WHERE ($2::uuid IS NULL OR i.santri_id = $2) AND ($3::text IS NULL OR i.period = $3)
            AND ($4::text IS NULL OR s.full_name ILIKE '%' || $4 || '%' OR s.nis ILIKE '%' || $4 || '%')
       ) t WHERE ($1::text IS NULL OR t.status = $1) ORDER BY t."dueDate" ASC, t."santriName" LIMIT 5000`,
      [status || null, santriId || null, period || null, q || null]);
    return rows;
  }

  /** Catat pembayaran tunai/transfer di loket oleh bendahara. Kelebihan bayar ditolak. */
  @Post('pay')
  async pay(@CurrentUser() u: AuthUser, @Body() b: PayDto) {
    return this.db.tx(async (c) => {
      const dup = (await c.query('SELECT id, receipt_number, invoice_id FROM payments WHERE idempotency_key = $1', [b.idempotencyKey])).rows[0];
      if (dup) return { paymentId: dup.id, receiptNumber: dup.receipt_number, duplicate: true };
      const inv = (await c.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [b.invoiceId])).rows[0];
      if (!inv) throw appErr(404, 'INVOICE_NOT_FOUND', 'Tagihan tidak ditemukan');
      if (['PAID', 'CANCELLED', 'WAIVED'].includes(inv.status)) throw appErr(409, 'INVOICE_CLOSED', `Tagihan sudah berstatus ${inv.status}`);
      const remaining = inv.total - inv.paid;
      if (b.amount > remaining) throw appErr(422, 'OVERPAY', `Pembayaran melebihi sisa tagihan (sisa Rp${remaining.toLocaleString('id-ID')})`);
      const p = (await c.query(
        `INSERT INTO payments(receipt_number, invoice_id, amount, method, idempotency_key, note, received_by)
         VALUES ('KW-' || to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYYMM') || '-' || lpad(nextval('receipt_seq')::text, 6, '0'), $1,$2,$3,$4,$5,$6)
         RETURNING id, receipt_number`, [inv.id, b.amount, b.method, b.idempotencyKey, b.note ?? null, u.id])).rows[0];
      const paid = inv.paid + b.amount;
      await c.query(`UPDATE invoices SET paid = $2, status = $3 WHERE id = $1`, [inv.id, paid, paid >= inv.total ? 'PAID' : 'PARTIAL']);
      await audit(c, u.id, 'INVOICE_PAY', 'invoice', inv.id, { amount: b.amount, method: b.method, receipt: p.receipt_number });
      const sn = (await c.query('SELECT full_name FROM santri WHERE id = $1', [inv.santri_id])).rows[0]?.full_name ?? 'santri';
      await notifyStaff(c, 'Pembayaran di loket', `${sn} membayar ${inv.title} ${inv.period} sebesar ${rp(b.amount)}${paid >= inv.total ? ' (lunas)' : ' (dicicil)'}. Kwitansi ${p.receipt_number}.`, '/tagihan', 'PAYMENT', { payType: 'LOKET_PAY', exceptUserId: u.id });
      return { paymentId: p.id, receiptNumber: p.receipt_number, paid, remaining: inv.total - paid, duplicate: false };
    });
  }

  /** Pembatalan hanya untuk tagihan yang belum dibayar sama sekali; datanya tidak dihapus. */
  @Post('invoices/:id/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { rows } = await this.db.query(
      `UPDATE invoices SET status = 'CANCELLED' WHERE id = $1 AND paid = 0 AND status = 'UNPAID' RETURNING id`, [id]);
    if (!rows[0]) throw appErr(409, 'CANNOT_CANCEL', 'Hanya tagihan yang belum dibayar sama sekali yang bisa dibatalkan');
    await audit(this.db.pool, u.id, 'INVOICE_CANCEL', 'invoice', id);
    return { ok: true };
  }

  @Roles('BENDAHARA', 'ADMIN') @Get('payments/:id')
  async receipt(@Param('id', ParseUUIDPipe) id: string) {
    const { rows } = await this.db.query(
      `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount, p.method, p.paid_at AS "paidAt", i.number AS "invoiceNumber", i.title, i.period,
              i.total, i.paid, s.full_name AS "santriName", s.nis, s.kelas, u.full_name AS "receivedBy"
         FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN santri s ON s.id = i.santri_id LEFT JOIN users u ON u.id = p.received_by
        WHERE p.id = $1`, [id]);
    if (!rows[0]) throw appErr(404, 'NOT_FOUND', 'Kwitansi tidak ditemukan');
    return rows[0];
  }
}

@Module({ controllers: [BillingController] })
export class BillingModule {}
