"use server";

import { guardRenter } from "../guard";
import { audit } from "../audit";
import { addDays, nowIso, today } from "../clock";
import { act, Form, UserError, type ActionState } from "../validate";
import { scheduleMoveOut } from "../agreements";
import { createPaymentRequest } from "../gateway";
import { processOutbox, queuePlain } from "../email";
import { formatDate, renterName } from "../format";

/** Every portal action re-checks that the record belongs to the signed-in renter. */
function own(ctx: Awaited<ReturnType<typeof guardRenter>>, table: "agreements" | "invoices", id: string) {
  const row = ctx.db.one<Record<string, any>>(`SELECT * FROM ${table} WHERE id = ? AND renter_id = ?`, [id, ctx.renterId]);
  if (!row) throw new UserError("That record was not found on your account.");
  return row;
}

function notifyOffice(ctx: Awaited<ReturnType<typeof guardRenter>>, subject: string, body: string) {
  const to = ctx.settings.business_email || ctx.settings.email_reply_to;
  if (to) queuePlain(ctx.db, { kind: "portal_request", to, subject, body });
}

export async function requestRenewalAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guardRenter();
    const ag = own(ctx, "agreements", String(form.get("agreement_id") ?? ""));
    if (ag.status !== "active") throw new UserError("This agreement is not active.");
    ctx.db.run(`UPDATE agreements SET renewal_requested_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), ag.id]);
    audit(ctx.db, ctx.actor, "renewal_request", "agreement", ag.id, `Renter asked to renew ${ag.agreement_no}`);
    const renter = ctx.db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [ctx.renterId])!;
    notifyOffice(ctx, `Renewal request — ${ag.agreement_no}`, `${renterName(renter)} asked from the customer portal to renew agreement ${ag.agreement_no}.`);
    await processOutbox(ctx.db);
    return { ok: "Thank you — we have your renewal request and will be in touch to confirm the new term." };
  });
}

export async function requestMoveOutAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guardRenter();
    const f = new Form(form);
    const ag = own(ctx, "agreements", f.req("agreement_id"));
    const date = f.date("move_out_date", { required: true, label: "Move-out date" });
    f.check();
    if (ag.status !== "active") throw new UserError("This agreement is not active.");
    const earliest = addDays(today(), ag.notice_days);
    if (date! < earliest) throw new UserError(`Your agreement asks for ${ag.notice_days} days' notice, so the earliest date is ${formatDate(earliest)}. Call us if you need to leave sooner.`);
    scheduleMoveOut(ctx.db, ctx.actor, ag.id, date!, "renter", f.str("notes", { max: 500 }));
    const renter = ctx.db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [ctx.renterId])!;
    notifyOffice(ctx, `Move-out request — ${ag.agreement_no}`, `${renterName(renter)} asked from the customer portal to move out on ${formatDate(date)} (${ag.agreement_no}). Confirm it on the agreement page.`);
    await processOutbox(ctx.db);
    return { ok: "We have your move-out request and will confirm the date with you." };
  });
}

/** Asks for an online payment link. The invoice stays unpaid until the gateway confirms the money. */
export async function portalPayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guardRenter();
    const inv = own(ctx, "invoices", String(form.get("invoice_id") ?? ""));
    const r = createPaymentRequest(ctx.db, ctx.actor, inv.id);
    await processOutbox(ctx.db);
    return { ok: r.url ? `Pay securely here: ${r.url}` : "We have emailed you the payment instructions. Your invoice will show as paid once we receive the money." };
  });
}
