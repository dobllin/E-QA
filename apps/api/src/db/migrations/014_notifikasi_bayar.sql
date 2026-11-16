-- v0.9: tiap admin/bendahara memilih sendiri jenis pembayaran yang ingin diberi notifikasi.
-- Menyimpan jenis yang DIMATIKAN (muted); kosong = semua menyala (standar).
CREATE TABLE notification_prefs (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  muted      text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ADD COLUMN pay_type text;
