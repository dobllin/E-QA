-- Toleransi kelebihan transfer + gambar QRIS pesantren.
ALTER TABLE topup_requests
  ADD COLUMN received_amount integer CHECK (received_amount > 0),  -- jumlah yang benar-benar masuk di rekening (dari mutasi / diisi bendahara)
  ADD COLUMN credited integer CHECK (credited > 0);                -- saldo yang dimasukkan ke santri (= diterima - biaya layanan)
UPDATE topup_requests SET credited = amount + unique_code WHERE status = 'CREDITED' AND credited IS NULL;
INSERT INTO app_settings(key, value) VALUES ('topup_tolerance', '5000'), ('qris_image', '') ON CONFLICT (key) DO NOTHING;
