-- Pembagian otomatis per NOMINAL (bukan persen) dan rekening terstruktur (agar bisa disalin wali).
ALTER TABLE santri
  ADD COLUMN split_spp     integer NOT NULL DEFAULT 0 CHECK (split_spp >= 0),      -- tiap top up: sekian Rp otomatis ke kantong SPP
  ADD COLUMN split_laundry integer NOT NULL DEFAULT 0 CHECK (split_laundry >= 0);  -- ... dan sekian Rp ke kantong Laundry; sisanya ke Jajan
ALTER TABLE topup_requests
  ADD COLUMN alloc_spp     integer NOT NULL DEFAULT 0 CHECK (alloc_spp >= 0),
  ADD COLUMN alloc_laundry integer NOT NULL DEFAULT 0 CHECK (alloc_laundry >= 0);
INSERT INTO app_settings(key, value) VALUES ('bank_name', ''), ('bank_account', ''), ('bank_holder', '') ON CONFLICT (key) DO NOTHING;
