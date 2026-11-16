import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { EFFECTIVE_STATUS } from '../billing/billing.module';
import { audit } from '../common/audit';
import { notifyStaff } from '../common/notify';
import { POCKETS, POCKET_LABEL, Pocket } from '../common/pockets';

class TransferDto {
  @IsIn(POCKETS) from: Pocket;
  @IsIn(POCKETS) to: Pocket;
  @IsInt() @Min(1000) @Max(100_000_000) amount: number;
  @IsString() @MinLength(8) idempotencyKey: string;
}
class SourceDto { @IsIn(POCKETS) pocket: Pocket; @IsInt() @Min(1) @Max(100_000_000) amount: number }
class PayInvoiceDto {
  @IsOptional() @IsIn(POCKETS) pocket?: Pocket;                      // cara lama: satu kantong
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) amount?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => SourceDto) sources?: SourceDto[]; // beberapa kantong sekaligus
  @IsString() @MinLength(8) idempotencyKey: string;
}
class ConsentDto { @IsString() @MinLength(1) version: string }
class PayBillDto {
  @IsString() @MinLength(1) title: string;
  @IsInt() @Min(1) @Max(100_000_000) amount: number;
  @IsString() @MinLength(8) idempotencyKey: string;
}

/**
 * Portal wali santri. SEMUA endpoint memeriksa tabel santri_walsan di backend:
 * walsan hanya bisa melihat anak yang terhubung dengan akunnya.
 */
@Controller('portal')
@Roles('WALSAN')
class PortalController {
  constructor(private db: Db) {}

  private async assertChild(userId: string, santriId: string) {
    const { rows } = await this.db.query('SELECT 1 FROM santri_walsan WHERE user_id = $1 AND santri_id = $2', [userId, santriId]);
    // 404 (bukan 403) supaya keberadaan santri lain tidak bisa ditebak
    if (!rows[0]) throw appErr(404, 'CHILD_NOT_FOUND', 'Data anak tidak ditemukan');
  }

  @Get('children')
  async children(@CurrentUser() u: AuthUser) {
    const { rows } = await this.db.query(
      `SELECT s.id, s.nis, s.full_name AS "fullName", s.kelas, w.balance, w.daily_limit AS "dailyLimit", sw.relation,
              (SELECT json_object_agg(x.pocket, x.balance) FROM wallets x WHERE x.santri_id = s.id) AS pockets,
              (SELECT status FROM cards c WHERE c.santri_id = s.id AND c.status IN ('ACTIVE','SUSPENDED','LOCKED') LIMIT 1) AS "cardStatus",
              COALESCE((SELECT SUM(i.total - i.paid) FROM invoices i WHERE i.santri_id = s.id AND i.status IN ('UNPAID','PARTIAL')), 0)::int AS "totalDue",
              COALESCE((SELECT SUM(i.total - i.paid) FROM invoices i WHERE i.santri_id = s.id AND i.status IN ('UNPAID','PARTIAL')
                         AND i.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date), 0)::int AS "totalOverdue"
         FROM santri_walsan sw JOIN santri s ON s.id = sw.santri_id LEFT JOIN wallets w ON w.santri_id = s.id AND w.pocket = 'JAJAN'
        WHERE sw.user_id = $1 ORDER BY s.full_name`, [u.id]);
    return rows;
  }

  @Get('children/:id/ledger')
  async ledger(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('limit') limit = '50') {
    await this.assertChild(u.id, id);
    const { rows } = await this.db.query(
      `SELECT l.id, l.type, l.direction, l.amount, l.balance_after AS "balanceAfter", l.note, l.created_at AS "createdAt", w.pocket
         FROM ledger_entries l JOIN wallets w ON w.id = l.wallet_id WHERE w.santri_id = $1
        ORDER BY l.created_at DESC LIMIT $2`, [id, Math.min(Number(limit) || 50, 200)]);
    return rows;
  }

  /** Detail belanja: apa saja yang dibeli, harga, jam, dan statusnya (termasuk jika sudah di-refund). */
  @Get('children/:id/orders')
  async orders(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('limit') limit = '30') {
    await this.assertChild(u.id, id);
    const { rows } = await this.db.query(
      `SELECT o.id, o.total, o.merchant, o.created_at AS "createdAt",
              EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of = o.ledger_entry_id) AS refunded,
              (SELECT json_agg(json_build_object('name', i.name, 'qty', i.qty, 'unitPrice', i.unit_price, 'subtotal', i.subtotal) ORDER BY i.name)
                 FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o WHERE o.santri_id = $1 ORDER BY o.created_at DESC LIMIT $2`, [id, Math.min(Number(limit) || 30, 100)]);
    return rows;
  }

  @Get('children/:id/invoices')
  async invoices(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertChild(u.id, id);
    const { rows } = await this.db.query(
      `SELECT i.id, i.number, i.title, i.period, i.due_date AS "dueDate", i.total, i.paid, (i.total - i.paid) AS remaining,
              ${EFFECTIVE_STATUS} AS status,
              COALESCE((SELECT json_agg(json_build_object('receiptNumber', p.receipt_number, 'amount', p.amount, 'method', p.method, 'paidAt', p.paid_at) ORDER BY p.paid_at)
                          FROM payments p WHERE p.invoice_id = i.id), '[]') AS payments
         FROM invoices i WHERE i.santri_id = $1 AND i.status <> 'CANCELLED' ORDER BY i.due_date DESC`, [id]);
    return rows;
  }

  /** Pindahkan saldo antar kantong (Saldo / Jajan / Laundry) milik anak. Dua entri ledger (keluar dan masuk) dalam satu transaksi. */
  @Post('children/:id/transfer')
  async transfer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: TransferDto) {
    await this.assertChild(u.id, id);
    if (b.from === b.to) throw appErr(400, 'SAME_POCKET', 'Kantong asal dan tujuan tidak boleh sama');
    return this.db.tx(async (c) => {
      const wallets = (await c.query('SELECT id, pocket, balance, santri_id FROM wallets WHERE santri_id = $1 AND pocket = ANY($2) ORDER BY pocket FOR UPDATE', [id, [b.from, b.to]])).rows;
      const out = wallets.find((w) => w.pocket === b.from), inn = wallets.find((w) => w.pocket === b.to);
      if (!out || !inn) throw appErr(404, 'WALLET_NOT_FOUND', 'Kantong saldo tidak ditemukan');
      const dup = (await c.query('SELECT w.santri_id FROM ledger_entries l JOIN wallets w ON w.id = l.wallet_id WHERE l.idempotency_key = $1', [`${b.idempotencyKey}:out`])).rows[0];
      if (dup) {
        if (dup.santri_id !== id) throw appErr(409, 'IDEMPOTENCY_CONFLICT', 'Kunci permintaan sudah dipakai untuk transaksi lain');
        const bal = (await c.query(`SELECT json_object_agg(pocket, balance) AS p FROM wallets WHERE santri_id = $1`, [id])).rows[0].p;
        return { duplicate: true, pockets: bal };
      }
      if (out.balance < b.amount) throw appErr(422, 'INSUFFICIENT_BALANCE', `Saldo kantong ${POCKET_LABEL[b.from]} tidak cukup`, { balance: out.balance });
      const outAfter = out.balance - b.amount, inAfter = inn.balance + b.amount;
      await c.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE id = $1', [out.id, outAfter]);
      await c.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE id = $1', [inn.id, inAfter]);
      await c.query(`INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note, actor_id) VALUES ($1,'TRANSFER','DEBIT',$2,$3,$4,$5,$6)`,
        [out.id, b.amount, outAfter, `${b.idempotencyKey}:out`, `Pindah ke kantong ${POCKET_LABEL[b.to]}`, u.id]);
      await c.query(`INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note, actor_id) VALUES ($1,'TRANSFER','CREDIT',$2,$3,$4,$5,$6)`,
        [inn.id, b.amount, inAfter, `${b.idempotencyKey}:in`, `Dari kantong ${POCKET_LABEL[b.from]}`, u.id]);
      await audit(c, u.id, 'POCKET_TRANSFER', 'santri', id, { from: b.from, to: b.to, amount: b.amount });
      const pockets = (await c.query(`SELECT json_object_agg(pocket, balance) AS p FROM wallets WHERE santri_id = $1`, [id])).rows[0].p;
      return { duplicate: false, pockets };
    });
  }

  /** Wali menyetujui pemberitahuan privasi dan penggunaan data anak (versi teks dicatat). */
  @Post('consent')
  async consent(@CurrentUser() u: AuthUser, @Body() b: ConsentDto) {
    await this.db.query('UPDATE users SET consent_at = now(), consent_version = $2 WHERE id = $1', [u.id, b.version]);
    await audit(this.db.pool, u.id, 'CONSENT', 'user', u.id, { version: b.version });
    return { ok: true };
  }

  /** Kartu tagihan: tagihan yang belum lunas dikelompokkan per jenis (mis. SPP, Uang Gedung). */
  @Get('children/:id/bills')
  async bills(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertChild(u.id, id);
    const { rows } = await this.db.query(
      `SELECT title, SUM(total - paid)::int AS remaining, count(*)::int AS count, MIN(due_date) AS "nextDue",
              COALESCE(SUM(total - paid) FILTER (WHERE due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date), 0)::int AS overdue
         FROM invoices WHERE santri_id = $1 AND status IN ('UNPAID','PARTIAL') GROUP BY title ORDER BY MIN(due_date), title`, [id]);
    return rows;
  }

  /**
   * Pindahkan uang dari Saldo ke kartu tagihan = membayar tagihan itu. Dibayarkan ke tagihan paling lama dulu
   * (mis. SPP bulan lalu sebelum bulan ini), boleh dicicil, tidak boleh melebihi sisa. Satu transaksi.
   */
  @Post('children/:id/bills/pay')
  async payBill(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: PayBillDto) {
    await this.assertChild(u.id, id);
    return this.db.tx(async (c) => {
      const dup = (await c.query(
        `SELECT p.receipt_number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE starts_with(p.idempotency_key, $1) AND i.santri_id = $2 ORDER BY p.receipt_number`, [`${b.idempotencyKey}:`, id])).rows;
      if (dup.length) return { receipts: dup.map((x) => x.receipt_number), duplicate: true };
      const invs = (await c.query(
        `SELECT * FROM invoices WHERE santri_id = $1 AND title = $2 AND status IN ('UNPAID','PARTIAL') ORDER BY due_date, period, created_at FOR UPDATE`, [id, b.title])).rows;
      if (!invs.length) throw appErr(404, 'BILL_NOT_FOUND', 'Tagihan ini sudah lunas atau tidak ditemukan');
      const remaining = invs.reduce((a, x) => a + x.total - x.paid, 0);
      if (b.amount > remaining) throw appErr(422, 'OVERPAY', `Pembayaran melebihi sisa tagihan (sisa Rp${remaining.toLocaleString('id-ID')})`);
      const w = (await c.query("SELECT id, balance FROM wallets WHERE santri_id = $1 AND pocket = 'SALDO' FOR UPDATE", [id])).rows[0];
      if (!w) throw appErr(404, 'WALLET_NOT_FOUND', 'Saldo anak tidak ditemukan');
      if (w.balance < b.amount) throw appErr(422, 'INSUFFICIENT_BALANCE', 'Saldo tidak cukup', { balance: w.balance });
      let left = b.amount, bal = w.balance; const receipts: string[] = [];
      for (const inv of invs) {
        if (left <= 0) break;
        const pay = Math.min(left, inv.total - inv.paid);
        bal -= pay; left -= pay;
        const e = (await c.query(
          `INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note, actor_id) VALUES ($1,'BILL_PAYMENT','DEBIT',$2,$3,$4,$5,$6) RETURNING id`,
          [w.id, pay, bal, `${b.idempotencyKey}:ledger:${inv.id}`, `Bayar ${inv.title} ${inv.period}`, u.id])).rows[0];
        const p = (await c.query(
          `INSERT INTO payments(receipt_number, invoice_id, amount, method, idempotency_key, note, received_by, ledger_entry_id)
           VALUES ('KW-' || to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYYMM') || '-' || lpad(nextval('receipt_seq')::text, 6, '0'), $1,$2,'WALLET',$3,'Dari saldo',$4,$5) RETURNING receipt_number`,
          [inv.id, pay, `${b.idempotencyKey}:${inv.id}`, u.id, e.id])).rows[0];
        const paid = inv.paid + pay;
        await c.query('UPDATE invoices SET paid = $2, status = $3 WHERE id = $1', [inv.id, paid, paid >= inv.total ? 'PAID' : 'PARTIAL']);
        receipts.push(p.receipt_number);
      }
      await c.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE id = $1', [w.id, bal]);
      await audit(c, u.id, 'BILL_PAY_WALLET', 'santri', id, { title: b.title, amount: b.amount, receipts });
      const sn = (await c.query('SELECT full_name FROM santri WHERE id = $1', [id])).rows[0]?.full_name ?? 'santri';
      await notifyStaff(c, 'Ada yang bayar', `${u.fullName ?? 'Wali'} membayar ${b.title} sebesar Rp${b.amount.toLocaleString('id-ID')} dari saldo (${sn}). Kwitansi ${receipts.join(', ')}.`, '/tagihan', 'PAYMENT', { payType: 'WALI_PAY' });
      return { receipts, balanceAfter: bal, remaining: remaining - b.amount, duplicate: false };
    });
  }

  /**
   * Wali membayar tagihan anak dari saldo. Boleh dari beberapa kantong sekaligus (`sources`), mis. SPP Rp300.000 + kekurangan Rp50.000 dari Jajan.
   * Boleh dicicil; tidak boleh melebihi sisa tagihan. Semua potongan dalam satu transaksi.
   */
  @Post('children/:id/invoices/:invId/pay')
  async payInvoice(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('invId', ParseUUIDPipe) invId: string, @Body() b: PayInvoiceDto) {
    await this.assertChild(u.id, id);
    const merged = new Map<Pocket, number>();
    const given = b.sources?.length ? b.sources : b.pocket && b.amount ? [{ pocket: b.pocket, amount: b.amount }] : [];
    for (const x of given) merged.set(x.pocket, (merged.get(x.pocket) ?? 0) + x.amount);
    if (merged.size === 0) throw appErr(400, 'NO_SOURCE', 'Pilih sumber saldo dan jumlah yang dibayar');
    const sources = [...merged.entries()].map(([pocket, amount]) => ({ pocket, amount })).sort((a, b2) => (a.pocket < b2.pocket ? -1 : 1));
    const total = sources.reduce((a, x) => a + x.amount, 0);
    return this.db.tx(async (c) => {
      const dup = (await c.query('SELECT receipt_number, invoice_id FROM payments WHERE idempotency_key = $1', [b.idempotencyKey])).rows[0];
      if (dup) {
        if (dup.invoice_id !== invId) throw appErr(409, 'IDEMPOTENCY_CONFLICT', 'Kunci permintaan sudah dipakai untuk transaksi lain');
        return { receiptNumber: dup.receipt_number, duplicate: true };
      }
      const inv = (await c.query('SELECT * FROM invoices WHERE id = $1 AND santri_id = $2 FOR UPDATE', [invId, id])).rows[0];
      if (!inv) throw appErr(404, 'INVOICE_NOT_FOUND', 'Tagihan tidak ditemukan');
      if (['PAID', 'CANCELLED', 'WAIVED'].includes(inv.status)) throw appErr(409, 'INVOICE_CLOSED', 'Tagihan ini sudah selesai atau dibatalkan');
      const remaining = inv.total - inv.paid;
      if (total > remaining) throw appErr(422, 'OVERPAY', `Pembayaran melebihi sisa tagihan (sisa Rp${remaining.toLocaleString('id-ID')})`);
      const wallets = (await c.query('SELECT id, pocket, balance FROM wallets WHERE santri_id = $1 AND pocket = ANY($2) ORDER BY pocket FOR UPDATE', [id, sources.map((x) => x.pocket)])).rows;
      for (const x of sources) {
        const w = wallets.find((y) => y.pocket === x.pocket);
        if (!w) throw appErr(404, 'WALLET_NOT_FOUND', 'Kantong saldo tidak ditemukan');
        if (w.balance < x.amount) throw appErr(422, 'INSUFFICIENT_BALANCE', `Saldo kantong ${POCKET_LABEL[x.pocket]} tidak cukup`, { balance: w.balance, pocket: x.pocket });
      }
      let firstLedger: string | null = null; let balanceAfter = 0;
      for (const x of sources) {
        const w = wallets.find((y) => y.pocket === x.pocket)!;
        const after = w.balance - x.amount;
        await c.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE id = $1', [w.id, after]);
        const e = (await c.query(
          `INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note, actor_id) VALUES ($1,'BILL_PAYMENT','DEBIT',$2,$3,$4,$5,$6) RETURNING id`,
          [w.id, x.amount, after, `${b.idempotencyKey}:ledger:${x.pocket}`, `Bayar ${inv.title} ${inv.period}`, u.id])).rows[0];
        firstLedger ??= e.id; balanceAfter = after;
      }
      const from = sources.map((x) => `${POCKET_LABEL[x.pocket]} Rp${x.amount.toLocaleString('id-ID')}`).join(', ');
      const p = (await c.query(
        `INSERT INTO payments(receipt_number, invoice_id, amount, method, idempotency_key, note, received_by, ledger_entry_id)
         VALUES ('KW-' || to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYYMM') || '-' || lpad(nextval('receipt_seq')::text, 6, '0'), $1,$2,'WALLET',$3,$4,$5,$6) RETURNING receipt_number`,
        [inv.id, total, b.idempotencyKey, `Dari saldo: ${from}`, u.id, firstLedger])).rows[0];
      const paid = inv.paid + total;
      await c.query('UPDATE invoices SET paid = $2, status = $3 WHERE id = $1', [inv.id, paid, paid >= inv.total ? 'PAID' : 'PARTIAL']);
      await audit(c, u.id, 'INVOICE_PAY_WALLET', 'invoice', inv.id, { amount: total, sources, receipt: p.receipt_number });
      const sn = (await c.query('SELECT full_name FROM santri WHERE id = $1', [id])).rows[0]?.full_name ?? 'santri';
      await notifyStaff(c, 'Ada yang bayar', `${u.fullName ?? 'Wali'} membayar ${inv.title} ${inv.period} sebesar Rp${total.toLocaleString('id-ID')} dari saldo (${sn}). Kwitansi ${p.receipt_number}.`, '/tagihan', 'PAYMENT', { payType: 'WALI_PAY' });
      return { receiptNumber: p.receipt_number, paid, remaining: inv.total - paid, balanceAfter: sources.length === 1 ? balanceAfter : undefined, duplicate: false };
    });
  }
}

@Module({ controllers: [PortalController] })
export class PortalModule {}
