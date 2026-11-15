import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/components/Icon";
import PaymentFields from "@/components/PaymentFields";
import { Card, Check, Chip, Detail, EmptyState, Field, InvoiceChip, Notice, PageHeader } from "@/components/ui";
import { ConfirmButton, ModalForm } from "@/components/forms";
import { HistoryPanel } from "@/components/panels";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addLineAction, applyCreditAction, recordPaymentAction, removeLineAction, requestPaymentAction, sendInvoiceAction, voidInvoiceAction } from "@/lib/actions/billing";
import { creditBalance, displayStatus } from "@/lib/billing";
import { daysBetween, today } from "@/lib/clock";
import { secondary } from "@/lib/settings";
import { formatDate, formatDateTime, money, renterName, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("finance.view");
  const { id } = await params;
  const { db, settings } = ctx;
  const inv = db.one<Record<string, any>>(
    `SELECT i.*, u.unit_number, f.name AS facility_name, a.agreement_no FROM invoices i
       LEFT JOIN units u ON u.id = i.unit_id JOIN facilities f ON f.id = i.facility_id LEFT JOIN agreements a ON a.id = i.agreement_id WHERE i.id = ?`,
    [id],
  );
  if (!inv) notFound();
  const renter = db.one<Record<string, any>>(`SELECT id, kind, first_name, last_name, company, email, address, city FROM renters WHERE id = ?`, [inv.renter_id])!;
  const lines = db.all<Record<string, any>>(`SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort`, [id]);
  const allocations = db.all<Record<string, any>>(
    `SELECT pa.amount_cents, p.id, p.payment_no, p.received_date, p.method, p.reference FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = ? ORDER BY p.received_date`,
    [id],
  );
  const credits = db.all<Record<string, any>>(`SELECT ca.amount_cents, ca.created_at, c.reason, c.source FROM credit_applications ca JOIN credits c ON c.id = ca.credit_id WHERE ca.invoice_id = ?`, [id]);
  const requests = db.all<Record<string, any>>(`SELECT * FROM payment_requests WHERE invoice_id = ? ORDER BY created_at DESC`, [id]);
  const emails = db.all<Record<string, any>>(`SELECT * FROM email_outbox WHERE entity = 'invoice' AND entity_id = ? ORDER BY created_at DESC LIMIT 8`, [id]);
  const t = today();
  const status = displayStatus(inv as never, t);
  const edit = can(ctx.user.role, "finance.edit");
  const open = inv.status === "open" || inv.status === "partial";
  const cur = inv.currency;
  const credit = open ? creditBalance(db, inv.renter_id) : 0;
  const alt = secondary(settings, inv.balance_cents);

  return (
    <>
      <PageHeader
        eyebrow={`Invoice · ${inv.facility_name}`}
        title={<span className="flex flex-wrap items-center gap-3">{inv.invoice_no} <InvoiceChip status={status} /></span>}
        back={{ href: "/invoices", label: "Invoices" }}
        actions={
          <>
            <a href={`/api/invoices/${id}/pdf`} target="_blank" className="btn"><Icon name="download" />PDF</a>
            {edit && inv.status !== "void" && <ConfirmButton action={sendInvoiceAction} fields={{ invoice_id: id }} label={inv.sent_at ? "Email again" : "Email invoice"} icon="mail" className="btn" />}
            {edit && open && (
              <ModalForm label="Record payment" title={`Record a payment for ${inv.invoice_no}`} blurb={`${money(inv.balance_cents, cur)} is outstanding.`} action={recordPaymentAction} className="btn btn-primary" icon="card" submit="Record payment">
                <PaymentFields currency={settings.base_currency} today={t} amount={inv.balance_cents} renterId={inv.renter_id} invoiceId={id} stay />
              </ModalForm>
            )}
          </>
        }
      />

      {status === "overdue" && <div className="mb-5"><Notice tone="bad">{daysBetween(inv.due_date, t)} days overdue{inv.late_fee_applied_at ? " — a late fee has been added." : settings.late_fee_enabled ? ` — a late fee is added ${settings.late_fee_grace_days} days after the due date.` : "."}</Notice></div>}
      {inv.status === "void" && <div className="mb-5"><Notice tone="warn">Voided {formatDate(inv.voided_at)} — {inv.void_reason}</Notice></div>}

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <Card dense>
            <div className="p-5 grid sm:grid-cols-2 gap-5">
              <div>
                <div className="label">Billed to</div>
                <Link href={`/renters/${renter.id}`} className="link text-base">{renterName(renter)}</Link>
                <div className="text-sm" style={{ color: "var(--ink-3)" }}>{[renter.address, renter.city].filter(Boolean).join(", ")}</div>
                <div className="text-sm" style={{ color: "var(--ink-3)" }}>{renter.email ?? "No email on file"}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Detail label="Issued">{formatDate(inv.issue_date)}</Detail>
                <Detail label="Due">{formatDate(inv.due_date)}</Detail>
                <Detail label="Unit">{inv.unit_id ? <Link className="link" href={`/units/${inv.unit_id}`}>{inv.unit_number}</Link> : null}</Detail>
                <Detail label="Agreement">{inv.agreement_id ? <Link className="link" href={`/agreements/${inv.agreement_id}`}>{inv.agreement_no}</Link> : null}</Detail>
                {inv.period_start && <div className="col-span-2"><Detail label="Billing period">{formatDate(inv.period_start)} – {formatDate(inv.period_end)}</Detail></div>}
              </div>
            </div>

            <div className="scroll-x hair">
              <table className="table">
                <thead><tr><th>Description</th><th>Taxable</th><th className="r">Amount</th>{edit && open && <th />}</tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="primary" style={{ fontWeight: 500 }}>{l.description}{l.kind === "late_fee" && <span className="ml-2"><Chip tone="warn">Late fee</Chip></span>}</td>
                      <td>{l.taxable ? "Yes" : "No"}</td>
                      <td className="r num">{money(l.amount_cents, cur)}</td>
                      {edit && open && (
                        <td className="r">
                          {l.kind !== "rent" && l.kind !== "prorated_rent" && (
                            <ConfirmButton action={removeLineAction} fields={{ line_id: l.id }} label={l.kind === "late_fee" ? "Waive" : "Remove"} className="btn btn-ghost btn-sm" title="quiet"
                              confirm={l.kind === "late_fee" ? "Waive this late fee?" : "Remove this line?"} />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-5 hair flex flex-wrap justify-between gap-5">
              <div>
                {edit && open && (
                  <ModalForm label="Add a charge or discount" title="Add a line" action={addLineAction} className="btn btn-sm" icon="plus" submit="Add line">
                    <input type="hidden" name="invoice_id" value={id} />
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Type">
                        <select className="select" name="kind" defaultValue="fee"><option value="fee">Fee</option><option value="other">Other charge</option><option value="discount">Discount</option></select>
                      </Field>
                      <Field label={`Amount (${cur})`}><input className="input" name="amount" inputMode="decimal" placeholder="0.00" required /></Field>
                      <Field label="Description" className="col-span-2"><input className="input" name="description" required maxLength={200} /></Field>
                      <div className="col-span-2"><Check name="taxable" label="Taxable" defaultChecked /></div>
                    </div>
                  </ModalForm>
                )}
                {inv.notes && <div className="mt-3 text-sm max-w-sm" style={{ color: "var(--ink-2)" }}><div className="label">Notes</div>{inv.notes}</div>}
              </div>
              <dl className="text-sm space-y-1.5 w-full sm:w-72">
                <div className="flex justify-between"><dt style={{ color: "var(--ink-3)" }}>Subtotal</dt><dd className="num">{money(inv.subtotal_cents - inv.discount_cents, cur)}</dd></div>
                {(inv.tax_rate_bp > 0 || inv.tax_cents > 0) && <div className="flex justify-between"><dt style={{ color: "var(--ink-3)" }}>{inv.tax_label ?? "Tax"} ({inv.tax_rate_bp / 100}%)</dt><dd className="num">{money(inv.tax_cents, cur)}</dd></div>}
                <div className="flex justify-between pt-1.5 hair font-semibold"><dt>Total</dt><dd className="num">{money(inv.total_cents, cur)}</dd></div>
                {inv.paid_cents > 0 && <div className="flex justify-between"><dt style={{ color: "var(--ink-3)" }}>Paid</dt><dd className="num">{money(-inv.paid_cents, cur)}</dd></div>}
                {inv.credited_cents > 0 && <div className="flex justify-between"><dt style={{ color: "var(--ink-3)" }}>Credit applied</dt><dd className="num">{money(-inv.credited_cents, cur)}</dd></div>}
                <div className="flex justify-between items-baseline rounded-lg px-3 py-2 mt-1" style={{ background: inv.balance_cents > 0 ? "var(--accent-soft)" : "var(--good-bg)" }}>
                  <dt className="font-semibold">Balance due</dt>
                  <dd className="num font-bold text-base">{money(inv.balance_cents, cur)}</dd>
                </div>
                {settings.show_secondary_currency && inv.balance_cents > 0 && <div className="text-xs text-right" style={{ color: "var(--ink-3)" }}>≈ {money(alt.cents, alt.currency)}</div>}
              </dl>
            </div>
          </Card>

          <Card title="Payments received" dense>
            {allocations.length + credits.length === 0 ? <EmptyState title="Nothing received yet" hint="An invoice is only marked paid when a payment is recorded against it — never because a request or reminder was sent." /> : (
              <ul>
                {allocations.map((p, i) => (
                  <li key={p.id + i} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <div className="flex-1 min-w-0">
                      <Link href={`/payments/${p.id}`} className="link-ink text-sm font-medium">{p.payment_no}</Link>
                      <div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatDate(p.received_date)} · {p.method === "deposit" ? "Security deposit applied" : titleCase(p.method)}{p.reference ? ` · ${p.reference}` : ""}</div>
                    </div>
                    <span className="text-sm font-semibold num">{money(p.amount_cents, cur)}</span>
                  </li>
                ))}
                {credits.map((c, i) => (
                  <li key={`c${i}`} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: "1px solid var(--line)" }}>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">Credit applied</span>
                      <div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatDate(c.created_at)} · {c.source === "overpayment" ? "from an earlier overpayment" : c.reason}</div>
                    </div>
                    <span className="text-sm font-semibold num">{money(c.amount_cents, cur)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {edit && open && (
            <Card title="Collect">
              <div className="space-y-3">
                {credit > 0 && (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>{money(credit, cur)} credit on account</span>
                    <ConfirmButton action={applyCreditAction} fields={{ invoice_id: id }} label="Apply credit" className="btn btn-sm" />
                  </div>
                )}
                <p className="text-sm" style={{ color: "var(--ink-3)" }}>Send the renter a request to pay. The invoice stays unpaid until the money actually arrives.</p>
                <ConfirmButton action={requestPaymentAction} fields={{ invoice_id: id }} label="Send payment request" icon="mail" className="btn" />
              </div>
              {requests.length > 0 && (
                <ul className="mt-4 hair pt-3 space-y-1.5 text-xs" style={{ color: "var(--ink-3)" }}>
                  {requests.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2"><span>Request for {money(r.amount_cents, cur)} · {formatDate(r.created_at)}</span><Chip tone={r.status === "paid" ? "good" : r.status === "failed" ? "bad" : "neutral"}>{titleCase(r.status)}</Chip></li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="Delivery" dense>
            {emails.length === 0 ? <EmptyState title="Not emailed yet" /> : (
              <ul>
                {emails.map((e, i) => (
                  <li key={e.id} className="px-4 py-2.5 text-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{titleCase(e.kind)}</span>
                      <Chip tone={e.status === "sent" ? "good" : e.status === "queued" ? "info" : "bad"}>{e.status === "sent" && e.provider === "log" ? "Recorded" : titleCase(e.status)}</Chip>
                    </div>
                    <div className="text-xs" style={{ color: "var(--ink-3)" }}>{e.to_email} · {formatDateTime(e.sent_at ?? e.created_at)}{e.last_error ? ` · ${e.last_error}` : ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <HistoryPanel db={db} entity="invoice" entityId={id} />

          {edit && open && inv.paid_cents === 0 && (
            <ModalForm label="Void invoice" title={`Void ${inv.invoice_no}`} blurb="A void invoice stays on record but is no longer owed or counted as revenue." action={voidInvoiceAction} className="btn btn-danger btn-sm" icon="x" submit="Void invoice" submitClass="btn btn-danger">
              <input type="hidden" name="invoice_id" value={id} />
              <Field label="Reason"><input className="input" name="reason" required maxLength={200} /></Field>
            </ModalForm>
          )}
        </div>
      </div>
    </>
  );
}
