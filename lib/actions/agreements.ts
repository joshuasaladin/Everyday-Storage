"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { guard } from "../guard";
import { audit } from "../audit";
import { nowIso, today } from "../clock";
import { act, Form, UserError, type ActionState } from "../validate";
import {
  cancelAgreement, cancelMoveOut, completeMoveOut, confirmMoveOut, createAgreement, issueSignLink, renewAgreement,
  scheduleMoveOut, setMoveOutStep, signAgreement, type AgreementInput,
} from "../agreements";
import { generateDueInvoices } from "../billing";
import { recordDeposit } from "../payments";
import { processOutbox, queueAgreementNotice, queueInvoiceEmail } from "../email";
import { PAYMENT_METHODS } from "../payments";

async function origin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createAgreementAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("agreements.edit");
    const f = new Form(form);
    const unitId = f.req("unit_id", { label: "Unit" });
    const renterId = f.req("renter_id", { label: "Renter" });
    const termType = f.oneOf("term_type", ["fixed", "month_to_month"] as const, { label: "Term" });
    const input: AgreementInput = {
      facility_id: "",
      unit_id: unitId,
      renter_id: renterId,
      reservation_id: f.str("reservation_id"),
      term_type: termType,
      start_date: f.date("start_date", { required: true, label: "Start date" }) ?? today(),
      term_months: termType === "fixed" ? f.int("term_months", { required: true, min: 1, max: 120, label: "Term length" }) : null,
      monthly_rate_cents: f.cents("monthly_rate", { required: true, label: "Monthly rate" }) ?? 0,
      deposit_cents: f.cents("deposit", { label: "Security deposit" }) ?? 0,
      discount_cents: f.cents("discount", { label: "Monthly discount" }) ?? 0,
      discount_note: f.str("discount_note", { max: 120 }),
      billing_mode: f.oneOf("billing_mode", ["anniversary", "fixed_day"] as const, { label: "Billing cycle" }),
      billing_day: f.int("billing_day", { min: 1, max: 28, label: "Billing day" }) ?? 1,
      prorate_first: f.bool("prorate_first") ? 1 : 0,
      renewal_option: f.oneOf("renewal_option", ["auto_renew", "month_to_month", "end"] as const, { fallback: "month_to_month", label: "Renewal option" }),
      renewal_term_months: f.int("renewal_term_months", { min: 1, max: 120, label: "Renewal term" }),
      notice_days: f.int("notice_days", { min: 0, max: 365, label: "Notice period" }) ?? 30,
      notes: f.text("notes", { max: 4000 }),
    };
    f.check();
    const unit = ctx.db.one<{ facility_id: string }>(`SELECT facility_id FROM units WHERE id = ?`, [unitId]);
    if (!unit) throw new UserError("Choose a unit.", { unit_id: "Choose a unit." });
    if (!ctx.db.one(`SELECT 1 FROM renters WHERE id = ?`, [renterId])) throw new UserError("Choose a renter.", { renter_id: "Choose a renter." });
    if (input.discount_cents > input.monthly_rate_cents) throw new UserError("The discount cannot be more than the rent.", { discount: "Too high" });
    input.facility_id = unit.facility_id;
    const agId = createAgreement(ctx.db, ctx.actor, input);
    redirect(`/agreements/${agId}`);
  });
}

/** Staff-side signing: the renter signs on this screen, or a paper copy has been signed. */
export async function signAgreementAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("agreements.edit");
    const f = new Form(form);
    const agId = f.req("id");
    const method = f.oneOf("method", ["in-person", "paper"] as const);
    const name = f.req("signed_name", { max: 120, label: "Signer's name" });
    f.check();
    const h = await headers();
    signAgreement(ctx.db, ctx.actor, agId, {
      name, method, signature_png: method === "in-person" ? String(form.get("signature") ?? "") : null,
      ip: ctx.actor.ip, user_agent: h.get("user-agent"),
    });
    for (const inv of ctx.db.all<{ id: string }>(`SELECT id FROM invoices WHERE agreement_id = ? AND sent_at IS NULL`, [agId])) queueInvoiceEmail(ctx.db, inv.id);
    return { ok: "Signed. The agreement is active and billing has started." };
  });
}

export async function sendSignLinkAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("agreements.edit");
    const agId = String(form.get("id") ?? "");
    const ag = ctx.db.one<{ status: string }>(`SELECT status FROM agreements WHERE id = ?`, [agId]);
    if (!ag || ag.status !== "pending_signature") throw new UserError("This agreement is not awaiting a signature.");
    const token = issueSignLink(ctx.db, ctx.actor, agId);
    const link = `${await origin()}/sign/${token}`;
    const emailed = queueAgreementNotice(ctx.db, agId, "sign_request", token.slice(0, 8), { link });
    await processOutbox(ctx.db);
    return { ok: `${emailed ? "Emailed to the renter. " : "No email on file — share this link yourself. "}${link}` };
  });
}

export async function cancelAgreementAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("agreements.edit");
    cancelAgreement(ctx.db, ctx.actor, String(form.get("id") ?? ""), String(form.get("reason") ?? "").trim() || "Cancelled before signing");
    return { ok: "Agreement cancelled and the unit released." };
  });
}

/** Changes that are allowed on a running agreement. The signed terms themselves are never rewritten. */
export async function updateAgreementAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("agreements.edit");
    const f = new Form(form);
    const agId = f.req("id");
    const rate = f.cents("monthly_rate", { required: true, label: "Monthly rate" }) ?? 0;
    const discount = f.cents("discount", { label: "Monthly discount" }) ?? 0;
    const discountNote = f.str("discount_note", { max: 120 });
    const renewal = f.oneOf("renewal_option", ["auto_renew", "month_to_month", "end"] as const, { fallback: "month_to_month", label: "Renewal option" });
    const renewalTerm = f.int("renewal_term_months", { min: 1, max: 120, label: "Renewal term" });
    const notice = f.int("notice_days", { min: 0, max: 365, label: "Notice period" }) ?? 30;
    const notes = f.text("notes", { max: 4000 });
    f.check();
    const ag = ctx.db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ?`, [agId]);
    if (!ag || !["active", "pending_signature"].includes(ag.status)) throw new UserError("Only a live agreement can be changed.");
    if (discount > rate) throw new UserError("The discount cannot be more than the rent.");
    ctx.db.run(
      `UPDATE agreements SET monthly_rate_cents = ?, discount_cents = ?, discount_note = ?, renewal_option = ?, renewal_term_months = ?,
              notice_days = ?, notes = ?, updated_at = ? WHERE id = ?`,
      [rate, discount, discountNote, ag.term_type === "fixed" ? renewal : "month_to_month", renewalTerm, notice, notes, nowIso(), agId],
    );
    const changes = [
      rate !== ag.monthly_rate_cents && `rate ${(ag.monthly_rate_cents / 100).toFixed(2)} → ${(rate / 100).toFixed(2)}`,
      discount !== ag.discount_cents && `discount ${(ag.discount_cents / 100).toFixed(2)} → ${(discount / 100).toFixed(2)}`,
      renewal !== ag.renewal_option && ag.term_type === "fixed" && `renewal option → ${renewal}`,
    ].filter(Boolean);
    audit(ctx.db, ctx.actor, "update", "agreement", agId, `Updated ${ag.agreement_no}${changes.length ? `: ${changes.join(", ")}` : ""} (applies to future invoices)`);
    return { ok: "Saved. Changes apply to invoices generated from now on." };
  });
}

export async function renewAgreementAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("agreements.edit");
    const f = new Form(form);
    const agId = f.req("id");
    const months = f.int("months", { required: true, min: 1, max: 120, label: "Renewal term" }) ?? 12;
    const rate = f.cents("new_rate", { label: "New monthly rate" });
    const note = f.str("note", { max: 200 });
    f.check();
    renewAgreement(ctx.db, ctx.actor, agId, months, rate, note);
    return { ok: "Agreement renewed." };
  });
}

export async function moveOutAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("agreements.edit");
    const f = new Form(form);
    const op = f.oneOf("op", ["schedule", "confirm", "cancel", "complete", "step"] as const);
    f.check();
    if (op === "schedule") {
      const date = f.date("move_out_date", { required: true, label: "Move-out date" });
      f.check();
      scheduleMoveOut(ctx.db, ctx.actor, f.req("agreement_id"), date!, "staff", f.str("notes", { max: 500 }));
      return { ok: "Move-out scheduled. Billing will stop on that date." };
    }
    const moveOutId = f.req("move_out_id");
    if (op === "confirm") confirmMoveOut(ctx.db, ctx.actor, moveOutId);
    if (op === "cancel") cancelMoveOut(ctx.db, ctx.actor, moveOutId);
    if (op === "step") setMoveOutStep(ctx.db, moveOutId, f.req("step"), form.get("done") === "1");
    if (op === "complete") {
      completeMoveOut(ctx.db, ctx.actor, moveOutId);
      return { ok: "Move-out completed. The agreement has ended and the unit is free." };
    }
    return { ok: "Saved." };
  });
}

export async function depositAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const f = new Form(form);
    const type = f.oneOf("type", ["collected", "refunded", "applied", "forfeited"] as const);
    // taking money in is routine; giving it back or keeping it is an admin decision
    const ctx = await guard(type === "collected" || type === "applied" ? "finance.edit" : "finance.refund");
    const agreementId = f.req("agreement_id");
    const amount = f.cents("amount", { required: true, min: 1 }) ?? 0;
    const date = f.date("txn_date", { required: true, label: "Date" }) ?? today();
    const method = type === "collected" || type === "refunded" ? f.oneOf("method", PAYMENT_METHODS.map((m) => m.value), { label: "Method" }) : null;
    const reference = f.str("reference", { max: 80 });
    const notes = f.str("notes", { max: 300 });
    f.check();
    if (date > today()) throw new UserError("The date cannot be in the future.");
    recordDeposit(ctx.db, ctx.actor, { agreement_id: agreementId, type, amount_cents: amount, txn_date: date, method, reference, notes, idempotency_key: f.str("idempotency_key", { max: 80 }) });
    return { ok: "Deposit ledger updated." };
  });
}

export async function generateNowAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const agreementId = String(form.get("agreement_id") ?? "") || undefined;
    const r = generateDueInvoices(ctx.db, { agreementId, actor: ctx.actor });
    return { ok: r.created.length ? `${r.created.length} invoice${r.created.length === 1 ? "" : "s"} generated.` : "Nothing is due to be invoiced yet." };
  });
}
