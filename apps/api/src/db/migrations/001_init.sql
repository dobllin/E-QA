-- E-QA schema v0.1 (DEMO). Semua nominal = Rupiah integer. Waktu = timestamptz (UTC).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  phone         text,
  role          text NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','BENDAHARA','KASIR','GURU','WALSAN')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE santri (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nis        text NOT NULL UNIQUE,
  full_name  text NOT NULL,
  kelas      text,
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','GRADUATED','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX santri_kelas_idx ON santri(kelas);

-- Kunci akses walsan: walsan hanya boleh melihat santri yang ada di tabel ini.
CREATE TABLE santri_walsan (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  santri_id uuid NOT NULL REFERENCES santri(id) ON DELETE CASCADE,
  relation  text NOT NULL DEFAULT 'wali',
  PRIMARY KEY (user_id, santri_id)
);
CREATE INDEX santri_walsan_santri_idx ON santri_walsan(santri_id);

CREATE SEQUENCE card_public_seq START 10000001;

CREATE TABLE cards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  santri_id       uuid NOT NULL REFERENCES santri(id),
  public_number   text NOT NULL UNIQUE,
  barcode_hash    text NOT NULL UNIQUE,  -- sha256(token); token asli TIDAK disimpan
  pin_hash        text,                  -- argon2id
  pin_must_change boolean NOT NULL DEFAULT true,
  pin_failed      integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','LOCKED','REPLACED','REVOKED')),
  reason          text,
  replaced_by     uuid REFERENCES cards(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Satu santri hanya boleh punya SATU kartu "hidup".
CREATE UNIQUE INDEX one_live_card_per_santri ON cards(santri_id)
  WHERE status IN ('ACTIVE','SUSPENDED','LOCKED');

CREATE TABLE card_events (
  id         bigserial PRIMARY KEY,
  card_id    uuid NOT NULL REFERENCES cards(id),
  event      text NOT NULL,
  actor_id   uuid,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_events_card_idx ON card_events(card_id, created_at);

CREATE TABLE wallets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  santri_id    uuid NOT NULL UNIQUE REFERENCES santri(id),
  balance      integer NOT NULL DEFAULT 0 CONSTRAINT wallet_balance_nonneg CHECK (balance >= 0),
  daily_limit  integer CHECK (daily_limit IS NULL OR daily_limit > 0),
  per_tx_limit integer CHECK (per_tx_limit IS NULL OR per_tx_limit > 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       uuid NOT NULL REFERENCES wallets(id),
  type            text NOT NULL CHECK (type IN ('TOPUP','PURCHASE','REFUND','ADJUSTMENT')),
  direction       text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount          integer NOT NULL CONSTRAINT ledger_amount_pos CHECK (amount > 0),
  balance_after   integer NOT NULL CHECK (balance_after >= 0),
  idempotency_key text NOT NULL UNIQUE,
  reversal_of     uuid UNIQUE REFERENCES ledger_entries(id),
  note            text,
  meta            jsonb,
  actor_id        uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_wallet_idx ON ledger_entries(wallet_id, created_at DESC);

-- Ledger immutable: tidak boleh UPDATE / DELETE.
CREATE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ledger_entries bersifat immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

CREATE TABLE products (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  price      integer NOT NULL CHECK (price > 0),
  stock      integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  santri_id       uuid NOT NULL REFERENCES santri(id),
  total           integer NOT NULL CHECK (total > 0),
  ledger_entry_id uuid NOT NULL UNIQUE REFERENCES ledger_entries(id),
  cashier_id      uuid REFERENCES users(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_santri_idx ON orders(santri_id, created_at DESC);

CREATE TABLE order_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  name       text NOT NULL,
  unit_price integer NOT NULL,
  qty        integer NOT NULL CHECK (qty > 0),
  subtotal   integer NOT NULL
);
CREATE INDEX order_items_order_idx ON order_items(order_id);

CREATE SEQUENCE invoice_seq START 1;
CREATE SEQUENCE receipt_seq START 1;

CREATE TABLE invoices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number     text NOT NULL UNIQUE,
  santri_id  uuid NOT NULL REFERENCES santri(id),
  period     text NOT NULL,           -- contoh '2026-11'
  title      text NOT NULL,           -- contoh 'SPP'
  due_date   date NOT NULL,
  total      integer NOT NULL CHECK (total > 0),
  paid       integer NOT NULL DEFAULT 0 CHECK (paid >= 0),
  status     text NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID','PARTIAL','PAID','WAIVED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (paid <= total),
  -- generate tagihan idempotent: satu santri, satu periode, satu jenis biaya
  UNIQUE (santri_id, period, title)
);
CREATE INDEX invoices_status_due_idx ON invoices(status, due_date);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number  text NOT NULL UNIQUE,
  invoice_id      uuid NOT NULL REFERENCES invoices(id),
  amount          integer NOT NULL CHECK (amount > 0),
  method          text NOT NULL CHECK (method IN ('CASH','TRANSFER')),
  idempotency_key text NOT NULL UNIQUE,
  note            text,
  received_by     uuid REFERENCES users(id),
  paid_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_idx ON payments(invoice_id);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_logs(entity, entity_id);
CREATE INDEX audit_created_idx ON audit_logs(created_at DESC);
