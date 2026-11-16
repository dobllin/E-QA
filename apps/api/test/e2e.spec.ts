import { parseMoney, parseSheet } from '../src/import/sheet-parser';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import request from 'supertest';

const TEST_DB = 'postgresql://eqa:eqa_dev_pass@localhost:5432/eqa_test';
process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.RATE_LIMIT = '100000';
process.env.POS_RATE_LIMIT = '100000';
process.env.PIN_RATE_LIMIT = '100000';
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.MAX_PIN_ATTEMPTS = '3';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupApp } = require('../src/app.setup');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runMigrations } = require('../src/db/migrate');

let app: INestApplication;
let pool: Pool;
const tok: Record<string, string> = {};
let uid = 0;
const key = () => `test-key-${Date.now()}-${++uid}-${Math.random().toString(36).slice(2, 8)}`;
const api = () => request(app.getHttpServer());
const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });

async function mkUser(username: string, role: string) {
  await pool.query(`INSERT INTO users(username, password_hash, full_name, role) VALUES ($1,$2,$1,$3)`,
    [username, await argon2.hash('Password123'), role]);
  const r = await api().post('/auth/login').send({ username, password: 'Password123' });
  expect(r.status).toBe(201);
  tok[username] = r.body.accessToken;
  return (await pool.query('SELECT id FROM users WHERE username=$1', [username])).rows[0].id as string;
}

/** Buat santri + kartu + PIN final, saldo awal `balance`. */
async function mkSantri(nis: string, balance = 0) {
  const s = await api().post('/santri').set(as('admin')).send({ nis, fullName: `Santri ${nis}`, kelas: '7A' });
  expect(s.status).toBe(201);
  const c = await api().post('/cards/issue').set(as('admin')).send({ santriId: s.body.id });
  expect(c.status).toBe(201);
  const { barcodeToken, initialPin, cardId } = c.body;
  const ch = await api().post('/cards/change-pin').set(as('kasir')).send({ barcode: barcodeToken, currentPin: initialPin, newPin: '482915' });
  expect(ch.status).toBe(201);
  if (balance > 0) {
    const t = await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: s.body.id, amount: balance, method: 'CASH_COUNTER', pocket: 'JAJAN', idempotencyKey: key() });
    expect(t.status).toBe(201);
  }
  return { santriId: s.body.id as string, cardId: cardId as string, barcode: barcodeToken as string, pin: '482915' };
}
const balanceOf = async (santriId: string, pocket = 'JAJAN') => (await pool.query('SELECT balance FROM wallets WHERE santri_id=$1 AND pocket=$2', [santriId, pocket])).rows[0].balance as number;
const pay = (s: { barcode: string; pin: string }, amount: number, k = key(), pin?: string) =>
  api().post('/pos/pay').set(as('kasir')).send({ barcode: s.barcode, pin: pin ?? s.pin, amount, idempotencyKey: k });

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DB });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(TEST_DB);
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  setupApp(app);
  await app.init();
  await mkUser('admin', 'ADMIN'); await mkUser('bendahara', 'BENDAHARA'); await mkUser('kasir', 'KASIR');
  await mkUser('walsanA', 'WALSAN'); await mkUser('walsanB', 'WALSAN');
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('Autentikasi & otorisasi', () => {
  it('tanpa token ditolak (401)', async () => { expect((await api().get('/santri')).status).toBe(401); });
  it('password salah ditolak', async () => {
    expect((await api().post('/auth/login').send({ username: 'admin', password: 'salah-salah' })).status).toBe(401);
  });
  it('kasir TIDAK bisa top up (403) dan tidak bisa lihat daftar santri', async () => {
    expect((await api().post('/wallet/topup').set(as('kasir')).send({ santriId: '00000000-0000-4000-8000-000000000000', amount: 5000, method: 'CASH_COUNTER', idempotencyKey: key() })).status).toBe(403);
    expect((await api().get('/santri').set(as('kasir'))).status).toBe(403);
  });
  it('admin TIDAK bisa top up / mengubah saldo; walsan tidak bisa akses admin', async () => {
    expect((await api().post('/wallet/topup').set(as('admin')).send({ santriId: '00000000-0000-4000-8000-000000000000', amount: 5000, method: 'CASH_COUNTER', idempotencyKey: key() })).status).toBe(403);
    expect((await api().get('/santri').set(as('walsanA'))).status).toBe(403);
  });
  it('refresh token berputar dan logout mencabut sesi', async () => {
    const l = await api().post('/auth/login').send({ username: 'kasir', password: 'Password123' });
    const r1 = await api().post('/auth/refresh').send({ refreshToken: l.body.refreshToken });
    expect(r1.status).toBe(201);
    expect((await api().post('/auth/refresh').send({ refreshToken: l.body.refreshToken })).status).toBe(401); // token lama sudah dicabut
    await api().post('/auth/logout').send({ refreshToken: r1.body.refreshToken });
    expect((await api().post('/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
  });
});

describe('Pembayaran kantin (barcode + PIN)', () => {
  it('saldo berkurang sesuai nominal dan tercatat di ledger', async () => {
    const s = await mkSantri('P001', 50000);
    const r = await pay(s, 12000);
    expect(r.status).toBe(201);
    expect(r.body.balanceAfter).toBe(38000);
    expect(await balanceOf(s.santriId)).toBe(38000);
  });

  it('saldo tidak cukup ditolak dan saldo tidak berubah', async () => {
    const s = await mkSantri('P002', 10000);
    const r = await pay(s, 15000);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balanceOf(s.santriId)).toBe(10000);
  });

  it('permintaan duplikat (idempotency key sama) TIDAK debit dua kali', async () => {
    const s = await mkSantri('P003', 50000);
    const k = key();
    const a = await pay(s, 10000, k);
    const b = await pay(s, 10000, k);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.orderId).toBe(a.body.orderId);
    expect(await balanceOf(s.santriId)).toBe(40000);
  });

  it('20 permintaan SEKALIGUS: saldo Rp50.000, tiap transaksi Rp10.000 → tepat 5 berhasil, saldo 0, tidak pernah negatif', async () => {
    const s = await mkSantri('P004', 50000);
    const results = await Promise.all(Array.from({ length: 20 }, () => pay(s, 10000)));
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;
    expect(ok).toBe(5);
    expect(rejected).toBe(15);
    expect(await balanceOf(s.santriId)).toBe(0);
  });

  it('20 permintaan SEKALIGUS dengan idempotency key yang SAMA hanya menghasilkan 1 debit', async () => {
    const s = await mkSantri('P005', 100000);
    const k = key();
    const results = await Promise.all(Array.from({ length: 20 }, () => pay(s, 10000, k)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await balanceOf(s.santriId)).toBe(90000);
    const n = (await pool.query(`SELECT count(*)::int n FROM ledger_entries WHERE idempotency_key=$1`, [k])).rows[0].n;
    expect(n).toBe(1);
  });

  it('PIN salah 3x → kartu terkunci; PIN benar pun ditolak sampai admin membuka', async () => {
    const s = await mkSantri('P006', 50000);
    const w1 = await pay(s, 5000, key(), '111222'); expect(w1.status).toBe(422); expect(w1.body.attemptsLeft).toBe(2);
    const w2 = await pay(s, 5000, key(), '111222'); expect(w2.status).toBe(422);
    const w3 = await pay(s, 5000, key(), '111222'); expect(w3.status).toBe(403); expect(w3.body.code).toBe('CARD_LOCKED');
    const ok = await pay(s, 5000); expect(ok.status).toBe(403);
    expect(await balanceOf(s.santriId)).toBe(50000);
    expect((await api().post(`/cards/${s.cardId}/unlock`).set(as('admin'))).status).toBe(201);
    expect((await pay(s, 5000)).status).toBe(201);
  });

  it('kartu yang dinonaktifkan sementara tidak bisa bertransaksi, bisa diaktifkan lagi', async () => {
    const s = await mkSantri('P007', 50000);
    expect((await api().post(`/cards/${s.cardId}/suspend`).set(as('admin')).send({ reason: 'Kartu hilang' })).status).toBe(201);
    const r = await pay(s, 5000);
    expect(r.status).toBe(403); expect(r.body.code).toBe('CARD_SUSPENDED');
    await api().post(`/cards/${s.cardId}/unsuspend`).set(as('admin'));
    expect((await pay(s, 5000)).status).toBe(201);
  });

  it('kartu hilang → diganti: barcode lama mati permanen, saldo ikut ke kartu baru', async () => {
    const s = await mkSantri('P008', 30000);
    const rep = await api().post(`/cards/${s.cardId}/replace`).set(as('admin')).send({ reason: 'Hilang di asrama' });
    expect(rep.status).toBe(201);
    expect((await pay(s, 5000)).body.code).toBe('CARD_REPLACED');
    const n = { barcode: rep.body.barcodeToken, pin: '739154' };
    await api().post('/cards/change-pin').set(as('kasir')).send({ barcode: n.barcode, currentPin: rep.body.initialPin, newPin: n.pin });
    const r = await pay(n, 5000);
    expect(r.status).toBe(201); expect(r.body.balanceAfter).toBe(25000);
  });

  it('PIN awal wajib diganti sebelum bisa belanja; PIN lemah ditolak', async () => {
    const sn = await api().post('/santri').set(as('admin')).send({ nis: 'P009', fullName: 'Santri P009' });
    await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: sn.body.id, amount: 20000, method: 'CASH_COUNTER', pocket: 'JAJAN', idempotencyKey: key() });
    const c = await api().post('/cards/issue').set(as('admin')).send({ santriId: sn.body.id });
    const blocked = await pay({ barcode: c.body.barcodeToken, pin: c.body.initialPin }, 5000);
    expect(blocked.body.code).toBe('PIN_MUST_CHANGE');
    const weak = await api().post('/cards/change-pin').set(as('kasir')).send({ barcode: c.body.barcodeToken, currentPin: c.body.initialPin, newPin: '123456' });
    expect(weak.status).toBe(400);
  });

  it('barcode tidak dikenal ditolak; satu santri tidak bisa punya dua kartu aktif', async () => {
    expect((await pay({ barcode: 'TIDAKADAKARTUINI1', pin: '482915' }, 5000)).body.code).toBe('CARD_UNKNOWN');
    const s = await mkSantri('P010');
    expect((await api().post('/cards/issue').set(as('admin')).send({ santriId: s.santriId })).status).toBe(409);
  });

  it('barcode/PIN tidak disimpan dalam bentuk asli di database', async () => {
    const s = await mkSantri('P011');
    const row = (await pool.query('SELECT barcode_hash, pin_hash FROM cards WHERE id=$1', [s.cardId])).rows[0];
    expect(row.barcode_hash).not.toContain(s.barcode);
    expect(row.pin_hash.startsWith('$argon2id$')).toBe(true);
  });

  it('batas belanja harian dan per transaksi dihormati', async () => {
    const s = await mkSantri('P012', 100000);
    await api().patch(`/wallet/${s.santriId}/limits`).set(as('bendahara')).send({ dailyLimit: 20000, perTxLimit: 15000 });
    expect((await pay(s, 16000)).body.code).toBe('PER_TX_LIMIT');
    expect((await pay(s, 12000)).status).toBe(201);
    expect((await pay(s, 12000)).body.code).toBe('DAILY_LIMIT');
    expect(await balanceOf(s.santriId)).toBe(88000);
  });
});

describe('Produk, stok, refund', () => {
  it('checkout produk mengurangi stok; stok tidak cukup ditolak TANPA memotong saldo/stok', async () => {
    const p = await api().post('/products').set(as('admin')).send({ name: 'Roti Test', price: 5000, stock: 3 });
    const s = await mkSantri('R001', 50000);
    const ok = await api().post('/pos/pay').set(as('kasir')).send({ barcode: s.barcode, pin: s.pin, idempotencyKey: key(), items: [{ productId: p.body.id, qty: 2 }] });
    expect(ok.status).toBe(201); expect(ok.body.total).toBe(10000);
    const bad = await api().post('/pos/pay').set(as('kasir')).send({ barcode: s.barcode, pin: s.pin, idempotencyKey: key(), items: [{ productId: p.body.id, qty: 2 }] });
    expect(bad.status).toBe(409); expect(bad.body.code).toBe('OUT_OF_STOCK');
    expect(await balanceOf(s.santriId)).toBe(40000);
    expect((await pool.query('SELECT stock FROM products WHERE id=$1', [p.body.id])).rows[0].stock).toBe(1);
  });

  it('refund = transaksi pembalik; riwayat asli utuh; tidak bisa refund dua kali; stok kembali', async () => {
    const p = await api().post('/products').set(as('admin')).send({ name: 'Es Test', price: 4000, stock: 10 });
    const s = await mkSantri('R002', 20000);
    const o = await api().post('/pos/pay').set(as('kasir')).send({ barcode: s.barcode, pin: s.pin, idempotencyKey: key(), items: [{ productId: p.body.id, qty: 3 }] });
    expect(await balanceOf(s.santriId)).toBe(8000);
    const rf = await api().post('/wallet/refund').set(as('bendahara')).send({ orderId: o.body.orderId, reason: 'Salah pesan' });
    expect(rf.status).toBe(201);
    expect(await balanceOf(s.santriId)).toBe(20000);
    const types = (await pool.query(`SELECT type FROM ledger_entries l JOIN wallets w ON w.id=l.wallet_id WHERE w.santri_id=$1 ORDER BY l.created_at`, [s.santriId])).rows.map((r) => r.type);
    expect(types).toEqual(['TOPUP', 'PURCHASE', 'REFUND']);
    expect((await api().post('/wallet/refund').set(as('bendahara')).send({ orderId: o.body.orderId, reason: 'Dobel' })).status).toBe(409);
    expect((await pool.query('SELECT stock FROM products WHERE id=$1', [p.body.id])).rows[0].stock).toBe(10);
  });
});

describe('Ledger & rekonsiliasi', () => {
  it('ledger tidak bisa di-UPDATE atau DELETE (trigger database)', async () => {
    await expect(pool.query('UPDATE ledger_entries SET amount = 1')).rejects.toThrow(/immutable/);
    await expect(pool.query('DELETE FROM ledger_entries')).rejects.toThrow(/immutable/);
  });
  it('saldo wallet tidak bisa dipaksa negatif langsung di database (CHECK)', async () => {
    await expect(pool.query('UPDATE wallets SET balance = -1')).rejects.toThrow();
  });
  it('rekonsiliasi: semua saldo sama dengan jumlah mutasi ledger', async () => {
    const r = await api().get('/reports/reconcile').set(as('bendahara'));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.walletsChecked).toBeGreaterThan(5);
  });
  it('top up idempotent: kunci sama tidak menambah saldo dua kali', async () => {
    const s = await mkSantri('L001');
    const k = key();
    await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: s.santriId, amount: 20000, method: 'CASH_COUNTER', pocket: 'JAJAN', idempotencyKey: k });
    await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: s.santriId, amount: 20000, method: 'CASH_COUNTER', pocket: 'JAJAN', idempotencyKey: k });
    expect(await balanceOf(s.santriId)).toBe(20000);
  });
});

describe('Tagihan SPP', () => {
  it('generate tagihan idempotent (dijalankan 2x tidak dobel)', async () => {
    await pool.query(`UPDATE santri SET status='INACTIVE'`); // isolasi: hanya santri baru yang kena
    const s1 = await mkSantri('B001'); const s2 = await mkSantri('B002');
    await pool.query(`UPDATE santri SET status='ACTIVE' WHERE id = ANY($1)`, [[s1.santriId, s2.santriId]]);
    const body = { period: '2026-11', title: 'SPP', amount: 300000, dueDate: '2026-11-10' };
    const a = await api().post('/billing/generate').set(as('bendahara')).send(body);
    const b = await api().post('/billing/generate').set(as('bendahara')).send(body);
    expect(a.body.created).toBe(2); expect(b.body.created).toBe(0);
  });

  it('pembayaran parsial → PARTIAL, sisa akurat; lunas → PAID; kelebihan bayar ditolak; kwitansi unik', async () => {
    const s = await mkSantri('B003');
    await pool.query(`UPDATE santri SET status='ACTIVE' WHERE id=$1`, [s.santriId]);
    await api().post('/billing/generate').set(as('bendahara')).send({ period: '2026-12', title: 'SPP', amount: 300000, dueDate: '2026-12-10', kelas: '7A' });
    const inv = (await pool.query(`SELECT id FROM invoices WHERE santri_id=$1 AND period='2026-12'`, [s.santriId])).rows[0];
    const p1 = await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv.id, amount: 100000, method: 'CASH', idempotencyKey: key() });
    expect(p1.status).toBe(201); expect(p1.body.remaining).toBe(200000);
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [inv.id])).rows[0].status).toBe('PARTIAL');
    expect((await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv.id, amount: 250000, method: 'CASH', idempotencyKey: key() })).status).toBe(422);
    const k = key();
    const p2 = await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv.id, amount: 200000, method: 'TRANSFER', idempotencyKey: k });
    const p2dup = await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv.id, amount: 200000, method: 'TRANSFER', idempotencyKey: k });
    expect(p2dup.body.duplicate).toBe(true);
    expect(p2.body.receiptNumber).not.toBe(p1.body.receiptNumber);
    expect((await pool.query('SELECT status, paid FROM invoices WHERE id=$1', [inv.id])).rows[0]).toEqual({ status: 'PAID', paid: 300000 });
    expect((await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv.id, amount: 1000, method: 'CASH', idempotencyKey: key() })).status).toBe(409);
  });

  it('tagihan lewat jatuh tempo tampil OVERDUE; pembatalan tidak menghapus data', async () => {
    const s = await mkSantri('B004');
    await pool.query(`UPDATE santri SET status='ACTIVE' WHERE id=$1`, [s.santriId]);
    await api().post('/billing/generate').set(as('bendahara')).send({ period: '2020-01', title: 'SPP Lama', amount: 100000, dueDate: '2020-01-10', kelas: '7A' });
    const list = await api().get('/billing/invoices').set(as('bendahara')).query({ santriId: s.santriId, status: 'OVERDUE' });
    expect(list.body.length).toBe(1);
    expect((await api().post(`/billing/invoices/${list.body[0].id}/cancel`).set(as('bendahara'))).status).toBe(201);
    expect((await pool.query('SELECT status FROM invoices WHERE id=$1', [list.body[0].id])).rows[0].status).toBe('CANCELLED');
  });
});

describe('Portal wali santri', () => {
  it('walsan hanya melihat anak yang terhubung; anak orang lain = 404', async () => {
    const mine = await mkSantri('W001', 30000);
    const other = await mkSantri('W002', 30000);
    const idA = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await api().post(`/santri/${mine.santriId}/walsan`).set(as('admin')).send({ userId: idA, relation: 'ayah' });
    await pay(mine, 7000);

    const kids = await api().get('/portal/children').set(as('walsanA'));
    expect(kids.status).toBe(200);
    expect(kids.body.map((k: any) => k.id)).toEqual([mine.santriId]);
    expect(kids.body[0].balance).toBe(23000);

    expect((await api().get(`/portal/children/${mine.santriId}/ledger`).set(as('walsanA'))).status).toBe(200);
    for (const path of ['ledger', 'orders', 'invoices']) {
      expect((await api().get(`/portal/children/${other.santriId}/${path}`).set(as('walsanA'))).status).toBe(404);
      expect((await api().get(`/portal/children/${mine.santriId}/${path}`).set(as('walsanB'))).status).toBe(404);
    }
  });

  it('walsan melihat detail belanja (nama barang, harga) dan tagihan anaknya', async () => {
    const p = await api().post('/products').set(as('admin')).send({ name: 'Nasi Goreng Test', price: 8000, stock: 5 });
    const mine = await mkSantri('W003', 30000);
    const idA = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await api().post(`/santri/${mine.santriId}/walsan`).set(as('admin')).send({ userId: idA });
    await api().post('/pos/pay').set(as('kasir')).send({ barcode: mine.barcode, pin: mine.pin, idempotencyKey: key(), items: [{ productId: p.body.id, qty: 2 }] });
    await pool.query(`UPDATE santri SET status='ACTIVE' WHERE id=$1`, [mine.santriId]);
    await api().post('/billing/generate').set(as('bendahara')).send({ period: '2027-01', title: 'SPP', amount: 250000, dueDate: '2027-01-10', kelas: '7A' });

    const orders = await api().get(`/portal/children/${mine.santriId}/orders`).set(as('walsanA'));
    expect(orders.body[0].items[0]).toMatchObject({ name: 'Nasi Goreng Test', qty: 2, unitPrice: 8000 });
    const inv = await api().get(`/portal/children/${mine.santriId}/invoices`).set(as('walsanA'));
    expect(inv.body.some((i: any) => i.period === '2027-01' && i.remaining === 250000)).toBe(true);
  });
});

describe('PIN yang ditentukan admin', () => {
  it('PIN custom + tidak wajib ganti → langsung bisa dipakai bayar', async () => {
    const sn = await api().post('/santri').set(as('admin')).send({ nis: 'C001', fullName: 'Santri C001' });
    await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: sn.body.id, amount: 20000, method: 'CASH_COUNTER', pocket: 'JAJAN', idempotencyKey: key() });
    const c = await api().post('/cards/issue').set(as('admin')).send({ santriId: sn.body.id, pin: '482915', mustChange: false });
    expect(c.status).toBe(201); expect(c.body.initialPin).toBe('482915');
    const r = await pay({ barcode: c.body.barcodeToken, pin: '482915' }, 5000);
    expect(r.status).toBe(201); expect(r.body.balanceAfter).toBe(15000);
  });
  it('PIN custom + wajib ganti (default) → harus diganti dulu', async () => {
    const sn = await api().post('/santri').set(as('admin')).send({ nis: 'C002', fullName: 'Santri C002' });
    await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: sn.body.id, amount: 20000, method: 'CASH_COUNTER', pocket: 'JAJAN', idempotencyKey: key() });
    const c = await api().post('/cards/issue').set(as('admin')).send({ santriId: sn.body.id, pin: '482915' });
    expect((await pay({ barcode: c.body.barcodeToken, pin: '482915' }, 5000)).body.code).toBe('PIN_MUST_CHANGE');
  });
  it('PIN custom yang lemah ditolak (issue, reset, ganti kartu)', async () => {
    const sn = await api().post('/santri').set(as('admin')).send({ nis: 'C003', fullName: 'Santri C003' });
    expect((await api().post('/cards/issue').set(as('admin')).send({ santriId: sn.body.id, pin: '111111' })).status).toBe(400);
    expect((await api().post('/cards/issue').set(as('admin')).send({ santriId: sn.body.id, pin: '12ab56' })).status).toBe(400);
    const c = await api().post('/cards/issue').set(as('admin')).send({ santriId: sn.body.id });
    expect((await api().post(`/cards/${c.body.cardId}/reset-pin`).set(as('admin')).send({ pin: '123456' })).status).toBe(400);
    expect((await api().post(`/cards/${c.body.cardId}/replace`).set(as('admin')).send({ reason: 'hilang', pin: '000000' })).status).toBe(400);
    const ok = await api().post(`/cards/${c.body.cardId}/reset-pin`).set(as('admin')).send({ pin: '739154', mustChange: false });
    expect(ok.status).toBe(201); expect(ok.body.initialPin).toBe('739154');
  });
});

describe('Preview kartu (admin)', () => {
  it('admin bisa melihat QR kartu aktif, tokennya benar-benar bisa dipakai bayar, dan tercatat di audit log', async () => {
    const s = await mkSantri('V001', 30000);
    const v = await api().get(`/cards/${s.cardId}/preview`).set(as('admin'));
    expect(v.status).toBe(200);
    expect(v.body.barcodeToken).toBe(s.barcode);
    expect(v.body.santri.nis).toBe('V001');
    expect((await pay({ barcode: v.body.barcodeToken, pin: s.pin }, 5000)).status).toBe(201);
    const n = (await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action='CARD_VIEW' AND entity_id=$1`, [s.cardId])).rows[0].n;
    expect(n).toBe(1);
  });
  it('token tidak tersimpan sebagai teks biasa di database', async () => {
    const s = await mkSantri('V002');
    const row = (await pool.query('SELECT token_enc FROM cards WHERE id=$1', [s.cardId])).rows[0];
    expect(row.token_enc).toBeTruthy(); expect(row.token_enc).not.toContain(s.barcode);
  });
  it('peran lain tidak boleh melihat preview', async () => {
    const s = await mkSantri('V003');
    for (const who of ['kasir', 'bendahara', 'walsanA']) expect((await api().get(`/cards/${s.cardId}/preview`).set(as(who))).status).toBe(403);
  });
  it('kartu yang sudah diganti, atau kartu lama tanpa token, tidak bisa di-preview', async () => {
    const s = await mkSantri('V004');
    await pool.query('UPDATE cards SET token_enc = NULL WHERE id=$1', [s.cardId]);
    expect((await api().get(`/cards/${s.cardId}/preview`).set(as('admin'))).body.code).toBe('PREVIEW_UNAVAILABLE');
    const s2 = await mkSantri('V005');
    await api().post(`/cards/${s2.cardId}/replace`).set(as('admin')).send({ reason: 'hilang' });
    expect((await api().get(`/cards/${s2.cardId}/preview`).set(as('admin'))).body.code).toBe('CARD_NOT_LIVE');
  });
});

describe('Top up transfer bank (kode unik + fee di atas nominal)', () => {
  let walsanId: string;
  const setSettings = (b: any) => api().put('/topups/settings').set(as('admin')).send(b);
  beforeAll(async () => {
    walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    expect((await setSettings({ fee: 1500, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank Contoh 123456 a.n. Pesantren Demo' })).status).toBe(200);
  });
  async function child(nis: string) {
    const s = await mkSantri(nis);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    return s;
  }

  it('total = nominal + kode unik + fee; saldo yang masuk = nominal + kode unik (fee BUKAN saldo)', async () => {
    const s = await child('T001');
    const r = await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 50000 });
    expect(r.status).toBe(201);
    expect(r.body.fee).toBe(1500);
    expect(r.body.total).toBe(50000 + r.body.uniqueCode + 1500);
    expect(r.body.credited).toBe(50000 + r.body.uniqueCode);
    expect(r.body.bankInfo).toContain('Pesantren Demo');
  });

  it('alur lengkap: cocokkan mutasi → disetujui bendahara → saldo naik sebesar nominal+kode; fee tercatat di laporan', async () => {
    const s = await child('T002');
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 100000 })).body;
    const m = await api().post('/topups/match').set(as('bendahara')).send({ lines: [{ ref: '09/11 TRF DARI AHMAD', amount: r.total }, { ref: '09/11 LAIN', amount: 12345 }] });
    expect(m.body).toMatchObject({ matched: 1, unmatched: 1, duplicates: 0 });
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(0); // dicocokkan saja belum menambah saldo
    const before = (await api().get('/topups/report').set(as('bendahara'))).body;
    const ap = await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({});
    expect(ap.status).toBe(201);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(r.credited);
    const after = (await api().get('/topups/report').set(as('bendahara'))).body;
    expect(after.feeTotal - before.feeTotal).toBe(1500);
    expect(after.count - before.count).toBe(1);
    expect((await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({})).status).toBe(409); // tidak bisa dua kali
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(r.credited);
  });

  it('baris mutasi yang sama diimpor dua kali tidak mencocokkan dua kali', async () => {
    const s = await child('T003');
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 30000 })).body;
    const lines = [{ ref: 'REF-ABC-1', amount: r.total }];
    expect((await api().post('/topups/match').set(as('bendahara')).send({ lines })).body.matched).toBe(1);
    expect((await api().post('/topups/match').set(as('bendahara')).send({ lines })).body.duplicates).toBe(1);
  });

  it('nominal transfer selalu unik di antara permintaan terbuka', async () => {
    const s = await child('T004');
    const totals = new Set<number>();
    for (let i = 0; i < 3; i++) totals.add((await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 40000 })).body.total);
    expect(totals.size).toBe(3);
    expect((await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 40000 })).body.code).toBe('TOO_MANY_OPEN');
  });

  it('minimal/maksimal ditegakkan; anak orang lain = 404; kasir/walsan tidak bisa menyetujui', async () => {
    const s = await child('T005'); const other = await mkSantri('T006');
    expect((await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 5000 })).body.code).toBe('AMOUNT_RANGE');
    expect((await api().post(`/portal/children/${other.santriId}/topups`).set(as('walsanA')).send({ amount: 50000 })).status).toBe(404);
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 50000 })).body;
    for (const who of ['kasir', 'walsanA', 'walsanB']) expect((await api().post(`/topups/${r.id}/approve`).set(as(who)).send({})).status).toBe(403);
    expect((await api().get('/topups').set(as('walsanA'))).status).toBe(403);
  });

  it('persetujuan manual (tanpa mutasi) wajib catatan; permintaan kedaluwarsa tidak bisa dicocokkan', async () => {
    const s = await child('T007');
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 60000 })).body;
    expect((await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({})).body.code).toBe('MANUAL_NOTE');
    await pool.query(`UPDATE topup_requests SET expires_at = now() - interval '1 hour' WHERE id=$1`, [r.id]);
    expect((await api().post('/topups/match').set(as('bendahara')).send({ lines: [{ ref: 'EXP-1', amount: r.total }] })).body.matched).toBe(0);
    const s2 = await child('T008');
    const r2 = (await api().post(`/portal/children/${s2.santriId}/topups`).set(as('walsanA')).send({ amount: 60000 })).body;
    const ok = await api().post(`/topups/${r2.id}/approve`).set(as('bendahara')).send({ note: 'Bukti transfer #8841 dicek manual' });
    expect(ok.status).toBe(201); expect(await balanceOf(s2.santriId, 'SALDO')).toBe(r2.credited);
  });

  it('hanya admin yang boleh mengubah biaya layanan; rekonsiliasi tetap tanpa selisih', async () => {
    expect((await api().put('/topups/settings').set(as('bendahara')).send({ fee: 0, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'x' })).status).toBe(403);
    expect((await api().get('/reports/reconcile').set(as('bendahara'))).body.ok).toBe(true);
  });
});

describe('Bukti transfer (foto)', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const png = (extra = 0) => Buffer.concat([PNG, Buffer.alloc(extra, 7)]); // variasi byte agar hash berbeda
  let walsanId: string;
  beforeAll(async () => {
    walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await api().put('/topups/settings').set(as('admin')).send({ fee: 1500, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank Contoh 123 a.n. Pesantren' });
  });
  async function req(nis: string) {
    const s = await mkSantri(nis);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 50000 })).body;
    return { s, r };
  }
  const upload = (who: string, rid: string, buf: Buffer, ocr: number[], name = 'bukti.png', type = 'image/png') =>
    api().post(`/portal/topups/${rid}/proof`).set(as(who)).attach('file', buf, { filename: name, contentType: type }).field('ocrAmounts', JSON.stringify(ocr));

  it('unggah foto: nominal cocok ditandai; staf bisa melihat dan pembukaannya tercatat; saldo TIDAK berubah', async () => {
    const { s, r } = await req('F001');
    const u = await upload('walsanA', r.id, png(1), [r.total, 12345]);
    expect(u.status).toBe(201); expect(u.body.amountMatch).toBe(true);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(0);
    const list = await api().get('/topups').set(as('bendahara'));
    const row = list.body.find((x: any) => x.id === r.id);
    expect(row.proofs).toBe(1); expect(row.proofMatch).toBe(true);
    const pr = await api().get(`/topups/${r.id}/proofs`).set(as('bendahara'));
    const img = await api().get(`/topups/proofs/${pr.body[0].id}/image`).set(as('bendahara')).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(img.status).toBe(200); expect(img.headers['content-type']).toBe('image/png'); expect(Buffer.compare(img.body, png(1))).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE action='TOPUP_PROOF_VIEW' AND entity_id=$1`, [r.id])).rows[0].n).toBe(1);
  });
  it('nominal di foto tidak cocok → ditandai tidak cocok (bukan ditolak)', async () => {
    const { r } = await req('F002');
    const u = await upload('walsanA', r.id, png(2), [99999]);
    expect(u.status).toBe(201); expect(u.body.amountMatch).toBe(false);
  });
  it('foto yang sama tidak bisa dipakai dua kali (permintaan lain pun ditolak)', async () => {
    const a = await req('F003'); const b = await req('F004');
    expect((await upload('walsanA', a.r.id, png(3), [])).status).toBe(201);
    expect((await upload('walsanA', a.r.id, png(3), [])).body.code).toBe('PROOF_DUPLICATE');
    expect((await upload('walsanA', b.r.id, png(3), [])).body.code).toBe('PROOF_DUPLICATE');
  });
  it('file bukan gambar (walau diberi nama .png) ditolak; ukuran > 3 MB ditolak', async () => {
    const { r } = await req('F005');
    expect((await upload('walsanA', r.id, Buffer.from('<html><script>alert(1)</script></html>'), [], 'x.png', 'image/png')).body.code).toBe('BAD_FILE');
    expect((await upload('walsanA', r.id, Buffer.concat([PNG, Buffer.alloc(3.2 * 1024 * 1024, 1)]), [])).status).toBe(413);
  });
  it('maksimal 3 foto; wali lain tidak bisa mengunggah ke permintaan orang; wali tidak bisa membuka foto lewat jalur staf', async () => {
    const { r } = await req('F006');
    for (let i = 10; i < 13; i++) expect((await upload('walsanA', r.id, png(i), [])).status).toBe(201);
    expect((await upload('walsanA', r.id, png(20), [])).body.code).toBe('TOO_MANY_PROOFS');
    const o = await req('F007');
    expect((await upload('walsanB', o.r.id, png(30), [])).status).toBe(404);
    const pr = await api().get(`/topups/${r.id}/proofs`).set(as('bendahara'));
    expect((await api().get(`/topups/proofs/${pr.body[0].id}/image`).set(as('walsanA'))).status).toBe(403);
    expect((await api().get(`/topups/proofs/${pr.body[0].id}/image`).set(as('kasir'))).status).toBe(403);
  });
});

describe('Tagihan jasa bulanan (fee)', () => {
  let walsanId: string; let superTok: string; let month: string; let paidDate: string;
  beforeAll(async () => {
    walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await mkUser('superdev', 'SUPER_ADMIN'); superTok = tok['superdev'];
    await api().put('/topups/settings').set(as('admin')).send({ fee: 1500, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank Contoh 123 a.n. Pesantren' });
    month = (await pool.query(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta') - interval '2 months', 'YYYY-MM') AS m`)).rows[0].m;
    paidDate = (await pool.query(`SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS d`)).rows[0].d;
    const ids: string[] = [];
    for (const [i, nis] of ['G001', 'G002'].entries()) {
      const s = await mkSantri(nis);
      await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
      const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 50000 + i * 10000 })).body;
      expect((await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({ note: 'bukti manual tes' })).status).toBe(201);
      ids.push(r.id);
    }
    // pindahkan penyetujuan ke 2 bulan lalu supaya jadi "bulan yang sudah berakhir"
    await pool.query(`UPDATE topup_requests SET decided_at = (($1 || '-15 12:00')::timestamp AT TIME ZONE 'Asia/Jakarta') WHERE id = ANY($2::uuid[])`, [month, ids]);
  });
  const get = (path: string, who = 'bendahara') => api().get(path).set(as(who));

  it('daftar bulan: jumlah, total fee, status BELUM_DIBAYAR untuk bulan lewat; bulan berjalan = BERJALAN', async () => {
    const r = await get('/fees/months');
    expect(r.status).toBe(200);
    const m = r.body.find((x: any) => x.month === month);
    expect(m).toMatchObject({ count: 2, feeTotal: 3000, status: 'BELUM_DIBAYAR' });
    expect(r.body.some((x: any) => x.status === 'BERJALAN')).toBe(true);
    expect((await get('/fees/summary')).body.unpaidTotal).toBeGreaterThanOrEqual(3000);
  });
  it('rincian dan CSV memuat tiap top up dan total', async () => {
    const d = await get(`/fees/months/${month}`);
    expect(d.body.items).toHaveLength(2); expect(d.body.totals).toMatchObject({ count: 2, fee: 3000 });
    const c = await get(`/fees/months/${month}/csv`);
    expect(c.status).toBe(200); expect(c.headers['content-type']).toContain('text/csv');
    expect(c.text).toContain('Biaya layanan (Rp)'); expect(c.text).toContain('G001'); expect(c.text).toContain('TOTAL (2 top up)');
  });
  it('hanya admin/bendahara yang boleh melihat; kasir dan wali tidak', async () => {
    for (const who of ['kasir', 'walsanA']) expect((await get('/fees/months', who)).status).toBe(403);
  });
  it('bulan berjalan tidak bisa ditandai dibayar; tanggal masa depan ditolak; catatan wajib', async () => {
    const cur = (await get('/fees/months')).body.find((x: any) => x.status === 'BERJALAN').month;
    expect((await api().post(`/fees/months/${cur}/paid`).set(as('bendahara')).send({ paidAt: paidDate, note: 'bukti 1' })).body.code).toBe('MONTH_OPEN');
    expect((await api().post(`/fees/months/${month}/paid`).set(as('bendahara')).send({ paidAt: '2999-01-01', note: 'bukti 1' })).body.code).toBe('FUTURE_DATE');
    expect((await api().post(`/fees/months/${month}/paid`).set(as('bendahara')).send({ paidAt: paidDate, note: 'a' })).status).toBe(400);
  });
  it('tandai dibayar → DIBAYAR; tidak bisa dua kali; konfirmasi hanya Super Admin → LUNAS; pembatalan hanya Super Admin', async () => {
    expect((await api().post(`/fees/months/${month}/paid`).set(as('bendahara')).send({ paidAt: paidDate, note: 'TRF bukti #7781' })).status).toBe(201);
    expect((await api().post(`/fees/months/${month}/paid`).set(as('bendahara')).send({ paidAt: paidDate, note: 'TRF lagi' })).body.code).toBe('ALREADY_PAID');
    expect((await get('/fees/months')).body.find((x: any) => x.month === month).status).toBe('DIBAYAR');
    expect((await api().post(`/fees/months/${month}/received`).set(as('bendahara'))).status).toBe(403);
    expect((await api().post(`/fees/months/${month}/received`).set('Authorization', `Bearer ${superTok}`)).status).toBe(201);
    expect((await get('/fees/months')).body.find((x: any) => x.month === month)).toMatchObject({ status: 'LUNAS', paidTotal: 3000 });
    expect((await api().delete(`/fees/months/${month}/paid`).set(as('bendahara'))).status).toBe(403);
    expect((await api().delete(`/fees/months/${month}/paid`).set('Authorization', `Bearer ${superTok}`)).status).toBe(200);
    expect((await get('/fees/months')).body.find((x: any) => x.month === month).status).toBe('BELUM_DIBAYAR');
    expect((await pool.query(`SELECT count(*)::int n FROM audit_logs WHERE entity='fee' AND entity_id=$1`, [month])).rows[0].n).toBeGreaterThanOrEqual(3);
  });
});

describe('Toleransi kelebihan transfer & jumlah diterima', () => {
  let walsanId: string;
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  beforeAll(async () => {
    walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await pool.query(`UPDATE topup_requests SET status = 'CANCELLED' WHERE status IN ('PENDING','MATCHED')`); // isolasi: tanpa permintaan terbuka lain
    expect((await api().put('/topups/settings').set(as('admin')).send({ fee: 1500, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank Contoh 123 a.n. Pesantren', tolerance: 5000 })).status).toBe(200);
  });
  async function req(nis: string, amount = 50000) {
    const s = await mkSantri(nis);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount })).body;
    return { s, r };
  }
  const match = (lines: any[]) => api().post('/topups/match').set(as('bendahara')).send({ lines });

  it('lebih Rp2.000 dari total tetap dicocokkan; SELURUH jumlah diterima (dikurangi fee) masuk saldo', async () => {
    const { s, r } = await req('H001');
    const m = await match([{ ref: 'LEBIH-1', amount: r.total + 2000 }]);
    expect(m.body).toMatchObject({ matched: 1, ambiguous: 0, unmatched: 0 });
    expect((await api().get('/topups').set(as('bendahara'))).body.find((x: any) => x.id === r.id)).toMatchObject({ status: 'MATCHED', receivedAmount: r.total + 2000 });
    const ap = await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({});
    expect(ap.status).toBe(201); expect(ap.body.credited).toBe(r.total + 2000 - 1500);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(r.total + 2000 - 1500);
  });
  it('lebih dari batas toleransi tidak dicocokkan otomatis; kurang dari total juga tidak', async () => {
    const { r } = await req('H002');
    expect((await match([{ ref: 'LEBIH-BESAR', amount: r.total + 6000 }])).body).toMatchObject({ matched: 0, unmatched: 1 });
    expect((await match([{ ref: 'KURANG', amount: r.total - 500 }])).body).toMatchObject({ matched: 0, unmatched: 1 });
  });
  it('persis sama diutamakan; dua kandidat tanpa yang persis = ambigu (diproses manual)', async () => {
    const a = await req('H003'); const b = await req('H004');
    const hi = Math.max(a.r.total, b.r.total), lo = Math.min(a.r.total, b.r.total);
    expect((await match([{ ref: 'AMBIGU-1', amount: hi + 300 }])).body).toMatchObject({ matched: 0, ambiguous: 1 });
    const exact = await match([{ ref: 'PERSIS-1', amount: lo }]);
    expect(exact.body.matched).toBe(1);
    const who = (await api().get('/topups').set(as('bendahara'))).body.find((x: any) => x.receivedAmount === lo && x.status === 'MATCHED');
    expect(who.total).toBe(lo);
  });
  it('setuju manual dengan jumlah berbeda wajib catatan; saldo = jumlah diterima - fee; fee di laporan tetap', async () => {
    const { s, r } = await req('H005');
    const noNote = await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({ receivedAmount: r.total - 700 });
    expect(noNote.status).toBe(422);
    const ok = await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({ note: 'Transfer kurang 700, dicek di mutasi', receivedAmount: r.total - 700 });
    expect(ok.status).toBe(201); expect(await balanceOf(s.santriId, 'SALDO')).toBe(r.total - 700 - 1500);
    const { r: r2 } = await req('H006', 20000);
    expect((await api().post(`/topups/${r2.id}/approve`).set(as('bendahara')).send({ note: 'bukti manual terlalu kecil', receivedAmount: 1200 })).body.code).toBe('CREDIT_TOO_SMALL');
  });
  it('rekonsiliasi tetap tanpa selisih setelah top up dengan jumlah berbeda', async () => {
    expect((await api().get('/reports/reconcile').set(as('bendahara'))).body.ok).toBe(true);
  });
  it('toleransi bisa diubah admin saja', async () => {
    expect((await api().put('/topups/settings').set(as('bendahara')).send({ fee: 1500, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'x', tolerance: 100 })).status).toBe(403);
    expect((await api().get('/topups/settings').set(as('bendahara'))).status).toBe(403); // pengaturan rekening/QRIS hanya Admin
    expect((await api().get('/topups/settings').set(as('admin'))).body.tolerance).toBe(5000);
  });

  it('QRIS: hanya admin yang mengunggah; wali bisa melihat; file non-gambar ditolak; bisa dihapus', async () => {
    expect((await api().get('/portal/topup-info').set(as('walsanA'))).body.hasQris).toBe(false);
    expect((await api().put('/topups/qris').set(as('bendahara')).attach('file', PNG, { filename: 'q.png', contentType: 'image/png' })).status).toBe(403);
    expect((await api().put('/topups/qris').set(as('admin')).attach('file', Buffer.from('bukan gambar'), { filename: 'q.png', contentType: 'image/png' })).body.code).toBe('BAD_FILE');
    expect((await api().put('/topups/qris').set(as('admin')).attach('file', PNG, { filename: 'q.png', contentType: 'image/png' })).status).toBe(200);
    expect((await api().get('/portal/topup-info').set(as('walsanA'))).body.hasQris).toBe(true);
    const img = await api().get('/portal/topup-qris').set(as('walsanA')).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(img.status).toBe(200); expect(img.headers['content-type']).toBe('image/png'); expect(Buffer.compare(img.body, PNG)).toBe(0);
    expect((await api().get('/portal/topup-qris').set(as('kasir'))).status).toBe(403);
    expect((await api().delete('/topups/qris').set(as('admin'))).status).toBe(200);
    expect((await api().get('/portal/topup-qris').set(as('walsanA'))).status).toBe(404);
  });
});

describe('Saldo utama, kantong Jajan/Laundry, dan pindah saldo oleh wali', () => {
  let walsanId: string;
  beforeAll(async () => { walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id; });
  async function child(nis: string, saldo = 0) {
    const s = await mkSantri(nis);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    if (saldo) expect((await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: s.santriId, amount: saldo, method: 'CASH_COUNTER', idempotencyKey: key() })).status).toBe(201);
    return s;
  }
  const transfer = (who: string, id: string, from: string, to: string, amount: number, k = key()) =>
    api().post(`/portal/children/${id}/transfer`).set(as(who)).send({ from, to, amount, idempotencyKey: k });

  it('santri baru punya kantong Saldo, Jajan, Laundry; top up masuk ke Saldo; wali memindahkannya', async () => {
    const s = await child('K001', 500000);
    expect((await pool.query('SELECT pocket FROM wallets WHERE santri_id=$1 ORDER BY pocket', [s.santriId])).rows.map((r) => r.pocket)).toEqual(['JAJAN', 'LAUNDRY', 'SALDO']);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(500000); expect(await balanceOf(s.santriId)).toBe(0);
    expect((await transfer('walsanA', s.santriId, 'SALDO', 'JAJAN', 100000)).status).toBe(201);
    const r = await transfer('walsanA', s.santriId, 'SALDO', 'LAUNDRY', 50000);
    expect(r.body.pockets).toEqual({ SALDO: 350000, JAJAN: 100000, LAUNDRY: 50000 });
    const kids = await api().get('/portal/children').set(as('walsanA'));
    expect(kids.body.find((k: any) => k.id === s.santriId).pockets).toEqual({ SALDO: 350000, JAJAN: 100000, LAUNDRY: 50000 });
    expect((await api().get('/reports/reconcile').set(as('bendahara'))).body.ok).toBe(true);
  });
  it('kantong SPP lama sudah tidak dikenal; pindah saldo: tidak cukup, kantong sama, idempotent, anak orang lain 404', async () => {
    const s = await child('K002', 50000); const o = await mkSantri('K003', 50000);
    expect((await transfer('walsanA', s.santriId, 'SALDO', 'SPP', 10000)).status).toBe(400);
    expect((await transfer('walsanA', s.santriId, 'SALDO', 'JAJAN', 60000)).body.code).toBe('INSUFFICIENT_BALANCE');
    expect((await transfer('walsanA', s.santriId, 'SALDO', 'SALDO', 10000)).body.code).toBe('SAME_POCKET');
    const k = key();
    await transfer('walsanA', s.santriId, 'SALDO', 'JAJAN', 20000, k);
    expect((await transfer('walsanA', s.santriId, 'SALDO', 'JAJAN', 20000, k)).body.duplicate).toBe(true);
    expect(await balanceOf(s.santriId)).toBe(20000); expect(await balanceOf(s.santriId, 'SALDO')).toBe(30000);
    expect((await transfer('walsanA', o.santriId, 'SALDO', 'JAJAN', 10000)).status).toBe(404);
    expect((await transfer('kasir', s.santriId, 'SALDO', 'JAJAN', 10000)).status).toBe(403);
  });
  it('20 pindah saldo bersamaan dari kantong yang sama: saldo tidak pernah negatif', async () => {
    const s = await child('K004', 50000);
    const rs = await Promise.all(Array.from({ length: 20 }, () => transfer('walsanA', s.santriId, 'SALDO', 'JAJAN', 10000)));
    expect(rs.filter((r) => r.status === 201).length).toBe(5);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(0); expect(await balanceOf(s.santriId)).toBe(50000);
  });
  it('kasir kantin hanya memotong kantong JAJAN: uang di Saldo tidak bisa dipakai belanja', async () => {
    const s = await child('K005', 100000);
    expect((await pay(s, 8000)).body.code).toBe('INSUFFICIENT_BALANCE');
    await transfer('walsanA', s.santriId, 'SALDO', 'JAJAN', 10000);
    expect((await pay(s, 8000)).status).toBe(201);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(90000);
  });
  it('top up transfer yang disetujui masuk ke Saldo (bukan ke Jajan), permintaan tidak menerima kantong tujuan', async () => {
    await api().put('/topups/settings').set(as('admin')).send({ fee: 0, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank X 1 a.n. Pesantren' });
    const s = await child('K006');
    expect((await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 100000, targetPocket: 'JAJAN' })).status).toBe(400);
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 100000 })).body;
    expect((await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({ note: 'bukti manual tes' })).status).toBe(201);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(r.credited); expect(await balanceOf(s.santriId)).toBe(0);
    expect((await api().patch(`/portal/children/${s.santriId}/split`).set(as('walsanA')).send({ sppAmount: 1000, laundryAmount: 0 })).status).toBe(404);
  });
  it('top up tunai di loket: biaya layanan di atas nominal, saldo masuk = nominal, tercatat di tagihan jasa bulan ini', async () => {
    await api().put('/topups/settings').set(as('admin')).send({ fee: 1500, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank X 1 a.n. Pesantren' });
    const s = await mkSantri('K007');
    const before = (await api().get('/fees/months').set(as('bendahara'))).body[0];
    const k = key();
    const r = await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: s.santriId, amount: 50000, method: 'CASH_COUNTER', idempotencyKey: k });
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ fee: 1500, collect: 51500, balanceAfter: 50000 });
    expect((await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: s.santriId, amount: 50000, method: 'CASH_COUNTER', idempotencyKey: k })).body).toMatchObject({ duplicate: true, fee: 1500, collect: 51500 });
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(50000);
    const after = (await api().get('/fees/months').set(as('bendahara'))).body[0];
    expect(after.feeTotal - before.feeTotal).toBe(1500); expect(after.count - before.count).toBe(1);
    const m = after.month; const d = (await api().get(`/fees/months/${m}`).set(as('bendahara'))).body;
    expect(d.items.some((x: any) => x.kind === 'TUNAI' && x.nis === 'K007' && x.fee === 1500)).toBe(true);
    await api().put('/topups/settings').set(as('admin')).send({ fee: 0, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank X 1 a.n. Pesantren' });
  });
});

describe('Kartu tagihan: pindahkan saldo ke tagihan = bayar', () => {
  let walsanId: string;
  beforeAll(async () => { walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id; });
  async function setup(nis: string, saldo: number) {
    const s = await mkSantri(nis);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    if (saldo) await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: s.santriId, amount: saldo, method: 'CASH_COUNTER', idempotencyKey: key() });
    const inv = (period: string, title: string, amount: number, due: string) => api().post('/billing/invoices').set(as('bendahara')).send({ santriId: s.santriId, period, title, amount, dueDate: due }).then((r) => r.body);
    return { s, inv };
  }
  const payBill = (who: string, id: string, title: string, amount: number, k = key()) =>
    api().post(`/portal/children/${id}/bills/pay`).set(as(who)).send({ title, amount, idempotencyKey: k });

  it('tagihan dikelompokkan per jenis; bayar dari Saldo melunasi yang paling lama dulu, boleh cicil', async () => {
    const { s, inv } = await setup('B101', 400000);
    const old = await inv('2027-01', 'SPP', 100000, '2027-01-10'); const nw = await inv('2027-02', 'SPP', 100000, '2027-02-10');
    await inv('2027-02', 'Uang Gedung', 500000, '2027-02-10');
    const bills = (await api().get(`/portal/children/${s.santriId}/bills`).set(as('walsanA'))).body;
    expect(bills.map((b: any) => [b.title, b.remaining, b.count])).toEqual([['SPP', 200000, 2], ['Uang Gedung', 500000, 1]]);
    const a = await payBill('walsanA', s.santriId, 'SPP', 150000);
    expect(a.status).toBe(201); expect(a.body).toMatchObject({ remaining: 50000, balanceAfter: 250000 }); expect(a.body.receipts).toHaveLength(2);
    expect((await pool.query('SELECT status, paid FROM invoices WHERE id=$1', [old.id])).rows[0]).toEqual({ status: 'PAID', paid: 100000 });
    expect((await pool.query('SELECT status, paid FROM invoices WHERE id=$1', [nw.id])).rows[0]).toEqual({ status: 'PARTIAL', paid: 50000 });
    const k = key();
    const b = await payBill('walsanA', s.santriId, 'Uang Gedung', 200000, k);
    expect(b.body).toMatchObject({ remaining: 300000, balanceAfter: 50000 });
    expect((await payBill('walsanA', s.santriId, 'Uang Gedung', 200000, k)).body.duplicate).toBe(true);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(50000);
    const now = (await api().get(`/portal/children/${s.santriId}/bills`).set(as('walsanA'))).body;
    expect(now.map((x: any) => [x.title, x.remaining])).toEqual([['SPP', 50000], ['Uang Gedung', 300000]]);
    expect((await api().get('/reports/reconcile').set(as('bendahara'))).body.ok).toBe(true);
  });
  it('saldo tidak cukup / melebihi sisa ditolak tanpa memotong apa pun; wali lain 404; staf 403; lunas hilang dari kartu', async () => {
    const { s, inv } = await setup('B102', 50000);
    await inv('2027-03', 'SPP', 100000, '2027-03-10');
    expect((await payBill('walsanA', s.santriId, 'SPP', 80000)).body.code).toBe('INSUFFICIENT_BALANCE');
    expect((await payBill('walsanA', s.santriId, 'SPP', 150000)).body.code).toBe('OVERPAY');
    expect((await payBill('walsanA', s.santriId, 'Tidak Ada', 10000)).body.code).toBe('BILL_NOT_FOUND');
    expect((await payBill('walsanB', s.santriId, 'SPP', 10000)).status).toBe(404);
    expect((await payBill('bendahara', s.santriId, 'SPP', 10000)).status).toBe(403);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(50000);
    expect((await payBill('walsanA', s.santriId, 'SPP', 50000)).status).toBe(201);
    await pool.query('SELECT 1');
  });
  it('tagihan anak lain tidak tersentuh; 10 pembayaran bersamaan tidak membuat saldo negatif atau tagihan kelebihan', async () => {
    const { s, inv } = await setup('B103', 50000); const other = await setup('B104', 50000);
    await inv('2027-04', 'SPP', 100000, '2027-04-10'); await other.inv('2027-04', 'SPP', 100000, '2027-04-10');
    const rs = await Promise.all(Array.from({ length: 10 }, () => payBill('walsanA', s.santriId, 'SPP', 10000)));
    expect(rs.filter((r) => r.status === 201).length).toBe(5);
    expect(await balanceOf(s.santriId, 'SALDO')).toBe(0);
    expect((await pool.query(`SELECT sum(paid)::int p FROM invoices WHERE santri_id=$1`, [s.santriId])).rows[0].p).toBe(50000);
    expect((await pool.query(`SELECT sum(paid)::int p FROM invoices WHERE santri_id=$1`, [other.s.santriId])).rows[0].p).toBe(0);
  });
  it('bayar per tagihan dari beberapa kantong (cara lama) tetap berfungsi, dan pengurus mendapat "Ada yang bayar"', async () => {
    const { s, inv } = await setup('B105', 40000);
    await api().post(`/portal/children/${s.santriId}/transfer`).set(as('walsanA')).send({ from: 'SALDO', to: 'JAJAN', amount: 10000, idempotencyKey: key() });
    const i = await inv('2027-05', 'SPP', 50000, '2027-05-10');
    await pool.query('DELETE FROM notifications');
    const r = await api().post(`/portal/children/${s.santriId}/invoices/${i.id}/pay`).set(as('walsanA')).send({ sources: [{ pocket: 'SALDO', amount: 30000 }, { pocket: 'JAJAN', amount: 10000 }], idempotencyKey: key() });
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ paid: 40000, remaining: 10000 });
    const n = (await api().get('/notifications').set(as('bendahara'))).body.items.filter((x: any) => x.kind === 'PAYMENT');
    expect(n).toHaveLength(1);
  });
});

describe('SPP per santri dan edit tagihan', () => {
  it('nominal SPP per santri dipakai saat generate massal; yang belum punya nominal memakai cadangan atau dilewati', async () => {
    await pool.query(`UPDATE santri SET status='INACTIVE'`);
    const a = await mkSantri('S201'); const b = await mkSantri('S202'); const c = await mkSantri('S203');
    await pool.query(`UPDATE santri SET status='ACTIVE' WHERE id = ANY($1)`, [[a.santriId, b.santriId, c.santriId]]);
    expect((await api().patch(`/santri/${a.santriId}/spp`).set(as('bendahara')).send({ sppAmount: 450000 })).status).toBe(200);
    expect((await api().patch(`/santri/${b.santriId}/spp`).set(as('admin')).send({ sppAmount: 250000 })).status).toBe(200);
    expect((await api().patch(`/santri/${a.santriId}/spp`).set(as('kasir')).send({ sppAmount: 1000 })).status).toBe(403);
    const g = await api().post('/billing/generate').set(as('bendahara')).send({ period: '2027-02', title: 'SPP', dueDate: '2027-02-10', usePerStudent: true });
    expect(g.body).toMatchObject({ created: 2, skippedNoRate: 1 });
    const rows = (await pool.query(`SELECT santri_id, total FROM invoices WHERE period='2027-02' AND title='SPP'`)).rows;
    expect(rows.find((r) => r.santri_id === a.santriId).total).toBe(450000);
    expect(rows.find((r) => r.santri_id === b.santriId).total).toBe(250000);
    expect(rows.find((r) => r.santri_id === c.santriId)).toBeUndefined();
    const g2 = await api().post('/billing/generate').set(as('bendahara')).send({ period: '2027-02', title: 'SPP', dueDate: '2027-02-10', usePerStudent: true, amount: 300000 });
    expect(g2.body.created).toBe(1);
    expect((await pool.query(`SELECT total FROM invoices WHERE santri_id=$1 AND period='2027-02'`, [c.santriId])).rows[0].total).toBe(300000);
    expect((await api().post('/billing/generate').set(as('bendahara')).send({ period: '2027-03', title: 'SPP', dueDate: '2027-03-10' })).body.code).toBe('AMOUNT_REQUIRED');
  });
  it('tagihan untuk satu santri: nominal bebas; duplikat judul+periode ditolak', async () => {
    const s = await mkSantri('S204');
    const body = { santriId: s.santriId, period: '2027-04', title: 'Uang gedung', amount: 1500000, dueDate: '2027-04-10' };
    expect((await api().post('/billing/invoices').set(as('bendahara')).send(body)).status).toBe(201);
    expect((await api().post('/billing/invoices').set(as('bendahara')).send(body)).body.code).toBe('INVOICE_EXISTS');
    expect((await api().post('/billing/invoices').set(as('kasir')).send(body)).status).toBe(403);
  });
  it('edit tagihan: ubah nominal/jatuh tempo/judul dengan alasan; tidak boleh di bawah yang sudah dibayar; status ikut menyesuaikan; tercatat di audit', async () => {
    const s = await mkSantri('S205');
    const inv = (await api().post('/billing/invoices').set(as('bendahara')).send({ santriId: s.santriId, period: '2027-05', title: 'SPP', amount: 300000, dueDate: '2027-05-10' })).body;
    await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv.id, amount: 100000, method: 'CASH', idempotencyKey: key() });
    expect((await api().patch(`/billing/invoices/${inv.id}`).set(as('bendahara')).send({ total: 350000 })).body.code).toBe('REASON_REQUIRED');
    expect((await api().patch(`/billing/invoices/${inv.id}`).set(as('bendahara')).send({ total: 50000, reason: 'koreksi' })).body.code).toBe('BELOW_PAID');
    const ok = await api().patch(`/billing/invoices/${inv.id}`).set(as('bendahara')).send({ total: 350000, dueDate: '2027-05-20', title: 'SPP Mei', reason: 'Kenaikan SPP' });
    expect(ok.status).toBe(200); expect(ok.body).toMatchObject({ total: 350000, status: 'PARTIAL' });
    expect((await pool.query('SELECT total, due_date::text, title FROM invoices WHERE id=$1', [inv.id])).rows[0]).toEqual({ total: 350000, due_date: '2027-05-20', title: 'SPP Mei' });
    const full = await api().patch(`/billing/invoices/${inv.id}`).set(as('bendahara')).send({ total: 100000, reason: 'Disesuaikan: sudah lunas' });
    expect(full.body.status).toBe('PAID');
    expect((await pool.query(`SELECT meta FROM audit_logs WHERE action='INVOICE_EDIT' AND entity_id=$1 ORDER BY id`, [inv.id])).rows[0].meta.before.total).toBe(300000);
    await api().post(`/billing/invoices/${(await api().post('/billing/invoices').set(as('bendahara')).send({ santriId: s.santriId, period: '2027-06', title: 'SPP', amount: 100000, dueDate: '2027-06-10' })).body.id}/cancel`).set(as('bendahara'));
    expect((await api().patch(`/billing/invoices/${inv.id}`).set(as('kasir')).send({ title: 'x1' })).status).toBe(403);
  });
});

describe('Peran Laundry (terpisah dari Kasir)', () => {
  let svc: string; let item: string;
  beforeAll(async () => {
    await mkUser('laundry1', 'LAUNDRY');
    svc = (await api().post('/products').set(as('admin')).send({ name: 'Cuci setrika', price: 6000, stock: 0, merchant: 'LAUNDRY' })).body.id;
    item = (await api().post('/products').set(as('admin')).send({ name: 'Roti kantin', price: 5000, stock: 10 })).body.id;
  });
  it('admin bisa membuat akun Laundry; layanan laundry tidak melacak stok', async () => {
    expect((await api().post('/users').set(as('admin')).send({ username: 'petugas.laundry', password: 'Password123', fullName: 'Petugas Laundry', role: 'LAUNDRY' })).status).toBe(201);
    expect((await pool.query('SELECT merchant, track_stock FROM products WHERE id=$1', [svc])).rows[0]).toEqual({ merchant: 'LAUNDRY', track_stock: false });
  });
  it('Laundry hanya melihat layanan laundry; Kasir hanya produk kantin', async () => {
    const l = await api().get('/products').set(as('laundry1')); const k = await api().get('/products').set(as('kasir'));
    expect(l.body.every((p: any) => p.merchant === 'LAUNDRY')).toBe(true); expect(l.body.some((p: any) => p.id === svc)).toBe(true);
    expect(k.body.every((p: any) => p.merchant === 'KANTIN')).toBe(true); expect(k.body.some((p: any) => p.id === svc)).toBe(false);
  });
  it('Laundry membayar dari kantong LAUNDRY saja; Kasir dari JAJAN saja; produk tidak bisa silang', async () => {
    const s = await mkSantri('L301', 100000);
    const wid = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: wid });
    const payL = (items: any[], k = key()) => api().post('/pos/pay').set(as('laundry1')).send({ barcode: s.barcode, pin: s.pin, idempotencyKey: k, items });
    expect((await payL([{ productId: svc, qty: 2 }])).body.code).toBe('INSUFFICIENT_BALANCE'); // kantong laundry masih 0
    await api().post(`/portal/children/${s.santriId}/transfer`).set(as('walsanA')).send({ from: 'JAJAN', to: 'LAUNDRY', amount: 30000, idempotencyKey: key() });
    const ok = await payL([{ productId: svc, qty: 2 }]);
    expect(ok.status).toBe(201); expect(ok.body.total).toBe(12000); expect(ok.body.balanceAfter).toBe(18000);
    expect(await balanceOf(s.santriId, 'LAUNDRY')).toBe(18000); expect(await balanceOf(s.santriId)).toBe(70000);
    expect((await payL([{ productId: item, qty: 1 }])).body.code).toBe('PRODUCT_NOT_FOUND');
    const viaKasir = await api().post('/pos/pay').set(as('kasir')).send({ barcode: s.barcode, pin: s.pin, idempotencyKey: key(), items: [{ productId: svc, qty: 1 }] });
    expect(viaKasir.body.code).toBe('PRODUCT_NOT_FOUND');
    const o = (await api().get(`/portal/children/${s.santriId}/orders`).set(as('walsanA'))).body.find((x: any) => x.total === 12000);
    expect(o.merchant).toBe('LAUNDRY');
    expect((await pool.query(`SELECT merchant FROM orders WHERE total=12000 AND santri_id=$1`, [s.santriId])).rows[0].merchant).toBe('LAUNDRY');
  });
  it('Laundry tidak bisa memakai fitur Kasir/Bendahara/Admin (kecuali mengelola layanannya sendiri, v0.8)', async () => {
    expect((await api().get('/santri').set(as('laundry1'))).status).toBe(403);
    expect((await api().post('/wallet/topup').set(as('laundry1')).send({ santriId: '00000000-0000-4000-8000-000000000000', amount: 5000, method: 'CASH_COUNTER', idempotencyKey: key() })).status).toBe(403);
  });
});

describe('Rekening terstruktur (bisa disalin wali)', () => {
  let walsanId: string;
  const settings = (b: any) => api().put('/topups/settings').set(as('admin')).send({ fee: 1500, min: 20000, max: 2000000, expiryHours: 48, tolerance: 5000, ...b });
  beforeAll(async () => {
    walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await pool.query(`UPDATE topup_requests SET status = 'CANCELLED' WHERE status IN ('PENDING','MATCHED')`);
    expect((await settings({ bankName: 'Bank Mandiri', bankAccount: '1290016605277', bankHolder: 'Pesantren Demo' })).status).toBe(200);
  });
  async function child(nis: string, topup = 0) {
    const s = await mkSantri(nis, topup);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    return s;
  }
  const bal = (id: string) => Promise.all(['JAJAN', 'LAUNDRY', 'SPP'].map((p) => balanceOf(id, p))).then(([j, l, sp]) => ({ JAJAN: j, LAUNDRY: l, SPP: sp }));

  it('rekening: tiap bagian tersimpan terpisah (bisa disalin), teks gabungan disusun otomatis, nomor hanya angka', async () => {
    const a = (await api().get('/topups/settings').set(as('admin'))).body;
    expect(a).toMatchObject({ bankName: 'Bank Mandiri', bankAccount: '1290016605277', bankHolder: 'Pesantren Demo' });
    expect(a.bankInfo).toContain('1290016605277'); expect(a.bankInfo).toContain('a.n. Pesantren Demo');
    const w = (await api().get('/portal/topup-info').set(as('walsanA'))).body;
    expect(w).toMatchObject({ bankName: 'Bank Mandiri', bankAccount: '1290016605277', bankHolder: 'Pesantren Demo' });
    expect((await settings({ bankName: 'X', bankAccount: '12ab34', bankHolder: 'Y' })).status).toBe(400);
    expect((await settings({ bankName: '', bankAccount: '', bankHolder: '', bankInfo: '' })).body.code).toBe('BANK_REQUIRED');
  });
});

describe('Identitas pesantren, ganti password, persetujuan wali', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  it('nama dan logo pesantren: hanya Admin yang mengubah; bacaan publik (tanpa login); file non-gambar ditolak', async () => {
    expect((await api().get('/public/school')).body).toEqual({ name: '', hasLogo: false });
    expect((await api().put('/settings/school').set(as('bendahara')).send({ name: 'X Y' })).status).toBe(403);
    expect((await api().put('/settings/school').set(as('admin')).send({ name: 'Pesantren Al-Hikmah' })).status).toBe(200);
    expect((await api().put('/settings/school/logo').set(as('admin')).attach('file', Buffer.from('bukan gambar'), { filename: 'l.png', contentType: 'image/png' })).body.code).toBe('BAD_FILE');
    expect((await api().put('/settings/school/logo').set(as('admin')).attach('file', PNG, { filename: 'l.png', contentType: 'image/png' })).status).toBe(200);
    expect((await api().get('/public/school')).body).toEqual({ name: 'Pesantren Al-Hikmah', hasLogo: true });
    const img = await api().get('/public/school/logo').buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(img.status).toBe(200); expect(img.headers['content-type']).toBe('image/png'); expect(Buffer.compare(img.body, PNG)).toBe(0);
    expect((await api().delete('/settings/school/logo').set(as('admin'))).status).toBe(200);
    expect((await api().get('/public/school/logo')).status).toBe(404);
  });
  it('ganti password: password lama wajib benar, minimal 8 karakter, sesi lama dicabut, password lama tidak berlaku', async () => {
    await mkUser('gantipw', 'KASIR');
    const l = await api().post('/auth/login').send({ username: 'gantipw', password: 'Password123' });
    expect((await api().post('/auth/change-password').set('Authorization', `Bearer ${l.body.accessToken}`).send({ currentPassword: 'salah', newPassword: 'PasswordBaru1' })).body.code).toBe('PASSWORD_WRONG');
    expect((await api().post('/auth/change-password').set('Authorization', `Bearer ${l.body.accessToken}`).send({ currentPassword: 'Password123', newPassword: 'pendek' })).status).toBe(400);
    expect((await api().post('/auth/change-password').set('Authorization', `Bearer ${l.body.accessToken}`).send({ currentPassword: 'Password123', newPassword: 'Password123' })).body.code).toBe('PASSWORD_SAME');
    expect((await api().post('/auth/change-password').set('Authorization', `Bearer ${l.body.accessToken}`).send({ currentPassword: 'Password123', newPassword: 'PasswordBaru1' })).status).toBe(201);
    expect((await api().post('/auth/refresh').send({ refreshToken: l.body.refreshToken })).status).toBe(401);
    expect((await api().post('/auth/login').send({ username: 'gantipw', password: 'Password123' })).status).toBe(401);
    expect((await api().post('/auth/login').send({ username: 'gantipw', password: 'PasswordBaru1' })).status).toBe(201);
    expect((await api().post('/auth/change-password').send({ currentPassword: 'a', newPassword: 'PasswordBaru1' })).status).toBe(401);
  });
  it('persetujuan wali tercatat (versi + waktu); hanya wali yang bisa', async () => {
    expect((await api().get('/auth/me').set(as('walsanB'))).body.consentAt).toBeNull();
    expect((await api().post('/portal/consent').set(as('walsanB')).send({ version: 'v1-draft' })).status).toBe(201);
    const me = (await api().get('/auth/me').set(as('walsanB'))).body;
    expect(me.consentAt).toBeTruthy(); expect(me.consentVersion).toBe('v1-draft');
    expect((await api().post('/portal/consent').set(as('kasir')).send({ version: 'v1' })).status).toBe(403);
  });
});

describe('Pemberitahuan untuk wali', () => {
  let walsanId: string, otherId: string;
  const feed = async (who: string) => (await api().get('/notifications').set(as(who))).body;
  beforeAll(async () => {
    walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    otherId = (await pool.query(`SELECT id FROM users WHERE username='walsanB'`)).rows[0].id;
    await pool.query('DELETE FROM notifications');
  });
  it('belanja → wali anak itu diberi tahu (dan hanya dia); tanpa notifikasi untuk permintaan duplikat', async () => {
    const s = await mkSantri('N001', 50000);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    const k = key();
    await pay(s, 12000, k); await pay(s, 12000, k);
    const a = await feed('walsanA'); const b = await feed('walsanB');
    const n = a.items.filter((x: any) => x.title === 'Anak belanja');
    expect(n).toHaveLength(1); expect(n[0].body).toContain('Rp12.000'); expect(n[0].body).toContain('Santri N001');
    expect(b.items.some((x: any) => x.title === 'Anak belanja')).toBe(false);
    expect(a.unread).toBeGreaterThanOrEqual(1);
    expect((await api().post('/notifications/read-all').set(as('walsanA'))).status).toBe(201);
    expect((await feed('walsanA')).unread).toBe(0);
  });
  it('isi saldo disetujui, tagihan baru (satu dan massal), kartu terkunci/dinonaktifkan → pemberitahuan', async () => {
    const s = await mkSantri('N002', 0);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    await api().put('/topups/settings').set(as('admin')).send({ fee: 0, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank X 1 a.n. P' });
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 30000 })).body;
    await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({ note: 'bukti manual tes' });
    await api().post('/billing/invoices').set(as('bendahara')).send({ santriId: s.santriId, period: '2027-09', title: 'Seragam', amount: 150000, dueDate: '2027-09-10' });
    await pool.query(`UPDATE santri SET status='INACTIVE'`); await pool.query(`UPDATE santri SET status='ACTIVE' WHERE id=$1`, [s.santriId]);
    await api().post('/billing/generate').set(as('bendahara')).send({ period: '2027-10', title: 'SPP', amount: 200000, dueDate: '2027-10-10' });
    await api().post(`/cards/${s.cardId}/suspend`).set(as('admin')).send({ reason: 'tes' });
    await api().post(`/cards/${s.cardId}/unsuspend`).set(as('admin'));
    for (let i = 0; i < 3; i++) await pay(s, 1000, key(), '000999');
    const titles = (await feed('walsanA')).items.map((x: any) => x.title);
    for (const t of ['Isi saldo berhasil', 'Tagihan baru', 'Kartu dinonaktifkan sementara', 'Kartu terkunci']) expect(titles).toContain(t);
    expect(titles.filter((t: string) => t === 'Tagihan baru')).toHaveLength(2);
    expect((await feed('walsanB')).items.length).toBe(0);
  });
  it('pengguna hanya bisa membaca/menandai pemberitahuan miliknya; wali nonaktif tidak diberi tahu', async () => {
    const mine = (await feed('walsanA')).items[0];
    expect((await api().post(`/notifications/${mine.id}/read`).set(as('walsanB'))).status).toBe(201);
    expect((await pool.query('SELECT read_at FROM notifications WHERE id=$1', [mine.id])).rows[0].read_at).toBeNull();
    expect((await api().get('/notifications')).status).toBe(401);
  });
});

describe('Edit santri, naik kelas, lulus, dan kartu massal', () => {
  it('edit nama/NIS/kelas; NIS ganda ditolak; hanya Admin', async () => {
    const a = await mkSantri('E001'); const b = await mkSantri('E002');
    expect((await api().patch(`/santri/${a.santriId}`).set(as('admin')).send({ fullName: 'Nama Baru', kelas: '8B', nis: 'E001X' })).status).toBe(200);
    const d = (await api().get(`/santri/${a.santriId}`).set(as('admin'))).body; expect(d).toMatchObject({ fullName: 'Nama Baru', kelas: '8B', nis: 'E001X' });
    expect((await api().patch(`/santri/${b.santriId}`).set(as('admin')).send({ nis: 'E001X' })).body.code).toBe('NIS_TAKEN');
    expect((await api().patch(`/santri/${a.santriId}`).set(as('bendahara')).send({ fullName: 'x1' })).status).toBe(403);
  });
  it('naik kelas massal hanya untuk santri aktif; lulus membuat kartu tidak bisa dipakai tetapi saldo tetap', async () => {
    const a = await mkSantri('E011', 20000); const b = await mkSantri('E012', 20000);
    await pool.query(`UPDATE santri SET kelas='K7' WHERE id = ANY($1)`, [[a.santriId, b.santriId]]); await pool.query(`UPDATE santri SET status='INACTIVE' WHERE id=$1`, [b.santriId]);
    expect((await api().post('/santri/promote').set(as('admin')).send({ fromKelas: 'K7', toKelas: 'K8' })).body.moved).toBe(1);
    expect((await pool.query('SELECT kelas FROM santri WHERE id=$1', [a.santriId])).rows[0].kelas).toBe('K8'); expect((await pool.query('SELECT kelas FROM santri WHERE id=$1', [b.santriId])).rows[0].kelas).toBe('K7');
    expect((await api().post('/santri/graduate').set(as('admin')).send({ kelas: 'K8' })).body.graduated).toBe(1);
    expect((await pay(a, 5000)).body.code).toBe('SANTRI_INACTIVE'); expect(await balanceOf(a.santriId)).toBe(20000);
    expect((await api().post('/santri/promote').set(as('kasir')).send({ fromKelas: 'a', toKelas: 'b' })).status).toBe(403);
  });
  it('kartu massal per kelas: hanya santri aktif tanpa kartu; token/PIN unik; tidak menerbitkan dua kali; wajib pilih target', async () => {
    for (const [i, n] of ['M1', 'M2', 'M3'].entries()) await api().post('/santri').set(as('admin')).send({ nis: `BK${i}`, fullName: `Santri ${n}`, kelas: 'KB' });
    const have = (await pool.query(`SELECT id FROM santri WHERE nis='BK0'`)).rows[0].id;
    await api().post('/cards/issue').set(as('admin')).send({ santriId: have });
    const r = await api().post('/cards/issue-bulk').set(as('admin')).send({ kelas: 'KB' });
    expect(r.status).toBe(201); expect(r.body.issued).toHaveLength(2);
    expect(new Set(r.body.issued.map((x: any) => x.barcodeToken)).size).toBe(2); expect(r.body.issued.every((x: any) => /^\d{6}$/.test(x.initialPin) && x.publicNumber.startsWith('EQA-'))).toBe(true);
    expect((await api().post('/cards/issue-bulk').set(as('admin')).send({ kelas: 'KB' })).body.issued).toHaveLength(0);
    expect((await api().post('/cards/issue-bulk').set(as('admin')).send({})).body.code).toBe('TARGET_REQUIRED');
    expect((await api().post('/cards/issue-bulk').set(as('kasir')).send({ kelas: 'KB' })).status).toBe(403);
    const t = r.body.issued[0];
    expect((await pay({ barcode: t.barcodeToken, pin: t.initialPin }, 1000)).body.code).toBe('PIN_MUST_CHANGE');
    expect((await pool.query(`SELECT count(*)::int n FROM cards WHERE status='ACTIVE' AND santri_id = ANY((SELECT array_agg(id) FROM santri WHERE kelas='KB')::uuid[])`)).rows[0].n).toBe(3);
  });
});

describe('Dashboard "perlu tindakan", daftar transaksi + refund, dan laporan Excel (CSV)', () => {
  it('todo dan trend 7 hari tersedia untuk Admin/Bendahara; tidak untuk Kasir/Wali', async () => {
    const t = (await api().get('/reports/todo').set(as('bendahara'))).body;
    for (const k of ['topupMatched', 'topupPending', 'topupPendingWithProof', 'overdueCount', 'overdueTotal', 'cardsLocked', 'cardsSuspended', 'lowStock']) expect(typeof t[k]).toBe('number');
    const tr = (await api().get('/reports/trend').set(as('admin'))).body; expect(tr).toHaveLength(7); expect(tr[0]).toHaveProperty('sales');
    for (const who of ['kasir', 'walsanA']) expect((await api().get('/reports/todo').set(as(who))).status).toBe(403);
  });
  it('daftar transaksi bisa dicari, memuat item, dan bendahara bisa me-refund dari daftar tersebut', async () => {
    const s = await mkSantri('R901', 30000); const o = await pay(s, 9000);
    const list = (await api().get('/reports/orders').set(as('bendahara')).query({ q: 'R901' })).body;
    const row = list.find((x: any) => x.id === o.body.orderId); expect(row).toMatchObject({ total: 9000, refunded: false, merchant: 'KANTIN', nis: 'R901' });
    expect((await api().post('/wallet/refund').set(as('bendahara')).send({ orderId: row.id, reason: 'salah input' })).status).toBe(201);
    expect((await api().get('/reports/orders').set(as('bendahara')).query({ q: 'R901' })).body.find((x: any) => x.id === row.id).refunded).toBe(true);
    expect(await balanceOf(s.santriId)).toBe(30000);
    expect((await api().get('/reports/orders').set(as('kasir'))).status).toBe(403);
  });
  it('penjualan per hari/jenis tidak menghitung yang di-refund; tunggakan, rekap top up, dan saldo tersedia sebagai CSV yang terbaca Excel', async () => {
    const sales = (await api().get('/reports/sales').set(as('bendahara'))).body;
    expect(sales.length).toBeGreaterThan(0); expect(sales[0]).toHaveProperty('merchant');
    const c = await api().get('/reports/sales.csv').set(as('bendahara'));
    expect(c.status).toBe(200); expect(c.headers['content-type']).toContain('text/csv'); expect(c.text.startsWith('\ufeffTanggal;Jenis;Jumlah transaksi;Total (Rp)')).toBe(true);
    const s = await mkSantri('R902'); await api().post('/billing/invoices').set(as('bendahara')).send({ santriId: s.santriId, period: '2020-01', title: 'SPP Lama', amount: 100000, dueDate: '2020-01-10' });
    const ar = (await api().get('/reports/arrears').set(as('bendahara'))).body.find((x: any) => x.nis === 'R902');
    expect(ar).toMatchObject({ remaining: 100000, title: 'SPP Lama' }); expect(ar.daysLate).toBeGreaterThan(100);
    expect((await api().get('/reports/arrears.csv').set(as('bendahara'))).text).toContain('R902');
    expect((await api().get('/reports/topups.csv').set(as('bendahara'))).text).toContain('Uang masuk ke santri');
    const bal = await api().get('/reports/balances.csv').set(as('admin')); expect(bal.text).toContain('Uang jajan (Rp)'); expect(bal.text).toContain('R901');
    for (const path of ['sales.csv', 'arrears.csv', 'topups.csv', 'balances.csv']) expect((await api().get(`/reports/${path}`).set(as('kasir'))).status).toBe(403);
  });
});

describe('Pemberitahuan "Ada yang bayar" untuk staf', () => {
  const feed = async (who: string) => (await api().get('/notifications').set(as(who))).body;
  let walsanId: string;
  beforeAll(async () => {
    walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await pool.query('DELETE FROM notifications');
    await api().put('/topups/settings').set(as('admin')).send({ fee: 0, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank X 1 a.n. P' });
  });
  it('wali kirim bukti transfer → admin & bendahara dapat kind PAYMENT; kasir dan wali tidak', async () => {
    const s = await mkSantri('BYR01', 30000);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 40000 })).body;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bukti-staf-1')]);
    const u = await api().post(`/portal/topups/${r.id}/proof`).set(as('walsanA')).attach('file', png, { filename: 'b.png', contentType: 'image/png' }).field('ocrAmounts', '[]');
    expect(u.status).toBe(201);
    for (const who of ['admin', 'bendahara']) {
      const n = (await feed(who)).items.filter((x: any) => x.title === 'Ada yang bayar');
      expect(n).toHaveLength(1); expect(n[0].kind).toBe('PAYMENT'); expect(n[0].body).toContain('Santri BYR01');
    }
    expect((await feed('kasir')).items.some((x: any) => x.title === 'Ada yang bayar')).toBe(false);
    expect((await feed('walsanA')).items.some((x: any) => x.title === 'Ada yang bayar')).toBe(false);
  });
  it('notifikasi biasa tetap kind INFO', async () => {
    const s = (await pool.query(`SELECT s.id FROM santri s WHERE nis='BYR01'`)).rows[0];
    const row = (await pool.query(`SELECT barcode_hash FROM cards WHERE santri_id=$1`, [s.id])).rows[0];
    expect(row).toBeTruthy();
    await pool.query(`INSERT INTO notifications(user_id, title, body) VALUES ($1,'Info biasa','x')`, [walsanId]);
    const items = (await feed('walsanA')).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((x: any) => x.kind === 'INFO')).toBe(true);
  });
});


// ====================== v0.8 ======================
const { clock } = require('../src/common/clock');
const realNow = clock.now;
const at = (iso: string) => { clock.now = () => new Date(iso); };   // contoh: at('2026-11-16T07:30:00+07:00') = Senin 07.30 WIB
const MON = '2026-11-16';

describe('Absen guru (scan kartu santri, tanpa PIN)', () => {
  let guruA: string; let schedId: string; let a1: any; let a2: any; let other: any; let wrong: any;
  const scan = (who: string, barcode: string, extra: Record<string, unknown> = {}) =>
    api().post('/attendance/scan').set(as(who)).send({ scheduleId: schedId, barcode, operatorName: 'Ust. Ahmad', ...extra });
  beforeAll(async () => {
    guruA = await mkUser('guruA', 'GURU'); await mkUser('guruB', 'GURU');
    a1 = await mkSantri('ABS01'); a2 = await mkSantri('ABS02'); other = await mkSantri('ABS03'); wrong = await mkSantri('ABS04');
    await pool.query(`UPDATE santri SET kelas='8B' WHERE id=$1`, [wrong.santriId]);
    const r = await api().post('/attendance/schedules').set(as('admin')).send({ subject: 'Fiqih', kelas: '7A', teacherId: guruA, days: [1, 2], startTime: '07:30', endTime: '08:30' });
    expect(r.status).toBe(201); expect(r.body.created).toBe(2);
    schedId = (await pool.query(`SELECT id FROM class_schedules WHERE subject='Fiqih' AND day_of_week=1`)).rows[0].id;
  });
  afterAll(() => { clock.now = realNow; });

  it('hanya Admin yang mengatur jadwal; jam harus masuk akal', async () => {
    expect((await api().post('/attendance/schedules').set(as('guruA')).send({ subject: 'X', days: [1], startTime: '07:00', endTime: '08:00' })).status).toBe(403);
    expect((await api().get('/attendance/schedules').set(as('kasir'))).status).toBe(403);
    expect((await api().post('/attendance/schedules').set(as('admin')).send({ subject: 'Salah', days: [1], startTime: '09:00', endTime: '08:00' })).body.code).toBe('BAD_TIME');
    expect((await api().post('/attendance/schedules').set(as('admin')).send({ subject: 'Salah', days: [9], startTime: '07:00', endTime: '08:00' })).status).toBe(400);
    const list = await api().get('/attendance/schedules').set(as('admin'));
    expect(list.body.filter((x: any) => x.subject === 'Fiqih')).toHaveLength(2);
  });
  it('guru hanya melihat jadwal hari ini miliknya; kasir/walsan tidak bisa', async () => {
    at(`${MON}T07:35:00+07:00`);
    const mine = (await api().get('/attendance/my-today').set(as('guruA'))).body;
    expect(mine.dayName).toBe('Senin'); expect(mine.items).toHaveLength(1); expect(mine.items[0]).toMatchObject({ subject: 'Fiqih', startTime: '07:30', endTime: '08:30', state: 'NOW' });
    expect((await api().get('/attendance/my-today').set(as('guruB'))).body.items).toHaveLength(0);
    expect((await api().get('/attendance/my-today').set(as('kasir'))).status).toBe(403);
    expect((await api().get('/attendance/my-today').set(as('walsanA'))).status).toBe(403);
  });
  it('scan di dalam jam = HADIR; scan ganda tidak dihitung dua kali; nama pemakai akun tercatat', async () => {
    at(`${MON}T07:35:00+07:00`);
    const r = await scan('guruA', a1.barcode);
    expect(r.status).toBe(201); expect(r.body).toMatchObject({ duplicate: false, status: 'HADIR', time: '07:35', santriName: 'Santri ABS01' });
    const again = await scan('guruA', a1.barcode, { operatorName: 'Ust. Budi' });
    expect(again.body).toMatchObject({ duplicate: true, status: 'HADIR', time: '07:35' });
    const rows = (await pool.query(`SELECT operator_name, recorded_by FROM attendance WHERE santri_id=$1`, [a1.santriId])).rows;
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ operator_name: 'Ust. Ahmad', recorded_by: guruA });
    expect((await api().get('/attendance/operators').set(as('guruA'))).body).toContain('Ust. Ahmad');
  });
  it('terlambat bila lewat batas (10 menit, bisa diubah Admin)', async () => {
    at(`${MON}T07:45:00+07:00`);
    expect((await scan('guruA', a2.barcode)).body.status).toBe('TERLAMBAT');
    expect((await api().put('/attendance/settings').set(as('admin')).send({ lateMinutes: 30 })).status).toBe(200);
    at(`${MON}T08:00:00+07:00`);
    expect((await scan('guruA', other.barcode)).body.status).toBe('HADIR');
    await api().put('/attendance/settings').set(as('admin')).send({ lateMinutes: 10 });
    await pool.query('DELETE FROM attendance WHERE santri_id=$1', [other.santriId]);
  });
  it('scan di luar jam / hari lain / jadwal nonaktif ditolak', async () => {
    at(`${MON}T09:00:00+07:00`); expect((await scan('guruA', other.barcode)).body.code).toBe('ALREADY_ENDED');
    at(`${MON}T07:00:00+07:00`); expect((await scan('guruA', other.barcode)).body.code).toBe('NOT_STARTED');
    at('2026-11-18T07:45:00+07:00'); expect((await scan('guruA', other.barcode)).body.code).toBe('WRONG_DAY');
    at(`${MON}T07:20:00+07:00`); expect((await scan('guruA', other.barcode)).status).toBe(201); // 10 menit sebelum mulai masih boleh
    await pool.query('DELETE FROM attendance WHERE santri_id=$1', [other.santriId]);
  });
  it('kartu tak dikenal, kelas salah, akun guru lain, dan nama kosong ditolak', async () => {
    at(`${MON}T07:40:00+07:00`);
    expect((await scan('guruA', 'ZZZZZZZZZZZZZZZZ')).body.code).toBe('CARD_UNKNOWN');
    expect((await scan('guruA', wrong.barcode)).body.code).toBe('WRONG_CLASS');
    expect((await scan('guruB', other.barcode)).status).toBe(403);
    expect((await scan('guruA', other.barcode, { operatorName: '' })).status).toBe(400);
    expect((await scan('kasir', other.barcode)).status).toBe(403);
  });
  it('kartu yang sudah diganti tidak bisa dipakai absen', async () => {
    at(`${MON}T07:40:00+07:00`);
    const s = await mkSantri('ABS05');
    await api().post(`/cards/${s.cardId}/replace`).set(as('admin')).send({ reason: 'hilang' });
    expect((await scan('guruA', s.barcode)).body.code).toBe('CARD_REPLACED');
  });
  it('daftar hari ini menunjukkan yang hadir dan yang belum hadir (jadwal ber-kelas)', async () => {
    at(`${MON}T08:10:00+07:00`);
    const t = (await api().get(`/attendance/schedules/${schedId}/today`).set(as('guruA'))).body;
    const present = t.present.map((p: any) => p.nis);
    expect(present).toEqual(expect.arrayContaining(['ABS01', 'ABS02'])); expect(t.absent.map((x: any) => x.nis)).not.toContain('ABS01');
    expect(t.absent.map((x: any) => x.nis)).toContain('ABS03'); expect(t.absent.map((x: any) => x.nis)).not.toContain('ABS04'); // ABS04 kelas 8B
    expect((await api().get(`/attendance/schedules/${schedId}/today`).set(as('guruB'))).status).toBe(403);
  });
  it('salah scan bisa dibatalkan (hanya hari ini, oleh pemilik jadwal) dan tercatat di audit', async () => {
    at(`${MON}T08:10:00+07:00`);
    const id = (await pool.query(`SELECT id FROM attendance WHERE santri_id=$1`, [a2.santriId])).rows[0].id;
    expect((await api().delete(`/attendance/${id}`).set(as('guruB'))).status).toBe(403);
    at('2026-11-17T08:10:00+07:00'); expect((await api().delete(`/attendance/${id}`).set(as('guruA'))).body.code).toBe('NOT_TODAY');
    at(`${MON}T08:10:00+07:00`); expect((await api().delete(`/attendance/${id}`).set(as('guruA'))).status).toBe(200);
    expect((await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE santri_id=$1`, [a2.santriId])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='ATTENDANCE_REMOVE'`)).rows[0].n).toBe(1);
  });
  it('laporan Admin + CSV, dan jadwal nonaktif tidak bisa dipakai', async () => {
    at(`${MON}T08:10:00+07:00`);
    await scan('guruA', a2.barcode); // hadir ulang (terlambat)
    const rep = await api().get('/attendance/report').set(as('admin')).query({ from: MON, to: MON });
    expect(rep.body.map((x: any) => x.nis)).toEqual(expect.arrayContaining(['ABS01', 'ABS02']));
    const csv = await api().get('/attendance/report.csv').set(as('admin')).query({ from: MON, to: MON });
    expect(csv.text).toContain('Fiqih'); expect(csv.text).toContain('Terlambat'); expect(csv.text).toContain('Ust. Ahmad');
    expect((await api().get('/attendance/report').set(as('guruA'))).status).toBe(403);
    await api().patch(`/attendance/schedules/${schedId}`).set(as('admin')).send({ isActive: false });
    expect((await scan('guruA', other.barcode)).body.code).toBe('SCHEDULE_INACTIVE');
    // jadwal tanpa guru tertentu boleh dipakai semua akun Guru
    await api().patch(`/attendance/schedules/${schedId}`).set(as('admin')).send({ isActive: true, teacherId: '' });
    expect((await scan('guruB', other.barcode, { operatorName: 'Ust. Cahya' })).status).toBe(201);
  });
});

describe('Kasir/Laundry: tambah barang sendiri + rekap harian', () => {
  let lId: string; let pid: string; let lpid: string; let s: any; let orderId: string;
  beforeAll(async () => { lId = await mkUser('laundry2', 'LAUNDRY'); s = await mkSantri('RKP01', 100000); await pool.query(`UPDATE wallets SET balance = balance + 50000 WHERE santri_id=$1 AND pocket='LAUNDRY'`, [s.santriId]); });
  it('kasir menambah barang kantin; laundry menambah layanan laundry; saling tidak bisa mengubah', async () => {
    const k = await api().post('/products').set(as('kasir')).send({ name: 'Roti Coklat', price: 3000, stock: 10 });
    expect(k.status).toBe(201); expect(k.body.merchant).toBe('KANTIN'); pid = k.body.id;
    const l = await api().post('/products').set(as('laundry2')).send({ name: 'Cuci Setrika Kilo', price: 7000, stock: 5, merchant: 'KANTIN' });
    expect(l.status).toBe(201); expect(l.body.merchant).toBe('LAUNDRY'); expect(l.body.stock).toBe(0); lpid = l.body.id; // peran menentukan jenis, bukan isian
    expect((await api().patch(`/products/${lpid}`).set(as('kasir')).send({ price: 1000 })).status).toBe(404);
    expect((await api().patch(`/products/${pid}`).set(as('laundry2')).send({ price: 9999 })).status).toBe(404);
    expect((await api().get('/products').set(as('kasir'))).body.map((p: any) => p.name)).toContain('Roti Coklat');
    expect((await api().get('/products').set(as('laundry2'))).body.map((p: any) => p.name)).not.toContain('Roti Coklat');
    for (const who of ['walsanA', 'guruA']) expect((await api().post('/products').set(as(who)).send({ name: 'x1', price: 1000, stock: 1 })).status).toBe(403);
  });
  it('perubahan harga oleh kasir tercatat (nilai lama & baru) dan barang bisa disembunyikan', async () => {
    expect((await api().patch(`/products/${pid}`).set(as('kasir')).send({ price: 3500 })).status).toBe(200);
    const a = (await pool.query(`SELECT meta FROM audit_logs WHERE action='PRODUCT_UPDATE' AND entity_id=$1`, [pid])).rows[0].meta;
    expect(a.before.price).toBe(3000); expect(a.after.price).toBe(3500);
    expect((await api().post('/products').set(as('kasir')).send({ name: 'Murah', price: 5, stock: 1 })).status).toBe(400); // harga minimal Rp100
  });
  it('rekap harian kantin: total, per barang, refund tidak dihitung, tidak tercampur laundry', async () => {
    const base = (await api().get('/pos/daily').set(as('kasir'))).body;          // tes lain juga membuat transaksi hari ini
    const baseL = (await api().get('/pos/daily').set(as('laundry2'))).body;
    const ok = await api().post('/pos/pay').set(as('kasir')).send({ barcode: s.barcode, pin: s.pin, idempotencyKey: key(), items: [{ productId: pid, qty: 2 }] });
    expect(ok.status).toBe(201); orderId = ok.body.orderId;
    const ok2 = await api().post('/pos/pay').set(as('kasir')).send({ barcode: s.barcode, pin: s.pin, idempotencyKey: key(), items: [{ productId: pid, qty: 1 }] });
    expect(ok2.status).toBe(201);
    const lp = await api().post('/pos/pay').set(as('laundry2')).send({ barcode: s.barcode, pin: s.pin, idempotencyKey: key(), items: [{ productId: lpid, qty: 1 }] });
    expect(lp.status).toBe(201);
    const d = (await api().get('/pos/daily').set(as('kasir'))).body;
    expect(d.merchant).toBe('KANTIN'); expect(d.count - base.count).toBe(2); expect(d.total - base.total).toBe(10500);
    expect(d.byItem.find((i: any) => i.name === 'Roti Coklat')).toEqual({ name: 'Roti Coklat', qty: 3, total: 10500 });
    expect(d.orders.find((o: any) => o.id === ok.body.orderId)).toMatchObject({ santriName: 'Santri RKP01', nis: 'RKP01', total: 7000, refunded: false });
    expect(d.orders.some((o: any) => o.id === lp.body.orderId)).toBe(false);   // laundry tidak masuk rekap kantin
    const dl = (await api().get('/pos/daily').set(as('laundry2'))).body;
    expect(dl.merchant).toBe('LAUNDRY'); expect(dl.count - baseL.count).toBe(1); expect(dl.total - baseL.total).toBe(7000);
    expect((await api().post('/wallet/refund').set(as('bendahara')).send({ orderId, reason: 'salah pesan' })).status).toBe(201);
    const d2 = (await api().get('/pos/daily').set(as('kasir'))).body;
    expect(d2.count - base.count).toBe(1); expect(d2.total - base.total).toBe(3500);
    expect(d2.refundedCount - base.refundedCount).toBe(1); expect(d2.refundedTotal - base.refundedTotal).toBe(7000);
    expect(d2.byItem.find((i: any) => i.name === 'Roti Coklat')).toEqual({ name: 'Roti Coklat', qty: 1, total: 3500 });
    expect(d2.orders.find((o: any) => o.id === orderId).refunded).toBe(true);
  });
  it('unduh CSV rekap + tanggal lain kosong + peran lain ditolak; admin boleh memilih jenis', async () => {
    const csv = await api().get('/pos/daily.csv').set(as('kasir'));
    const d = (await api().get('/pos/daily').set(as('kasir'))).body;
    expect(csv.status).toBe(200); expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.headers['content-disposition']).toContain('rekap-kantin-');
    expect(csv.text).toContain('Roti Coklat x2'); expect(csv.text).toContain('Dikembalikan'); expect(csv.text).toContain('REKAP PER BARANG');
    expect(csv.text).toContain(`TOTAL PENJUALAN;${d.count} transaksi;${d.total}`);
    expect((await api().get('/pos/daily').set(as('kasir')).query({ date: '2020-01-01' })).body).toMatchObject({ count: 0, total: 0, orders: [] });
    expect((await api().get('/pos/daily').set(as('admin')).query({ merchant: 'LAUNDRY' })).body.merchant).toBe('LAUNDRY');
    for (const who of ['walsanA', 'guruA']) expect((await api().get('/pos/daily').set(as(who))).status).toBe(403);
  });
});

describe('Pengingat tunggakan lewat WhatsApp', () => {
  let s1: any; let s2: any; let w1: string; let w2: string; let inv1: string;
  const prep = async (body: any = {}) => (await api().post('/reminders/prepare').set(as('bendahara')).send(body)).body;
  beforeAll(async () => {
    s1 = await mkSantri('WA001'); s2 = await mkSantri('WA002');
    w1 = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    w2 = (await pool.query(`SELECT id FROM users WHERE username='walsanB'`)).rows[0].id;
    await api().post(`/santri/${s1.santriId}/walsan`).set(as('admin')).send({ userId: w1 });
    await api().post(`/santri/${s2.santriId}/walsan`).set(as('admin')).send({ userId: w2 });
    const mk = (id: string, title: string, amount: number, due: string) => api().post('/billing/invoices').set(as('bendahara')).send({ santriId: id, period: '2026-09', title, amount, dueDate: due });
    inv1 = (await mk(s1.santriId, 'SPP', 600000, '2026-09-10')).body.id;
    await mk(s1.santriId, 'Uang Gedung', 400000, '2026-09-20');
    await mk(s2.santriId, 'SPP', 500000, '2026-09-10');
    await mk(s2.santriId, 'Seragam', 100000, '2099-01-01'); // belum jatuh tempo: tidak ikut
  });
  it('nomor HP wali bisa diisi/diubah Admin dan divalidasi', async () => {
    expect((await api().patch(`/users/${w1}`).set(as('admin')).send({ phone: 'abc' })).body.code).toBe('PHONE_INVALID');
    expect((await api().patch(`/users/${w1}`).set(as('admin')).send({ phone: '0812-3456-7890' })).status).toBe(200);
    expect((await api().get('/users').set(as('admin'))).body.find((u: any) => u.id === w1).phone).toBe('0812-3456-7890');
    expect((await api().patch(`/users/${w1}`).set(as('kasir')).send({ phone: '0812' })).status).toBe(403);
  });
  it('satu pesan per santri merangkum semua tunggakan; tautan wa.me berisi pesan; yang belum jatuh tempo tidak ikut', async () => {
    const r = await prep({ santriIds: [s1.santriId] });
    expect(r.items).toHaveLength(1);
    const it = r.items[0];
    expect(it).toMatchObject({ santriName: 'Santri WA001', phone: '6281234567890', hasPhone: true, total: 1000000, reminded: false });
    expect(it.invoiceIds).toHaveLength(2);
    expect(it.message).toContain('walsanA'); expect(it.message).toContain('Santri WA001'); expect(it.message).toContain('Rp600.000'); expect(it.message).toContain('Rp1.000.000'); expect(it.message).toContain('Uang Gedung');
    expect(it.waUrl).toBe(`https://wa.me/6281234567890?text=${encodeURIComponent(it.message)}`);
  });
  it('wali tanpa nomor HP ditandai dan tidak punya tautan', async () => {
    const it = (await prep({ santriIds: [s2.santriId] })).items[0];
    expect(it).toMatchObject({ hasPhone: false, waUrl: null, phone: null }); expect(it.total).toBe(500000);
    expect((await prep()).withoutPhone).toBeGreaterThanOrEqual(1);
  });
  it('template bisa diatur; penanda tak dikenal dibiarkan; Kasir tidak boleh', async () => {
    expect((await api().get('/reminders/template').set(as('kasir'))).status).toBe(403);
    expect((await api().put('/reminders/template').set(as('bendahara')).send({ template: 'pendek' })).status).toBe(400);
    expect((await api().put('/reminders/template').set(as('bendahara')).send({ template: 'Yth {nama_wali}, {nama_santri} menunggak {sisa} per {jatuh_tempo} {xyz}' })).status).toBe(200);
    expect((await prep({ santriIds: [s1.santriId] })).items[0].message).toBe('Yth walsanA, Santri WA001 menunggak Rp1.000.000 per 10/09/2026 {xyz}');
    const g = (await api().get('/reminders/template').set(as('admin'))).body; expect(g.template).toContain('{xyz}'); expect(g.defaultTemplate).toContain('{tagihan}');
    await api().put('/reminders/template').set(as('bendahara')).send({ template: g.defaultTemplate });
  });
  it('ditandai "sudah diingatkan": titik merah hilang di daftar tagihan, dan hanya muncul lagi untuk yang baru', async () => {
    const before = (await api().get('/billing/invoices').set(as('bendahara')).query({ santriId: s1.santriId, status: 'OVERDUE' })).body;
    expect(before).toHaveLength(2); expect(before.every((i: any) => i.lastRemindedAt === null)).toBe(true);
    const it = (await prep({ santriIds: [s1.santriId] })).items[0];
    expect((await api().post('/reminders/mark').set(as('bendahara')).send({ santriId: s1.santriId, invoiceIds: it.invoiceIds })).body).toMatchObject({ ok: true, marked: 2 });
    const after = (await api().get('/billing/invoices').set(as('bendahara')).query({ santriId: s1.santriId, status: 'OVERDUE' })).body;
    expect(after.every((i: any) => i.lastRemindedAt)).toBe(true);
    expect((await prep({ santriIds: [s1.santriId] })).items[0]).toMatchObject({ reminded: true });
    expect((await prep({ onlyDue: true })).items.map((x: any) => x.nis)).not.toContain('WA001');
    expect((await prep({ onlyDue: true })).items.map((x: any) => x.nis)).toContain('WA002');
    expect((await pool.query(`SELECT total FROM reminder_log WHERE santri_id=$1`, [s1.santriId])).rows[0].total).toBe(1000000);
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='ARREARS_REMINDER'`)).rows[0].n).toBe(1);
  });
  it('tidak bisa menandai tagihan milik santri lain / yang sudah lunas; Kasir ditolak', async () => {
    const it2 = (await prep({ santriIds: [s2.santriId] })).items[0];
    expect((await api().post('/reminders/mark').set(as('bendahara')).send({ santriId: s1.santriId, invoiceIds: it2.invoiceIds })).body.code).toBe('NOTHING_TO_MARK');
    expect((await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv1, amount: 600000, method: 'CASH', idempotencyKey: key() })).status).toBe(201);
    expect((await prep({ santriIds: [s1.santriId] })).items[0].invoiceIds).toHaveLength(1); // SPP lunas tidak ikut lagi
    expect((await api().post('/reminders/prepare').set(as('kasir')).send({})).status).toBe(403);
    expect((await api().post('/reminders/mark').set(as('kasir')).send({ santriId: s1.santriId, invoiceIds: it2.invoiceIds })).status).toBe(403);
  });
});


describe('Pengingat ulang tunggakan (v0.8.1)', () => {
  let s1: any; let s2: any; let inv: string[] = [];
  const setLast = (id: string, daysAgo: number | null) => pool.query(`UPDATE invoices SET last_reminded_at = ${daysAgo === null ? 'NULL' : `now() - interval '${daysAgo} days'`}, alert_sent_at = NULL WHERE id = $1`, [id]);
  const state = async (id: string) => (await api().get('/billing/invoices').set(as('bendahara')).query({ santriId: (await pool.query('SELECT santri_id FROM invoices WHERE id=$1', [id])).rows[0].santri_id })).body.find((i: any) => i.id === id).remindState;
  const summary = async (who = 'bendahara') => (await api().get('/reminders/summary').set(as(who))).body;
  const alerts = async () => (await pool.query(`SELECT count(*)::int AS n FROM notifications n JOIN users u ON u.id=n.user_id WHERE n.title='Perlu diingatkan lagi' AND u.username='bendahara'`)).rows[0].n;
  beforeAll(async () => {
    await api().put('/reminders/settings').set(as('bendahara')).send({ repeatDays: 3 });
    s1 = await mkSantri('ULG01'); s2 = await mkSantri('ULG02');
    const mk = (id: string, due: string, title = 'SPP') => api().post('/billing/invoices').set(as('bendahara')).send({ santriId: id, period: '2026-08', title, amount: 300000, dueDate: due }).then((r) => r.body.id);
    inv = [await mk(s1.santriId, '2026-08-10'), await mk(s2.santriId, '2026-08-10'), await mk(s2.santriId, '2099-01-01', 'Seragam')];
    await pool.query(`UPDATE invoices SET alert_sent_at = now(), last_reminded_at = now() WHERE santri_id NOT IN ($1,$2) AND status IN ('UNPAID','PARTIAL')`, [s1.santriId, s2.santriId]); // tenangkan tagihan dari tes lain
  });
  it('pengaturan: hanya Admin/Bendahara, 0-60 hari', async () => {
    expect((await api().get('/reminders/settings').set(as('kasir'))).status).toBe(403);
    expect((await api().get('/reminders/settings').set(as('bendahara'))).body.repeatDays).toBe(3);
    expect((await api().put('/reminders/settings').set(as('admin')).send({ repeatDays: 61 })).status).toBe(400);
    expect((await api().put('/reminders/settings').set(as('admin')).send({ repeatDays: -1 })).status).toBe(400);
    expect((await api().put('/reminders/settings').set(as('admin')).send({ repeatDays: 3 })).status).toBe(200);
  });
  it('keadaan tagihan: belum diingatkan → NEVER; baru diingatkan → WAIT; lewat 3 hari → AGAIN; belum jatuh tempo/lunas → kosong', async () => {
    expect(await state(inv[0])).toBe('NEVER');
    await setLast(inv[0], 1); expect(await state(inv[0])).toBe('WAIT');
    await setLast(inv[0], 2); expect(await state(inv[0])).toBe('WAIT');
    await setLast(inv[0], 4); expect(await state(inv[0])).toBe('AGAIN');
    expect(await state(inv[2])).toBeNull();                                  // belum jatuh tempo
    await api().put('/reminders/settings').set(as('bendahara')).send({ repeatDays: 7 });
    expect(await state(inv[0])).toBe('WAIT');                                // batas hari bisa diubah
    await api().put('/reminders/settings').set(as('bendahara')).send({ repeatDays: 0 });
    await setLast(inv[0], 30); expect(await state(inv[0])).toBe('WAIT');     // 0 = tidak ada pengingat ulang
    await api().put('/reminders/settings').set(as('bendahara')).send({ repeatDays: 3 });
    expect(await state(inv[0])).toBe('AGAIN');
  });
  it('ringkasan menu samping menghitung yang perlu diingatkan; pemberitahuan hanya SEKALI per putaran', async () => {
    await setLast(inv[0], 4); await setLast(inv[1], null);
    const before = await alerts();
    const a = await summary();
    expect(a.needSantri).toBeGreaterThanOrEqual(2); expect(a.overdueSantri).toBeGreaterThanOrEqual(2); expect(a.repeatDays).toBe(3); expect(a.alertedNow).toBe(1);
    expect(await alerts()).toBe(before + 1);
    const n = (await api().get('/notifications').set(as('bendahara'))).body.items.find((x: any) => x.title === 'Perlu diingatkan lagi');
    expect(n.link).toBe('/tagihan'); expect(n.body).toContain('3 hari'); expect(n.kind).toBe('INFO');
    expect((await summary()).alertedNow).toBe(0); expect(await alerts()).toBe(before + 1);     // dipanggil lagi: tidak dobel
    expect((await summary('admin')).alertedNow).toBe(0);
    expect((await api().get('/reminders/summary').set(as('kasir'))).status).toBe(403);
  });
  it('setelah diingatkan lagi lalu 3 hari berlalu, pemberitahuan baru muncul; yang NEVER tidak memicu pemberitahuan', async () => {
    await setLast(inv[1], null);
    expect((await summary()).alertedNow).toBe(0);                            // NEVER: cukup titik merah, tanpa pemberitahuan
    const it = (await api().post('/reminders/prepare').set(as('bendahara')).send({ santriIds: [s1.santriId] })).body.items[0];
    expect(it.needsReminder).toBe(true);                                     // AGAIN
    await api().post('/reminders/mark').set(as('bendahara')).send({ santriId: s1.santriId, invoiceIds: it.invoiceIds });
    expect(await state(inv[0])).toBe('WAIT');
    expect((await api().post('/reminders/prepare').set(as('bendahara')).send({ santriIds: [s1.santriId] })).body.items[0].needsReminder).toBe(false);
    const before = await alerts();
    await pool.query(`UPDATE invoices SET last_reminded_at = last_reminded_at - interval '4 days', alert_sent_at = alert_sent_at - interval '4 days' WHERE id = $1`, [inv[0]]);   // simulasi: 4 hari berlalu
    expect((await summary()).alertedNow).toBe(1); expect(await alerts()).toBe(before + 1);
  });
  it('"hanya yang perlu diingatkan" menyertakan AGAIN dan NEVER, melewatkan WAIT; sudah lunas tidak ikut', async () => {
    await setLast(inv[0], 1); await setLast(inv[1], null);
    const r = (await api().post('/reminders/prepare').set(as('bendahara')).send({ onlyDue: true })).body.items.map((x: any) => x.nis);
    expect(r).toContain('ULG02'); expect(r).not.toContain('ULG01');
    await setLast(inv[0], 5);
    expect((await api().post('/reminders/prepare').set(as('bendahara')).send({ onlyDue: true })).body.items.map((x: any) => x.nis)).toContain('ULG01');
    expect((await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv[0], amount: 300000, method: 'CASH', idempotencyKey: key() })).status).toBe(201);
    expect(await state(inv[0])).toBeNull();
    expect((await api().post('/reminders/prepare').set(as('bendahara')).send({ onlyDue: true })).body.items.map((x: any) => x.nis)).not.toContain('ULG01');
  });
});

// ====================== v0.9 ======================
describe('Notifikasi pembayaran: dipilih sendiri oleh Admin/Bendahara (v0.9)', () => {
  let walsanId: string;
  const feed = async (who: string, type?: string) => (await pool.query(
    `SELECT n.title, n.kind, n.pay_type, n.body FROM notifications n JOIN users u ON u.id=n.user_id WHERE u.username=$1 ${type ? 'AND n.pay_type=$2' : ''} ORDER BY n.created_at DESC`, type ? [who, type] : [who])).rows;
  const setMuted = (who: string, muted: string[]) => api().put('/notifications/prefs').set(as(who)).send({ muted });
  beforeAll(async () => {
    walsanId = (await pool.query(`SELECT id FROM users WHERE username='walsanA'`)).rows[0].id;
    await pool.query('DELETE FROM notification_prefs');
    await pool.query('DELETE FROM notifications');
  });
  async function santriWithBill(nis: string, saldo = 0) {
    const s = await mkSantri(nis);
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    if (saldo) await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: s.santriId, amount: saldo, method: 'CASH_COUNTER', idempotencyKey: key() });
    const inv = (await api().post('/billing/invoices').set(as('bendahara')).send({ santriId: s.santriId, period: '2027-03', title: 'SPP', amount: 100000, dueDate: '2027-03-10' })).body;
    return { s, inv };
  }

  it('daftar pilihan: standar semua menyala; hanya Admin/Bendahara yang boleh membuka', async () => {
    const r = await api().get('/notifications/prefs').set(as('bendahara'));
    expect(r.status).toBe(200);
    expect(r.body.types.map((t: any) => t.key)).toEqual(['TOPUP_PROOF', 'TOPUP_DONE', 'WALI_PAY', 'LOKET_PAY']);
    expect(r.body.types.every((t: any) => t.enabled)).toBe(true);
    for (const who of ['kasir', 'laundry1', 'walsanA']) expect((await api().get('/notifications/prefs').set(as(who))).status).toBe(403);
    expect((await setMuted('kasir', [])).status).toBe(403);
  });
  it('validasi: jenis yang tidak dikenal atau dobel ditolak', async () => {
    expect((await setMuted('admin', ['BUKAN_JENIS'])).status).toBe(400);
    expect((await setMuted('admin', ['LOKET_PAY', 'LOKET_PAY'])).status).toBe(400);
    expect((await api().put('/notifications/prefs').set(as('admin')).send({})).status).toBe(400);
  });
  it('bayar di loket oleh bendahara → admin dapat (LOKET_PAY), bendahara sendiri tidak', async () => {
    const { inv } = await santriWithBill('NTF01');
    const r = await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv.id, amount: 40000, method: 'CASH', idempotencyKey: key() });
    expect(r.status).toBe(201);
    const a = await feed('admin', 'LOKET_PAY');
    expect(a).toHaveLength(1); expect(a[0].kind).toBe('PAYMENT'); expect(a[0].body).toContain('Santri NTF01'); expect(a[0].body).toContain('dicicil');
    expect(await feed('bendahara', 'LOKET_PAY')).toHaveLength(0);
    expect(await feed('kasir', 'LOKET_PAY')).toHaveLength(0);
    expect(await feed('walsanA', 'LOKET_PAY')).toHaveLength(0);
  });
  it('mematikan satu jenis hanya berlaku untuk pemilihnya; jenis lain tetap masuk', async () => {
    const put = await setMuted('admin', ['LOKET_PAY']);
    expect(put.status).toBe(200); expect(put.body.types.find((t: any) => t.key === 'LOKET_PAY').enabled).toBe(false);
    expect((await api().get('/notifications/prefs').set(as('admin'))).body.types.filter((t: any) => !t.enabled).map((t: any) => t.key)).toEqual(['LOKET_PAY']);
    expect((await api().get('/notifications/prefs').set(as('bendahara'))).body.types.every((t: any) => t.enabled)).toBe(true);
    const before = (await feed('admin', 'LOKET_PAY')).length;
    const { inv } = await santriWithBill('NTF02');
    await api().post('/billing/pay').set(as('bendahara')).send({ invoiceId: inv.id, amount: 100000, method: 'CASH', idempotencyKey: key() });
    expect((await feed('admin', 'LOKET_PAY')).length).toBe(before);   // admin mematikan → tidak bertambah
  });
  it('wali membayar dari saldo → admin dan bendahara dapat WALI_PAY; bila dimatikan, tidak', async () => {
    const { s } = await santriWithBill('NTF03', 300000);
    const pay = (k = key()) => api().post(`/portal/children/${s.santriId}/bills/pay`).set(as('walsanA')).send({ title: 'SPP', amount: 20000, idempotencyKey: k });
    expect((await pay()).status).toBe(201);
    expect(await feed('admin', 'WALI_PAY')).toHaveLength(1);
    expect(await feed('bendahara', 'WALI_PAY')).toHaveLength(1);
    await setMuted('bendahara', ['WALI_PAY']);
    expect((await pay()).status).toBe(201);
    expect(await feed('admin', 'WALI_PAY')).toHaveLength(2);
    expect(await feed('bendahara', 'WALI_PAY')).toHaveLength(1);       // tidak bertambah
  });
  it('top up: bukti transfer → TOPUP_PROOF; disetujui bendahara → TOPUP_DONE ke admin, bukan ke bendahara pelaku', async () => {
    await api().put('/topups/settings').set(as('admin')).send({ fee: 0, min: 20000, max: 500000, expiryHours: 48, bankInfo: 'Bank X 1 a.n. P' });
    await setMuted('bendahara', []);
    const s = await mkSantri('NTF04');
    await api().post(`/santri/${s.santriId}/walsan`).set(as('admin')).send({ userId: walsanId });
    const r = (await api().post(`/portal/children/${s.santriId}/topups`).set(as('walsanA')).send({ amount: 50000 })).body;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bukti-ntf-4')]);
    expect((await api().post(`/portal/topups/${r.id}/proof`).set(as('walsanA')).attach('file', png, { filename: 'b.png', contentType: 'image/png' }).field('ocrAmounts', '[]')).status).toBe(201);
    expect(await feed('admin', 'TOPUP_PROOF')).toHaveLength(1);
    expect(await feed('bendahara', 'TOPUP_PROOF')).toHaveLength(1);
    await api().post('/topups/match').set(as('bendahara')).send({ lines: [{ ref: '15/11 TRF NTF04', amount: r.total }] });
    const done = await api().post(`/topups/${r.id}/approve`).set(as('bendahara')).send({});
    expect(done.status).toBeLessThan(300);
    expect(await feed('admin', 'TOPUP_DONE')).toHaveLength(1);
    expect(await feed('bendahara', 'TOPUP_DONE')).toHaveLength(0);          // pelaku tidak diberi tahu soal tindakannya sendiri
  });
  it('notifikasi pengingat (INFO) tidak ikut pilihan jenis pembayaran', async () => {
    await setMuted('bendahara', ['TOPUP_PROOF', 'TOPUP_DONE', 'WALI_PAY', 'LOKET_PAY']);
    await pool.query(`INSERT INTO notifications(user_id, title, body, kind) SELECT id,'Info staf','x','INFO' FROM users WHERE username='bendahara'`);
    expect((await feed('bendahara')).some((n: any) => n.title === 'Info staf')).toBe(true);
    await setMuted('bendahara', []);
  });
});

// ====================== v1.0 ======================


describe('Impor santri + tagihan dari Excel (v1.0)', () => {
  const HEAD = ['NAMA', 'Seragam', 'peci', 'KELOMPOK', 'STATUS', 'FORM PENDAFTARAN', 'U Gedung', 'UANG KEGIATAN', 'KBM SMT1', 'KBM SMT2', 'DAFTAR ULANG', 'SPP JUL', 'SPP AGS', 'SPP SEPT', 'SPP OKT', 'SPP NOV', 'SPP DES', 'SPP JAN', 'SPP FEB', 'SPP MAR', 'SPP APR', 'SPP MEI', 'SPP JUN', 'KURANG BAYAR', 'SKTM', 'Peci', 'KURANG BAYAR'];
  const rp = (n: number | string) => (typeof n === 'string' ? n : `Rp ${n.toLocaleString('en-US')} `);
  /** Susun satu baris persis sesuai posisi kolom di judul; total di kolom setelah kolom terakhir. */
  const row = (name: string, set: Record<string, string | number>, total?: number | string) => {
    const cells = HEAD.map(() => '');
    cells[0] = name;
    for (const [k, v] of Object.entries(set)) {
      const [h, nth] = k.split('#'); let seen = 0, idx = -1;
      HEAD.forEach((x, i) => { if (x === h) { if (seen === Number(nth ?? 0)) idx = i; seen++; } });
      if (idx < 0) throw new Error('kolom ' + k);
      cells[idx] = typeof v === 'number' ? rp(v) : v;
    }
    cells.push(total === undefined ? '' : typeof total === 'number' ? `Rp${total.toLocaleString('en-US')}` : total);
    return cells.join('\t');
  };
  const spp = (months: string[], amt: number) => Object.fromEntries(months.map((m) => ['SPP ' + m, amt]));
  const UP = ['OKT', 'NOV', 'DES', 'JAN', 'FEB', 'MAR', 'APR', 'MEI'];
  const sheet = (rows: string[]) => [HEAD.join('\t'), 'ULA/ SD IKHWAN\t' + '\t'.repeat(HEAD.length - 1) + 'Rp0', ...rows].join('\n');
  const SAMPLE = [
    row('Ahmad Hamzah ', { Seragam: 'S', peci: '5', KELOMPOK: 'ULA', STATUS: 'KERINGANAN', 'FORM PENDAFTARAN': 'Rp -', 'KBM SMT2': 650000, ...spp(UP, 500000) }, 4650000),
    row('Akram Malik Sinarta Sitepu', { Seragam: 'S', peci: '4', KELOMPOK: 'ULA', STATUS: 'KERINGANAN', 'U Gedung': 3300000, 'UANG KEGIATAN': 3000000, 'KBM SMT1': 'Rp -', 'KBM SMT2': 650000, ...Object.fromEntries(['JUL', 'AGS', 'SEPT', 'OKT', 'NOV'].map((m) => ['SPP ' + m, 'Rp -'])), ...spp(['DES', 'JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN'], 350000) }, 9400000),
    row('Argya Rizqi Syuhada', { Seragam: 'S', peci: '4', KELOMPOK: 'ULA', STATUS: 'Keringanan', 'U Gedung': 3500000, 'UANG KEGIATAN': 'Rp -', 'KBM SMT2': 650000, ...spp(UP, 750000) }, 10150000),
    row('Salman Maulana', { Seragam: 'S', peci: '4', KELOMPOK: 'ULA', STATUS: 'KERINGANAN', 'FORM PENDAFTARAN': 'Rp -', 'KBM SMT2': 650000, ...spp(['NOV', 'DES', 'JAN', 'FEB', 'MAR', 'APR', 'MEI'], 500000) }, 4150000),
  ];
  const body = (rows = SAMPLE, extra: any = {}) => ({ text: sheet(rows), startYear: 2026, entryDue: '2020-01-01', ...extra });

  it('pembaca angka: Rp -, titik/koma ribuan, kosong, dan yang tidak dikenal', () => {
    expect(parseMoney('Rp -')).toBe(0); expect(parseMoney(' Rp 3,300,000 ')).toBe(3300000); expect(parseMoney('Rp3.300.000')).toBe(3300000);
    expect(parseMoney('')).toBeNull(); expect(parseMoney('abc')).toBeNaN(); expect(parseMoney('12,5')).toBeNaN();
  });
  it('pembaca: kolom dikenali dari judul; SPP Jul-Des 2026, Jan-Jun 2027, jatuh tempo tanggal 10; ukuran seragam/peci bukan tagihan', () => {
    const p = parseSheet(sheet(SAMPLE), { startYear: 2026, entryDue: '2026-06-30' });
    expect(p.ok).toBe(true); expect(p.sections).toEqual(['ULA/ SD IKHWAN']); expect(p.rows).toHaveLength(4);
    const col = (h: string) => p.columns.find((c) => c.header === h)!;
    expect(col('SPP JUL')).toMatchObject({ period: '2026-07', dueDate: '2026-07-10', title: 'SPP' });
    expect(col('SPP JAN')).toMatchObject({ period: '2027-01', dueDate: '2027-01-10' });
    expect(col('SPP JUN')).toMatchObject({ period: '2027-06', dueDate: '2027-06-10' });
    expect(col('U Gedung')).toMatchObject({ kind: 'fee', title: 'Uang Gedung', dueDate: '2026-06-30' });
    expect(p.columns.filter((c) => c.header === 'KURANG BAYAR').map((c) => c.title)).toEqual(['Kurang Bayar', 'Kurang Bayar 2']);
    expect(p.columns.filter((c) => c.header.toLowerCase() === 'peci').map((c) => c.kind)).toEqual(['size', 'fee']);
    const [ahmad, akram, argya, salman] = p.rows;
    expect(ahmad).toMatchObject({ name: 'Ahmad Hamzah', kelas: 'ULA', statusLabel: 'Keringanan', catatan: 'Seragam S, peci 5', bagian: 'ULA/ SD IKHWAN', sum: 4650000, totalCheck: 'OK' });
    expect(ahmad.invoices).toHaveLength(9);                                         // Form pendaftaran "Rp -" tidak jadi tagihan
    expect(akram.invoices.map((i) => i.title + ':' + i.amount)).toEqual(expect.arrayContaining(['Uang Gedung:3300000', 'Uang Kegiatan:3000000', 'KBM Semester 2:650000']));
    expect(akram.invoices).toHaveLength(10); expect(akram.sum).toBe(9400000);       // KBM Smt1 "Rp -" dan SPP Jul-Nov lunas dilewati
    expect(argya.sum).toBe(10150000); expect(salman.sum).toBe(4150000);
    expect(p.rows.every((r) => !r.errors.length)).toBe(true);
  });
  it('pembaca: total tidak sama → baris ditolak; angka aneh → ditolak; tanpa judul → gagal', () => {
    const bad = parseSheet(sheet([row('Budi Santoso', { KELOMPOK: 'ULA', 'U Gedung': 1000000 }, 999000), row('Cici Lestari', { KELOMPOK: 'ULA', 'U Gedung': 'sejuta' }, 1000000)]), { startYear: 2026, entryDue: '2026-06-30' });
    expect(bad.rows[0].totalCheck).toBe('MISMATCH'); expect(bad.rows[0].errors[0]).toContain('tidak sama');
    expect(bad.rows[1].errors[0]).toContain('tidak dikenali');
    expect(parseSheet('Ahmad\tULA\tRp 1', { startYear: 2026, entryDue: '2026-06-30' }).ok).toBe(false);
  });
  it('pembaca: total yang bergeser ke dalam kolom judul tetap dikenali dan diberi peringatan', () => {
    const r = parseSheet(HEAD.join('\t') + '\n' + ['Dedi Kurnia', '', '', 'ULA', 'Reguler', '', '', '', '', 'Rp 650,000', '', '', '', '', 'Rp 500,000', 'Rp 500,000', '', '', '', '', '', '', '', '', '', '', 'Rp1,650,000'].join('\t'), { startYear: 2026, entryDue: '2026-06-30' });
    expect(r.rows[0].totalCheck).toBe('OK'); expect(r.rows[0].sum).toBe(1650000); expect(r.rows[0].warnings[0]).toContain('bergeser');
  });

  it('hanya ADMIN yang boleh mengimpor', async () => {
    for (const who of ['bendahara', 'kasir', 'walsanA']) {
      expect((await api().post('/import/preview').set(as(who)).send(body())).status).toBe(403);
      expect((await api().post('/import/commit').set(as(who)).send({ ...body(), confirm: true })).status).toBe(403);
    }
  });
  it('pratinjau tidak mengubah apa pun; nomor urut 01, 02, ... untuk santri baru', async () => {
    const before = (await pool.query('SELECT (SELECT count(*) FROM santri)::int s, (SELECT count(*) FROM invoices)::int i')).rows[0];
    const r = await api().post('/import/preview').set(as('admin')).send(body());
    expect(r.status).toBe(201);
    expect(r.body.summary).toMatchObject({ rows: 4, rowsOk: 4, rowsError: 0, santriNew: 4, santriExisting: 0, invoicesNew: 37, amountNew: 4650000 + 9400000 + 10150000 + 4150000 });
    const nis = r.body.rows.map((x: any) => x.nis); expect(nis.every((n: string) => /^\d{2,}$/.test(n))).toBe(true);
    nis.slice(1).forEach((n: string, i: number) => expect(Number(n)).toBe(Number(nis[i]) + 1));
    expect(r.body.rows[0].invoices.find((i: any) => i.title === 'KBM Semester 2')).toMatchObject({ period: '2026-07', dueDate: '2020-01-01' });
    const after = (await pool.query('SELECT (SELECT count(*) FROM santri)::int s, (SELECT count(*) FROM invoices)::int i')).rows[0];
    expect(after).toEqual(before);
  });
  it('wajib konfirmasi; baris bermasalah dilewati, yang benar masuk', async () => {
    expect((await api().post('/import/commit').set(as('admin')).send(body())).status).toBe(400);
    const rows = [...SAMPLE, row('Rusak Total', { KELOMPOK: 'ULA', 'U Gedung': 1000000 }, 1)];
    const r = await api().post('/import/commit').set(as('admin')).send({ ...body(rows), confirm: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ santriCreated: 4, invoicesCreated: 37, invoicesExisting: 0 });
    expect(r.body.skipped).toHaveLength(1); expect(r.body.skipped[0].name).toBe('Rusak Total');
    expect(r.body.overdueCreated).toBeGreaterThanOrEqual(7);                          // biaya awal sudah lewat jatuh tempo
    expect((await pool.query(`SELECT 1 FROM santri WHERE full_name = 'Rusak Total'`)).rowCount).toBe(0);
  });
  it('hasil impor: santri + label + dompet + tagihan menunggak muncul di Tagihan; jumlah per santri cocok dengan total', async () => {
    const s = (await api().get('/santri').set(as('admin')).query({ q: 'Akram' })).body[0];
    expect(s).toMatchObject({ fullName: 'Akram Malik Sinarta Sitepu', kelas: 'ULA', statusLabel: 'Keringanan', bagian: 'ULA/ SD IKHWAN' });
    expect(/^\d{2,}$/.test(s.nis)).toBe(true);
    expect((await pool.query('SELECT count(*)::int n FROM wallets WHERE santri_id = $1', [s.id])).rows[0].n).toBe(3);
    const d = (await api().get(`/santri/${s.id}`).set(as('admin'))).body; expect(d.catatan).toBe('Seragam S, peci 4');
    const inv = (await api().get('/billing/invoices').set(as('bendahara')).query({ q: 'Akram' })).body;
    expect(inv).toHaveLength(10); expect(inv.reduce((a: number, i: any) => a + i.total, 0)).toBe(9400000);
    expect(inv.filter((i: any) => i.title === 'Uang Gedung')[0]).toMatchObject({ total: 3300000, status: 'OVERDUE', remindState: 'NEVER' });
    expect(inv.filter((i: any) => i.title === 'SPP').every((i: any) => i.dueDate.slice(8, 10) === '10')).toBe(true);
    expect((await pool.query(`SELECT count(*)::int n FROM cards WHERE santri_id = $1`, [s.id])).rows[0].n).toBe(0);   // kartu tidak dibuat
  });
  it('aman diulang: tempel yang sama lagi tidak menggandakan santri maupun tagihan', async () => {
    const r = await api().post('/import/commit').set(as('admin')).send({ ...body(), confirm: true });
    expect(r.body).toMatchObject({ santriCreated: 0, santriExisting: 4, invoicesCreated: 0, invoicesExisting: 37 });
    const p = await api().post('/import/preview').set(as('admin')).send(body());
    expect(p.body.summary).toMatchObject({ santriNew: 0, santriExisting: 4, invoicesNew: 0, invoicesExisting: 37 });
    expect((await pool.query(`SELECT count(*)::int n FROM santri WHERE full_name = 'Ahmad Hamzah'`)).rows[0].n).toBe(1);
  });
  it('nama kembar di data yang ditempel ditolak, dan data tanpa judul → 422', async () => {
    const r = await api().post('/import/preview').set(as('admin')).send(body([row('Kembar Satu', { KELOMPOK: 'ULA', 'U Gedung': 1000000 }, 1000000), row('kembar  satu', { KELOMPOK: 'ULA', 'U Gedung': 2000000 }, 2000000)]));
    expect(r.body.summary.rowsError).toBe(2); expect(r.body.rows[0].errors[0]).toContain('Nama kembar');
    expect((await api().post('/import/preview').set(as('admin')).send({ text: 'a\tb', startYear: 2026, entryDue: '2026-06-30' })).status).toBe(422);
    expect((await api().post('/import/preview').set(as('admin')).send({ text: 'NAMA', startYear: 1999, entryDue: '2026-06-30' })).status).toBe(400);
  });
  it('audit tercatat dan portal wali melihat tagihan impor (Uang Gedung) dari saldo', async () => {
    expect((await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'IMPORT_SANTRI_TAGIHAN'`)).rowCount).toBeGreaterThanOrEqual(2);
    const sid = (await pool.query(`SELECT id FROM santri WHERE full_name = 'Argya Rizqi Syuhada'`)).rows[0].id;
    const w = (await pool.query(`SELECT id FROM users WHERE username = 'walsanA'`)).rows[0].id;
    await pool.query('INSERT INTO santri_walsan(user_id, santri_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [w, sid]);
    await api().post('/wallet/topup').set(as('bendahara')).send({ santriId: sid, amount: 500000, method: 'CASH_COUNTER', idempotencyKey: key() });
    const bills = (await api().get(`/portal/children/${sid}/bills`).set(as('walsanA'))).body;
    expect(bills.find((b: any) => b.title === 'Uang Gedung')).toMatchObject({ remaining: 3500000, overdue: 3500000 });
    const pay = await api().post(`/portal/children/${sid}/bills/pay`).set(as('walsanA')).send({ title: 'Uang Gedung', amount: 500000, idempotencyKey: key() });
    expect(pay.status).toBe(201); expect(pay.body.remaining).toBe(3000000);
  });
});
