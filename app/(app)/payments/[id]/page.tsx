import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/components/Icon";
import { Card, Chip, Detail, EmptyState, Field, PageHeader } from "@/components/ui";
import { ConfirmButton, ModalForm } from "@/components/forms";
import { HistoryPanel } from "@/components/panels";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { reconcileAction, refundPaymentAction, sendReceiptAction } from "@/lib/actions/billing";
import { PAYMENT_METHODS } from "@/lib/payments";
import { today } from "@/lib/clock";
import { centsInput, formatDate, formatDateTime, money, renterName, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("finance.view");
  const { id } = await params;
  const { db } = ctx;
  const p = db.one<Record<string, any>>(`SELECT p.*, f.name AS facility_name FROM payments p JOIN facilities f ON f.id = p.facility_id WHERE p.id = ?`, [id]);
  if (!p) notFound();
  const renter = db.one<Record<string, any>>(`SELECT id, kind, first_name, last_name, company, email FROM renters WHERE id = ?`, [p.renter_id])!;
  const allocs = db.all<Record<string, any>>(
    `SELECT pa.amount_cents, i.id, i.invoice_no, i.period_start, i.period_end, i.balance_cents FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = ? ORDER BY i.due_date`,
    [id],
  );
  const refunds = db.all<Record<string, any>>(`SELECT * FROM refunds WHERE payment_id = ? ORDER BY refund_date`, [id]);
  const credit = db.one<{ amount_cents: number; remaining_cents: number }>(`SELECT amount_cents, remaining_cents FROM credits WHERE payment_id = ?`, [id]);
  const cur = ctx.settings.base_currency;
  const refundable = p.amount_cents - p.refunded_cents;
  const edit = can(ctx.user.role, "finance.edit");
  const t = today();
  const method = p.method === "deposit" ? "Security deposit applied" : PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? titleCase(p.method);

  return (
    <>
      <PageHeader
        eyebrow={`Payment · ${p.facility_name}`}
        title={<span className="flex flex-wrap items-center gap-3">{p.payment_no} {p.status !== "completed" && <Chip tone="warn">{titleCase(p.status)}</Chip>}</span>}
        back={{ href: "/payments", label: "Payments" }}
        actions={
          <>
            <a href={`/api/receipts/${id}/pdf`} target="_blank" className="btn"><Icon name="download" />Receipt PDF</a>
            {edit && <ConfirmButton action={sendReceiptAction} fields={{ payment_id: id }} label="Email receipt" icon="mail" className="btn" />}
            {can(ctx.user.role, "finance.refund") && refundable > 0 && p.method !== "deposit" && (
              <ModalForm label="Refund" title={`Refund ${p.payment_no}`} blurb={`Up to ${money(refundable, cur)} can be refunded. Invoices this payment covered are re-opened by the amount refunded.`} action={refundPaymentAction} className="btn btn-danger" icon="undo" submit="Record refund" submitClass="btn btn-danger">
                <input type="hidden" name="payment_id" value={id} />
                <div className="grid grid-cols-2 gap-4">
                  <Field label={`Amount (${cur})`}><input className="input" name="amount" inputMode="decimal" defaultValue={centsInput(refundable)} required /></Field>
                  <Field label="Refund date"><input className="input" type="date" name="refund_date" defaultValue={t} max={t} required /></Field>
                  <Field label="Method"><select className="select" name="method" defaultValue={p.method}>{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
                  <Field label="Reference"><input className="input" name="reference" maxLength={80} /></Field>
                  <Field label="Reason" className="col-span-2"><input className="input" name="reason" required maxLength={200} /></Field>
                </div>
              </ModalForm>
            )}
          </>
        }
      />

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="col-span-2">
                <div className="eyebrow mb-1">Amount received</div>
                <div className="stat-value">{money(p.amount_cents, cur)}</div>
                {p.tendered_currency && p.tendered_currency !== cur && <div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>Tendered as {money(p.tendered_cents, p.tendered_currency)}</div>}
              </div>
              <Detail label="Renter"><Link className="link" href={`/renters/${renter.id}`}>{renterName(renter)}</Link></Detail>
              <Detail label="Received">{formatDate(p.received_date)}</Detail>
              <Detail label="Method">{method}</Detail>
              <Detail label="Reference">{p.reference}</Detail>
              <Detail label="Recorded">{formatDateTime(p.created_at)}</Detail>
              <Detail label="Source">{p.gateway ? "Payment gateway (confirmed)" : "Entered by staff"}</Detail>
              {p.notes && <div className="col-span-2 sm:col-span-4"><Detail label="Notes">{p.notes}</Detail></div>}
            </div>
          </Card>

          <Card title="Applied to" dense>
            {allocs.length === 0 && !credit ? <EmptyState title="Fully refunded" /> : (
              <ul>
                {allocs.map((a, i) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <div className="flex-1 min-w-0">
                      <Link href={`/invoices/${a.id}`} className="link-ink text-sm font-medium">{a.invoice_no}</Link>
                      <div className="text-xs" style={{ color: "var(--ink-3)" }}>{a.period_start ? `${formatDate(a.period_start)} – ${formatDate(a.period_end)}` : "One-off invoice"}{a.balance_cents > 0 ? ` · ${money(a.balance_cents, cur)} still owed` : " · settled"}</div>
                    </div>
                    <span className="text-sm font-semibold num">{money(a.amount_cents, cur)}</span>
                  </li>
                ))}
                {credit && credit.amount_cents > 0 && (
                  <li className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: allocs.length ? "1px solid var(--line)" : undefined }}>
                    <div className="flex-1"><span className="text-sm font-medium">Held as credit on the renter's account</span><div className="text-xs" style={{ color: "var(--ink-3)" }}>{money(credit.remaining_cents, cur)} not yet used</div></div>
                    <span className="text-sm font-semibold num">{money(credit.amount_cents, cur)}</span>
                  </li>
                )}
              </ul>
            )}
          </Card>

          {refunds.length > 0 && (
            <Card title="Refunds" dense>
              <ul>
                {refunds.map((r, i) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <div className="flex-1"><span className="text-sm font-medium">{r.reason}</span><div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatDate(r.refund_date)} · {titleCase(r.method)}{r.reference ? ` · ${r.reference}` : ""}</div></div>
                    <span className="text-sm font-semibold num" style={{ color: "var(--bad-fg)" }}>{money(-r.amount_cents, cur)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {p.method !== "deposit" && (
            <Card title="Bank reconciliation">
              {p.reconciled_at ? (
                <div className="space-y-3">
                  <Chip tone="good" dot>Reconciled</Chip>
                  <Detail label="Statement">{p.statement_ref}</Detail>
                  <Detail label="By">{p.reconciled_by} · {formatDate(p.reconciled_at)}</Detail>
                  {edit && <ConfirmButton action={reconcileAction} fields={{ op: "undo", payment_id: id }} label="Undo" className="btn btn-sm" confirm="Remove the reconciliation mark from this payment?" />}
                </div>
              ) : (
                <div className="space-y-3">
                  <Chip tone="warn" dot>Not reconciled</Chip>
                  <p className="text-sm" style={{ color: "var(--ink-3)" }}>Match it against the bank statement under Payments → Reconciliation.</p>
                </div>
              )}
            </Card>
          )}
          <HistoryPanel db={db} entity="payment" entityId={id} />
        </div>
      </div>
    </>
  );
}
