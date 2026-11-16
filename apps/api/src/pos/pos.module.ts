import { Body, Controller, Get, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength, ValidateNested,
} from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { CardsModule } from '../cards/cards.module';
import { CardsService } from '../cards/cards.service';
import { POCKET_LABEL, Pocket } from '../common/pockets';
import { notifyWalsan, rp } from '../common/notify';
import { toCsv } from '../common/csv';
import { jakarta } from '../common/clock';

class ItemDto { @IsUUID() productId: string; @IsInt() @Min(1) @Max(100) qty: number }
class PayDto {
  @IsString() @MinLength(8) barcode: string;
  @IsString() pin: string;
  @IsString() @MinLength(8) idempotencyKey: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ItemDto) items?: ItemDto[];
  @IsOptional() @IsInt() @Min(500) @Max(1_000_000) amount?: number; // nominal bebas bila tanpa item
  @IsOptional() @IsString() note?: string;
}
class ProductDto {
  @IsOptional() @IsIn(['KANTIN', 'LAUNDRY']) merchant?: 'KANTIN' | 'LAUNDRY';
  @IsString() @MinLength(2) name: string;
  @IsInt() @Min(100) price: number;
  @IsInt() @Min(0) stock: number;
}
class ProductUpdateDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsInt() @Min(100) price?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class PosService {
  constructor(private db: Db, private cards: CardsService) {}

  async pay(cashier: AuthUser, dto: PayDto) {
    // Kasir = kantin (kantong JAJAN). Laundry = layanan laundry (kantong LAUNDRY). Terpisah penuh.
    const merchant = cashier.role === 'LAUNDRY' ? 'LAUNDRY' : 'KANTIN';
    const pocket: Pocket = merchant === 'LAUNDRY' ? 'LAUNDRY' : 'JAJAN';
    const hasItems = !!dto.items?.length;
    if (!hasItems && !dto.amount) throw appErr(400, 'EMPTY', 'Pilih produk atau isi nominal');
    if (hasItems && dto.amount) throw appErr(400, 'AMBIGUOUS', 'Pilih produk ATAU isi nominal, jangan keduanya');

    const outcome = await this.db.tx(async (c) => {
      const v = await this.cards.verify(c, dto.barcode, dto.pin);
      if (!v.ok) return { error: v.error } as const; // commit dulu (hitungan salah PIN tersimpan), lempar setelahnya
      const card = v.card;

      const w = (await c.query('SELECT * FROM wallets WHERE santri_id = $1 AND pocket = $2 FOR UPDATE', [card.santri_id, pocket])).rows[0];

      // Idempotency: permintaan yang sama (mis. koneksi putus lalu diulang) tidak boleh debit dua kali.
      const dup = (await c.query(
        `SELECT l.id, l.balance_after, l.wallet_id, o.id AS order_id, o.total FROM ledger_entries l
           LEFT JOIN orders o ON o.ledger_entry_id = l.id WHERE l.idempotency_key = $1`, [dto.idempotencyKey])).rows[0];
      if (dup) {
        if (dup.wallet_id !== w.id) throw appErr(409, 'IDEMPOTENCY_CONFLICT', 'Kunci permintaan sudah dipakai untuk transaksi lain');
        return { result: { orderId: dup.order_id, total: dup.total, balanceAfter: dup.balance_after, santriName: card.full_name, duplicate: true } } as const;
      }

      // Hitung total & kunci stok produk (urut by id agar tidak deadlock).
      let total = dto.amount ?? 0;
      const lines: { productId: string; name: string; unitPrice: number; qty: number }[] = [];
      if (hasItems) {
        const merged = new Map<string, number>();
        for (const it of dto.items!) merged.set(it.productId, (merged.get(it.productId) ?? 0) + it.qty);
        const ids = [...merged.keys()].sort();
        const prods = (await c.query('SELECT id, name, price, stock, is_active, track_stock FROM products WHERE id = ANY($1::uuid[]) AND merchant = $2 ORDER BY id FOR UPDATE', [ids, merchant])).rows;
        if (prods.length !== ids.length) throw appErr(404, 'PRODUCT_NOT_FOUND', 'Ada produk yang tidak ditemukan');
        total = 0;
        for (const p of prods) {
          const qty = merged.get(p.id)!;
          if (!p.is_active) throw appErr(409, 'PRODUCT_INACTIVE', `${p.name} sedang tidak dijual`);
          if (p.track_stock && p.stock < qty) throw appErr(409, 'OUT_OF_STOCK', `Stok ${p.name} tidak cukup (sisa ${p.stock})`);
          if (p.track_stock) await c.query('UPDATE products SET stock = stock - $2 WHERE id = $1', [p.id, qty]);
          lines.push({ productId: p.id, name: p.name, unitPrice: p.price, qty });
          total += p.price * qty;
        }
      } else {
        lines.push({ productId: '', name: dto.note?.trim() || (merchant === 'LAUNDRY' ? 'Layanan laundry' : 'Belanja kantin'), unitPrice: total, qty: 1 });
      }

      // Batas belanja
      if (w.per_tx_limit && total > w.per_tx_limit)
        throw appErr(422, 'PER_TX_LIMIT', `Melebihi batas per transaksi (Rp${w.per_tx_limit.toLocaleString('id-ID')})`);
      if (w.daily_limit) {
        const used = (await c.query(
          `SELECT COALESCE(SUM(CASE WHEN type='PURCHASE' THEN amount WHEN type='REFUND' THEN -amount ELSE 0 END),0)::int AS used
             FROM ledger_entries WHERE wallet_id = $1 AND type IN ('PURCHASE','REFUND')
              AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`, [w.id])).rows[0].used;
        if (used + total > w.daily_limit)
          throw appErr(422, 'DAILY_LIMIT', `Melebihi batas belanja harian (Rp${w.daily_limit.toLocaleString('id-ID')})`);
      }

      // Debit atomic: kondisi balance >= total ada di dalam UPDATE itu sendiri.
      const upd = (await c.query(
        'UPDATE wallets SET balance = balance - $2, updated_at = now() WHERE id = $1 AND balance >= $2 RETURNING balance', [w.id, total])).rows[0];
      if (!upd) {
        // rollback stok yang sudah dikurangi: kita keluar dari tx dengan error → lempar agar ROLLBACK
        throw appErr(422, 'INSUFFICIENT_BALANCE', `Saldo kantong ${POCKET_LABEL[pocket]} tidak cukup`, { balance: w.balance, needed: total });
      }
      const ledger = (await c.query(
        `INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note, actor_id)
         VALUES ($1,'PURCHASE','DEBIT',$2,$3,$4,$5,$6) RETURNING id`,
        [w.id, total, upd.balance, dto.idempotencyKey, dto.note ?? null, cashier.id])).rows[0];
      const order = (await c.query(
        `INSERT INTO orders(santri_id, total, ledger_entry_id, cashier_id, note, merchant) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [card.santri_id, total, ledger.id, cashier.id, dto.note ?? null, merchant])).rows[0];
      for (const l of lines) {
        await c.query(
          `INSERT INTO order_items(order_id, product_id, name, unit_price, qty, subtotal) VALUES ($1,$2,$3,$4,$5,$6)`,
          [order.id, l.productId || null, l.name, l.unitPrice, l.qty, l.unitPrice * l.qty]);
      }
      await notifyWalsan(c, card.santri_id, merchant === 'LAUNDRY' ? 'Anak memakai laundry' : 'Anak belanja', `${card.full_name} membayar ${rp(total)} di ${merchant === 'LAUNDRY' ? 'laundry' : 'kantin'}. Sisa uang ${POCKET_LABEL[pocket].toLowerCase()}: ${rp(upd.balance)}.`);
      return { result: { orderId: order.id, total, balanceAfter: upd.balance, santriName: card.full_name, duplicate: false } } as const;
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.result;
  }
}

@Controller()
class PosController {
  constructor(private pos: PosService, private db: Db) {}

  @Roles('KASIR', 'LAUNDRY') @Throttle({ default: { limit: Number(process.env.POS_RATE_LIMIT ?? 600), ttl: 60_000 } }) @Post('pos/pay')
  pay(@CurrentUser() u: AuthUser, @Body() b: PayDto) { return this.pos.pay(u, b); }

  /** Kasir hanya melihat produk kantin, Laundry hanya layanan laundry. Admin/Bendahara bisa memfilter lewat ?merchant=. */
  @Roles('KASIR', 'LAUNDRY', 'ADMIN', 'BENDAHARA') @Get('products')
  async products(@CurrentUser() u: AuthUser, @Query('merchant') m?: string) {
    const merchant = u.role === 'LAUNDRY' ? 'LAUNDRY' : u.role === 'KASIR' ? 'KANTIN' : (m === 'LAUNDRY' || m === 'KANTIN' ? m : null);
    const { rows } = await this.db.query('SELECT id, name, price, stock, is_active AS "isActive", merchant, track_stock AS "trackStock" FROM products WHERE ($1::text IS NULL OR merchant = $1) ORDER BY name', [merchant]);
    return rows;
  }

  /** Kasir menambah/mengubah barang kantin, Laundry menambah/mengubah layanan laundry. Admin/Bendahara bebas memilih. Tidak ada hapus: barang disembunyikan lewat isActive. */
  private ownMerchant(u: AuthUser): 'KANTIN' | 'LAUNDRY' | null { return u.role === 'LAUNDRY' ? 'LAUNDRY' : u.role === 'KASIR' ? 'KANTIN' : null; }

  @Roles('KASIR', 'LAUNDRY', 'ADMIN', 'BENDAHARA') @Post('products')
  async create(@CurrentUser() u: AuthUser, @Body() b: ProductDto) {
    const merchant = this.ownMerchant(u) ?? b.merchant ?? 'KANTIN';
    const { rows } = await this.db.query('INSERT INTO products(name, price, stock, merchant, track_stock) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, price, stock, merchant', [b.name.trim(), b.price, merchant === 'KANTIN' ? b.stock : 0, merchant, merchant === 'KANTIN']);
    await audit(this.db.pool, u.id, 'PRODUCT_CREATE', 'product', rows[0].id, { name: b.name.trim(), price: b.price, merchant });
    return rows[0];
  }

  @Roles('KASIR', 'LAUNDRY', 'ADMIN', 'BENDAHARA') @Patch('products/:id')
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ProductUpdateDto) {
    const own = this.ownMerchant(u);
    const cur = (await this.db.query('SELECT name, price, stock, is_active, merchant FROM products WHERE id = $1', [id])).rows[0];
    if (!cur || (own && cur.merchant !== own)) throw appErr(404, 'PRODUCT_NOT_FOUND', 'Produk tidak ditemukan');
    await this.db.query(
      `UPDATE products SET name = COALESCE($2,name), price = COALESCE($3,price), stock = COALESCE($4,stock), is_active = COALESCE($5,is_active)
        WHERE id = $1`, [id, b.name?.trim() ?? null, b.price ?? null, b.stock ?? null, b.isActive ?? null]);
    // Perubahan harga/nama dicatat dengan nilai lama dan baru supaya bisa ditelusuri.
    await audit(this.db.pool, u.id, 'PRODUCT_UPDATE', 'product', id, { before: { name: cur.name, price: cur.price, stock: cur.stock, isActive: cur.is_active }, after: b });
    return { ok: true };
  }

  // ---------- Rekap harian ----------
  private async daily(u: AuthUser, dateIn?: string, m?: string) {
    const merchant = this.ownMerchant(u) ?? (m === 'LAUNDRY' ? 'LAUNDRY' : 'KANTIN');
    const date = dateIn && /^\d{4}-\d{2}-\d{2}$/.test(dateIn) ? dateIn : jakarta().date;
    const orders = (await this.db.query(
      `SELECT o.id, o.created_at AS "createdAt", to_char(o.created_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time, o.total,
              s.full_name AS "santriName", s.nis, s.kelas, cu.full_name AS cashier,
              EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of = o.ledger_entry_id) AS refunded,
              COALESCE((SELECT json_agg(json_build_object('name', i.name, 'qty', i.qty, 'unitPrice', i.unit_price, 'subtotal', i.subtotal) ORDER BY i.name) FROM order_items i WHERE i.order_id = o.id), '[]'::json) AS items
         FROM orders o JOIN santri s ON s.id = o.santri_id LEFT JOIN users cu ON cu.id = o.cashier_id
        WHERE o.merchant = $1 AND (o.created_at AT TIME ZONE 'Asia/Jakarta')::date = $2::date ORDER BY o.created_at`, [merchant, date])).rows;
    const ok = orders.filter((o) => !o.refunded);
    const byItem = new Map<string, { name: string; qty: number; total: number }>();
    for (const o of ok) for (const it of o.items as { name: string; qty: number; subtotal: number }[]) {
      const e = byItem.get(it.name) ?? { name: it.name, qty: 0, total: 0 }; e.qty += it.qty; e.total += it.subtotal; byItem.set(it.name, e);
    }
    return {
      date, merchant, count: ok.length, total: ok.reduce((s, o) => s + o.total, 0),
      refundedCount: orders.length - ok.length, refundedTotal: orders.filter((o) => o.refunded).reduce((s, o) => s + o.total, 0),
      byItem: [...byItem.values()].sort((a, b) => b.total - a.total), orders,
    };
  }

  @Roles('KASIR', 'LAUNDRY', 'ADMIN', 'BENDAHARA') @Get('pos/daily')
  dailyJson(@CurrentUser() u: AuthUser, @Query('date') date?: string, @Query('merchant') m?: string) { return this.daily(u, date, m); }

  /** CSV rekap harian: daftar transaksi, lalu rekap per barang dan total. Terbuka langsung di Excel. */
  @Roles('KASIR', 'LAUNDRY', 'ADMIN', 'BENDAHARA') @Get('pos/daily.csv')
  async dailyCsv(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response, @Query('date') date?: string, @Query('merchant') m?: string) {
    const d = await this.daily(u, date, m);
    const kind = d.merchant === 'LAUNDRY' ? 'Laundry' : 'Kantin';
    const head = ['Jam', 'Nama santri', 'NIS', 'Kelas', 'Barang', 'Total (Rp)', 'Status', 'Kasir'];
    const rows: unknown[][] = d.orders.map((o) => [o.time, o.santriName, o.nis, o.kelas ?? '', (o.items as { name: string; qty: number }[]).map((i) => `${i.name} x${i.qty}`).join('; '), o.total, o.refunded ? 'Dikembalikan' : 'Berhasil', o.cashier ?? '']);
    rows.push([], ['REKAP PER BARANG', 'Jumlah', 'Total (Rp)']);
    for (const i of d.byItem) rows.push([i.name, i.qty, i.total]);
    rows.push([], ['TOTAL PENJUALAN', `${d.count} transaksi`, d.total]);
    if (d.refundedCount) rows.push(['Dikembalikan (tidak dihitung)', `${d.refundedCount} transaksi`, d.refundedTotal]);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="rekap-${kind.toLowerCase()}-${d.date}.csv"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(Buffer.from(toCsv(head, rows), 'utf8'));
  }
}

@Module({ imports: [CardsModule], controllers: [PosController], providers: [PosService], exports: [PosService] })
export class PosModule {}
