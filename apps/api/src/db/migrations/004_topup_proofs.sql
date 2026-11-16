-- Foto/screenshot bukti transfer dari wali. Hanya pembantu verifikasi: saldo TIDAK pernah masuk hanya karena foto.
CREATE TABLE topup_proofs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topup_id      uuid NOT NULL REFERENCES topup_requests(id) ON DELETE CASCADE,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  mime          text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  data          bytea NOT NULL,
  sha256        text NOT NULL UNIQUE,            -- foto yang sama tidak bisa dipakai dua kali
  ocr_amounts   integer[] NOT NULL DEFAULT '{}', -- angka yang terbaca dari foto (dari browser wali)
  amount_match  boolean NOT NULL DEFAULT false,  -- apakah salah satu angka = total transfer yang diminta
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX topup_proofs_topup_idx ON topup_proofs(topup_id);
