-- v0.8.1: pengingat ulang tunggakan. Bila sudah diingatkan tetapi masih belum lunas setelah N hari,
-- tagihan ditandai "perlu diingatkan lagi" dan pengurus mendapat pemberitahuan (sekali per putaran).
INSERT INTO app_settings(key, value) VALUES ('reminder_repeat_days', '3') ON CONFLICT (key) DO NOTHING;   -- 0 = tidak mengingatkan ulang

ALTER TABLE invoices ADD COLUMN alert_sent_at timestamptz;   -- kapan pemberitahuan "perlu diingatkan lagi" terakhir dikirim
