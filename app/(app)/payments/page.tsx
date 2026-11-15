import Link from "next/link";
import PaymentFields from "@/components/PaymentFields";
import ReconcileForm from "@/components/ReconcileForm";
import { Card, Chip, EmptyState, Notice, PageHeader, StatCard, Tabs } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { exportUrl, Pager, SortTh, Toolbar } from "@/components/table";
import { requireStaff, scope } from "@/lib/auth";
import { can } from "@/lib/roles";
import { recordPaymentAction } from "@/lib/actions/billing";
import { PAYMENT_METHODS } from "@/lib/payments";
import { startOfMonth, today } from "@/lib/clock";
import { formatDate, money, renterName, titleCase } from "@/lib/format";
import { like, listParams, param, withQuery, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

const SORT = { no: "p.payment_no", date: "p.received_date", renter: "COALESCE(NULLIF(r.company, ''), r.last_name || r.first_name) COLLATE NOCASE", amount: "p.amount_cents", method: "p.method" };
const methodLabel = (m: string) => (m === "deposit" ? "Deposit applied" : PAYMENT_METHODS.find((x) => x.value === m)?.label ?? titleCase(m));

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("finance.view");
  const query = await searchParams;
  const { db } = ctx;
  const view = param(query, "view") || "payments";
  const cur = ctx.settings.base_currency;
  const t = today();
  const edit = can(ctx.user.role, "finance.edit");
  const s = scope(ctx, "p.facility_id");
  const tab = (key: string) => (key === "payments" ? "/payments" : `/payments?view=${key}`);

  const unreconciled = db.num(`SELECT COUNT(*) FROM payments p WHERE p.reconciled_at IS NULL AND p.method <> 'deposit' AND p.status <> 'refunded'${s.sql}`, s.params);
  const monthIn = db.num(`SELECT COALESCE(SUM(p.amount_cents - p.refunded_cents), 0) FROM payments p WHERE p.method <> 'deposit' AND p.received_date >= ?${s.sql}`, [startOfMonth(t), ...s.params]);
  const credit = db.num(`SELECT COALESCE(SUM(remaining_cents), 0) FROM credits`);
  const ds = scope(ctx, "d.facility_id");
  const held = db.num(`SELECT COALESCE(SUM(CASE WHEN d.type = 'collected' THEN d.amount_cents ELSE -d.amount_cents END), 0) FROM deposit_transactions d WHERE 1 = 1${ds.sql}`, ds.params);

  const renters = edit ? db.all<Record<string, any>>(`SELECT id, renter_no, kind, first_name, last_name, company FROM renters WHERE status <> 'lead' ORDER BY COALESCE(NULLIF(company, ''), last_name || first_name) COLLATE NOCASE`) : [];
  const preRenter = param(query, "renter");
  const owed = preRenter ? db.num(`SELECT COALESCE(SUM(balance_cents), 0) FROM invoices WHERE renter_id = ? AND status IN ('open','partial')`, [preRenter]) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Payments"
        blurb="Money actually received, what it was applied to, and what the bank statement confirms. Deposits are kept in their own ledger."
        actions={edit && (
          <ModalForm label="Record payment" title="Record a payment" action={recordPaymentAction} className="btn btn-primary" icon="plus" submit="Record payment">
            <PaymentFields currency={cur} today={t} renters={renters.map((r) => ({ id: r.id, label: `${renterName(r)} (${r.renter_no})` }))} renterId={preRenter || undefined} amount={owed || undefined} />
          </ModalForm>
        )}
      />

      {param(query, "record") && edit && <div className="mb-5"><Notice>Use <strong>Record payment</strong> to book money you have received{preRenter && owed ? ` — this renter owes ${money(owed, cur)}` : ""}.</Notice></div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Received this month" value={money(monthIn, cur)} tone="good" icon="card" sub="net of refunds" />
        <StatCard label="To reconcile" value={unreconciled} tone={unreconciled ? "warn" : "good"} icon="scale" sub="not yet matched to a statement" href="/payments?view=reconcile" />
        <StatCard label="Renter credit" value={money(credit, cur)} tone="info" icon="wallet" sub="overpayments and goodwill credits" />
        <StatCard label="Deposits held" value={money(held, cur)} tone="neutral" icon="shield" sub="a liability, not revenue" href="/payments?view=deposits" />
      </div>

      <Tabs active={view} tabs={[
        { key: "payments", label: "Payments", href: tab("payments") },
        { key: "reconcile", label: "Reconciliation", href: tab("reconcile"), count: unreconciled },
        { key: "deposits", label: "Security deposits", href: tab("deposits") },
        { key: "refunds", label: "Refunds", href: tab("refunds") },
      ]} />

      {view === "payments" && <PaymentList ctx={ctx} query={query} />}
      {view === "reconcile" && <Reconcile ctx={ctx} edit={edit} />}
      {view === "deposits" && <Deposits ctx={ctx} query={query} />}
      {view === "refunds" && <Refunds ctx={ctx} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireStaff>>;

function PaymentList({ ctx, query }: { ctx: Ctx; query: Query }) {
  const list = listParams(query, SORT, "date", "desc");
  const s = scope(ctx, "p.facility_id");
  const cur = ctx.settings.base_currency;
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  for (const [key, col] of [["method", "p.method"], ["renter", "p.renter_id"], ["pstatus", "p.status"]] as const) {
    if (param(query, key)) { where.push(`${col} = ?`); params.push(param(query, key)); }
  }
  if (param(query, "from")) { where.push("p.received_date >= ?"); params.push(param(query, "from")); }
  if (param(query, "to")) { where.push("p.received_date <= ?"); params.push(param(query, "to")); }
  if (list.q) {
    where.push(`(p.payment_no LIKE ? ESCAPE '\\' OR p.reference LIKE ? ESCAPE '\\' OR r.first_name || ' ' || r.last_name LIKE ? ESCAPE '\\' OR r.company LIKE ? ESCAPE '\\')`);
    params.push(...Array(4).fill(like(list.q)));
  }
  const from = `FROM payments p JOIN renters r ON r.id = p.renter_id WHERE ${where.join(" AND ")}${s.sql}`;
  const all = [...params, ...s.params];
  const totals = ctx.db.one<{ n: number; total: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(p.amount_cents - p.refunded_cents), 0) AS total ${from}`, all)!;
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT p.*, r.first_name, r.last_name, r.company, r.kind,
            (SELECT GROUP_CONCAT(i.invoice_no, ', ') FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = p.id) AS invoices
     ${from} ORDER BY ${list.orderBy}, p.payment_no DESC LIMIT ? OFFSET ?`,
    [...all, list.limit, list.offset],
  );
  return (
    <>
      <Toolbar query={query} keep={["renter"]} placeholder="Search by payment, reference or renter…" exportHref={exportUrl("payments", query)}
        filters={[
          { name: "method", label: "Method", options: [...PAYMENT_METHODS, { value: "deposit", label: "Deposit applied" }] },
          { name: "pstatus", label: "Status", options: [{ value: "completed", label: "Completed" }, { value: "partially_refunded", label: "Partly refunded" }, { value: "refunded", label: "Refunded" }] },
        ]}>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}>From<input type="date" name="from" defaultValue={param(query, "from")} className="input w-auto" /></label>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}>To<input type="date" name="to" defaultValue={param(query, "to")} className="input w-auto" /></label>
      </Toolbar>
      <Card dense>
        {rows.length === 0 ? <EmptyState title="No payments match" /> : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="no" label="Payment" base="/payments" query={query} list={list} />
                  <SortTh col="date" label="Received" base="/payments" query={query} list={list} />
                  <SortTh col="renter" label="Renter" base="/payments" query={query} list={list} />
                  <SortTh col="method" label="Method" base="/payments" query={query} list={list} />
                  <th>Reference</th><th>Applied to</th>
                  <SortTh col="amount" label="Amount" base="/payments" query={query} list={list} right />
                  <th>Reconciled</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="primary"><Link href={`/payments/${p.id}`} className="link-ink">{p.payment_no}</Link></td>
                    <td className="whitespace-nowrap">{formatDate(p.received_date)}</td>
                    <td><Link className="link" href={`/renters/${p.renter_id}`}>{renterName(p)}</Link></td>
                    <td>{methodLabel(p.method)}</td>
                    <td>{p.reference ?? "—"}</td>
                    <td className="text-xs">{p.invoices ?? <span style={{ color: "var(--ink-3)" }}>held as credit</span>}</td>
                    <td className="r num">{money(p.amount_cents, cur)}{p.refunded_cents > 0 && <div className="text-xs" style={{ color: "var(--bad-fg)" }}>refunded {money(p.refunded_cents, cur)}</div>}</td>
                    <td>{p.method === "deposit" ? <span style={{ color: "var(--ink-3)" }}>n/a</span> : p.reconciled_at ? <Chip tone="good" dot>Yes</Chip> : <Chip tone="warn" dot>No</Chip>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={6}>{totals.n} {totals.n === 1 ? "payment" : "payments"} in this view, net of refunds</td><td className="r num">{money(totals.total, cur)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        <Pager base="/payments" query={query} list={list} total={totals.n} />
      </Card>
    </>
  );
}

function Reconcile({ ctx, edit }: { ctx: Ctx; edit: boolean }) {
  const s = scope(ctx, "p.facility_id");
  const cur = ctx.settings.base_currency;
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT p.*, r.first_name, r.last_name, r.company, r.kind,
            (SELECT COUNT(*) FROM payments q WHERE q.renter_id = p.renter_id AND q.amount_cents = p.amount_cents AND q.received_date = p.received_date AND q.id <> p.id AND q.status <> 'refunded') AS twins
       FROM payments p JOIN renters r ON r.id = p.renter_id
      WHERE p.reconciled_at IS NULL AND p.method <> 'deposit' AND p.status <> 'refunded'${s.sql}
      ORDER BY p.received_date, p.payment_no LIMIT 300`,
    s.params,
  );
  const recent = ctx.db.all<Record<string, any>>(
    `SELECT p.statement_ref, p.reconciled_by, MAX(p.reconciled_at) AS at, COUNT(*) AS n, SUM(p.amount_cents - p.refunded_cents) AS total
       FROM payments p WHERE p.reconciled_at IS NOT NULL${s.sql} GROUP BY COALESCE(p.statement_ref, p.reconciled_at) ORDER BY at DESC LIMIT 8`,
    s.params,
  );
  return (
    <div className="grid lg:grid-cols-3 gap-5 items-start">
      <Card title="Payments not yet matched to a bank statement" dense className="lg:col-span-2">
        {rows.length === 0 ? <EmptyState title="Everything is reconciled" hint="Every recorded payment has been matched to a statement." /> : !edit ? <EmptyState title={`${rows.length} payments to reconcile`} /> : (
          <div className="pb-4">
            <ReconcileForm currency={cur} rows={rows.map((p) => ({
              id: p.id, no: p.payment_no, date: formatDate(p.received_date), renter: renterName(p), method: methodLabel(p.method), reference: p.reference,
              amount: p.amount_cents - p.refunded_cents, flag: p.twins > 0 ? "Same renter, amount and date as another payment — check for a duplicate" : null,
            }))} />
          </div>
        )}
      </Card>
      <Card title="Recent reconciliations" dense>
        {recent.length === 0 ? <EmptyState title="None yet" /> : (
          <ul>
            {recent.map((r, i) => (
              <li key={i} className="px-4 py-2.5 text-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                <div className="flex justify-between gap-3"><span className="font-medium">{r.statement_ref ?? "No reference"}</span><span className="num font-semibold">{money(r.total, cur)}</span></div>
                <div className="text-xs" style={{ color: "var(--ink-3)" }}>{r.n} payments · {r.reconciled_by} · {formatDate(r.at)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Deposits({ ctx, query }: { ctx: Ctx; query: Query }) {
  const s = scope(ctx, "a.facility_id");
  const cur = ctx.settings.base_currency;
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT a.id, a.agreement_no, a.status, a.deposit_cents, u.unit_number, r.id AS renter_id, r.first_name, r.last_name, r.company, r.kind,
            COALESCE(SUM(CASE WHEN d.type = 'collected' THEN d.amount_cents ELSE 0 END), 0) AS collected,
            COALESCE(SUM(CASE WHEN d.type = 'refunded' THEN d.amount_cents ELSE 0 END), 0) AS refunded,
            COALESCE(SUM(CASE WHEN d.type IN ('applied','forfeited') THEN d.amount_cents ELSE 0 END), 0) AS kept
       FROM agreements a JOIN units u ON u.id = a.unit_id JOIN renters r ON r.id = a.renter_id
       LEFT JOIN deposit_transactions d ON d.agreement_id = a.id
      WHERE a.status <> 'cancelled'${s.sql}
      GROUP BY a.id HAVING collected > 0 OR a.deposit_cents > 0
      ORDER BY (collected - refunded - kept) DESC, a.agreement_no DESC`,
    s.params,
  );
  const held = rows.reduce((t, r) => t + r.collected - r.refunded - r.kept, 0);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm max-w-2xl" style={{ color: "var(--ink-3)" }}>Deposits are money held for renters. They are tracked here, separately from invoices and payments, and only become income if applied to an unpaid invoice or forfeited.</p>
        <a href={withQuery("/api/export/deposits", query, { view: null })} className="btn" download>Export CSV</a>
      </div>
      <Card dense>
        {rows.length === 0 ? <EmptyState title="No deposits recorded" /> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Agreement</th><th>Renter</th><th>Unit</th><th className="r">Required</th><th className="r">Collected</th><th className="r">Refunded</th><th className="r">Applied / forfeited</th><th className="r">Held now</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const h = r.collected - r.refunded - r.kept;
                  return (
                    <tr key={r.id}>
                      <td className="primary"><Link href={`/agreements/${r.id}`} className="link-ink">{r.agreement_no}</Link>{r.status !== "active" && <span className="text-xs font-normal" style={{ color: "var(--ink-3)" }}> · {titleCase(r.status)}</span>}</td>
                      <td><Link className="link" href={`/renters/${r.renter_id}`}>{renterName(r)}</Link></td>
                      <td>{r.unit_number}</td>
                      <td className="r num">{money(r.deposit_cents, cur)}</td>
                      <td className="r num">{money(r.collected, cur)}</td>
                      <td className="r num">{r.refunded ? money(r.refunded, cur) : "—"}</td>
                      <td className="r num">{r.kept ? money(r.kept, cur) : "—"}</td>
                      <td className="r num" style={{ fontWeight: 600, color: h > 0 ? "var(--ink)" : "var(--ink-3)" }}>{money(h, cur)}{r.status === "ended" && h > 0 && <div className="text-xs font-normal" style={{ color: "var(--warn-fg)" }}>agreement ended — settle</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td colSpan={7}>Total held (liability)</td><td className="r num">{money(held, cur)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Refunds({ ctx }: { ctx: Ctx }) {
  const s = scope(ctx, "p.facility_id");
  const cur = ctx.settings.base_currency;
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT rf.*, p.payment_no, p.renter_id, r.first_name, r.last_name, r.company, r.kind FROM refunds rf
       JOIN payments p ON p.id = rf.payment_id JOIN renters r ON r.id = p.renter_id WHERE 1 = 1${s.sql} ORDER BY rf.refund_date DESC LIMIT 200`,
    s.params,
  );
  return (
    <Card dense>
      {rows.length === 0 ? <EmptyState title="No refunds" hint="Refunds are made from a payment's page by an administrator." /> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Date</th><th>Payment</th><th>Renter</th><th>Method</th><th>Reason</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{formatDate(r.refund_date)}</td>
                  <td className="primary"><Link href={`/payments/${r.payment_id}`} className="link-ink">{r.payment_no}</Link></td>
                  <td>{renterName(r)}</td><td>{methodLabel(r.method)}</td><td>{r.reason}</td>
                  <td className="r num">{money(r.amount_cents, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
