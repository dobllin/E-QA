-- Identitas pesantren (nama + logo), persetujuan wali, dan pemberitahuan dalam aplikasi.
INSERT INTO app_settings(key, value) VALUES ('school_name', ''), ('school_logo', '') ON CONFLICT (key) DO NOTHING;
ALTER TABLE users ADD COLUMN consent_at timestamptz, ADD COLUMN consent_version text;
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,
  link       text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);
