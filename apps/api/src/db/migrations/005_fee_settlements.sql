-- Penyelesaian biaya layanan bulanan: pesantren menyetor total fee ke pengembang (lihat perjanjian).
-- Angka fee diambil dari topup_requests.fee (snapshot saat permintaan dibuat), jadi mengubah pengaturan tidak mengubah bulan lama.
CREATE TABLE fee_settlements (
  month        text PRIMARY KEY CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  topup_count  integer NOT NULL,
  fee_total    integer NOT NULL CHECK (fee_total > 0),   -- nilai yang dibayar (snapshot saat ditandai dibayar)
  paid_at      date NOT NULL,                             -- tanggal pesantren mentransfer
  note         text NOT NULL,                             -- mis. nomor bukti transfer
  marked_by    uuid NOT NULL REFERENCES users(id),
  received_at  date,                                      -- tanggal pengembang mengonfirmasi uang diterima
  received_by  uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
