-- Kantong saldo per santri (JAJAN, LAUNDRY, SPP), peran Laundry, produk per merchant,
-- SPP per santri, dan pembayaran tagihan dari saldo.

-- 1. Kantong: satu wallet per (santri, kantong). Wallet lama menjadi kantong JAJAN.
ALTER TABLE wallets DROP CONSTRAINT wallets_santri_id_key;
ALTER TABLE wallets ADD COLUMN pocket text NOT NULL DEFAULT 'JAJAN' CHECK (pocket IN ('JAJAN','LAUNDRY','SPP'));
ALTER TABLE wallets ADD CONSTRAINT wallets_santri_pocket_key UNIQUE (santri_id, pocket);
INSERT INTO wallets(santri_id, pocket)
  SELECT s.id, v.p FROM santri s CROSS JOIN (VALUES ('LAUNDRY'), ('SPP')) AS v(p)
  ON CONFLICT (santri_id, pocket) DO NOTHING;

-- 2. Jenis mutasi baru
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_type_check
  CHECK (type IN ('TOPUP','PURCHASE','REFUND','ADJUSTMENT','TRANSFER','BILL_PAYMENT'));

-- 3. Peran Laundry
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SUPER_ADMIN','ADMIN','BENDAHARA','KASIR','LAUNDRY','GURU','WALSAN'));

-- 4. Produk/jasa dan transaksi dipisah per merchant (kantin / laundry)
ALTER TABLE products ADD COLUMN merchant text NOT NULL DEFAULT 'KANTIN' CHECK (merchant IN ('KANTIN','LAUNDRY')),
                     ADD COLUMN track_stock boolean NOT NULL DEFAULT true;
ALTER TABLE orders   ADD COLUMN merchant text NOT NULL DEFAULT 'KANTIN' CHECK (merchant IN ('KANTIN','LAUNDRY'));

-- 5. SPP per santri + pembayaran tagihan dari saldo
ALTER TABLE santri ADD COLUMN spp_amount integer CHECK (spp_amount IS NULL OR spp_amount > 0);
ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('CASH','TRANSFER','WALLET'));
ALTER TABLE payments ADD COLUMN ledger_entry_id uuid UNIQUE REFERENCES ledger_entries(id);

-- 6. Kantong tujuan top up
ALTER TABLE topup_requests ADD COLUMN target_pocket text NOT NULL DEFAULT 'JAJAN' CHECK (target_pocket IN ('JAJAN','LAUNDRY','SPP'));
