"use server";

import { redirect } from "next/navigation";
import { guard, facilityOf } from "../guard";
import { audit } from "../audit";
import { nowIso, today } from "../clock";
import { act, Form, UserError, type ActionState } from "../validate";
import { addLine, applyCredits, createInvoice, recalcInvoice, voidInvoice, type LineInput } from "../billing";
import { PAYMENT_METHODS, PaymentError, recordPayment, reconcilePayments, refundPayment, unreconcile } from "../payments";
import { processOutbox, queueInvoiceEmail, queueReceiptEmail } from "../email";
import { createPaymentRequest } from "../gateway";
import { toBase } from "../settings";
import { createExpense, EXPENSE_CATEGORIES } from "../maintenance";

const LINE_KINDS = ["fee", "other", "discount"] as const;

function readLines(form: FormData): LineInput[] {
  const descs = form.getAll("line_description").map(String);
  const amounts = form.getAll("line_amount").map(String);
  const kinds = form.getAll("line_kind").map(String);
  const taxable = form.getAll("line_taxable").map(String);
  const lines: LineInput[] = [];
  descs.forEach((d, i) => {
    const description = d.trim();
    const raw = (amounts[i] ?? "").replace(/[,\s$]/g, "");
    if (!description && !raw) return;
    if (!description) throw new UserError(`Line ${i + 1} needs a description.`);
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) throw new UserError(`Line ${i + 1} needs an amount greater than zero.`);
    const kind = (LINE_KINDS as readonly string[]).includes(kinds[i]) ? (kinds[i] as LineInput["kind"]) : "other";
    lines.push({ kind, description: description.slice(0, 200), amount_cents: Math.round(Number(raw) * 100), taxable: taxable.includes(String(i)) });
  });
  return lines;
}

export async function createInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const f = new Form(form);
    const renterId = f.req("renter_id", { label: "Renter" });
    const agreementId = f.str("agreement_id");
    const issue = f.date("issue_date", { required: true, label: "Issue date" }) ?? today();
    const due = f.date("due_date", { required: true, label: "Due date" }) ?? today();
    const notes = f.text("notes", { max: 1000 });
    f.check();
    if (due < issue) throw new UserError("The due date cannot be before the issue date.", { due_date: "Too early" });
    if (!ctx.db.one(`SELECT 1 FROM renters WHERE id = ?`, [renterId])) throw new UserError("Choose a renter.");
    const lines = readLines(form);
    if (!lines.some((l) => l.kind !== "discount")) throw new UserError("Add at least one charge.");
    const ag = agreementId ? ctx.db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ? AND renter_id = ?`, [agreementId, renterId]) : null;
    if (agreementId && !ag) throw new UserError("That agreement does not belong to this renter.");
    const invoiceId = createInvoice(ctx.db, ctx.actor, {
      facility_id: ag?.facility_id ?? facilityOf(ctx, form), renter_id: renterId, agreement_id: ag?.id ?? null, unit_id: ag?.unit_id ?? null,
      kind: "one_off", issue_date: issue, due_date: due, notes, lines,
    });
    const no = ctx.db.one<{ invoice_no: string }>(`SELECT invoice_no FROM invoices WHERE id = ?`, [invoiceId])!;
    audit(ctx.db, ctx.actor, "create", "invoice", invoiceId, `Created ${no.invoice_no}`);
    redirect(`/invoices/${invoiceId}`);
  });
}

function editable(ctx: Awaited<ReturnType<typeof guard>>, invoiceId: string) {
  const inv = ctx.db.one<Record<string, any>>(`SELECT * FROM invoices WHERE id = ?`, [invoiceId]);
  if (!inv) throw new UserError("Invoice not found.");
  if (inv.status === "void") throw new UserError("A void invoice cannot be changed.");
  if (inv.status === "paid") throw new UserError("A paid invoice cannot be changed. Issue a new invoice or a credit instead.");
  return inv;
}

export async function addLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const f = new Form(form);
    const invoiceId = f.req("invoice_id");
    const kind = f.oneOf("kind", LINE_KINDS, { label: "Type" });
    const description = f.req("description", { max: 200 });
    const amount = f.cents("amount", { required: true, min: 1 }) ?? 0;
    const taxable = f.bool("taxable");
    f.check();
    const inv = editable(ctx, invoiceId);
    ctx.db.tx(() => {
      addLine(ctx.db, invoiceId, { kind, description, amount_cents: amount, taxable });
      recalcInvoice(ctx.db, invoiceId);
      const after = ctx.db.one<{ total_cents: number; paid_cents: number; credited_cents: number }>(`SELECT total_cents, paid_cents, credited_cents FROM invoices WHERE id = ?`, [invoiceId])!;
      if (after.total_cents < after.paid_cents + after.credited_cents) throw new UserError("That discount would take the invoice below what has already been paid.");
      audit(ctx.db, ctx.actor, "line", "invoice", invoiceId, `${kind === "discount" ? "Discount" : "Charge"} of ${(amount / 100).toFixed(2)} added to ${inv.invoice_no} — ${description}`);
    });
    return { ok: "Line added." };
  });
}

export async function removeLineAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const lineId = String(form.get("line_id") ?? "");
    const line = ctx.db.one<Record<string, any>>(`SELECT * FROM invoice_lines WHERE id = ?`, [lineId]);
    if (!line) throw new UserError("Line not found.");
    const inv = editable(ctx, line.invoice_id);
    if (line.kind === "rent" || line.kind === "prorated_rent") throw new UserError("The rent line cannot be removed. Void the invoice instead.");
    ctx.db.tx(() => {
      ctx.db.run(`DELETE FROM invoice_lines WHERE id = ?`, [lineId]);
      recalcInvoice(ctx.db, line.invoice_id);
      const after = ctx.db.one<{ total_cents: number; paid_cents: number; credited_cents: number }>(`SELECT total_cents, paid_cents, credited_cents FROM invoices WHERE id = ?`, [line.invoice_id])!;
      if (after.total_cents < after.paid_cents + after.credited_cents) throw new UserError("Removing that would take the invoice below what has already been paid.");
      audit(ctx.db, ctx.actor, "line", "invoice", line.invoice_id, `${line.kind === "late_fee" ? "Late fee waived" : "Line removed"} on ${inv.invoice_no} — ${line.description}`);
    });
    return { ok: line.kind === "late_fee" ? "Late fee waived." : "Line removed." };
  });
}

export async function voidInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const f = new Form(form);
    const invoiceId = f.req("invoice_id");
    const reason = f.req("reason", { max: 200 });
    f.check();
    voidInvoice(ctx.db, ctx.actor, invoiceId, reason);
    return { ok: "Invoice voided." };
  });
}

/** Queue the invoice email and try to deliver it straight away. Sending never changes what is owed. */
export async function sendInvoiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const invoiceId = String(form.get("invoice_id") ?? "");
    const inv = ctx.db.one<Record<string, any>>(`SELECT i.invoice_no, i.status, r.email FROM invoices i JOIN renters r ON r.id = i.renter_id WHERE i.id = ?`, [invoiceId]);
    if (!inv) throw new UserError("Invoice not found.");
    if (inv.status === "void") throw new UserError("A void invoice cannot be sent.");
    if (!inv.email) throw new UserError("This renter has no email address on file.");
    queueInvoiceEmail(ctx.db, invoiceId, String(Date.now()));
    const r = await processOutbox(ctx.db);
    audit(ctx.db, ctx.actor, "send", "invoice", invoiceId, `Emailed ${inv.invoice_no} to ${inv.email}`);
    return { ok: r.failed ? "Queued — delivery failed and will be retried automatically." : `Sent to ${inv.email}.` };
  });
}

export async function requestPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const r = createPaymentRequest(ctx.db, ctx.actor, String(form.get("invoice_id") ?? ""));
    await processOutbox(ctx.db);
    return { ok: `Payment request ${r.emailed ? "emailed" : "created (no email on file)"}. The invoice stays unpaid until the money is actually received.` };
  });
}

export async function applyCreditAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const invoiceId = String(form.get("invoice_id") ?? "");
    const applied = applyCredits(ctx.db, invoiceId);
    if (!applied) throw new UserError("There is no credit to apply.");
    audit(ctx.db, ctx.actor, "credit", "invoice", invoiceId, `Applied ${(applied / 100).toFixed(2)} of renter credit`);
    return { ok: "Credit applied." };
  });
}

export async function recordPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const f = new Form(form);
    const renterId = f.req("renter_id", { label: "Renter" });
    const tendered = f.cents("amount", { required: true, min: 1 }) ?? 0;
    const currency = f.oneOf("currency", ["USD", "AWG"] as const, { fallback: ctx.settings.base_currency });
    const method = f.oneOf("method", PAYMENT_METHODS.map((m) => m.value), { label: "Method" });
    const date = f.date("received_date", { required: true, label: "Date received" }) ?? today();
    const reference = f.str("reference", { max: 80 });
    const notes = f.str("notes", { max: 300 });
    const invoiceId = f.str("invoice_id");
    f.check();
    if (method !== "cash" && method !== "other" && !reference) {
      throw new UserError("Enter the transaction reference — it is how a payment is matched to the bank and how duplicates are caught.", { reference: "Required" });
    }
    const base = toBase(ctx.settings, tendered, currency);
    try {
      const result = recordPayment(ctx.db, ctx.actor, {
        renter_id: renterId, amount_cents: base.cents, method, received_date: date, reference, notes,
        invoice_ids: invoiceId ? [invoiceId] : [], spill: true,
        idempotency_key: f.str("idempotency_key", { max: 80 }), confirm_duplicate: f.bool("confirm_duplicate"),
        tendered_currency: currency, tendered_cents: tendered, fx_rate: base.rate,
      });
      if (f.bool("send_receipt")) {
        queueReceiptEmail(ctx.db, result.payment_id);
        await processOutbox(ctx.db);
      }
      if (form.get("stay") === "1") {
        return { ok: `${result.payment_no} recorded${result.credit_cents ? ` — ${(result.credit_cents / 100).toFixed(2)} left over is held as credit` : ""}.` };
      }
      redirect(`/payments/${result.payment_id}`);
    } catch (err) {
      if (err instanceof PaymentError) throw new UserError(err.message, err.code === "possible_duplicate" ? { confirm_duplicate: err.message } : err.code === "duplicate" ? { reference: err.message } : {});
      throw err;
    }
  });
}

export async function refundPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.refund");
    const f = new Form(form);
    const paymentId = f.req("payment_id");
    const amount = f.cents("amount", { required: true, min: 1 }) ?? 0;
    const method = f.oneOf("method", PAYMENT_METHODS.map((m) => m.value), { label: "Method" });
    const date = f.date("refund_date", { required: true, label: "Refund date" }) ?? today();
    const reference = f.str("reference", { max: 80 });
    const reason = f.req("reason", { max: 200 });
    f.check();
    try {
      refundPayment(ctx.db, ctx.actor, { payment_id: paymentId, amount_cents: amount, refund_date: date, method, reference, reason });
    } catch (err) {
      if (err instanceof PaymentError) throw new UserError(err.message);
      throw err;
    }
    return { ok: "Refund recorded. Affected invoices have been re-opened." };
  });
}

export async function reconcileAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const ids = form.getAll("payment_id").map(String).filter(Boolean);
    if (form.get("op") === "undo") {
      unreconcile(ctx.db, ctx.actor, ids[0]);
      return { ok: "Reconciliation removed." };
    }
    if (!ids.length) throw new UserError("Tick the payments that appear on the statement.");
    const n = reconcilePayments(ctx.db, ctx.actor, ids, String(form.get("statement_ref") ?? "").trim().slice(0, 80) || null);
    return { ok: `${n} payment${n === 1 ? "" : "s"} reconciled.` };
  });
}

export async function sendReceiptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const paymentId = String(form.get("payment_id") ?? "");
    ctx.db.run(`DELETE FROM email_outbox WHERE dedupe_key = ? AND status IN ('sent','dead')`, [`receipt:${paymentId}`]);
    if (!queueReceiptEmail(ctx.db, paymentId)) throw new UserError("This renter has no email address on file.");
    await processOutbox(ctx.db);
    return { ok: "Receipt emailed." };
  });
}

export async function saveExpenseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const f = new Form(form);
    const expenseId = f.str("id");
    const input = {
      facility_id: facilityOf(ctx, form),
      expense_date: f.date("expense_date", { required: true, label: "Date" }) ?? today(),
      category: f.oneOf("category", EXPENSE_CATEGORIES.map((c) => c.value)),
      vendor: f.str("vendor", { max: 120 }),
      description: f.req("description", { max: 200 }),
      amount_cents: f.cents("amount", { required: true, min: 1 }) ?? 0,
      method: f.str("method", { max: 40 }),
      reference: f.str("reference", { max: 80 }),
      maintenance_id: f.str("maintenance_id"),
      unit_id: f.str("unit_id"),
    };
    f.check();
    if (expenseId) {
      ctx.db.run(
        `UPDATE expenses SET facility_id = ?, expense_date = ?, category = ?, vendor = ?, description = ?, amount_cents = ?, method = ?, reference = ?, updated_at = ? WHERE id = ?`,
        [input.facility_id, input.expense_date, input.category, input.vendor, input.description, input.amount_cents, input.method, input.reference, nowIso(), expenseId],
      );
      audit(ctx.db, ctx.actor, "update", "expense", expenseId, `Updated expense — ${input.description}`);
    } else {
      createExpense(ctx.db, ctx.actor, input);
    }
    return { ok: "Expense saved." };
  });
}

export async function deleteExpenseAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const expenseId = String(form.get("id") ?? "");
    const e = ctx.db.one<Record<string, any>>(`SELECT * FROM expenses WHERE id = ?`, [expenseId]);
    if (!e) throw new UserError("Expense not found.");
    ctx.db.run(`DELETE FROM expenses WHERE id = ?`, [expenseId]);
    audit(ctx.db, ctx.actor, "delete", "expense", expenseId, `Deleted expense ${(e.amount_cents / 100).toFixed(2)} — ${e.description}`);
    return { ok: "Expense deleted." };
  });
}
