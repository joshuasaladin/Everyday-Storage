import { id, type DB } from "./db";
import { nowIso } from "./clock";
import { getSettings, secondary, type Settings } from "./settings";
import { formatDate, money, renterName } from "./format";
import { invoicePdf, receiptPdf } from "./pdf";

/**
 * Outgoing email goes through an outbox table, never straight to a provider:
 *   - dedupe_key makes "send reminder X for invoice Y" happen at most once
 *   - failures are retried with backoff, then parked as 'dead' for a person
 *   - the demo workspace always uses the "log" provider — it can never send
 *     real email, whatever the configuration says
 *
 * Providers: log (default; records the message, sends nothing),
 *            smtp (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE),
 *            resend (RESEND_API_KEY). Secrets come from the environment only.
 */
export type Provider = "log" | "smtp" | "resend";

export function providerFor(db: DB, settings: Settings = getSettings(db)): Provider {
  if (db.workspace === "demo") return "log";
  const p = (process.env.EMAIL_PROVIDER as Provider | undefined) ?? settings.email_provider;
  if (p === "smtp" && process.env.SMTP_HOST) return "smtp";
  if (p === "resend" && process.env.RESEND_API_KEY) return "resend";
  return "log";
}

export function providerStatus(db: DB): { provider: Provider; wanted: string; note: string } {
  const s = getSettings(db);
  const wanted = (process.env.EMAIL_PROVIDER as string | undefined) ?? s.email_provider;
  const provider = providerFor(db, s);
  let note = "Messages are recorded in the outbox but not delivered. Choose SMTP or Resend to send real email.";
  if (db.workspace === "demo") note = "The demo workspace never sends real email — messages are only recorded in the outbox.";
  else if (provider === "smtp") note = `Delivering through SMTP (${process.env.SMTP_HOST}).`;
  else if (provider === "resend") note = "Delivering through Resend.";
  else if (wanted !== "log") note = `"${wanted}" is selected but its environment variables are not set, so messages are only recorded.`;
  return { provider, wanted, note };
}

export type QueueInput = {
  kind: string;
  to: string | null | undefined;
  toName?: string | null;
  subject: string;
  body: string;
  attachInvoiceId?: string | null;
  attachPaymentId?: string | null;
  entity?: string;
  entityId?: string;
  renterId?: string | null;
  dedupeKey: string;
};

/** Returns true when a new message was queued, false when it already existed or there is no address. */
export function queueEmail(db: DB, input: QueueInput): boolean {
  if (!input.to) return false;
  const res = db.run(
    `INSERT OR IGNORE INTO email_outbox (id, kind, to_email, to_name, subject, body_text, attach_invoice_id, attach_payment_id,
                                         entity, entity_id, renter_id, dedupe_key, status, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    [
      id(), input.kind, input.to, input.toName ?? null, input.subject, input.body, input.attachInvoiceId ?? null,
      input.attachPaymentId ?? null, input.entity ?? null, input.entityId ?? null, input.renterId ?? null,
      input.dedupeKey, nowIso(), nowIso(),
    ],
  );
  return res.changes > 0;
}

type Attachment = { filename: string; content: Buffer };

async function deliver(provider: Provider, s: Settings, msg: Record<string, any>, attachments: Attachment[]): Promise<void> {
  const from = `${s.email_from_name} <${s.email_from_address}>`;
  if (provider === "log") return;
  if (provider === "smtp") {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await transport.sendMail({
      from, to: msg.to_name ? `${msg.to_name} <${msg.to_email}>` : msg.to_email,
      replyTo: s.email_reply_to || undefined, subject: msg.subject, text: msg.body_text, attachments,
    });
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [msg.to_email], reply_to: s.email_reply_to || undefined, subject: msg.subject, text: msg.body_text,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const MAX_ATTEMPTS = 5;

/** Send what is due. Each message is claimed first, so two workers never send the same one. */
export async function processOutbox(db: DB, limit = 25): Promise<{ sent: number; failed: number }> {
  const s = getSettings(db);
  const provider = providerFor(db, s);
  const out = { sent: 0, failed: 0 };
  const due = db.all<Record<string, any>>(
    `SELECT * FROM email_outbox WHERE status IN ('queued','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at LIMIT ?`,
    [nowIso(), limit],
  );
  for (const msg of due) {
    // claim: push next_attempt_at out so a parallel run skips this row
    const claimed = db.run(
      `UPDATE email_outbox SET attempts = attempts + 1, next_attempt_at = ? WHERE id = ? AND attempts = ? AND status IN ('queued','failed')`,
      [new Date(Date.now() + 10 * 60_000).toISOString(), msg.id, msg.attempts],
    ).changes;
    if (!claimed) continue;
    try {
      const attachments: Attachment[] = [];
      if (msg.attach_invoice_id) {
        const pdf = await invoicePdf(db, msg.attach_invoice_id);
        attachments.push({ filename: pdf.filename, content: pdf.bytes });
      }
      if (msg.attach_payment_id) {
        const pdf = await receiptPdf(db, msg.attach_payment_id);
        attachments.push({ filename: pdf.filename, content: pdf.bytes });
      }
      await deliver(provider, s, msg, attachments);
      db.run(`UPDATE email_outbox SET status = 'sent', provider = ?, sent_at = ?, last_error = NULL WHERE id = ?`, [provider, nowIso(), msg.id]);
      if (msg.kind === "invoice" && msg.entity_id) {
        db.run(`UPDATE invoices SET sent_at = COALESCE(sent_at, ?) WHERE id = ?`, [nowIso(), msg.entity_id]);
      }
      out.sent += 1;
    } catch (err) {
      const attempts = msg.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const backoffMin = 5 * 2 ** (attempts - 1); // 5, 10, 20, 40 minutes
      db.run(`UPDATE email_outbox SET status = ?, last_error = ?, provider = ?, next_attempt_at = ? WHERE id = ?`, [
        dead ? "dead" : "failed", String(err instanceof Error ? err.message : err).slice(0, 500), provider,
        dead ? null : new Date(Date.now() + backoffMin * 60_000).toISOString(), msg.id,
      ]);
      out.failed += 1;
    }
  }
  return out;
}

export function retryEmail(db: DB, emailId: string): void {
  db.run(`UPDATE email_outbox SET status = 'queued', attempts = 0, next_attempt_at = ?, last_error = NULL WHERE id = ? AND status IN ('failed','dead')`, [nowIso(), emailId]);
}

// ---------------------------------------------------------------- templates

function sign(s: Settings): string {
  return `\n\n${s.business_name}\n${[s.business_phone, s.business_email].filter(Boolean).join(" · ")}`.trimEnd();
}

function invoiceContext(db: DB, invoiceId: string) {
  const inv = db.one<Record<string, any>>(
    `SELECT i.*, u.unit_number FROM invoices i LEFT JOIN units u ON u.id = i.unit_id WHERE i.id = ?`,
    [invoiceId],
  );
  if (!inv) return null;
  const renter = db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [inv.renter_id])!;
  const s = getSettings(db);
  const alt = secondary(s, inv.balance_cents);
  const amount = `${money(inv.balance_cents, inv.currency)}${s.show_secondary_currency ? ` (${money(alt.cents, alt.currency)})` : ""}`;
  return { inv, renter, s, amount, hello: `Dear ${renter.first_name || renterName(renter)},` };
}

/** `force` re-sends on request (a new dedupe key); automatic delivery passes none and sends once. */
export function queueInvoiceEmail(db: DB, invoiceId: string, force?: string): boolean {
  const c = invoiceContext(db, invoiceId);
  if (!c || c.inv.status === "void") return false;
  const { inv, renter, s } = c;
  return queueEmail(db, {
    kind: "invoice", to: renter.email, toName: renterName(renter),
    subject: `Invoice ${inv.invoice_no} from ${s.business_name}`,
    body: `${c.hello}\n\nPlease find attached invoice ${inv.invoice_no}${inv.unit_number ? ` for storage unit ${inv.unit_number}` : ""}${inv.period_start ? `, covering ${formatDate(inv.period_start)} to ${formatDate(inv.period_end)}` : ""}.\n\nAmount due: ${c.amount}\nDue date: ${formatDate(inv.due_date)}\n\n${s.payment_instructions}${sign(s)}`,
    attachInvoiceId: invoiceId, entity: "invoice", entityId: invoiceId, renterId: renter.id,
    dedupeKey: force ? `invoice:${invoiceId}:${force}` : `invoice:${invoiceId}`,
  });
}

export function queueDueReminder(db: DB, invoiceId: string, days: number): boolean {
  const c = invoiceContext(db, invoiceId);
  if (!c) return false;
  const { inv, renter, s } = c;
  return queueEmail(db, {
    kind: "due_reminder", to: renter.email, toName: renterName(renter),
    subject: `Reminder: invoice ${inv.invoice_no} is due ${formatDate(inv.due_date)}`,
    body: `${c.hello}\n\nA friendly reminder that invoice ${inv.invoice_no} for ${c.amount} is due on ${formatDate(inv.due_date)}${days > 0 ? ` — in ${days} day${days === 1 ? "" : "s"}` : ""}.\n\n${s.payment_instructions}\n\nIf you have already paid, thank you — please ignore this message.${sign(s)}`,
    attachInvoiceId: invoiceId, entity: "invoice", entityId: invoiceId, renterId: renter.id,
    dedupeKey: `due:${invoiceId}:${days}`,
  });
}

export function queueOverdueReminder(db: DB, invoiceId: string, stage: number, daysOver: number): boolean {
  const c = invoiceContext(db, invoiceId);
  if (!c) return false;
  const { inv, renter, s } = c;
  const fee = s.late_fee_enabled && !inv.late_fee_applied_at ? `\n\nA late fee applies to invoices unpaid ${s.late_fee_grace_days} days after the due date.` : "";
  return queueEmail(db, {
    kind: "overdue_reminder", to: renter.email, toName: renterName(renter),
    subject: `Overdue: invoice ${inv.invoice_no} (${daysOver} days past due)`,
    body: `${c.hello}\n\nInvoice ${inv.invoice_no} was due on ${formatDate(inv.due_date)} and ${c.amount} is still outstanding.${fee}\n\n${s.payment_instructions}\n\nIf something is wrong with this invoice, or you would like to arrange payment, please reply to this email or call us.${sign(s)}`,
    attachInvoiceId: invoiceId, entity: "invoice", entityId: invoiceId, renterId: renter.id,
    dedupeKey: `overdue:${invoiceId}:${stage}`,
  });
}

export function queueReceiptEmail(db: DB, paymentId: string): boolean {
  const pay = db.one<Record<string, any>>(`SELECT * FROM payments WHERE id = ?`, [paymentId]);
  if (!pay) return false;
  const renter = db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [pay.renter_id])!;
  const s = getSettings(db);
  return queueEmail(db, {
    kind: "receipt", to: renter.email, toName: renterName(renter),
    subject: `Receipt ${pay.payment_no} — thank you for your payment`,
    body: `Dear ${renter.first_name || renterName(renter)},\n\nWe received your payment of ${money(pay.amount_cents, s.base_currency)} on ${formatDate(pay.received_date)}. Your receipt is attached.${sign(s)}`,
    attachPaymentId: paymentId, entity: "payment", entityId: paymentId, renterId: renter.id,
    dedupeKey: `receipt:${paymentId}`,
  });
}

export function queueAgreementNotice(
  db: DB,
  agreementId: string,
  kind: "expiry_notice" | "renewal_reminder" | "move_out_reminder" | "sign_request",
  stageKey: string,
  extra: { link?: string } = {},
): boolean {
  const ag = db.one<Record<string, any>>(
    `SELECT a.*, u.unit_number FROM agreements a JOIN units u ON u.id = a.unit_id WHERE a.id = ?`,
    [agreementId],
  );
  if (!ag) return false;
  const renter = db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [ag.renter_id])!;
  const s = getSettings(db);
  const hello = `Dear ${renter.first_name || renterName(renter)},`;
  let subject = "";
  let body = "";
  if (kind === "expiry_notice") {
    subject = `Your storage agreement for unit ${ag.unit_number} ends on ${formatDate(ag.end_date)}`;
    body = ag.renewal_option === "end"
      ? `${hello}\n\nYour agreement ${ag.agreement_no} for unit ${ag.unit_number} ends on ${formatDate(ag.end_date)}. If you would like to keep the unit, reply to this email or renew from your customer portal and we will arrange it. Otherwise, please have the unit empty and your lock removed by that date.`
      : `${hello}\n\nThe fixed term of agreement ${ag.agreement_no} for unit ${ag.unit_number} ends on ${formatDate(ag.end_date)}. After that it continues month-to-month at ${money(ag.monthly_rate_cents - ag.discount_cents, s.base_currency)} per month, and either of us can end it with ${ag.notice_days} days' notice. If you would prefer a new fixed term, let us know.`;
  } else if (kind === "renewal_reminder") {
    subject = `Your storage agreement for unit ${ag.unit_number} renews on ${formatDate(ag.end_date)}`;
    body = `${hello}\n\nAgreement ${ag.agreement_no} for unit ${ag.unit_number} renews automatically after ${formatDate(ag.end_date)} for another ${ag.renewal_term_months ?? ag.term_months} months at ${money(ag.monthly_rate_cents - ag.discount_cents, s.base_currency)} per month. You do not need to do anything. If you would rather not renew, please tell us at least ${ag.notice_days} days before that date.`;
  } else if (kind === "move_out_reminder") {
    subject = `Move-out reminder for unit ${ag.unit_number} — ${formatDate(ag.move_out_date)}`;
    body = `${hello}\n\nYour move-out from unit ${ag.unit_number} is booked for ${formatDate(ag.move_out_date)}. Please empty the unit, leave it clean and remove your lock by then. Once we have inspected the unit and any final invoice is settled, your security deposit will be returned.`;
  } else {
    subject = `Please sign your storage agreement ${ag.agreement_no}`;
    body = `${hello}\n\nYour rental agreement for unit ${ag.unit_number} is ready. Review and sign it online here:\n\n${extra.link}\n\nThe link is personal to you and expires in 14 days.`;
  }
  return queueEmail(db, {
    kind, to: renter.email, toName: renterName(renter), subject, body: `${body}${sign(s)}`,
    entity: "agreement", entityId: agreementId, renterId: renter.id, dedupeKey: `${kind}:${agreementId}:${stageKey}`,
  });
}

export function queuePlain(db: DB, input: { kind: string; to: string | null; toName?: string; subject: string; body: string; entity?: string; entityId?: string; renterId?: string | null; dedupeKey?: string }): boolean {
  const s = getSettings(db);
  return queueEmail(db, { ...input, body: `${input.body}${sign(s)}`, dedupeKey: input.dedupeKey ?? `${input.kind}:${id()}` });
}
