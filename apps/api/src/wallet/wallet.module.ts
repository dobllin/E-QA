import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Roles } from '../common/auth';

class TopupDto {
  @IsUUID() santriId: string;
  @IsInt() @Min(1000, { message: 'Minimal top up Rp1.000' }) @Max(5_000_000) amount: number;
  @IsIn(['CASH_COUNTER', 'BANK_TRANSFER']) method: string;
  @IsString() @MinLength(8) idempotencyKey: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsIn(['SALDO', 'JAJAN', 'LAUNDRY']) pocket?: string; // bawaan: SALDO
}
class RefundDto {
  @IsUUID() orderId: string;
  @IsString() @MinLength(3, { message: 'Alasan refund wajib diisi' }) reason: string;
}
class LimitDto {
  @IsOptional() @IsInt() @Min(1000) dailyLimit?: number | null;
  @IsOptional() @IsInt() @Min(1000) perTxLimit?: number | null;
}

@Controller('wallet')
class WalletController {
  constructor(private db: Db) {}

  /** Biaya layanan yang berlaku, agar petugas tahu berapa tunai yang harus diterima. */
  @Roles('BENDAHARA', 'ADMIN') @Get('topup-fee')
  async topupFee() {
    return { fee: Number((await this.db.query("SELECT value FROM app_settings WHERE key = 'topup_fee'")).rows[0]?.value ?? 0) || 0 };
  }

  /** Top up: HANYA menambah saldo lewat entri ledger. Tidak ada endpoint edit saldo langsung. */
  @Roles('BENDAHARA') @Post('topup')
  async topup(@CurrentUser() u: AuthUser, @Body() b: TopupDto) {
    return this.db.tx(async (c) => {
      const pocket = b.pocket ?? 'SALDO';
      const w = (await c.query('SELECT id, balance FROM wallets WHERE santri_id = $1 AND pocket = $2 FOR UPDATE', [b.santriId, pocket])).rows[0];
      if (!w) throw appErr(404, 'WALLET_NOT_FOUND', 'Wallet santri tidak ditemukan');
      const dup = (await c.query('SELECT id, balance_after, wallet_id FROM ledger_entries WHERE idempotency_key = $1', [b.idempotencyKey])).rows[0];
      if (dup) {
        if (dup.wallet_id !== w.id) throw appErr(409, 'IDEMPOTENCY_CONFLICT', 'Kunci permintaan sudah dipakai untuk transaksi lain');
        const f = (await c.query('SELECT fee FROM cash_topups WHERE ledger_entry_id = $1', [dup.id])).rows[0]?.fee ?? 0;
        return { ledgerId: dup.id, balanceAfter: dup.balance_after, fee: f, collect: b.amount + f, duplicate: true };
      }
      const after = w.balance + b.amount;
      const e = (await c.query(
        `INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note, meta, actor_id)
         VALUES ($1,'TOPUP','CREDIT',$2,$3,$4,$5,$6,$7) RETURNING id`,
        [w.id, b.amount, after, b.idempotencyKey, b.note ?? null, JSON.stringify({ method: b.method }), u.id])).rows[0];
      await c.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE id = $1', [w.id, after]);
      // Biaya layanan ditambahkan DI ATAS nominal: petugas menerima nominal + biaya; yang masuk ke santri tetap nominal.
      const fee = Number((await c.query("SELECT value FROM app_settings WHERE key = 'topup_fee'")).rows[0]?.value ?? 0) || 0;
      await c.query('INSERT INTO cash_topups(santri_id, amount, fee, ledger_entry_id, created_by) VALUES ($1,$2,$3,$4,$5)', [b.santriId, b.amount, fee, e.id, u.id]);
      await audit(c, u.id, 'WALLET_TOPUP', 'wallet', w.id, { amount: b.amount, method: b.method, fee, pocket });
      return { ledgerId: e.id, balanceAfter: after, fee, collect: b.amount + fee, duplicate: false };
    });
  }

  /** Refund = transaksi pembalik. Transaksi asli TIDAK dihapus/diubah. */
  @Roles('BENDAHARA') @Post('refund')
  async refund(@CurrentUser() u: AuthUser, @Body() b: RefundDto) {
    return this.db.tx(async (c) => {
      const o = (await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [b.orderId])).rows[0];
      if (!o) throw appErr(404, 'ORDER_NOT_FOUND', 'Transaksi tidak ditemukan');
      const w = (await c.query('SELECT id, balance FROM wallets WHERE id = (SELECT wallet_id FROM ledger_entries WHERE id = $1) FOR UPDATE', [o.ledger_entry_id])).rows[0];
      const already = (await c.query('SELECT 1 FROM ledger_entries WHERE reversal_of = $1', [o.ledger_entry_id])).rows[0];
      if (already) throw appErr(409, 'ALREADY_REFUNDED', 'Transaksi ini sudah pernah di-refund');
      const after = w.balance + o.total;
      const e = (await c.query(
        `INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, reversal_of, note, actor_id)
         VALUES ($1,'REFUND','CREDIT',$2,$3,$4,$5,$6,$7) RETURNING id`,
        [w.id, o.total, after, `refund:${o.id}`, o.ledger_entry_id, b.reason, u.id])).rows[0];
      await c.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE id = $1', [w.id, after]);
      // kembalikan stok barang
      await c.query(
        `UPDATE products p SET stock = p.stock + i.qty FROM order_items i WHERE i.order_id = $1 AND i.product_id = p.id`, [o.id]);
      await audit(c, u.id, 'WALLET_REFUND', 'order', o.id, { reason: b.reason, amount: o.total });
      return { ledgerId: e.id, balanceAfter: after };
    });
  }

  @Roles('BENDAHARA', 'ADMIN') @Patch(':santriId/limits')
  async setLimits(@CurrentUser() u: AuthUser, @Param('santriId', ParseUUIDPipe) santriId: string, @Body() b: LimitDto) {
    await this.db.query(
      `UPDATE wallets SET daily_limit = $2, per_tx_limit = $3, updated_at = now() WHERE santri_id = $1 AND pocket = 'JAJAN'`,
      [santriId, b.dailyLimit ?? null, b.perTxLimit ?? null]);
    await audit(this.db.pool, u.id, 'WALLET_LIMITS', 'wallet', santriId, b);
    return { ok: true };
  }

  @Roles('BENDAHARA', 'ADMIN') @Get(':santriId/ledger')
  async ledger(@Param('santriId', ParseUUIDPipe) santriId: string, @Query('limit') limit = '50') {
    const { rows } = await this.db.query(
      `SELECT l.id, l.type, l.direction, l.amount, l.balance_after AS "balanceAfter", l.note, l.created_at AS "createdAt", w.pocket
         FROM ledger_entries l JOIN wallets w ON w.id = l.wallet_id
        WHERE w.santri_id = $1 ORDER BY l.created_at DESC LIMIT $2`, [santriId, Math.min(Number(limit) || 50, 200)]);
    return rows;
  }
}

@Module({ controllers: [WalletController] })
export class WalletModule {}
