import 'dotenv/config';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { runMigrations } from './db/migrate';
import { hashBarcode, newBarcodeToken } from './cards/card-crypto';

/**
 * DATA DEMO. Jangan dijalankan di sistem sungguhan.
 * Semua password/PIN di sini hanya untuk percobaan dan dicetak ke layar.
 */
async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Seed demo ditolak di production. Set ALLOW_DEMO_SEED=true jika memang disengaja.');
  }
  await runMigrations();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const pw = 'Demo12345!';
  const hash = await argon2.hash(pw);

  const users: [string, string, string][] = [
    ['admin', 'Admin Pesantren', 'ADMIN'], ['bendahara', 'Ustadz Bendahara', 'BENDAHARA'],
    ['kasir', 'Kasir Kantin', 'KASIR'], ['laundry', 'Petugas Laundry', 'LAUNDRY'], ['walsan1', 'Bapak Ahmad', 'WALSAN'], ['walsan2', 'Ibu Siti', 'WALSAN'],
  ];
  const ids: Record<string, string> = {};
  for (const [username, fullName, role] of users) {
    const r = await pool.query(
      `INSERT INTO users(username, password_hash, full_name, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`, [username, hash, fullName, role]);
    ids[username] = r.rows[0].id;
  }

  const santri: [string, string, string, string][] = [
    ['2026001', 'Muhammad Fauzan', '7A', 'walsan1'], ['2026002', 'Aisyah Putri', '7A', 'walsan1'], ['2026003', 'Zaki Maulana', '8B', 'walsan2'],
  ];
  const out: string[] = [];
  for (const [nis, name, kelas, walsan] of santri) {
    const s = (await pool.query(
      `INSERT INTO santri(nis, full_name, kelas) VALUES ($1,$2,$3) ON CONFLICT (nis) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
      [nis, name, kelas])).rows[0];
    await pool.query(`INSERT INTO wallets(santri_id, pocket, daily_limit) SELECT $1, p, CASE WHEN p = 'JAJAN' THEN 50000 END FROM unnest(ARRAY['SALDO','JAJAN','LAUNDRY']) AS p ON CONFLICT (santri_id, pocket) DO NOTHING`, [s.id]);
    await pool.query('INSERT INTO santri_walsan(user_id, santri_id, relation) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ids[walsan], s.id, 'wali']);
    // Saldo awal simulasi lewat entri ledger (bukan edit saldo langsung).
    const wlt = (await pool.query("SELECT id FROM wallets WHERE santri_id = $1 AND pocket = 'JAJAN'", [s.id])).rows[0];
    const seeded = (await pool.query('SELECT 1 FROM ledger_entries WHERE idempotency_key = $1', [`seed-topup-${nis}`])).rows[0];
    if (!seeded) {
      await pool.query(`INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note)
                        VALUES ($1,'TOPUP','CREDIT',100000,100000,$2,'Saldo awal DEMO')`, [wlt.id, `seed-topup-${nis}`]);
      await pool.query('UPDATE wallets SET balance = 100000 WHERE id = $1', [wlt.id]);
    }
    const hasCard = (await pool.query(`SELECT 1 FROM cards WHERE santri_id = $1 AND status IN ('ACTIVE','SUSPENDED','LOCKED')`, [s.id])).rows[0];
    if (!hasCard) {
      const token = newBarcodeToken();
      await pool.query(
        `INSERT INTO cards(santri_id, public_number, barcode_hash, pin_hash, pin_must_change)
         VALUES ($1, 'EQA-' || nextval('card_public_seq'), $2, $3, false)`, [s.id, hashBarcode(token), await argon2.hash('246813')]);
      out.push(`  ${name.padEnd(18)} barcode: ${token}   PIN: 246813`);
    }
  }
  for (const [name, price, stock] of [['Nasi Goreng', 8000, 50], ['Es Teh', 3000, 80], ['Roti Cokelat', 5000, 40], ['Air Mineral', 3000, 100], ['Gorengan', 2000, 100]] as const) {
    const exists = (await pool.query('SELECT 1 FROM products WHERE name = $1', [name])).rows[0];
    if (!exists) await pool.query('INSERT INTO products(name, price, stock) VALUES ($1,$2,$3)', [name, price, stock]);
  }
  for (const [name, price] of [['Cuci + setrika (per kg)', 6000], ['Cuci saja (per kg)', 4000], ['Setrika saja (per kg)', 3000]] as const) {
    const exists = (await pool.query('SELECT 1 FROM products WHERE name = $1', [name])).rows[0];
    if (!exists) await pool.query("INSERT INTO products(name, price, stock, merchant, track_stock) VALUES ($1,$2,0,'LAUNDRY',false)", [name, price]);
  }
  await pool.end();
  console.log('\n=== DATA DEMO SIAP (bukan uang sungguhan) ===');
  console.log(`Login (password semua: ${pw}): admin, bendahara, kasir, laundry, walsan1, walsan2`);
  if (out.length) { console.log('Kartu demo (token hanya tampil sekali, catat sekarang):'); out.forEach((l) => console.log(l)); }
  else console.log('Kartu demo sudah pernah dibuat sebelumnya (token tidak bisa ditampilkan lagi; buat kartu baru lewat menu Admin).');
}
main().catch((e) => { console.error(e); process.exit(1); });
