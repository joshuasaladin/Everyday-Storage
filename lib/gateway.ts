import { id, type DB } from "./db";
import { audit, SYSTEM, type Actor } from "./audit";
import { nowIso, today } from "./clock";
import { hmac, safeEqual } from "./crypto";
import { getSettings } from "./settings";
import { recordPayment } from "./payments";
import { queuePlain } from "./email";
import { formatDate, money, renterName } from "./format";

/**
 * Payment-gateway integration point.
 *
 * The rule this file enforces: asking for money is not receiving money.
 * createPaymentRequest() and its email only ever write to payment_requests.
 * An invoice changes in exactly one way — recordPayment() — which is called
 * either by a person booking money they can see, or by handleWebhook() after
 * the gateway's signed "payment succeeded" event has been verified.
 *
 * To connect a real gateway (CX Pay, Sentoo, Stripe, …):
 *   1. set PAYMENT_LINK_TEMPLATE, e.g. https://pay.example.com/c?ref={request_id}&amount={amount}&currency={currency}
 *      (or replace buildLink() with the provider's "create checkout" API call)
 *   2. set PAYMENT_WEBHOOK_SECRET and point the provider's webhook at
 *      POST /api/webhooks/payments — adapt parseEvent() to its payload shape
 */
export function gatewayConfigured(): boolean {
  return Boolean(process.env.PAYMENT_LINK_TEMPLATE && process.env.PAYMENT_WEBHOOK_SECRET);
}

function buildLink(requestId: string, amountCents: number, currency: string): string | null {
  const template = process.env.PAYMENT_LINK_TEMPLATE;
  if (!template) return null;
  return template
    .replace("{request_id}", encodeURIComponent(requestId))
    .replace("{amount}", (amountCents / 100).toFixed(2))
    .replace("{currency}", currency);
}

export function createPaymentRequest(db: DB, actor: Actor, invoiceId: string): { id: string; url: string | null; emailed: boolean } {
  return db.tx(() => {
    const inv = db.one<Record<string, any>>(`SELECT * FROM invoices WHERE id = ?`, [invoiceId]);
    if (!inv || !["open", "partial"].includes(inv.status) || inv.balance_cents <= 0) throw new Error("This invoice has nothing left to pay.");
    const s = getSettings(db);
    const renter = db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [inv.renter_id])!;
    const requestId = id();
    const live = db.workspace === "live" && gatewayConfigured();
    const url = live ? buildLink(requestId, inv.balance_cents, inv.currency) : null;
    const stamp = nowIso();
    db.run(
      `INSERT INTO payment_requests (id, invoice_id, renter_id, amount_cents, provider, url, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`,
      [requestId, invoiceId, inv.renter_id, inv.balance_cents, live ? "gateway" : "manual", url, actor.id, stamp, stamp],
    );
    const emailed = queuePlain(db, {
      kind: "payment_request", to: renter.email, toName: renterName(renter),
      subject: `Payment request for invoice ${inv.invoice_no}`,
      body: `Dear ${renter.first_name || renterName(renter)},\n\n${money(inv.balance_cents, inv.currency)} is due on invoice ${inv.invoice_no} (due ${formatDate(inv.due_date)}).\n\n${url ? `Pay securely online:\n${url}` : s.payment_instructions}`,
      entity: "invoice", entityId: invoiceId, renterId: renter.id, dedupeKey: `payreq:${requestId}`,
    });
    if (emailed) db.run(`UPDATE payment_requests SET status = 'sent', sent_at = ? WHERE id = ?`, [stamp, requestId]);
    // deliberately no change to the invoice: a request is not a payment
    audit(db, actor, "payment_request", "invoice", invoiceId, `Payment request ${emailed ? "sent" : "created"} for ${inv.invoice_no} — invoice remains unpaid until money is received`);
    return { id: requestId, url, emailed };
  });
}

export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  return safeEqual(hmac(secret, rawBody), signature.replace(/^sha256=/, ""));
}

type GatewayEvent = { id: string; type: string; request_id?: string; amount_cents?: number; reference?: string };

function parseEvent(rawBody: string): GatewayEvent {
  const e = JSON.parse(rawBody);
  if (typeof e?.id !== "string" || typeof e?.type !== "string") throw new Error("Malformed event");
  return e;
}

/** Process a verified gateway event exactly once. */
export function handleWebhook(db: DB, rawBody: string): { status: number; message: string } {
  let event: GatewayEvent;
  try {
    event = parseEvent(rawBody);
  } catch {
    return { status: 400, message: "Malformed event" };
  }
  const fresh = db.run(`INSERT OR IGNORE INTO gateway_events (id, provider, type, payload, received_at) VALUES (?, 'gateway', ?, ?, ?)`, [
    event.id, event.type, rawBody.slice(0, 20000), nowIso(),
  ]).changes;
  if (!fresh) return { status: 200, message: "Already processed" };

  let result = "ignored";
  if (event.type === "payment.succeeded" && event.request_id) {
    const req = db.one<Record<string, any>>(`SELECT * FROM payment_requests WHERE id = ?`, [event.request_id]);
    if (!req) result = "unknown request";
    else if (!Number.isInteger(event.amount_cents) || (event.amount_cents ?? 0) <= 0) result = "invalid amount";
    else {
      const pay = recordPayment(db, SYSTEM, {
        renter_id: req.renter_id, amount_cents: event.amount_cents!, method: "online", received_date: today(),
        reference: event.reference ?? event.id, invoice_ids: [req.invoice_id], gateway: "gateway", gateway_ref: event.id,
        confirm_duplicate: true, notes: "Confirmed by payment gateway",
      });
      db.run(`UPDATE payment_requests SET status = 'paid', payment_id = ?, updated_at = ? WHERE id = ?`, [pay.payment_id, nowIso(), req.id]);
      result = `recorded ${pay.payment_no}`;
    }
  } else if (event.type === "payment.failed" && event.request_id) {
    db.run(`UPDATE payment_requests SET status = 'failed', updated_at = ? WHERE id = ? AND status <> 'paid'`, [nowIso(), event.request_id]);
    result = "marked failed";
  }
  db.run(`UPDATE gateway_events SET processed_at = ?, result = ? WHERE id = ?`, [nowIso(), result, event.id]);
  return { status: 200, message: result };
}
