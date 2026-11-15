-- Everyday Storage HQ — relational schema (SQLite).
--
-- Conventions
--   * ids are UUID text; human-facing numbers (INV-2026-0001) live in *_no columns
--   * money is INTEGER cents in the business base currency — never floats
--   * dates are ISO 'YYYY-MM-DD' (Aruba local), timestamps are ISO-8601 UTC
--   * every table that belongs to a site carries facility_id, so the platform
--     scales to several facilities without schema changes
--   * security deposits are held in deposit_transactions and never touch
--     invoices/payments, so they can never be counted as earned revenue

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------ platform

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','manager','staff','renter')),
  password_hash   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  renter_id       TEXT REFERENCES renters(id) ON DELETE CASCADE,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,           -- sha256 of the cookie value
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  email    TEXT NOT NULL COLLATE NOCASE,
  ip       TEXT,
  success  INTEGER NOT NULL,
  at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(email, at);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,              -- JSON
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name   TEXT PRIMARY KEY,
  value  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  actor_id    TEXT,
  actor_name  TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  summary     TEXT NOT NULL,
  meta        TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS taxes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  rate_bp     INTEGER NOT NULL CHECK (rate_bp >= 0 AND rate_bp <= 10000), -- basis points: 700 = 7%
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------- facilities

CREATE TABLE IF NOT EXISTS facilities (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT,
  country     TEXT DEFAULT 'Aruba',
  phone       TEXT,
  email       TEXT,
  map_cols    INTEGER NOT NULL DEFAULT 16,
  map_rows    INTEGER NOT NULL DEFAULT 10,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id            TEXT PRIMARY KEY,
  facility_id   TEXT NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  unit_number   TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'standard',
  size_label    TEXT NOT NULL DEFAULT 'medium',
  width_ft      REAL NOT NULL DEFAULT 0,
  depth_ft      REAL NOT NULL DEFAULT 0,
  height_ft     REAL NOT NULL DEFAULT 0,
  location      TEXT,                        -- building / row / floor
  monthly_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_price_cents >= 0),
  -- status is derived (see lib/units.ts syncUnitStatus) from agreements,
  -- reservations and maintenance; offline is the one manual switch
  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','occupied','reserved','maintenance','unavailable')),
  offline       INTEGER NOT NULL DEFAULT 0,
  available_from TEXT,
  features      TEXT,
  notes         TEXT,
  map_x         INTEGER,
  map_y         INTEGER,
  map_w         INTEGER NOT NULL DEFAULT 1,
  map_h         INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (facility_id, unit_number)
);
CREATE INDEX IF NOT EXISTS idx_units_status ON units(facility_id, status);

-- ------------------------------------------------------------------- renters

CREATE TABLE IF NOT EXISTS renters (
  id            TEXT PRIMARY KEY,
  renter_no     TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL DEFAULT 'individual' CHECK (kind IN ('individual','business')),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL DEFAULT '',
  company       TEXT,
  email         TEXT COLLATE NOCASE,
  phone         TEXT,
  phone_alt     TEXT,
  id_type       TEXT,
  id_number_enc TEXT,                        -- AES-256-GCM, see lib/crypto.ts
  id_last4      TEXT,
  address       TEXT,
  city          TEXT,
  country       TEXT,
  emergency_name     TEXT,
  emergency_phone    TEXT,
  emergency_relation TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('lead','active','former')),
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_renters_name ON renters(last_name, first_name);

-- ------------------------------------------------------------- reservations

CREATE TABLE IF NOT EXISTS reservations (
  id              TEXT PRIMARY KEY,
  reservation_no  TEXT NOT NULL UNIQUE,
  facility_id     TEXT NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  unit_id         TEXT REFERENCES units(id) ON DELETE SET NULL,   -- NULL = waitlist
  renter_id       TEXT REFERENCES renters(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  desired_size    TEXT,
  desired_type    TEXT,
  desired_start   TEXT,
  hold_until      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','waitlist','converted','cancelled','expired')),
  source          TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','web','portal')),
  notes           TEXT,
  converted_agreement_id TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(facility_id, status);
-- one live hold per unit
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservation_unit_hold
  ON reservations(unit_id) WHERE unit_id IS NOT NULL AND status IN ('pending','confirmed');

-- --------------------------------------------------------------- agreements

CREATE TABLE IF NOT EXISTS agreements (
  id              TEXT PRIMARY KEY,
  agreement_no    TEXT NOT NULL UNIQUE,
  facility_id     TEXT NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  unit_id         TEXT NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  renter_id       TEXT NOT NULL REFERENCES renters(id) ON DELETE RESTRICT,
  reservation_id  TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  term_type       TEXT NOT NULL CHECK (term_type IN ('fixed','month_to_month')),
  start_date      TEXT NOT NULL,
  end_date        TEXT,                      -- NULL while month-to-month
  term_months     INTEGER,
  monthly_rate_cents INTEGER NOT NULL CHECK (monthly_rate_cents >= 0),
  deposit_cents   INTEGER NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  discount_cents  INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  discount_note   TEXT,
  billing_mode    TEXT NOT NULL DEFAULT 'anniversary' CHECK (billing_mode IN ('anniversary','fixed_day')),
  billing_day     INTEGER NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 28),
  prorate_first   INTEGER NOT NULL DEFAULT 1,
  renewal_option  TEXT NOT NULL DEFAULT 'month_to_month'
                  CHECK (renewal_option IN ('auto_renew','month_to_month','end')),
  renewal_term_months INTEGER,
  notice_days     INTEGER NOT NULL DEFAULT 30,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','pending_signature','active','ended','cancelled')),
  next_period_start TEXT,                    -- the next rent period still to be invoiced
  terms_snapshot  TEXT,                      -- the exact terms text that was signed
  terms_sha256    TEXT,
  sign_token_hash TEXT UNIQUE,
  sign_token_expires TEXT,
  signed_at       TEXT,
  signed_name     TEXT,
  signed_method   TEXT,                      -- e-sign (remote), in-person, paper
  signature_png   TEXT,                      -- data URL of the drawn signature
  signed_ip       TEXT,
  signed_user_agent TEXT,
  external_sign_provider TEXT,               -- integration point: DocuSign, Dropbox Sign …
  external_sign_ref TEXT,
  move_out_date   TEXT,
  ended_at        TEXT,
  ended_reason    TEXT,
  renewal_requested_at TEXT,
  notes           TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agreements_renter ON agreements(renter_id);
CREATE INDEX IF NOT EXISTS idx_agreements_unit ON agreements(unit_id);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON agreements(facility_id, status);
-- a unit can only be under one live agreement at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_agreement_unit_live
  ON agreements(unit_id) WHERE status IN ('pending_signature','active');

CREATE TABLE IF NOT EXISTS agreement_renewals (
  id            TEXT PRIMARY KEY,
  agreement_id  TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,               -- auto_renew, manual, to_month_to_month
  previous_end  TEXT,
  new_end       TEXT,
  previous_rate_cents INTEGER,
  new_rate_cents INTEGER,
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS move_outs (
  id            TEXT PRIMARY KEY,
  agreement_id  TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  move_out_date TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('requested','scheduled','completed','cancelled')),
  requested_by  TEXT,                        -- staff or renter
  step_notice     INTEGER NOT NULL DEFAULT 0,
  step_final_invoice INTEGER NOT NULL DEFAULT 0,
  step_inspection INTEGER NOT NULL DEFAULT 0,
  step_lock_removed INTEGER NOT NULL DEFAULT 0,
  step_deposit    INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_move_out_live
  ON move_outs(agreement_id) WHERE status IN ('requested','scheduled');

-- ----------------------------------------------------------------- invoices

CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,
  invoice_no    TEXT NOT NULL UNIQUE,
  facility_id   TEXT NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  renter_id     TEXT NOT NULL REFERENCES renters(id) ON DELETE RESTRICT,
  agreement_id  TEXT REFERENCES agreements(id) ON DELETE RESTRICT,
  unit_id       TEXT REFERENCES units(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'rent' CHECK (kind IN ('rent','one_off')),
  period_start  TEXT,
  period_end    TEXT,
  issue_date    TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  -- 'overdue' is never stored: it is due_date < today AND balance > 0
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft','open','partial','paid','void')),
  currency      TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL DEFAULT 0, -- taxable + non-taxable charges, before discounts
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp   INTEGER NOT NULL DEFAULT 0,  -- frozen at issue, so later rate changes never rewrite history
  tax_label     TEXT,
  tax_cents     INTEGER NOT NULL DEFAULT 0,
  total_cents   INTEGER NOT NULL DEFAULT 0,
  paid_cents    INTEGER NOT NULL DEFAULT 0,  -- sum of payment allocations
  credited_cents INTEGER NOT NULL DEFAULT 0, -- sum of credit applications
  balance_cents INTEGER NOT NULL DEFAULT 0,
  late_fee_applied_at TEXT,
  sent_at       TEXT,
  paid_at       TEXT,
  voided_at     TEXT,
  void_reason   TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_renter ON invoices(renter_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(facility_id, status, due_date);
-- the duplicate guard for recurring billing: one live rent invoice per period
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_period
  ON invoices(agreement_id, period_start) WHERE kind = 'rent' AND status <> 'void';

CREATE TABLE IF NOT EXISTS invoice_lines (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('rent','prorated_rent','late_fee','fee','discount','other')),
  description   TEXT NOT NULL,
  quantity      REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  amount_cents  INTEGER NOT NULL,            -- negative for discounts
  taxable       INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON invoice_lines(invoice_id);

-- ----------------------------------------------------------------- payments

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  payment_no    TEXT NOT NULL UNIQUE,
  facility_id   TEXT NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  renter_id     TEXT NOT NULL REFERENCES renters(id) ON DELETE RESTRICT,
  received_date TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),   -- in base currency
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  method        TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','card','check','online','deposit','other')),
  reference     TEXT,
  tendered_currency TEXT,
  tendered_cents INTEGER,
  fx_rate       REAL,
  status        TEXT NOT NULL DEFAULT 'completed'
                CHECK (status IN ('completed','partially_refunded','refunded')),
  gateway       TEXT,
  gateway_ref   TEXT,
  idempotency_key TEXT UNIQUE,
  reconciled_at TEXT,
  reconciled_by TEXT,
  statement_ref TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_renter ON payments(renter_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(facility_id, received_date);
-- the same bank/cheque/gateway reference can never be booked twice
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_reference
  ON payments(method, reference) WHERE reference IS NOT NULL AND reference <> '' AND method <> 'cash';
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_gateway_ref
  ON payments(gateway, gateway_ref) WHERE gateway_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id            TEXT PRIMARY KEY,
  payment_id    TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alloc_invoice ON payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_alloc_payment ON payment_allocations(payment_id);

CREATE TABLE IF NOT EXISTS refunds (
  id            TEXT PRIMARY KEY,
  payment_id    TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  refund_date   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  method        TEXT NOT NULL,
  reference     TEXT,
  reason        TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

-- Renter credit: goodwill credits and unallocated overpayments.
CREATE TABLE IF NOT EXISTS credits (
  id            TEXT PRIMARY KEY,
  renter_id     TEXT NOT NULL REFERENCES renters(id) ON DELETE RESTRICT,
  source        TEXT NOT NULL CHECK (source IN ('manual','overpayment')),
  payment_id    TEXT REFERENCES payments(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  remaining_cents INTEGER NOT NULL CHECK (remaining_cents >= 0),
  reason        TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credits_renter ON credits(renter_id);

CREATE TABLE IF NOT EXISTS credit_applications (
  id            TEXT PRIMARY KEY,
  credit_id     TEXT NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_app_invoice ON credit_applications(invoice_id);

-- Security deposits: a liability ledger, separate from revenue.
CREATE TABLE IF NOT EXISTS deposit_transactions (
  id            TEXT PRIMARY KEY,
  facility_id   TEXT NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  agreement_id  TEXT NOT NULL REFERENCES agreements(id) ON DELETE RESTRICT,
  renter_id     TEXT NOT NULL REFERENCES renters(id) ON DELETE RESTRICT,
  type          TEXT NOT NULL CHECK (type IN ('collected','refunded','applied','forfeited')),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  txn_date      TEXT NOT NULL,
  method        TEXT,
  reference     TEXT,
  payment_id    TEXT REFERENCES payments(id) ON DELETE SET NULL,  -- set when applied to invoices
  notes         TEXT,
  idempotency_key TEXT UNIQUE,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deposit_agreement ON deposit_transactions(agreement_id);

-- A request for payment (pay link). Creating or sending one NEVER changes an
-- invoice; only a gateway-confirmed webhook or a recorded payment does.
CREATE TABLE IF NOT EXISTS payment_requests (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  renter_id     TEXT NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  provider      TEXT NOT NULL,
  provider_ref  TEXT,
  url           TEXT,
  status        TEXT NOT NULL DEFAULT 'created'
                CHECK (status IN ('created','sent','paid','failed','expired','cancelled')),
  payment_id    TEXT REFERENCES payments(id) ON DELETE SET NULL,
  sent_at       TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_events (
  id            TEXT PRIMARY KEY,            -- provider event id: replay-safe
  provider      TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  processed_at  TEXT,
  result        TEXT,
  received_at   TEXT NOT NULL
);

-- ----------------------------------------------------- expenses & maintenance

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id            TEXT PRIMARY KEY,
  ticket_no     TEXT NOT NULL UNIQUE,
  facility_id   TEXT NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  unit_id       TEXT REFERENCES units(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  category      TEXT NOT NULL DEFAULT 'general',
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting','done','cancelled')),
  assigned_to   TEXT REFERENCES users(id) ON DELETE SET NULL,
  unit_unavailable INTEGER NOT NULL DEFAULT 0,
  due_date      TEXT,
  completed_at  TEXT,
  resolution    TEXT,
  reported_by   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_tickets(facility_id, status);

CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,
  facility_id   TEXT NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  expense_date  TEXT NOT NULL,
  category      TEXT NOT NULL,
  vendor        TEXT,
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  method        TEXT,
  reference     TEXT,
  maintenance_id TEXT REFERENCES maintenance_tickets(id) ON DELETE SET NULL,
  unit_id       TEXT REFERENCES units(id) ON DELETE SET NULL,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(facility_id, expense_date);

-- ---------------------------------------------------------------- documents

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  entity        TEXT NOT NULL,               -- renter, agreement, unit, maintenance, expense
  entity_id     TEXT NOT NULL,
  renter_id     TEXT REFERENCES renters(id) ON DELETE CASCADE, -- owner, for portal scoping
  name          TEXT NOT NULL,
  category      TEXT,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  storage_key   TEXT NOT NULL UNIQUE,
  renter_visible INTEGER NOT NULL DEFAULT 0,
  uploaded_by   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity, entity_id);

-- -------------------------------------------------- automations, jobs, email

CREATE TABLE IF NOT EXISTS automations (
  key           TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  config        TEXT NOT NULL DEFAULT '{}',
  last_run_at   TEXT,
  last_result   TEXT,
  updated_at    TEXT NOT NULL
);

-- A small durable queue. dedupe_key makes enqueueing idempotent; attempts and
-- run_after give retries with backoff; 'dead' is where a job stops for a human.
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  dedupe_key    TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','dead')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  run_after     TEXT NOT NULL,
  locked_at     TEXT,
  last_error    TEXT,
  result        TEXT,
  created_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_after);

CREATE TABLE IF NOT EXISTS email_outbox (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,               -- invoice, due_reminder, overdue_reminder, …
  to_email      TEXT NOT NULL,
  to_name       TEXT,
  subject       TEXT NOT NULL,
  body_text     TEXT NOT NULL,
  attach_invoice_id TEXT,
  attach_payment_id TEXT,
  entity        TEXT,
  entity_id     TEXT,
  renter_id     TEXT,
  dedupe_key    TEXT NOT NULL UNIQUE,        -- one reminder of each kind per stage
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','dead')),
  provider      TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error    TEXT,
  sent_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox(status, next_attempt_at);
