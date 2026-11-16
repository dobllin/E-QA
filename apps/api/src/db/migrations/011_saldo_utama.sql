-- Saldo utama: semua top up masuk ke kantong SALDO dulu; wali memindahkannya ke Jajan/Laundry atau ke tagihan.
-- Pembagian otomatis dihapus (kolom lama dibiarkan agar riwayat tetap utuh, tidak dipakai lagi).

ALTER TABLE wallets DROP CONSTRAINT wallets_pocket_check;
ALTER TABLE wallets ADD CONSTRAINT wallets_pocket_check CHECK (pocket IN ('SALDO','JAJAN','LAUNDRY','SPP'));
ALTER TABLE topup_requests DROP CONSTRAINT topup_requests_target_pocket_check;
ALTER TABLE topup_requests ADD CONSTRAINT topup_requests_target_pocket_check CHECK (target_pocket IN ('SALDO','JAJAN','LAUNDRY','SPP'));
ALTER TABLE topup_requests ALTER COLUMN target_pocket SET DEFAULT 'SALDO';

INSERT INTO wallets(santri_id, pocket) SELECT id, 'SALDO' FROM santri ON CONFLICT (santri_id, pocket) DO NOTHING;

-- Sisa uang di kantong SPP lama dipindah ke SALDO lewat dua entri ledger (tidak ada uang hilang).
DO $$
DECLARE r record; sal record; spp_after int; sal_after int;
BEGIN
  FOR r IN SELECT id, santri_id, balance FROM wallets WHERE pocket = 'SPP' AND balance > 0 LOOP
    SELECT id, balance INTO sal FROM wallets WHERE santri_id = r.santri_id AND pocket = 'SALDO' FOR UPDATE;
    spp_after := 0; sal_after := sal.balance + r.balance;
    INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note)
      VALUES (r.id, 'TRANSFER', 'DEBIT', r.balance, spp_after, 'mig011:out:' || r.id, 'Pindah ke Saldo (kantong SPP dihapus)');
    INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note)
      VALUES (sal.id, 'TRANSFER', 'CREDIT', r.balance, sal_after, 'mig011:in:' || r.id, 'Dari kantong SPP lama');
    UPDATE wallets SET balance = 0, updated_at = now() WHERE id = r.id;
    UPDATE wallets SET balance = sal_after, updated_at = now() WHERE id = sal.id;
  END LOOP;
END $$;

-- Top up tunai di loket (dengan biaya layanan di atas nominal) dicatat agar ikut tagihan jasa bulanan.
CREATE TABLE cash_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  santri_id uuid NOT NULL REFERENCES santri(id),
  amount integer NOT NULL CHECK (amount > 0),   -- yang masuk ke santri
  fee integer NOT NULL CHECK (fee >= 0),        -- biaya layanan (dibayar di atas nominal)
  ledger_entry_id uuid UNIQUE REFERENCES ledger_entries(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_topups_created_idx ON cash_topups(created_at);

-- Satu pandangan gabungan untuk perhitungan biaya layanan (transfer + tunai).
CREATE VIEW fee_items AS
  SELECT t.id, t.santri_id, t.decided_at AS at, COALESCE(t.credited, t.amount + t.unique_code) AS credited, t.fee, t.total, 'TRANSFER'::text AS kind
    FROM topup_requests t WHERE t.status = 'CREDITED' AND t.decided_at IS NOT NULL
  UNION ALL
  SELECT c.id, c.santri_id, c.created_at, c.amount, c.fee, c.amount + c.fee, 'TUNAI'::text FROM cash_topups c;
