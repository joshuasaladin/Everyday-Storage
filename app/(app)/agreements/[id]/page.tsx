import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/components/Icon";
import SignaturePad from "@/components/SignaturePad";
import { Card, Check, Chip, Detail, EmptyState, Field, InvoiceChip, Lines, Meter, Notice, PageHeader, StatusChip } from "@/components/ui";
import { ActionForm, ConfirmButton, IdempotencyKey, ModalForm } from "@/components/forms";
import { DocumentsPanel, HistoryPanel } from "@/components/panels";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { cancelAgreementAction, depositAction, generateNowAction, moveOutAction, renewAgreementAction, sendSignLinkAction, signAgreementAction, updateAgreementAction } from "@/lib/actions/agreements";
import { AGREEMENT_STATUSES, contractProgress, MOVE_OUT_STEPS, RENEWAL_OPTIONS } from "@/lib/agreements";
import { displayStatus } from "@/lib/billing";
import { depositHeld, PAYMENT_METHODS } from "@/lib/payments";
import { label } from "@/lib/units";
import { today } from "@/lib/clock";
import { centsInput, dims, formatDate, formatDateTime, money, renterName, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("agreements.view");
  const { id } = await params;
  const { db } = ctx;
  const a = db.one<Record<string, any>>(
    `SELECT a.*, u.unit_number, u.width_m, u.depth_m, u.height_m, f.name AS facility_name FROM agreements a
       JOIN units u ON u.id = a.unit_id JOIN facilities f ON f.id = a.facility_id WHERE a.id = ?`,
    [id],
  );
  if (!a) notFound();
  const renter = db.one<Record<string, any>>(`SELECT id, kind, first_name, last_name, company, email, phone FROM renters WHERE id = ?`, [a.renter_id])!;
  const role = ctx.user.role;
  const edit = can(role, "agreements.edit");
  const money$ = can(role, "finance.view");
  const cur = ctx.settings.base_currency;
  const t = today();
  const p = contractProgress(a as never);
  const held = depositHeld(db, id);
  const deposits = db.all<Record<string, any>>(`SELECT * FROM deposit_transactions WHERE agreement_id = ? ORDER BY txn_date, created_at`, [id]);
  const invoices = db.all<Record<string, any>>(`SELECT * FROM invoices WHERE agreement_id = ? ORDER BY COALESCE(period_start, issue_date) DESC LIMIT 18`, [id]);
  const renewals = db.all<Record<string, any>>(`SELECT * FROM agreement_renewals WHERE agreement_id = ? ORDER BY created_at DESC`, [id]);
  const moveOut = db.one<Record<string, any>>(`SELECT * FROM move_outs WHERE agreement_id = ? AND status IN ('requested','scheduled') LIMIT 1`, [id]);
  const owed = db.num(`SELECT COALESCE(SUM(balance_cents), 0) FROM invoices WHERE agreement_id = ? AND status IN ('open','partial')`, [id]);
  const live = a.status === "active";
  const pending = a.status === "pending_signature";

  return (
    <>
      <PageHeader
        eyebrow={`${a.facility_name} · Unit ${a.unit_number}`}
        title={<span className="flex flex-wrap items-center gap-3">{a.agreement_no} <StatusChip list={AGREEMENT_STATUSES} value={a.status} /></span>}
        back={{ href: "/agreements", label: "Agreements" }}
        actions={
          <>
            <a href={`/api/agreements/${id}/pdf`} target="_blank" className="btn"><Icon name="download" />PDF</a>
            {live && edit && (
              <ModalForm label="Renew" title="Renew agreement" blurb="Starts a new fixed term from the day after the current one ends." action={renewAgreementAction} className="btn" icon="repeat" submit="Renew">
                <input type="hidden" name="id" value={id} />
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Renewal term (months)"><input className="input" type="number" name="months" min={1} max={120} defaultValue={a.term_months ?? 12} required /></Field>
                  <Field label={`New monthly rate (${cur})`} hint="Leave as is to keep the rate."><input className="input" name="new_rate" inputMode="decimal" defaultValue={centsInput(a.monthly_rate_cents)} /></Field>
                  <Field label="Note" className="col-span-2"><input className="input" name="note" maxLength={200} /></Field>
                </div>
              </ModalForm>
            )}
            {live && edit && !moveOut && (
              <ModalForm label="Schedule move-out" title="Schedule move-out" blurb={`Billing stops on the move-out date. The agreement asks for ${a.notice_days} days' notice.`} action={moveOutAction} className="btn" icon="logout" submit="Schedule">
                <input type="hidden" name="op" value="schedule" />
                <input type="hidden" name="agreement_id" value={id} />
                <div className="space-y-4">
                  <Field label="Move-out date"><input className="input" type="date" name="move_out_date" min={a.start_date} required /></Field>
                  <Field label="Notes"><input className="input" name="notes" maxLength={500} /></Field>
                </div>
              </ModalForm>
            )}
          </>
        }
      />

      {pending && (
        <Card className="mb-5" title="Signature needed">
          <p className="text-sm mb-4" style={{ color: "var(--ink-2)" }}>
            The unit is held for this renter. The agreement becomes active — and the first invoice is created — the moment it is signed.
          </p>
          {edit && (
            <div className="grid md:grid-cols-3 gap-4">
              <div className="panel-flat p-4">
                <div className="text-sm font-semibold mb-1">Sign online</div>
                <p className="hint mb-3" style={{ marginTop: 0 }}>Email the renter a personal link to review and sign from their phone.</p>
                <ConfirmButton action={sendSignLinkAction} fields={{ id }} label="Send signing link" icon="mail" className="btn btn-primary" />
              </div>
              <div className="panel-flat p-4">
                <div className="text-sm font-semibold mb-1">Sign on this device</div>
                <p className="hint mb-3" style={{ marginTop: 0 }}>Hand over the tablet or phone and have the renter sign here.</p>
                <ModalForm label="Sign now" title={`Sign ${a.agreement_no}`} action={signAgreementAction} className="btn" icon="pen" submit="Sign and activate" wide>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="method" value="in-person" />
                  <div className="panel-flat p-3 mb-4 text-xs leading-relaxed whitespace-pre-wrap" style={{ maxHeight: 180, overflow: "auto", color: "var(--ink-2)" }}>{a.terms_snapshot}</div>
                  <Field label="Full name of the person signing"><input className="input" name="signed_name" defaultValue={renter.kind === "business" ? `${renter.first_name} ${renter.last_name}`.trim() : renterName(renter)} required /></Field>
                  <div className="mt-4"><div className="label">Signature</div><SignaturePad /></div>
                </ModalForm>
              </div>
              <div className="panel-flat p-4">
                <div className="text-sm font-semibold mb-1">Signed on paper</div>
                <p className="hint mb-3" style={{ marginTop: 0 }}>Record a paper signature, then upload the scan under Documents.</p>
                <ModalForm label="Mark as signed" title="Signed on paper" action={signAgreementAction} className="btn" icon="file" submit="Activate agreement">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="method" value="paper" />
                  <Field label="Full name of the person who signed"><input className="input" name="signed_name" defaultValue={renterName(renter)} required /></Field>
                </ModalForm>
              </div>
            </div>
          )}
          {edit && (
            <div className="mt-4">
              <ConfirmButton action={cancelAgreementAction} fields={{ id }} label="Cancel this agreement" className="btn btn-ghost btn-sm" confirm="Cancel this unsigned agreement and release the unit?" />
            </div>
          )}
        </Card>
      )}

      {moveOut && (
        <Card className="mb-5" title={<span className="flex items-center gap-2">Move-out {moveOut.status === "requested" ? "requested by the renter" : "in progress"} <Chip tone="warn">{formatDate(moveOut.move_out_date)}</Chip></span>}>
          {moveOut.status === "requested" ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm flex-1" style={{ color: "var(--ink-2)" }}>The renter asked to move out on {formatDate(moveOut.move_out_date)}. Confirm it to stop billing on that date.</p>
              {edit && <ConfirmButton action={moveOutAction} fields={{ op: "confirm", move_out_id: moveOut.id }} label="Confirm move-out" className="btn btn-primary" />}
              {edit && <ConfirmButton action={moveOutAction} fields={{ op: "cancel", move_out_id: moveOut.id }} label="Decline" className="btn" />}
            </div>
          ) : (
            <>
              <ul className="space-y-1 mb-4">
                {MOVE_OUT_STEPS.map((s) => (
                  <li key={s.key} className="flex items-center gap-3">
                    {edit ? (
                      <ConfirmButton action={moveOutAction} title="quiet" fields={{ op: "step", move_out_id: moveOut.id, step: s.key, done: moveOut[s.key] ? "0" : "1" }}
                        className="btn btn-ghost btn-sm" label={<><span className="grid place-items-center w-5 h-5 rounded-md" style={{ border: "1.5px solid var(--line-2)", background: moveOut[s.key] ? "var(--good-fg)" : "transparent", color: "#fff" }}>{moveOut[s.key] ? <Icon name="check" className="w-3.5 h-3.5" /> : null}</span><span style={{ textDecoration: moveOut[s.key] ? "line-through" : undefined, color: moveOut[s.key] ? "var(--ink-3)" : "var(--ink)" }}>{s.label}</span></>} />
                    ) : <span className="text-sm">{moveOut[s.key] ? "✓" : "○"} {s.label}</span>}
                  </li>
                ))}
              </ul>
              {(owed > 0 || held > 0) && (
                <div className="mb-4"><Notice tone="warn">{owed > 0 ? `${money(owed, cur)} is still owed on this agreement. ` : ""}{held > 0 ? `${money(held, cur)} of deposit is still held — refund or apply it below.` : ""}</Notice></div>
              )}
              {edit && (
                <div className="flex flex-wrap gap-2">
                  <ConfirmButton action={moveOutAction} fields={{ op: "complete", move_out_id: moveOut.id }} label="Complete move-out" icon="check" className="btn btn-primary"
                    confirm="End this agreement and free the unit?" />
                  <ConfirmButton action={moveOutAction} fields={{ op: "cancel", move_out_id: moveOut.id }} label="Cancel move-out" className="btn" confirm="Cancel the move-out and resume normal billing?" />
                </div>
              )}
              {moveOut.move_out_date > t && <p className="hint mt-2">It can be completed on or after {formatDate(moveOut.move_out_date)}.</p>}
            </>
          )}
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <Card title="Contract">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              <Detail label="Renter"><Link className="link" href={`/renters/${renter.id}`}>{renterName(renter)}</Link></Detail>
              <Detail label="Unit"><Link className="link" href={`/units/${a.unit_id}`}>{a.unit_number}</Link> <span style={{ color: "var(--ink-3)" }}>· {dims(a)}</span></Detail>
              <Detail label="Type">{a.term_type === "fixed" ? `Fixed, ${a.term_months} months` : "Month-to-month"}</Detail>
              <Detail label="Notice period">{a.notice_days} days</Detail>
              <Detail label="Start">{formatDate(a.start_date)}</Detail>
              <Detail label="End">{a.end_date ? formatDate(a.end_date) : "Open-ended"}</Detail>
              <Detail label="At term end">{a.term_type === "fixed" ? label(RENEWAL_OPTIONS, a.renewal_option) : "—"}</Detail>
              <Detail label="Billing">{a.billing_mode === "anniversary" ? `Anniversary (day ${Number(a.start_date.slice(8))})` : `Day ${a.billing_day} of each month`}</Detail>
            </div>

            <div className="panel-flat p-4">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
                <div>
                  <div className="eyebrow mb-1">Elapsed</div>
                  <div className="stat-value" style={{ fontSize: "1.4rem" }}>{p.started ? `${p.elapsedMonths} ${p.elapsedMonths === 1 ? "month" : "months"}` : `Starts in ${p.startsIn} days`}</div>
                  {p.started && <div className="text-xs" style={{ color: "var(--ink-3)" }}>{p.elapsedDays} days since {formatDate(a.start_date)}</div>}
                </div>
                <div className="text-right">
                  <div className="eyebrow mb-1">Remaining</div>
                  <div className="stat-value" style={{ fontSize: "1.4rem" }}>{a.status === "ended" ? "Ended" : p.remainingMonths === null ? "Open-ended" : `${p.remainingMonths} ${p.remainingMonths === 1 ? "month" : "months"}`}</div>
                  {p.remainingDays !== null && a.status !== "ended" && <div className="text-xs" style={{ color: "var(--ink-3)" }}>{p.remainingDays} days to {formatDate(a.end_date)}</div>}
                </div>
              </div>
              {p.pct !== null && <Meter value={p.pct} tone={live && (p.remainingDays ?? 99) <= 30 ? "warn" : undefined} />}
              {a.renewal_requested_at && live && <div className="mt-3"><Notice>The renter asked to renew on {formatDate(a.renewal_requested_at)}.</Notice></div>}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
              <Detail label="Monthly rate">{money(a.monthly_rate_cents, cur)}</Detail>
              <Detail label="Discount">{a.discount_cents ? `${money(a.discount_cents, cur)}${a.discount_note ? ` · ${a.discount_note}` : ""}` : null}</Detail>
              <Detail label="Net monthly">{money(a.monthly_rate_cents - a.discount_cents, cur)}</Detail>
              <Detail label="Next invoice period">{a.next_period_start ? formatDate(a.next_period_start) : live ? "Nothing further" : "—"}</Detail>
            </div>
            {a.notes && <div className="mt-5"><div className="label">Internal notes</div><Lines text={a.notes} /></div>}

            {edit && (live || pending) && (
              <details className="mt-5 hair pt-4">
                <summary className="btn btn-sm inline-flex"><Icon name="edit" className="w-3.5 h-3.5" />Change rate, discount or renewal</summary>
                <ActionForm action={updateAgreementAction} className="mt-4" submit="Save changes">
                  <input type="hidden" name="id" value={id} />
                  <div className="grid sm:grid-cols-3 gap-4">
                    <Field label={`Monthly rate (${cur})`}><input className="input" name="monthly_rate" inputMode="decimal" defaultValue={centsInput(a.monthly_rate_cents)} required /></Field>
                    <Field label={`Monthly discount (${cur})`}><input className="input" name="discount" inputMode="decimal" defaultValue={a.discount_cents ? centsInput(a.discount_cents) : ""} /></Field>
                    <Field label="Discount reason"><input className="input" name="discount_note" defaultValue={a.discount_note ?? ""} maxLength={120} /></Field>
                    <Field label="At term end">
                      <select className="select" name="renewal_option" defaultValue={a.renewal_option} disabled={a.term_type !== "fixed"}>
                        {RENEWAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Renewal term (months)"><input className="input" type="number" name="renewal_term_months" min={1} max={120} defaultValue={a.renewal_term_months ?? a.term_months ?? ""} /></Field>
                    <Field label="Notice period (days)"><input className="input" type="number" name="notice_days" min={0} max={365} defaultValue={a.notice_days} /></Field>
                    <Field label="Internal notes" className="sm:col-span-3"><textarea className="textarea" name="notes" defaultValue={a.notes ?? ""} /></Field>
                  </div>
                  <p className="hint">Rate changes apply to invoices generated from now on. Invoices already issued are not altered.</p>
                </ActionForm>
              </details>
            )}
          </Card>

          {money$ && (
            <Card title="Invoices" dense action={live && can(role, "finance.edit") ? <ConfirmButton action={generateNowAction} fields={{ agreement_id: id }} label="Generate due invoices" icon="refresh" className="btn btn-ghost btn-sm" /> : undefined}>
              {invoices.length === 0 ? <EmptyState title="No invoices yet" hint={pending ? "The first invoice is created when the agreement is signed." : undefined} /> : (
                <div className="scroll-x">
                  <table className="table">
                    <thead><tr><th>Invoice</th><th>Period</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th><th>Status</th></tr></thead>
                    <tbody>
                      {invoices.map((i) => (
                        <tr key={i.id}>
                          <td className="primary"><Link href={`/invoices/${i.id}`} className="link-ink">{i.invoice_no}</Link></td>
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

          <Card title="Terms" action={<span className="text-xs" style={{ color: "var(--ink-3)" }}>fingerprint {String(a.terms_sha256).slice(0, 12)}…</span>}>
            <div className="text-xs leading-relaxed whitespace-pre-wrap" style={{ maxHeight: 260, overflow: "auto", color: "var(--ink-2)" }}>{a.terms_snapshot}</div>
          </Card>

          <DocumentsPanel db={db} entity="agreement" entityId={id} canEdit={edit} />
        </div>

        <div className="space-y-5">
          <Card title="Signature">
            {a.signed_at ? (
              <div className="space-y-3">
                {a.signature_png && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.signature_png} alt={`Signature of ${a.signed_name}`} style={{ background: "#fff", borderRadius: 8, border: "1px solid var(--line)", maxHeight: 90, width: "100%", objectFit: "contain" }} />
                )}
                <Detail label="Signed by">{a.signed_name}</Detail>
                <Detail label="When">{formatDateTime(a.signed_at)}</Detail>
                <Detail label="How">{a.signed_method === "e-sign" ? "Online (e-signature)" : a.signed_method === "in-person" ? "On a staff device" : "On paper"}{a.signed_ip ? ` · ${a.signed_ip}` : ""}</Detail>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--ink-3)" }}>{pending ? "Not signed yet." : "This agreement was never signed."}</p>
            )}
          </Card>

          {money$ && (
            <Card title="Security deposit" dense>
              <div className="p-4">
                <div className="flex items-end justify-between gap-3">
                  <div><div className="eyebrow mb-1">Held</div><div className="stat-value" style={{ fontSize: "1.4rem" }}>{money(held, cur)}</div></div>
                  <div className="text-right text-xs" style={{ color: "var(--ink-3)" }}>Required {money(a.deposit_cents, cur)}<br />A liability — not revenue</div>
                </div>
                {held < a.deposit_cents && (live || pending) && <div className="mt-3"><Notice tone="warn">{money(a.deposit_cents - held, cur)} of the deposit has not been collected.</Notice></div>}
                {can(role, "finance.edit") && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    <DepositModal kind="collected" label="Collect" title="Collect deposit" id={id} cur={cur} amount={Math.max(a.deposit_cents - held, 0)} t={t} />
                    {held > 0 && owed > 0 && <DepositModal kind="applied" label="Apply to invoices" title="Apply deposit to unpaid invoices" id={id} cur={cur} amount={Math.min(held, owed)} t={t} />}
                    {held > 0 && can(role, "finance.refund") && <DepositModal kind="refunded" label="Refund" title="Refund deposit" id={id} cur={cur} amount={held} t={t} />}
                    {held > 0 && can(role, "finance.refund") && <DepositModal kind="forfeited" label="Forfeit" title="Forfeit deposit" id={id} cur={cur} amount={held} t={t} />}
                  </div>
                )}
              </div>
              {deposits.length > 0 && (
                <ul className="hair">
                  {deposits.map((d, i) => (
                    <li key={d.id} className="flex items-center gap-3 px-4 py-2 text-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{titleCase(d.type)}</span>
                        <div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatDate(d.txn_date)}{d.method ? ` · ${titleCase(d.method)}` : ""}{d.reference ? ` · ${d.reference}` : ""}{d.notes ? ` · ${d.notes}` : ""}</div>
                      </div>
                      <span className="num font-semibold">{d.type === "collected" ? "" : "−"}{money(d.amount_cents, cur)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {renewals.length > 0 && (
            <Card title="Renewal history" dense>
              <ul>
                {renewals.map((r, i) => (
                  <li key={r.id} className="px-4 py-2.5 text-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    {r.kind === "to_month_to_month" ? "Continued month-to-month" : r.kind === "auto_renew" ? "Renewed automatically" : "Renewed"}
                    {r.new_end ? ` to ${formatDate(r.new_end)}` : ""}{r.new_rate_cents !== r.previous_rate_cents ? ` at ${money(r.new_rate_cents, cur)}` : ""}
                    <div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatDate(r.created_at)}{r.note ? ` · ${r.note}` : ""}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <HistoryPanel db={db} entity="agreement" entityId={id} />
        </div>
      </div>
    </>
  );
}

function DepositModal({ kind, label: text, title, id, cur, amount, t }: { kind: string; label: string; title: string; id: string; cur: string; amount: number; t: string }) {
  const blurb =
    kind === "collected" ? "Money held as security. It is recorded in the deposit ledger only — no invoice, no revenue."
    : kind === "applied" ? "Uses the deposit to pay this renter's unpaid invoices. This is when deposit money becomes revenue."
    : kind === "refunded" ? "Money returned to the renter."
    : "Keeps the deposit (for damage or abandonment). It is reported as other income.";
  return (
    <ModalForm label={text} title={title} blurb={blurb} action={depositAction} className="btn btn-sm" submit={text}>
      <input type="hidden" name="agreement_id" value={id} />
      <input type="hidden" name="type" value={kind} />
      <IdempotencyKey />
      <div className="grid grid-cols-2 gap-4">
        <Field label={`Amount (${cur})`}><input className="input" name="amount" inputMode="decimal" defaultValue={centsInput(amount)} required /></Field>
        <Field label="Date"><input className="input" type="date" name="txn_date" defaultValue={t} max={t} required /></Field>
        {(kind === "collected" || kind === "refunded") && (
          <>
            <Field label="Method">
              <select className="select" name="method" defaultValue="bank_transfer">{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
            </Field>
            <Field label="Reference"><input className="input" name="reference" maxLength={80} /></Field>
          </>
        )}
        <Field label="Notes" className="col-span-2"><input className="input" name="notes" maxLength={300} /></Field>
      </div>
    </ModalForm>
  );
}
