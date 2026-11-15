import Icon from "@/components/Icon";
import { Card, Chip, Detail, EmptyState, Field, InvoiceChip, Meter, Notice, StatCard } from "@/components/ui";
import { ConfirmButton, ModalForm } from "@/components/forms";
import { requireRenter } from "@/lib/auth";
import { portalPayAction, requestMoveOutAction, requestRenewalAction } from "@/lib/actions/portal";
import { contractProgress } from "@/lib/agreements";
import { displayStatus } from "@/lib/billing";
import { depositHeld, renterBalance } from "@/lib/payments";
import { addDays, today } from "@/lib/clock";
import { secondary } from "@/lib/settings";
import { dims, fileSize, formatDate, money, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const ctx = await requireRenter();
  const { db, renterId, settings } = ctx;
  const cur = settings.base_currency;
  const t = today();
  // everything below is filtered by the signed-in renter's id — the only id this page ever uses
  const renter = db.one<Record<string, any>>(`SELECT first_name, last_name, company, kind FROM renters WHERE id = ?`, [renterId])!;
  const bal = renterBalance(db, renterId);
  const agreements = db.all<Record<string, any>>(
    `SELECT a.*, u.unit_number, u.width_m, u.depth_m, u.height_m, u.location, u.features, f.name AS facility_name, f.address AS facility_address,
            (SELECT m.status || '|' || m.move_out_date FROM move_outs m WHERE m.agreement_id = a.id AND m.status IN ('requested','scheduled') LIMIT 1) AS move_out
       FROM agreements a JOIN units u ON u.id = a.unit_id JOIN facilities f ON f.id = a.facility_id
      WHERE a.renter_id = ? AND a.status IN ('active','pending_signature','ended') ORDER BY (a.status = 'ended'), a.start_date DESC`,
    [renterId],
  );
  const invoices = db.all<Record<string, any>>(`SELECT i.*, u.unit_number FROM invoices i LEFT JOIN units u ON u.id = i.unit_id WHERE i.renter_id = ? AND i.status NOT IN ('void','draft') ORDER BY i.issue_date DESC, i.invoice_no DESC LIMIT 18`, [renterId]);
  const payments = db.all<Record<string, any>>(`SELECT * FROM payments WHERE renter_id = ? ORDER BY received_date DESC LIMIT 12`, [renterId]);
  const docs = db.all<Record<string, any>>(`SELECT id, name, size_bytes, created_at FROM documents WHERE renter_id = ? AND renter_visible = 1 ORDER BY created_at DESC`, [renterId]);
  const nextDue = invoices.filter((i) => i.balance_cents > 0).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const alt = secondary(settings, bal.outstanding);

  return (
    <>
      <div className="mb-6">
        <div className="eyebrow mb-1">Welcome back</div>
        <h1 className="page-title">{renter.kind === "business" && renter.company ? renter.company : `${renter.first_name} ${renter.last_name}`}</h1>
      </div>
      {ctx.user.must_change_password ? <div className="mb-5"><Notice tone="warn">You are using a temporary password. <a className="link" href="/portal/account">Choose your own</a>.</Notice></div> : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Balance due" value={money(bal.outstanding, cur)} tone={bal.overdue ? "bad" : bal.outstanding ? "warn" : "good"} icon="receipt"
          sub={bal.outstanding ? `${settings.show_secondary_currency ? `≈ ${money(alt.cents, alt.currency)} · ` : ""}${bal.overdue ? "includes overdue" : "not yet due"}` : "You are all paid up"} />
        <StatCard label="Next payment" value={nextDue ? formatDate(nextDue.due_date) : "—"} tone="info" icon="calendar" sub={nextDue ? `${money(nextDue.balance_cents, cur)} · ${nextDue.invoice_no}` : "Nothing scheduled"} />
        <StatCard label="Credit" value={money(bal.credit, cur)} tone="neutral" icon="wallet" sub="used on your next invoice" />
        <StatCard label="Deposit held" value={money(bal.deposits, cur)} tone="neutral" icon="shield" sub="returned after move-out" />
      </div>

      <h2 className="section-title mb-3">Your units</h2>
      {agreements.length === 0 ? <Card className="mb-6"><EmptyState title="No units yet" hint="Once your agreement is set up it appears here." /></Card> : (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {agreements.map((a) => {
            const p = contractProgress(a as never);
            const live = a.status === "active";
            const [moStatus, moDate] = String(a.move_out ?? "").split("|");
            const held = depositHeld(db, a.id);
            return (
              <div key={a.id} className="panel p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="eyebrow mb-0.5">{a.facility_name}{a.location ? ` · ${a.location}` : ""}</div>
                    <div className="section-title">Unit {a.unit_number}</div>
                  </div>
                  <Chip tone={live ? "good" : a.status === "ended" ? "muted" : "warn"} dot>{live ? "Active" : a.status === "ended" ? "Ended" : "Awaiting your signature"}</Chip>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <Detail label="Size">{dims(a)}</Detail>
                  <Detail label="Monthly rent">{money(a.monthly_rate_cents - a.discount_cents, cur)}</Detail>
                  <Detail label="Started">{formatDate(a.start_date)}</Detail>
                  <Detail label={a.end_date ? "Term ends" : "Term"}>{a.end_date ? formatDate(a.end_date) : "Month-to-month"}</Detail>
                  <Detail label="Agreement">{a.agreement_no}</Detail>
                  <Detail label="Deposit held">{money(held, cur)}</Detail>
                </div>
                {live && (
                  <div className="panel-flat p-3 mb-4">
                    <div className="flex justify-between text-xs mb-1.5" style={{ color: "var(--ink-3)" }}>
                      <span>{p.started ? `${p.elapsedMonths} ${p.elapsedMonths === 1 ? "month" : "months"} so far` : `Starts in ${p.startsIn} days`}</span>
                      <span>{p.remainingMonths === null ? "Open-ended" : `${p.remainingMonths} ${p.remainingMonths === 1 ? "month" : "months"} remaining`}</span>
                    </div>
                    {p.pct !== null && <Meter value={p.pct} />}
                    <div className="text-xs mt-2" style={{ color: "var(--ink-2)" }}>
                      {moStatus ? `Move-out ${moStatus === "requested" ? "requested" : "confirmed"} for ${formatDate(moDate)}.`
                        : a.term_type === "month_to_month" ? `Continues monthly until either of us gives ${a.notice_days} days' notice.`
                        : a.renewal_option === "auto_renew" ? `Renews automatically for ${a.renewal_term_months ?? a.term_months} months after ${formatDate(a.end_date)}.`
                        : a.renewal_option === "end" ? `Ends on ${formatDate(a.end_date)} unless you renew.`
                        : `Continues month-to-month after ${formatDate(a.end_date)}.`}
                      {a.renewal_requested_at ? " We have your renewal request." : ""}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/agreements/${a.id}/pdf`} target="_blank" className="btn btn-sm"><Icon name="download" className="w-3.5 h-3.5" />Agreement</a>
                  {live && a.term_type === "fixed" && !a.renewal_requested_at && !moStatus && (
                    <ConfirmButton action={requestRenewalAction} fields={{ agreement_id: a.id }} label="Ask to renew" icon="repeat" />
                  )}
                  {live && !moStatus && (
                    <ModalForm label="Give notice to move out" title={`Move out of unit ${a.unit_number}`} blurb={`Your agreement asks for ${a.notice_days} days' notice. We will confirm the date with you.`} action={requestMoveOutAction} className="btn btn-sm" submit="Send request">
                      <input type="hidden" name="agreement_id" value={a.id} />
                      <div className="space-y-4">
                        <Field label="Move-out date"><input className="input" type="date" name="move_out_date" min={addDays(t, a.notice_days)} required /></Field>
                        <Field label="Anything we should know?"><input className="input" name="notes" maxLength={500} /></Field>
                      </div>
                    </ModalForm>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 items-start">
        <Card title="Invoices" dense>
          {invoices.length === 0 ? <EmptyState title="No invoices yet" /> : (
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>Invoice</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="primary whitespace-nowrap">{i.invoice_no}<div className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{i.period_start ? `${formatDate(i.period_start)} – ${formatDate(i.period_end)}` : "One-off"}{i.unit_number ? ` · ${i.unit_number}` : ""}</div></td>
                      <td className="whitespace-nowrap">{formatDate(i.due_date)}</td>
                      <td className="r num">{money(i.total_cents, i.currency)}</td>
                      <td className="r num">{money(i.balance_cents, i.currency)}</td>
                      <td><InvoiceChip status={displayStatus(i as never, t)} /></td>
                      <td className="r whitespace-nowrap">
                        <a href={`/api/invoices/${i.id}/pdf`} target="_blank" className="btn btn-ghost btn-sm" aria-label={`Download ${i.invoice_no}`}><Icon name="download" className="w-3.5 h-3.5" />PDF</a>
                        {i.balance_cents > 0 && <ConfirmButton action={portalPayAction} fields={{ invoice_id: i.id }} label="Pay" className="btn btn-sm btn-primary" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="How to pay"><p className="text-sm whitespace-pre-wrap" style={{ color: "var(--ink-2)" }}>{settings.payment_instructions}</p></Card>
          <Card title="Payments and receipts" dense>
            {payments.length === 0 ? <EmptyState title="No payments yet" /> : (
              <ul>
                {payments.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{money(p.amount_cents, cur)}</div>
                      <div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatDate(p.received_date)} · {p.method === "deposit" ? "Deposit applied" : titleCase(p.method)}{p.refunded_cents ? ` · ${money(p.refunded_cents, cur)} refunded` : ""}</div>
                    </div>
                    <a href={`/api/receipts/${p.id}/pdf`} target="_blank" className="btn btn-ghost btn-sm"><Icon name="download" className="w-3.5 h-3.5" />Receipt</a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {docs.length > 0 && (
            <Card title="Documents" dense>
              <ul>
                {docs.map((d, i) => (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <Icon name="file" className="w-4 h-4 shrink-0" />
                    <a className="link-ink text-sm flex-1 break-all" href={`/api/files/${d.id}`} target="_blank">{d.name}</a>
                    <span className="text-xs" style={{ color: "var(--ink-3)" }}>{fileSize(d.size_bytes)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
