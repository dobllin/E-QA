import { Body, Controller, Delete, Get, Injectable, Module, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Roles } from '../common/auth';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_SQL = `to_char(t.at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')`;

export type FeeStatus = 'BERJALAN' | 'TIDAK_ADA' | 'BELUM_DIBAYAR' | 'DIBAYAR' | 'LUNAS';

@Injectable()
export class FeesService {
  constructor(private db: Db) {}

  private async currentMonth() {
    return (await this.db.query(`SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS m`)).rows[0].m as string;
  }
  private checkMonth(m: string) { if (!MONTH_RE.test(m)) throw appErr(400, 'BAD_MONTH', 'Format bulan harus YYYY-MM'); }

  async months() {
    const cur = await this.currentMonth();
    const { rows } = await this.db.query(
      `SELECT ${MONTH_SQL} AS month, count(*)::int AS count, COALESCE(SUM(t.fee),0)::int AS "feeTotal", COALESCE(SUM(t.credited),0)::int AS "creditedTotal"
         FROM fee_items t GROUP BY 1`);
    const sett = (await this.db.query('SELECT * FROM fee_settlements')).rows;
    const byMonth = new Map<string, any>(rows.map((r) => [r.month, r]));
    for (const s of sett) if (!byMonth.has(s.month)) byMonth.set(s.month, { month: s.month, count: 0, feeTotal: 0, creditedTotal: 0 });
    byMonth.set(cur, byMonth.get(cur) ?? { month: cur, count: 0, feeTotal: 0, creditedTotal: 0 });
    return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 24).map((r) => {
      const s = sett.find((x) => x.month === r.month);
      let status: FeeStatus;
      if (r.month === cur) status = 'BERJALAN';
      else if (s) status = s.received_at ? 'LUNAS' : 'DIBAYAR';
      else status = r.feeTotal > 0 ? 'BELUM_DIBAYAR' : 'TIDAK_ADA';
      return { ...r, status, paidAt: s?.paid_at ?? null, note: s?.note ?? null, receivedAt: s?.received_at ?? null, paidTotal: s?.fee_total ?? null };
    });
  }

  async summary() {
    const m = await this.months();
    const unpaid = m.filter((x) => x.status === 'BELUM_DIBAYAR');
    return { unpaidMonths: unpaid.length, unpaidTotal: unpaid.reduce((a, x) => a + x.feeTotal, 0), awaitingConfirmation: m.filter((x) => x.status === 'DIBAYAR').length };
  }

  async detail(month: string) {
    this.checkMonth(month);
    const { rows } = await this.db.query(
      `SELECT t.id, to_char(t.at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS at, s.nis, s.full_name AS "santriName",
              t.credited, t.fee, t.total, t.kind
         FROM fee_items t JOIN santri s ON s.id = t.santri_id
        WHERE ${MONTH_SQL} = $1 ORDER BY t.at`, [month]);
    const totals = rows.reduce((a, r) => ({ count: a.count + 1, fee: a.fee + r.fee, credited: a.credited + r.credited }), { count: 0, fee: 0, credited: 0 });
    return { month, items: rows, totals };
  }

  async csv(month: string) {
    const d = await this.detail(month);
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['No', 'Waktu', 'Jenis', 'NIS', 'Nama santri', 'Saldo masuk (Rp)', 'Biaya layanan (Rp)', 'Total transfer wali (Rp)'].join(';')];
    d.items.forEach((r, i) => lines.push([i + 1, r.at, r.kind === 'TUNAI' ? 'Tunai' : 'Transfer', r.nis, r.santriName, r.credited, r.fee, r.total].map(esc).join(';')));
    lines.push(['', '', '', '', `TOTAL (${d.totals.count} top up)`, d.totals.credited, d.totals.fee, ''].join(';'));
    return '\ufeff' + lines.join('\r\n') + '\r\n'; // BOM agar Excel membaca UTF-8
  }

  async markPaid(actor: AuthUser, month: string, paidAt: string, note: string) {
    this.checkMonth(month);
    if (month >= (await this.currentMonth())) throw appErr(409, 'MONTH_OPEN', 'Bulan berjalan belum bisa ditandai dibayar. Tunggu bulan berakhir.');
    if (paidAt > (await this.db.query(`SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS d`)).rows[0].d) throw appErr(400, 'FUTURE_DATE', 'Tanggal bayar tidak boleh di masa depan');
    return this.db.tx(async (c) => {
      const d = (await c.query(
        `SELECT count(*)::int AS n, COALESCE(SUM(t.fee),0)::int AS fee FROM fee_items t WHERE ${MONTH_SQL} = $1`, [month])).rows[0];
      if (d.fee <= 0) throw appErr(409, 'NO_FEE', 'Tidak ada biaya layanan pada bulan ini');
      const r = (await c.query(
        `INSERT INTO fee_settlements(month, topup_count, fee_total, paid_at, note, marked_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (month) DO NOTHING RETURNING month`,
        [month, d.n, d.fee, paidAt, note.trim(), actor.id])).rows[0];
      if (!r) throw appErr(409, 'ALREADY_PAID', 'Bulan ini sudah ditandai dibayar');
      await audit(c, actor.id, 'FEE_MARK_PAID', 'fee', month, { total: d.fee, paidAt, note });
      return { month, feeTotal: d.fee };
    });
  }

  async confirmReceived(actor: AuthUser, month: string) {
    this.checkMonth(month);
    const { rows } = await this.db.query(
      `UPDATE fee_settlements SET received_at = (now() AT TIME ZONE 'Asia/Jakarta')::date, received_by = $2 WHERE month = $1 AND received_at IS NULL RETURNING month`, [month, actor.id]);
    if (!rows[0]) throw appErr(409, 'BAD_STATE', 'Bulan ini belum ditandai dibayar, atau sudah dikonfirmasi');
    await audit(this.db.pool, actor.id, 'FEE_CONFIRM_RECEIVED', 'fee', month);
    return { ok: true };
  }

  async undo(actor: AuthUser, month: string) {
    this.checkMonth(month);
    const { rows } = await this.db.query('DELETE FROM fee_settlements WHERE month = $1 RETURNING *', [month]);
    if (!rows[0]) throw appErr(404, 'NOT_FOUND', 'Bulan ini belum ditandai dibayar');
    await audit(this.db.pool, actor.id, 'FEE_UNDO', 'fee', month, { was: rows[0] });
    return { ok: true };
  }
}

class PaidDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Tanggal format YYYY-MM-DD' }) paidAt: string;
  @IsString() @MinLength(3, { message: 'Catatan/bukti transfer wajib diisi' }) @MaxLength(300) note: string;
}

@Controller('fees')
@Roles('ADMIN', 'BENDAHARA')
class FeesController {
  constructor(private svc: FeesService) {}

  @Get('months') months() { return this.svc.months(); }
  @Get('summary') summary() { return this.svc.summary(); }
  @Get('months/:month') detail(@Param('month') m: string) { return this.svc.detail(m); }

  @Get('months/:month/csv')
  async csv(@Param('month') m: string, @Res({ passthrough: true }) res: Response) {
    const body = await this.svc.csv(m);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="biaya-layanan-${m}.csv"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(Buffer.from(body, 'utf8'));
  }

  /** Pesantren menandai bahwa fee bulan itu sudah disetor ke pengembang. */
  @Post('months/:month/paid') paid(@CurrentUser() u: AuthUser, @Param('month') m: string, @Body() b: PaidDto) { return this.svc.markPaid(u, m, b.paidAt, b.note); }

  /** Pengembang (Super Admin) mengonfirmasi uangnya benar-benar diterima. */
  @Post('months/:month/received') received(@CurrentUser() u: AuthUser, @Param('month') m: string) {
    if (u.role !== 'SUPER_ADMIN') throw appErr(403, 'FORBIDDEN', 'Hanya Super Admin yang bisa mengonfirmasi penerimaan');
    return this.svc.confirmReceived(u, m);
  }

  @Delete('months/:month/paid') undo(@CurrentUser() u: AuthUser, @Param('month') m: string) {
    if (u.role !== 'SUPER_ADMIN') throw appErr(403, 'FORBIDDEN', 'Hanya Super Admin yang bisa membatalkan penandaan');
    return this.svc.undo(u, m);
  }
}

@Module({ controllers: [FeesController], providers: [FeesService] })
export class FeesModule {}
