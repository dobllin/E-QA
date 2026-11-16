-- v0.8: jadwal pelajaran + absen santri (guru scan kartu) dan pengingat tunggakan lewat WhatsApp.

-- 1. Jadwal pelajaran. Satu baris = satu mata pelajaran pada satu hari (hari 1 = Senin ... 7 = Ahad).
CREATE TABLE class_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject     text NOT NULL,
  kelas       text,                                   -- kosong = semua kelas
  teacher_id  uuid REFERENCES users(id),              -- akun Guru pemakai; kosong = boleh dipakai semua akun Guru
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX class_schedules_day_idx ON class_schedules(day_of_week) WHERE is_active;

-- 2. Absen. Satu santri hanya bisa tercatat sekali per jadwal per hari (scan ganda tidak dihitung dua kali).
CREATE TABLE attendance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id   uuid NOT NULL REFERENCES class_schedules(id),
  santri_id     uuid NOT NULL REFERENCES santri(id),
  day           date NOT NULL,                         -- tanggal (zona Asia/Jakarta)
  scanned_at    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL CHECK (status IN ('HADIR','TERLAMBAT')),
  recorded_by   uuid REFERENCES users(id),             -- akun yang dipakai
  operator_name text NOT NULL,                         -- nama guru yang sedang memakai akun (akun bersama / "joki")
  UNIQUE (schedule_id, santri_id, day)
);
CREATE INDEX attendance_day_idx ON attendance(day, schedule_id);

INSERT INTO app_settings(key, value) VALUES ('attendance_late_minutes', '10') ON CONFLICT (key) DO NOTHING;

-- 3. Pengingat tunggakan lewat WhatsApp.
ALTER TABLE invoices ADD COLUMN last_reminded_at timestamptz;   -- kosong = belum pernah diingatkan (titik merah berkedip)

CREATE TABLE reminder_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  santri_id   uuid NOT NULL REFERENCES santri(id),
  invoice_ids uuid[] NOT NULL,
  total       integer NOT NULL,
  sent_by     uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminder_log_santri_idx ON reminder_log(santri_id, created_at DESC);
