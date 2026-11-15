import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryDb, id, type DB } from "../lib/db";
import { SYSTEM } from "../lib/audit";
import { nowIso } from "../lib/clock";
import { saveSettings } from "../lib/settings";
import { createUnit, syncUnitStatus } from "../lib/units";
import { createRenter } from "../lib/renters";
import { createAgreement, signAgreement, scheduleMoveOut, processTermEnds, contractProgress } from "../lib/agreements";
import { applyLateFees, generateDueInvoices, periodFor, voidInvoice, type AgreementRow } from "../lib/billing";
import { depositHeld, PaymentError, recordDeposit, recordPayment, refundPayment } from "../lib/payments";
import { monthlySeries } from "../lib/reports";
import { runAutomation } from "../lib/jobs";
import { createPaymentRequest } from "../lib/gateway";

process.env.SHQ_TODAY = "2026-03-10";

function setup(opts: { mode?: "anniversary" | "fixed_day"; start?: string; term?: number | null; renewal?: "auto_renew" | "month_to_month" | "end" } = {}) {
  const db = memoryDb();
  saveSettings(db, { invoice_lead_days: 0, late_fee_grace_days: 5, late_fee_flat_cents: 2500 });
  const fac = id();
  db.run(`INSERT INTO facilities (id, code, name, created_at, updated_at) VALUES (?, 'T', 'Test', ?, ?)`, [fac, nowIso(), nowIso()]);
  const unit = createUnit(db, { facility_id: fac, unit_number: "A1", type: "standard", size_label: "small", width_ft: 5, depth_ft: 5, height_ft: 8, location: null, monthly_price_cents: 10000, offline: 0, available_from: null, features: null, notes: null });
  const renter = createRenter(db, { kind: "individual", first_name: "Test", last_name: "Renter", company: null, email: "t@example.com", phone: null, phone_alt: null, id_type: null, id_number: "A1234567", address: null, city: null, country: null, emergency_name: null, emergency_phone: null, emergency_relation: null, notes: null });
  const term = opts.term === undefined ? 12 : opts.term;
  const ag = createAgreement(db, SYSTEM, {
    facility_id: fac, unit_id: unit, renter_id: renter, term_type: term ? "fixed" : "month_to_month", start_date: opts.start ?? "2026-01-15", term_months: term,
    monthly_rate_cents: 10000, deposit_cents: 10000, discount_cents: 0, discount_note: null, billing_mode: opts.mode ?? "fixed_day", billing_day: 1, prorate_first: 1,
    renewal_option: opts.renewal ?? "month_to_month", renewal_term_months: term, notice_days: 30, notes: null,
  });
  db.run(`UPDATE agreements SET status = 'active', signed_at = ?, next_period_start = start_date WHERE id = ?`, [nowIso(), ag]);
  return { db, fac, unit, renter, ag };
}
const invoices = (db: DB) => db.all<Record<string, any>>(`SELECT * FROM invoices ORDER BY period_start`);

test("fixed-day billing prorates the first partial month, then bills whole months", () => {
  const { db } = setup();
  generateDueInvoices(db, { asOf: "2026-03-10" });
  const inv = invoices(db);
  assert.deepEqual(inv.map((i) => [i.period_start, i.period_end, i.total_cents]), [
    ["2026-01-15", "2026-01-31", 5484], // 17 of 31 days of 100.00
    ["2026-02-01", "2026-02-28", 10000],
    ["2026-03-01", "2026-03-31", 10000],
  ]);
});

test("anniversary billing runs start-day to start-day and clamps short months", () => {
  const ag = { start_date: "2026-01-31", billing_mode: "anniversary", billing_day: 1, prorate_first: 1, term_type: "month_to_month", renewal_option: "month_to_month", end_date: null, move_out_date: null } as unknown as AgreementRow;
  assert.deepEqual([periodFor(ag, "2026-01-31").end, periodFor(ag, "2026-02-28").end, periodFor(ag, "2026-03-31").end], ["2026-02-27", "2026-03-30", "2026-04-29"]);
});

test("running billing twice never creates a second invoice for the same period", () => {
  const { db, ag } = setup();
  const first = generateDueInvoices(db, { asOf: "2026-03-10" });
  const again = generateDueInvoices(db, { asOf: "2026-03-10" });
  assert.equal(first.created.length, 3);
  assert.equal(again.created.length, 0);
  // even if the cursor is wound back (a crash mid-run), the unique index holds
  db.run(`UPDATE agreements SET next_period_start = '2026-02-01' WHERE id = ?`, [ag]);
  const replay = generateDueInvoices(db, { asOf: "2026-03-10" });
  assert.equal(replay.created.length, 0);
  assert.equal(invoices(db).length, 3);
  assert.throws(() => db.run(`INSERT INTO invoices (id, invoice_no, facility_id, renter_id, agreement_id, kind, period_start, issue_date, due_date, created_at, updated_at) SELECT 'dup', 'DUP', facility_id, renter_id, agreement_id, 'rent', period_start, issue_date, due_date, created_at, updated_at FROM invoices LIMIT 1`), /UNIQUE/);
});

test("partial payments, overpayment credit and auto-applied credit", () => {
  const { db, renter } = setup();
  generateDueInvoices(db, { asOf: "2026-02-10" });
  const [jan, feb] = invoices(db);
  recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 2000, method: "cash", received_date: "2026-01-20", invoice_ids: [jan.id], spill: false });
  assert.deepEqual(db.one(`SELECT status, balance_cents FROM invoices WHERE id = ?`, [jan.id]), { status: "partial", balance_cents: 3484 });
  // pays the rest of January, all of February, and 50.00 over
  const r = recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 3484 + 10000 + 5000, method: "bank_transfer", reference: "BT-1", received_date: "2026-02-02" });
  assert.equal(r.credit_cents, 5000);
  assert.equal(db.one<any>(`SELECT status FROM invoices WHERE id = ?`, [feb.id]).status, "paid");
  generateDueInvoices(db, { asOf: "2026-03-10" });
  const mar = invoices(db)[2];
  assert.deepEqual([mar.credited_cents, mar.balance_cents, mar.status], [5000, 5000, "partial"]);
});

test("the same payment cannot be recorded twice", () => {
  const { db, renter } = setup();
  generateDueInvoices(db, { asOf: "2026-03-10" });
  const a = recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 5484, method: "bank_transfer", reference: "BT-77", received_date: "2026-01-16", idempotency_key: "k1" });
  // a double-submitted form returns the first payment
  const b = recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 5484, method: "bank_transfer", reference: "BT-77", received_date: "2026-01-16", idempotency_key: "k1" });
  assert.equal(b.duplicate, true);
  assert.equal(b.payment_id, a.payment_id);
  // the same bank reference is refused outright
  assert.throws(() => recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 100, method: "bank_transfer", reference: "BT-77", received_date: "2026-02-01" }), (e: unknown) => e instanceof PaymentError && e.code === "duplicate");
  // same renter, amount, date and method needs an explicit confirmation
  recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 1000, method: "cash", received_date: "2026-02-03" });
  assert.throws(() => recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 1000, method: "cash", received_date: "2026-02-03" }), (e: unknown) => e instanceof PaymentError && e.code === "possible_duplicate");
  recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 1000, method: "cash", received_date: "2026-02-03", confirm_duplicate: true });
  assert.equal(db.num(`SELECT COUNT(*) FROM payments`), 3);
});

test("a refund re-opens the invoice by exactly the amount refunded", () => {
  const { db, renter } = setup();
  generateDueInvoices(db, { asOf: "2026-02-10" });
  const feb = invoices(db)[1];
  const p = recordPayment(db, SYSTEM, { renter_id: renter, amount_cents: 10000, method: "card", reference: "POS-1", received_date: "2026-02-01", invoice_ids: [feb.id], spill: false });
  refundPayment(db, SYSTEM, { payment_id: p.payment_id, amount_cents: 4000, refund_date: "2026-02-05", method: "card", reason: "test" });
  assert.deepEqual(db.one(`SELECT status, paid_cents, balance_cents FROM invoices WHERE id = ?`, [feb.id]), { status: "partial", paid_cents: 6000, balance_cents: 4000 });
  assert.throws(() => refundPayment(db, SYSTEM, { payment_id: p.payment_id, amount_cents: 7000, refund_date: "2026-02-05", method: "card", reason: "too much" }), PaymentError);
});

test("late fees are added once, after the grace period", () => {
  const { db } = setup();
  generateDueInvoices(db, { asOf: "2026-03-10", issueOnPeriodStart: true });
  // Jan and Feb are long past due + 5 days; March (due 1 Mar) is only late from 7 Mar
  assert.equal(applyLateFees(db, { asOf: "2026-03-06" }).length, 2);
  assert.equal(applyLateFees(db, { asOf: "2026-03-07" }).length, 1);
  assert.equal(applyLateFees(db, { asOf: "2026-03-12" }).length, 0);
  assert.equal(db.num(`SELECT COUNT(*) FROM invoice_lines WHERE kind = 'late_fee'`), 3);
  assert.equal(invoices(db)[1].total_cents, 12500);
});

test("security deposits never count as revenue or as collections", () => {
  const { db, ag, renter, fac } = setup();
  recordDeposit(db, SYSTEM, { agreement_id: ag, type: "collected", amount_cents: 10000, txn_date: "2026-01-15", method: "cash" });
  generateDueInvoices(db, { asOf: "2026-01-20" });
  const jan = monthlySeries(db, ["2026-01"], fac)[0];
  assert.deepEqual([jan.revenue, jan.collected, jan.depositsIn], [5484, 0, 10000]);
  assert.equal(db.num(`SELECT COUNT(*) FROM payments`), 0);
  // applying it to an invoice pays the invoice but is still not new cash
  recordDeposit(db, SYSTEM, { agreement_id: ag, type: "applied", amount_cents: 5484, txn_date: "2026-01-25" });
  assert.equal(depositHeld(db, ag), 4516);
  assert.equal(monthlySeries(db, ["2026-01"], fac)[0].collected, 0);
  assert.equal(db.one<any>(`SELECT status FROM invoices`).status, "paid");
  assert.throws(() => recordDeposit(db, SYSTEM, { agreement_id: ag, type: "refunded", amount_cents: 9999, txn_date: "2026-01-26", method: "cash" }), PaymentError);
  void renter;
});

test("sending a payment request does not mark the invoice paid", () => {
  const { db } = setup();
  generateDueInvoices(db, { asOf: "2026-01-20" });
  const inv = invoices(db)[0];
  createPaymentRequest(db, SYSTEM, inv.id);
  assert.deepEqual(db.one(`SELECT status, paid_cents, balance_cents FROM invoices WHERE id = ?`, [inv.id]), { status: "open", paid_cents: 0, balance_cents: 5484 });
  assert.equal(db.num(`SELECT COUNT(*) FROM payments`), 0);
  assert.equal(db.one<any>(`SELECT status FROM payment_requests`).status, "sent");
});

test("a move-out stops billing on the move-out date with a prorated final invoice", () => {
  const { db, ag } = setup({ term: null });
  generateDueInvoices(db, { asOf: "2026-02-10" });
  scheduleMoveOut(db, SYSTEM, ag, "2026-03-15", "staff", null);
  generateDueInvoices(db, { asOf: "2026-04-20" });
  const inv = invoices(db);
  assert.equal(inv.length, 3);
  assert.deepEqual([inv[2].period_start, inv[2].period_end, inv[2].total_cents], ["2026-03-01", "2026-03-15", 4839]);
});

test("fixed terms renew, roll to month-to-month or end as the agreement says", () => {
  for (const [renewal, expect] of [["auto_renew", { status: "active", term_type: "fixed", end_date: "2026-08-31" }], ["month_to_month", { status: "active", term_type: "month_to_month", end_date: null }], ["end", { status: "ended", term_type: "fixed", end_date: "2026-02-28" }]] as const) {
    const { db, ag, unit } = setup({ start: "2025-09-01", term: 6, renewal });
    syncUnitStatus(db, unit);
    processTermEnds(db, "2026-03-10");
    assert.deepEqual(db.one(`SELECT status, term_type, end_date FROM agreements WHERE id = ?`, [ag]), expect);
    assert.equal(db.one<any>(`SELECT status FROM units WHERE id = ?`, [unit]).status, renewal === "end" ? "available" : "occupied");
  }
});

test("elapsed and remaining months", () => {
  const p = contractProgress({ start_date: "2026-01-15", end_date: "2027-01-14", term_type: "fixed", status: "active" }, "2026-03-10");
  assert.deepEqual([p.elapsedMonths, p.remainingMonths, p.remainingDays], [1, 10, 311]);
});

test("reminders are queued once per stage, however often the automation runs", () => {
  const { db } = setup();
  generateDueInvoices(db, { asOf: "2026-03-10", issueOnPeriodStart: true });
  runAutomation(db, "overdue_reminders", "2026-03-10");
  runAutomation(db, "overdue_reminders", "2026-03-10");
  // Jan (54 days → stage 30), Feb (37 → 30), Mar (9 → 7): one email each
  assert.equal(db.num(`SELECT COUNT(*) FROM email_outbox WHERE kind = 'overdue_reminder'`), 3);
  runAutomation(db, "overdue_reminders", "2026-03-16"); // March reaches stage 14
  assert.equal(db.num(`SELECT COUNT(*) FROM email_outbox WHERE kind = 'overdue_reminder'`), 4);
});

test("signing activates the agreement, occupies the unit and bills the first period; voiding hands credit back", () => {
  const { db, fac, renter } = setup();
  const unit2 = createUnit(db, { facility_id: fac, unit_number: "A2", type: "standard", size_label: "small", width_ft: 5, depth_ft: 5, height_ft: 8, location: null, monthly_price_cents: 8000, offline: 0, available_from: null, features: null, notes: null });
  const ag2 = createAgreement(db, SYSTEM, { facility_id: fac, unit_id: unit2, renter_id: renter, term_type: "month_to_month", start_date: "2026-03-10", term_months: null, monthly_rate_cents: 8000, deposit_cents: 0, discount_cents: 0, discount_note: null, billing_mode: "anniversary", billing_day: 1, prorate_first: 1, renewal_option: "month_to_month", renewal_term_months: null, notice_days: 30, notes: null });
  assert.equal(db.one<any>(`SELECT status FROM units WHERE id = ?`, [unit2]).status, "reserved");
  assert.throws(() => createAgreement(db, SYSTEM, { facility_id: fac, unit_id: unit2, renter_id: renter, term_type: "month_to_month", start_date: "2026-03-10", term_months: null, monthly_rate_cents: 8000, deposit_cents: 0, discount_cents: 0, discount_note: null, billing_mode: "anniversary", billing_day: 1, prorate_first: 1, renewal_option: "month_to_month", renewal_term_months: null, notice_days: 30, notes: null }), /already under an agreement/);
  signAgreement(db, SYSTEM, ag2, { name: "Test Renter", method: "paper" });
  assert.equal(db.one<any>(`SELECT status FROM units WHERE id = ?`, [unit2]).status, "occupied");
  const inv = db.one<any>(`SELECT * FROM invoices WHERE agreement_id = ?`, [ag2]);
  assert.deepEqual([inv.period_start, inv.period_end, inv.total_cents], ["2026-03-10", "2026-04-09", 8000]);
  voidInvoice(db, SYSTEM, inv.id, "test");
  assert.equal(db.one<any>(`SELECT status, balance_cents FROM invoices WHERE id = ?`, [inv.id]).status, "void");
});

test("ID numbers are encrypted at rest", () => {
  const { db, renter } = setup();
  const row = db.one<any>(`SELECT id_number_enc, id_last4 FROM renters WHERE id = ?`, [renter]);
  assert.ok(row.id_number_enc.startsWith("v1:"));
  assert.ok(!row.id_number_enc.includes("A1234567"));
  assert.equal(row.id_last4, "4567");
});
