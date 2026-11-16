-- Top up lewat transfer bank dengan kode unik + pencocokan mutasi.
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings(key, value) VALUES
  ('topup_fee', '0'),            -- biaya layanan per top up (Rp), ditambahkan DI ATAS nominal yang dibayar wali
  ('topup_min', '20000'),
  ('topup_max', '2000000'),
  ('topup_expiry_hours', '48'),
  ('bank_info', '');             -- teks rekening tujuan yang tampil ke wali

CREATE TABLE topup_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  santri_id       uuid NOT NULL REFERENCES santri(id),
  requested_by    uuid NOT NULL REFERENCES users(id),
  amount          integer NOT NULL CHECK (amount > 0),         -- nominal yang diminta wali
  unique_code     integer NOT NULL CHECK (unique_code BETWEEN 1 AND 999), -- ikut menjadi saldo
  fee             integer NOT NULL DEFAULT 0 CHECK (fee >= 0),  -- biaya layanan (BUKAN saldo)
  total           integer NOT NULL,                             -- yang harus ditransfer wali
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','MATCHED','CREDITED','REJECTED','EXPIRED','CANCELLED')),
  matched_ref     text,
  matched_at      timestamptz,
  ledger_entry_id uuid UNIQUE REFERENCES ledger_entries(id),
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  note            text,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (total = amount + unique_code + fee)
);
-- Nominal transfer harus unik di antara permintaan yang masih terbuka, supaya mutasi bank bisa dicocokkan tanpa ragu.
CREATE UNIQUE INDEX topup_total_open ON topup_requests(total) WHERE status IN ('PENDING','MATCHED');
CREATE UNIQUE INDEX topup_matched_ref_uq ON topup_requests(matched_ref) WHERE matched_ref IS NOT NULL;
CREATE INDEX topup_status_idx ON topup_requests(status, created_at DESC);
CREATE INDEX topup_santri_idx ON topup_requests(santri_id, created_at DESC);
