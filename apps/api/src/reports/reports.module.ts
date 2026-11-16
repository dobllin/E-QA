import { Controller, Get, Module, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { toCsv } from '../common/csv';
import { Db } from '../db/db.service';
import { Roles } from '../common/auth';

@Controller('reports')
@Roles('ADMIN', 'BENDAHARA')
class ReportsController {
  constructor(private db: Db) {}

  @Get('summary')
  async summary() {
    const today = `created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`;
    const q = async (sql: string) => (await this.db.query(sql)).rows[0];
    const [santri, cards, wallet, sales, topups, bills, topProducts] = await Promise.all([
      q(`SELECT count(*)::int AS total FROM santri WHERE status = 'ACTIVE'`),
      q(`SELECT count(*) FILTER (WHERE status='ACTIVE')::int AS active,
                count(*) FILTER (WHERE status IN ('SUSPENDED','LOCKED'))::int AS blocked FROM cards`),
      q(`SELECT COALESCE(SUM(balance),0)::int AS total FROM wallets`),
      q(`SELECT count(*)::int AS count, COALESCE(SUM(amount),0)::int AS total FROM ledger_entries WHERE type='PURCHASE' AND ${today}`),
      q(`SELECT COALESCE(SUM(amount),0)::int AS total FROM ledger_entries WHERE type='TOPUP' AND ${today}`),
      q(`SELECT COALESCE(SUM(total - paid) FILTER (WHERE status IN ('UNPAID','PARTIAL')),0)::int AS due,
                COALESCE(SUM(total - paid) FILTER (WHERE status IN ('UNPAID','PARTIAL') AND due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date),0)::int AS overdue
           FROM invoices`),
      this.db.query(`SELECT oi.name, SUM(oi.qty)::int AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
                      WHERE o.${today} GROUP BY oi.name ORDER BY qty DESC LIMIT 5`).then((r) => r.rows),
    ]);
    const sppToday = await q(`SELECT COALESCE(SUM(amount),0)::int AS total FROM payments WHERE paid_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`);
    return {
      santriActive: santri.total, cardsActive: cards.active, cardsBlocked: cards.blocked,
      walletTotal: wallet.total, salesTodayCount: sales.count, salesTodayTotal: sales.total, topupToday: topups.total,
      invoiceDue: bills.due, invoiceOverdue: bills.overdue, sppPaidToday: sppToday.total, topProducts,
    };
  }

  /** Rekonsiliasi: saldo setiap wallet harus sama dengan jumlah mutasi di ledger. */

  private d(v?: string) { return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
  private csv(res: Response, name: string, headers: string[], rows: unknown[][]) {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(Buffer.from(toCsv(headers, rows), 'utf8'));
  }

  /** Daftar "perlu tindakan" untuk dashboard staf. */
  @Get('todo')
  async todo() {
    const q = async (sql: string) => (await this.db.query(sql)).rows[0];
    const t = await q(`SELECT count(*) FILTER (WHERE status = 'MATCHED')::int AS matched,
                              count(*) FILTER (WHERE status = 'PENDING' AND expires_at > now())::int AS pending,
                              count(*) FILTER (WHERE status = 'PENDING' AND expires_at > now() AND EXISTS (SELECT 1 FROM topup_proofs p WHERE p.topup_id = topup_requests.id))::int AS "pendingWithProof"
                         FROM topup_requests`);
    const o = await q(`SELECT count(*)::int AS n, COALESCE(SUM(total - paid), 0)::int AS total FROM invoices WHERE status IN ('UNPAID','PARTIAL') AND due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date`);
    const c = await q(`SELECT count(*) FILTER (WHERE status = 'LOCKED')::int AS locked, count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended FROM cards`);
    const l = await q(`SELECT count(*)::int AS n FROM products WHERE is_active AND track_stock AND stock <= 5`);
    return { topupMatched: t.matched, topupPending: t.pending, topupPendingWithProof: t.pendingWithProof, overdueCount: o.n, overdueTotal: o.total, cardsLocked: c.locked, cardsSuspended: c.suspended, lowStock: l.n };
  }

  /** 7 hari terakhir: penjualan (kantin+laundry, tanpa yang di-refund) dan top up yang masuk. */
  @Get('trend')
  async trend() {
    const { rows } = await this.db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date, COALESCE(s.sales, 0)::int AS sales, COALESCE(t.topups, 0)::int AS topups
         FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - 6, (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') d
         LEFT JOIN (SELECT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date AS day, SUM(o.total) AS sales FROM orders o
                     WHERE NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of = o.ledger_entry_id) GROUP BY 1) s ON s.day = d::date
         LEFT JOIN (SELECT (t.decided_at AT TIME ZONE 'Asia/Jakarta')::date AS day, SUM(COALESCE(t.credited, t.amount + t.unique_code)) AS topups FROM topup_requests t
                     WHERE t.status = 'CREDITED' GROUP BY 1) t ON t.day = d::date
        ORDER BY d`);
    return rows;
  }

  /** Daftar transaksi belanja (untuk pencarian dan refund). */
  @Get('orders')
  async orders(@Query('q') q?: string, @Query('merchant') merchant?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const { rows } = await this.db.query(
      `SELECT o.id, o.total, o.merchant, o.created_at AS "createdAt", s.full_name AS "santriName", s.nis, s.kelas, u.full_name AS cashier,
              EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of = o.ledger_entry_id) AS refunded,
              (SELECT json_agg(json_build_object('name', i.name, 'qty', i.qty, 'unitPrice', i.unit_price) ORDER BY i.name) FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o JOIN santri s ON s.id = o.santri_id LEFT JOIN users u ON u.id = o.cashier_id
        WHERE ($1::text IS NULL OR s.full_name ILIKE '%' || $1 || '%' OR s.nis ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR o.merchant = $2)
          AND (o.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN COALESCE($3::date, (now() AT TIME ZONE 'Asia/Jakarta')::date - 6) AND COALESCE($4::date, (now() AT TIME ZONE 'Asia/Jakarta')::date)
        ORDER BY o.created_at DESC LIMIT 200`,
      [q?.trim() || null, merchant === 'KANTIN' || merchant === 'LAUNDRY' ? merchant : null, this.d(from), this.d(to)]);
    return rows;
  }

  private salesRows(from?: string, to?: string, merchant?: string) {
    return this.db.query(
      `SELECT to_char((o.created_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS date, o.merchant, count(*)::int AS count, COALESCE(SUM(o.total), 0)::int AS total
         FROM orders o WHERE NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of = o.ledger_entry_id)
          AND ($3::text IS NULL OR o.merchant = $3)
          AND (o.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN COALESCE($1::date, (now() AT TIME ZONE 'Asia/Jakarta')::date - 29) AND COALESCE($2::date, (now() AT TIME ZONE 'Asia/Jakarta')::date)
        GROUP BY 1, 2 ORDER BY 1 DESC, 2`, [this.d(from), this.d(to), merchant === 'KANTIN' || merchant === 'LAUNDRY' ? merchant : null]).then((r) => r.rows);
  }
  @Get('sales') sales(@Query('from') from?: string, @Query('to') to?: string, @Query('merchant') m?: string) { return this.salesRows(from, to, m); }
  @Get('sales.csv') async salesCsv(@Res({ passthrough: true }) res: Response, @Query('from') from?: string, @Query('to') to?: string, @Query('merchant') m?: string) {
    const r = await this.salesRows(from, to, m);
    return this.csv(res, 'penjualan', ['Tanggal', 'Jenis', 'Jumlah transaksi', 'Total (Rp)'], r.map((x) => [x.date, x.merchant === 'LAUNDRY' ? 'Laundry' : 'Kantin', x.count, x.total]));
  }

  private arrearsRows() {
    return this.db.query(
      `SELECT s.kelas, s.nis, s.full_name AS "santriName", i.title, i.period, to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate", (i.total - i.paid)::int AS remaining, ((now() AT TIME ZONE 'Asia/Jakarta')::date - i.due_date)::int AS "daysLate"
         FROM invoices i JOIN santri s ON s.id = i.santri_id
        WHERE i.status IN ('UNPAID','PARTIAL') AND i.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date ORDER BY s.kelas NULLS LAST, s.full_name, i.due_date`).then((r) => r.rows);
  }
  @Get('arrears') arrears() { return this.arrearsRows(); }
  @Get('arrears.csv') async arrearsCsv(@Res({ passthrough: true }) res: Response) {
    const r = await this.arrearsRows();
    return this.csv(res, 'tunggakan', ['Kelas', 'NIS', 'Nama santri', 'Tagihan', 'Periode', 'Jatuh tempo', 'Sisa (Rp)', 'Terlambat (hari)'], r.map((x) => [x.kelas ?? '', x.nis, x.santriName, x.title, x.period, x.dueDate, x.remaining, x.daysLate]));
  }

  private topupRows(from?: string, to?: string) {
    return this.db.query(
      `SELECT to_char(t.decided_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS at, s.nis, s.full_name AS "santriName", s.kelas,
              COALESCE(t.credited, t.amount + t.unique_code)::int AS credited, t.fee, COALESCE(t.received_amount, t.total) AS received
         FROM topup_requests t JOIN santri s ON s.id = t.santri_id
        WHERE t.status = 'CREDITED' AND (t.decided_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN COALESCE($1::date, (now() AT TIME ZONE 'Asia/Jakarta')::date - 29) AND COALESCE($2::date, (now() AT TIME ZONE 'Asia/Jakarta')::date)
        ORDER BY t.decided_at DESC`, [this.d(from), this.d(to)]).then((r) => r.rows);
  }
  @Get('topups') topups(@Query('from') from?: string, @Query('to') to?: string) { return this.topupRows(from, to); }
  @Get('topups.csv') async topupsCsv(@Res({ passthrough: true }) res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const r = await this.topupRows(from, to);
    return this.csv(res, 'rekap-topup', ['Waktu', 'NIS', 'Nama santri', 'Kelas', 'Uang masuk ke santri (Rp)', 'Biaya layanan (Rp)', 'Diterima di rekening (Rp)'], r.map((x) => [x.at, x.nis, x.santriName, x.kelas ?? '', x.credited, x.fee, x.received]));
  }

  private balanceRows() {
    return this.db.query(
      `SELECT s.kelas, s.nis, s.full_name AS "santriName", s.status,
              COALESCE(SUM(w.balance) FILTER (WHERE w.pocket = 'JAJAN'), 0)::int AS jajan,
              COALESCE(SUM(w.balance) FILTER (WHERE w.pocket = 'LAUNDRY'), 0)::int AS laundry,
              COALESCE(SUM(w.balance) FILTER (WHERE w.pocket = 'SALDO'), 0)::int AS saldo,
              COALESCE(SUM(w.balance), 0)::int AS total
         FROM santri s LEFT JOIN wallets w ON w.santri_id = s.id GROUP BY s.id ORDER BY s.kelas NULLS LAST, s.full_name`).then((r) => r.rows);
  }
  @Get('balances') balances() { return this.balanceRows(); }
  @Get('balances.csv') async balancesCsv(@Res({ passthrough: true }) res: Response) {
    const r = await this.balanceRows();
    return this.csv(res, 'saldo-santri', ['Kelas', 'NIS', 'Nama santri', 'Status', 'Uang jajan (Rp)', 'Uang laundry (Rp)', 'Saldo (Rp)', 'Total (Rp)'], r.map((x) => [x.kelas ?? '', x.nis, x.santriName, x.status, x.jajan, x.laundry, x.saldo, x.total]));
  }

  @Roles('BENDAHARA') @Get('reconcile')
  async reconcile() {
    const { rows } = await this.db.query(
      `SELECT s.nis, s.full_name AS "fullName", w.pocket, w.balance AS "walletBalance",
              COALESCE(SUM(CASE l.direction WHEN 'CREDIT' THEN l.amount ELSE -l.amount END), 0)::int AS "ledgerBalance"
         FROM wallets w JOIN santri s ON s.id = w.santri_id LEFT JOIN ledger_entries l ON l.wallet_id = w.id
        GROUP BY s.nis, s.full_name, w.pocket, w.balance
       HAVING w.balance <> COALESCE(SUM(CASE l.direction WHEN 'CREDIT' THEN l.amount ELSE -l.amount END), 0)`);
    const total = (await this.db.query('SELECT count(*)::int AS n FROM wallets')).rows[0].n;
    return { walletsChecked: total, mismatches: rows, ok: rows.length === 0 };
  }

  @Roles('ADMIN', 'BENDAHARA') @Get('audit')
  async audit() {
    const { rows } = await this.db.query(
      `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.meta, a.created_at AS "createdAt", u.username AS actor
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 100`);
    return rows;
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}
