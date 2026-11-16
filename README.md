# Everyday Storage HQ

The all-in-one management platform for Everyday Storage Aruba: units, a live
facility map, renters, rental agreements with e-signature, automatic monthly
invoicing, payments and deposits, financial reports, automations, reservations
and a public booking page.

Built on the same stack and design system as Coralux HQ — Next.js (App Router,
server actions), SQLite, Tailwind, role-based sessions, deployed to Render from
GitHub — rebranded in Everyday Storage's green and orange, with light and dark
mode.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

Sign in with `admin@everydaystorage.aw` / `storage2026` (local default — set
`ADMIN_EMAIL` / `ADMIN_PASSWORD` to choose your own). Once signed in, the
demo workspace is under the account menu → **Open demo workspace**.

```bash
npm test               # billing, payment and deposit rules (15 tests)
npm run smoke          # end-to-end browser test of the real UI (needs the app running + Playwright)
npm run typecheck
npm run build && npm start
```

## Live data and demo data never mix

There are two **separate database files**:

| Workspace | File | What it holds |
|---|---|---|
| Live | `DATA_DIR/storage.db` | Your real units, renters, invoices and payments. Starts empty. |
| Demo | `DATA_DIR/demo/storage-demo.db` | 14 months of believable example data, built by running the real billing engine. |

A session belongs to one workspace; every library function is handed the
database it must use, so nothing can cross over. The demo has its own uploads
folder, an orange banner on every screen, and can never send real email. Reset
it any time under Settings → Integrations & data. Set `DEMO_WORKSPACE=off` to
remove it entirely.

Demo logins (password `demo-storage`): `demo@…` (owner), `manager@…`,
`staff@everydaystorage.aw`. Only staff sign in — customers have no accounts.

## Modules

| Module | Where | Notes |
|---|---|---|
| Dashboard | `/` | Occupancy, MRR, outstanding, overdue, expiring agreements, charts |
| Storage units | `/units` | Storage unit or warehouse; Small (1.5 × 3 × 2.4 m), Standard (3 × 3 × 2.4 m) or Large (any size). All sizes in metres. Status is derived, never typed |
| Facility map | `/map` | Colour-coded grid per facility; click a unit for details; "Arrange layout" to move/resize |
| Renters | `/renters` | Contact details, encrypted ID number, documents, balances, several units each |
| Agreements | `/agreements` | Fixed-term and month-to-month, deposit, renewal option, e-signature, elapsed/remaining, move-out workflow |
| Invoices | `/invoices` | Automatic per billing cycle, proration, late fees, discounts, credits, PDF, email |
| Payments | `/payments` | Part payments, allocation, refunds, reconciliation, duplicate guards, deposit ledger |
| Reports | `/reports` | Revenue, collections, receivables aging, occupancy, forecast; CSV and PDF |
| Automations | `/automations` | Rules, email outbox, job log, run-now |
| Reservations | `/reservations` | Online requests, holds, convert to agreement; copy the full public booking link from here |
| Booking page | public `/reserve` | Customers choose Small, Standard or Warehouse (with square metres) at the standard prices from Settings → Prices. No customer sign-in |
| Settings | `/settings` | Business, standard prices, USD/AWG, taxes, billing rules, invoice template, notifications, users, facilities, terms |
| Audit log | `/audit` | Who did what, when; append-only |

## The rules the money follows

- **Money is integer cents** in one base currency (USD or AWG). Florin
  payments are converted at the configured rate (default 1.79) when recorded.
- **One invoice per agreement per period.** Each agreement remembers the next
  period to bill, and a unique index on `(agreement_id, period_start)` makes a
  second invoice impossible even if billing runs twice or two runs race.
- **An invoice is only paid by a payment.** Emailing it, sending a reminder or
  sending a payment request never changes what is owed. The only automated
  path is the gateway webhook, and only for a signed "payment succeeded" event.
- **The same payment cannot be booked twice.** A per-form idempotency key, a
  unique `(method, reference)` index, and a same-renter/amount/date/method
  check that must be explicitly confirmed.
- **Security deposits are a liability, not revenue.** They live in their own
  ledger (`deposit_transactions`) and never touch invoices or payments unless
  applied to an unpaid invoice or forfeited.
- **Revenue** = invoiced charges net of discounts and goodwill credits,
  excluding tax, in the month of the billing period. **Collected** = money
  received, by date, net of refunds.
- **Unit status is derived**: occupied › unavailable › reserved › available,
  from agreements, the offline switch and holds.

## Roles

| Role | Can |
|---|---|
| Staff | Units, map, renters, reservations. No financial data. |
| Manager | + agreements, invoices, payments, reports, renter ID numbers |
| Admin | + refunds and deposit refunds, settings, automations, users, audit log |
| Owner | Everything; cannot be demoted or disabled by an admin |

Capabilities are one table in `lib/roles.ts`, checked on the server for every
page (`requireStaff`), every action (`guard`) and every download (`authorize`).

## Security

- Passwords: scrypt. Sessions: random token in an httpOnly, SameSite cookie;
  only its SHA-256 is stored. Sign-in is rate-limited per email and per IP.
- Renter ID numbers are AES-256-GCM encrypted with `APP_SECRET`, shown only to
  managers on request (and that view is audited), and never exported.
- Only staff accounts can sign in; there are no customer logins.
- Documents are stored outside the web root under random names, checked by
  type and magic bytes, and served only through `/api/files/[id]`, which
  re-checks the session and the record.
- Every form is validated on the server; SQL is parameterised; sort columns
  are whitelisted; CSV exports are guarded against formula injection.
- Security headers (nosniff, frame deny, referrer policy, HSTS in production).
- Every create, change, payment, refund, export and settings change is written
  to the audit log.

## Background jobs

`lib/jobs.ts` is a small durable queue in the database: idempotent enqueue
(`dedupe_key`), compare-and-set claiming, retries with exponential backoff,
and a `dead` state for a person to review. The scheduler ticks every minute
inside the web process (the database file lives on this service's disk) and
queues the daily run once the configured hour has passed. `POST /api/cron`
(with `CRON_SECRET`) runs the same tick for an external scheduler.

Email goes through an outbox table with the same guarantees, so "overdue
reminder, stage 7 days, invoice X" is sent at most once.

## Deploying to Render

1. Push this repository to GitHub.
2. Render → **New → Blueprint** → pick the repo → **Apply** (`render.yaml`
   creates the service and a 5 GB persistent disk at `/var/data`).
3. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `APP_URL` in the service's
   Environment tab. `APP_SECRET` is generated for you — keep a copy.
4. Optional: `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` (or SMTP) for real email.

**Back up** `/var/data/storage.db` and `/var/data/uploads/` regularly.

**Upgrades** run themselves: on start, `lib/migrate.ts` brings an older
database up to date (tracked by SQLite's `user_version`). The demo workspace is
simply rebuilt.

## Before going live

- Confirm with your accountant whether and at what rate BBO/BAZV/BAVP apply,
  then enable the tax under Settings → Currency & tax (it ships switched off).
- Have the standard agreement terms (Settings → Agreement terms) reviewed by a
  lawyer, and confirm the built-in e-signature meets your needs under Aruban law.
- Add your bank details under Settings → Invoice template → How to pay.
- Connect an email provider; until then messages are recorded but not sent.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the schema, code layout
and implementation phases.
