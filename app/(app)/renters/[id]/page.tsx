import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/components/Icon";
import { Card, Chip, Detail, EmptyState, Field, InvoiceChip, Lines, PageHeader, StatCard, StatusChip } from "@/components/ui";
import { ConfirmButton, ModalForm } from "@/components/forms";
import { DocumentsPanel, HistoryPanel } from "@/components/panels";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { addCreditAction, deleteRenterAction, portalLoginAction, revealIdAction } from "@/lib/actions/renters";
import { ID_TYPES, RENTER_STATUSES } from "@/lib/renters";
import { AGREEMENT_STATUSES, contractProgress } from "@/lib/agreements";
import { displayStatus } from "@/lib/billing";
import { renterBalance } from "@/lib/payments";
import { label } from "@/lib/units";
import { formatDate, money, renterName, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RenterPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("renters.view");
  const { id } = await params;
  const { db } = ctx;
  // the encrypted ID number is never selected here
  const r = db.one<Record<string, any>>(
    `SELECT id, renter_no, kind, first_name, last_name, company, email, phone, id_type, id_last4, address, status, notes, created_at
       FROM renters WHERE id = ?`,
    [id],
  );
  if (!r) notFound();
  const role = ctx.user.role;
  const money$ = can(role, "finance.view");
  const cur = ctx.settings.base_currency;
  const bal = renterBalance(db, id);
  const agreements = db.all<Record<string, any>>(
    `SELECT a.*, u.unit_number, f.name AS facility_name FROM agreements a JOIN units u ON u.id = a.unit_id JOIN facilities f ON f.id = a.facility_id
      WHERE a.renter_id = ? ORDER BY (a.status IN ('active','pending_signature')) DESC, a.start_date DESC`,
    [id],
  );
  const invoices = money$ ? db.all<Record<string, any>>(`SELECT i.*, u.unit_number FROM invoices i LEFT JOIN units u ON u.id = i.unit_id WHERE i.renter_id = ? ORDER BY i.issue_date DESC, i.invoice_no DESC LIMIT 12`, [id]) : [];
  const payments = money$ ? db.all<Record<string, any>>(`SELECT * FROM payments WHERE renter_id = ? ORDER BY received_date DESC, payment_no DESC LIMIT 8`, [id]) : [];
  const portal = db.one<Record<string, any>>(`SELECT id, email, status, last_login_at FROM users WHERE renter_id = ?`, [id]);

  return (
    <>
      <PageHeader
        eyebrow={`${r.renter_no} · ${r.kind === "business" ? "Business" : "Individual"}`}
        title={<span className="flex flex-wrap items-center gap-3">{renterName(r)} <StatusChip list={RENTER_STATUSES} value={r.status} /></span>}
        back={{ href: "/renters", label: "Renters" }}
        actions={
          <>
            {can(role, "finance.edit") && bal.outstanding > 0 && <Link href={`/payments?record=1&renter=${id}`} className="btn btn-primary"><Icon name="card" />Record payment</Link>}
            {can(role, "agreements.edit") && <Link href={`/agreements/new?renter=${id}`} className="btn"><Icon name="pen" />New agreement</Link>}
            {can(role, "renters.edit") && <Link href={`/renters/${id}/edit`} className="btn"><Icon name="edit" />Edit</Link>}
          </>
        }
      />

      {money$ && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <StatCard label="Outstanding" value={money(bal.outstanding, cur)} tone={bal.outstanding ? "warn" : "good"} icon="receipt" sub={bal.outstanding ? "across open invoices" : "nothing owed"} />
          <StatCard label="Overdue" value={money(bal.overdue, cur)} tone={bal.overdue ? "bad" : "good"} icon="alert" sub={bal.overdue ? "past the due date" : "nothing overdue"} />
          <StatCard label="Credit on account" value={money(bal.credit, cur)} tone="info" icon="wallet" sub="applied to the next invoice" />
          <StatCard label="Deposits held" value={money(bal.deposits, cur)} tone="neutral" icon="shield" sub="held as security, not revenue" />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <Card title="Units and agreements" dense>
            {agreements.length === 0 ? (
              <EmptyState title="No agreements yet" action={can(role, "agreements.edit") ? <Link href={`/agreements/new?renter=${id}`} className="btn btn-primary">Create an agreement</Link> : undefined} />
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead><tr><th>Unit</th><th>Agreement</th><th>Term</th><th>Elapsed</th><th className="r">Rate</th><th>Status</th></tr></thead>
                  <tbody>
                    {agreements.map((a) => {
                      const p = contractProgress(a as never);
                      return (
                        <tr key={a.id}>
                          <td className="primary"><Link href={`/units/${a.unit_id}`} className="link-ink">{a.unit_number}</Link><div className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{a.facility_name}</div></td>
                          <td>{can(role, "agreements.view") ? <Link className="link" href={`/agreements/${a.id}`}>{a.agreement_no}</Link> : a.agreement_no}</td>
                          <td className="whitespace-nowrap">{formatDate(a.start_date)} – {a.end_date ? formatDate(a.end_date) : "open"}</td>
                          <td>{p.elapsedMonths} mo{p.remainingMonths !== null && a.status === "active" ? ` · ${p.remainingMonths} left` : ""}</td>
                          <td className="r num">{money(a.monthly_rate_cents - a.discount_cents, cur)}</td>
                          <td><StatusChip list={AGREEMENT_STATUSES} value={a.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {money$ && (
            <Card title="Invoices" dense action={<Link href={`/invoices?renter=${id}`} className="btn btn-ghost btn-sm">All invoices<Icon name="chevron" className="w-3 h-3" /></Link>}>
              {invoices.length === 0 ? <EmptyState title="No invoices yet" /> : (
                <div className="scroll-x">
                  <table className="table">
                    <thead><tr><th>Invoice</th><th>Period</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th><th>Status</th></tr></thead>
                    <tbody>
                      {invoices.map((i) => (
                        <tr key={i.id}>
                          <td className="primary"><Link href={`/invoices/${i.id}`} className="link-ink">{i.invoice_no}</Link>{i.unit_number && <span className="text-xs font-normal" style={{ color: "var(--ink-3)" }}> · {i.unit_number}</span>}</td>
                          <td className="whitespace-nowrap">{i.period_start ? `${formatDate(i.period_start)} – ${formatDate(i.period_end)}` : "One-off"}</td>
                          <td className="whitespace-nowrap">{formatDate(i.due_date)}</td>
                          <td className="r num">{money(i.total_cents, i.currency)}</td>
                          <td className="r num">{money(i.balance_cents, i.currency)}</td>
                          <td><InvoiceChip status={displayStatus(i as never)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {money$ && (
            <Card title="Payments" dense action={<Link href={`/payments?renter=${id}`} className="btn btn-ghost btn-sm">All payments<Icon name="chevron" className="w-3 h-3" /></Link>}>
              {payments.length === 0 ? <EmptyState title="No payments yet" /> : (
                <ul>
                  {payments.map((p, i) => (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                      <div className="min-w-0 flex-1">
                        <Link href={`/payments/${p.id}`} className="link-ink text-sm font-medium">{p.payment_no}</Link>
                        <div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatDate(p.received_date)} · {titleCase(p.method)}{p.reference ? ` · ${p.reference}` : ""}</div>
                      </div>
                      {p.status !== "completed" && <Chip tone="warn">{titleCase(p.status)}</Chip>}
                      <span className="text-sm font-semibold num">{money(p.amount_cents, cur)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <DocumentsPanel db={db} entity="renter" entityId={id} canEdit={can(role, "renters.edit")} shareable />
        </div>

        <div className="space-y-5">
          <Card title="Contact">
            <div className="space-y-3">
              {r.kind === "business" && <Detail label="Contact person">{`${r.first_name} ${r.last_name}`.trim()}</Detail>}
              <Detail label="Email">{r.email && <a className="link" href={`mailto:${r.email}`}>{r.email}</a>}</Detail>
              <Detail label="Phone">{r.phone}</Detail>
              <Detail label="Address">{r.address}</Detail>
              <Detail label="Identification">
                {r.id_type ? `${label(ID_TYPES, r.id_type)}${r.id_last4 ? ` ending ${r.id_last4}` : ""}` : null}
              </Detail>
              {r.id_last4 && can(role, "renters.sensitive") && (
                <ConfirmButton action={revealIdAction} fields={{ id }} label="Reveal ID number" icon="eye" className="btn btn-sm" />
              )}
              {r.notes && <div><div className="label">Notes</div><Lines text={r.notes} /></div>}
            </div>
          </Card>

          <Card title="Customer portal">
            {portal ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="break-all">{portal.email}</span>
                  <Chip tone={portal.status === "active" ? "good" : "muted"} dot>{portal.status === "active" ? "Active" : "Disabled"}</Chip>
                </div>
                <div style={{ color: "var(--ink-3)" }}>{portal.last_login_at ? `Last signed in ${formatDate(portal.last_login_at)}` : "Has not signed in yet"}</div>
                {can(role, "renters.edit") && (
                  <div className="flex flex-wrap gap-2">
                    <ConfirmButton action={portalLoginAction} fields={{ id, mode: "create" }} label="Reset password" confirm="Issue a new temporary password? Their current one stops working." />
                    <ConfirmButton action={portalLoginAction} fields={{ id, mode: portal.status === "active" ? "disable" : "enable" }} label={portal.status === "active" ? "Disable access" : "Enable access"} />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p style={{ color: "var(--ink-3)" }}>Give this renter a login to see their unit, agreement, invoices and receipts online.</p>
                {can(role, "renters.edit") && <ConfirmButton action={portalLoginAction} fields={{ id, mode: "create" }} label="Create portal login" icon="key" className="btn" />}
              </div>
            )}
          </Card>

          {can(role, "finance.edit") && (
            <Card title="Credit">
              <p className="text-sm mb-3" style={{ color: "var(--ink-3)" }}>A goodwill credit reduces what the renter owes on their next invoice.</p>
              <ModalForm label="Add a credit" title="Add a credit" action={addCreditAction} className="btn" icon="plus" submit="Add credit">
                <input type="hidden" name="renter_id" value={id} />
                <div className="space-y-4">
                  <Field label={`Amount (${cur})`}><input className="input" name="amount" inputMode="decimal" placeholder="0.00" required /></Field>
                  <Field label="Reason"><input className="input" name="reason" required maxLength={200} placeholder="e.g. Compensation for the gate outage" /></Field>
                </div>
              </ModalForm>
            </Card>
          )}

          <HistoryPanel db={db} entity="renter" entityId={id} />

          {can(role, "renters.edit") && agreements.length === 0 && (
            <ConfirmButton action={deleteRenterAction} fields={{ id }} label="Delete renter" icon="trash" className="btn btn-danger btn-sm" confirm={`Delete ${renterName(r)}?`} />
          )}
        </div>
      </div>
    </>
  );
}
