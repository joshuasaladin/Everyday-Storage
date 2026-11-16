# Architecture

## Stack

Next.js 16 (App Router, React 19 server components + server actions) ·
SQLite via better-sqlite3 (WAL, foreign keys on) · Tailwind 4 · pdfkit ·
nodemailer. One Node process, one persistent disk. No client-side data layer:
pages read the database directly on the server; every write is a server action.

## Layout

```
app/
  (app)/            staff app behind the login — one folder per module
  login/ reserve/ sign/[token]/        public pages
  api/              PDFs, document download, CSV export, reports, webhook, cron, health
components/         Shell, ui primitives, forms, charts, FacilityMap, SignaturePad, panels
lib/
  db.ts             the database (DATA_DIR/storage.db) and the DB wrapper
  bootstrap.ts      defaults, first facility and first admin
  auth.ts guard.ts roles.ts api.ts     sessions, capabilities, authorisation
  units.ts renters.ts agreements.ts    domain rules
  billing.ts payments.ts               invoices, proration, late fees, credits, payments, refunds, deposits
  reservations.ts files.ts migrate.ts origin.ts
  jobs.ts email.ts gateway.ts pdf.ts   automations, outbox, payment gateway hook, PDFs
  reports.ts report-data.ts            every figure on the dashboard and reports
  actions/          server actions, one file per area — the only write path
  seed.ts           example data for local testing (npm run seed:example)
db/schema.sql       the schema
tests/              node:test suite for the money rules
scripts/smoke-test.cjs   end-to-end browser test
```

The domain modules in `lib/` import nothing from Next, so they run under plain
Node in the tests.

## Schema (db/schema.sql)

```
facilities ─┬─ units ─────────────┬─ agreements ─┬─ invoices ── invoice_lines
            │                     │              │      │
            │   renters ──────────┘              │      ├─ payment_allocations ── payments ── refunds
            │      │                             │      └─ credit_applications ── credits
            │                                    ├─ deposit_transactions      (liability ledger)
            │                                    ├─ agreement_renewals
            └─ reservations (hold or waitlist)   └─ move_outs

documents (entity, entity_id)   audit_log   settings   taxes   counters
automations   jobs   email_outbox   payment_requests   gateway_events
users   sessions   login_attempts
```

Key constraints that carry the business rules:

| Constraint | Guarantees |
|---|---|
| `uq_invoice_period (agreement_id, period_start) WHERE kind='rent' AND status<>'void'` | no duplicate recurring invoice |
| `uq_agreement_unit_live (unit_id) WHERE status IN ('pending_signature','active')` | one live agreement per unit |
| `uq_reservation_unit_hold (unit_id) WHERE status IN ('pending','confirmed')` | one hold per unit |
| `uq_payment_reference (method, reference)` · `payments.idempotency_key UNIQUE` · `uq_payment_gateway_ref` | no duplicate payment |
| `jobs.dedupe_key UNIQUE` · `email_outbox.dedupe_key UNIQUE` | no duplicate job or reminder |
| `gateway_events.id PRIMARY KEY` | webhook replay is a no-op |
| amount `CHECK`s, status `CHECK`s, `ON DELETE RESTRICT` on financial links | history cannot be orphaned |

Every site-specific table carries `facility_id`; the header's facility picker
scopes every list, the dashboard and the reports. Adding a facility is a row,
not a migration.

## Billing cycle

1. Signing an agreement sets `next_period_start = start_date` and generates
   the first invoice.
2. Daily, `generate_invoices` creates each invoice `invoice_lead_days` before
   its period, advances `next_period_start`, applies any renter credit, and
   `send_invoices` queues the email with the PDF.
3. `due_reminders` / `overdue_reminders` / `late_fees` follow the due date.
4. `renewals` reminds, then applies the agreement's renewal option when a
   fixed term passes: auto-renew, roll to month-to-month, or end.
5. A scheduled move-out caps billing at the move-out date (final period
   prorated); completing it ends the agreement and frees the unit.

Period maths (`periodFor`): *anniversary* runs start-day to start-day, clamped
in short months; *fixed day* bills on the same day for everyone with a
prorated first partial month.

## Implementation phases

| Phase | Scope | Status |
|---|---|---|
| 1 — Core | Auth & roles, facilities, units, facility map, renters, agreements, invoicing, payments, deposits, dashboard, reports, audit log | Built |
| 2 — Operations | Automations & job queue, email outbox, PDF invoices/receipts/agreements, reservations & waitlist, CSV/PDF export, settings | Built |
| 3 — Customers | Built-in e-signature, public booking page | Built |
| 4 — Integrations | Payment gateway (hook + signed webhook ready; needs a provider account), real email provider credentials, external e-sign provider (fields reserved), SMS/WhatsApp reminders, accounting export | Integration points in place |
| 5 — Scale | Postgres instead of SQLite if more than one server is needed (SQL is confined to `lib/`), S3 for documents (`lib/files.ts`), per-facility user scoping, 2-factor sign-in | Not started |
