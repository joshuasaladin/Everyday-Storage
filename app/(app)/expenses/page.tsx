import { Card, EmptyState, Field, PageHeader, StatCard } from "@/components/ui";
import { ConfirmButton, ModalForm } from "@/components/forms";
import { exportUrl, Pager, SortTh, Toolbar } from "@/components/table";
import { requireStaff, scope } from "@/lib/auth";
import { can } from "@/lib/roles";
import { deleteExpenseAction, saveExpenseAction } from "@/lib/actions/billing";
import { EXPENSE_CATEGORIES } from "@/lib/maintenance";
import { PAYMENT_METHODS } from "@/lib/payments";
import { label } from "@/lib/units";
import { addMonths, startOfMonth, today } from "@/lib/clock";
import { centsInput, formatDate, money } from "@/lib/format";
import { like, listParams, param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Expenses" };

const SORT = { date: "e.expense_date", category: "e.category", vendor: "e.vendor COLLATE NOCASE", amount: "e.amount_cents" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("finance.view");
  const query = await searchParams;
  const list = listParams(query, SORT, "date", "desc");
  const s = scope(ctx, "e.facility_id");
  const cur = ctx.settings.base_currency;
  const t = today();
  const edit = can(ctx.user.role, "finance.edit");
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (param(query, "category")) { where.push("e.category = ?"); params.push(param(query, "category")); }
  if (param(query, "from")) { where.push("e.expense_date >= ?"); params.push(param(query, "from")); }
  if (param(query, "to")) { where.push("e.expense_date <= ?"); params.push(param(query, "to")); }
  if (list.q) { where.push(`(e.description LIKE ? ESCAPE '\\' OR e.vendor LIKE ? ESCAPE '\\' OR e.reference LIKE ? ESCAPE '\\')`); params.push(...Array(3).fill(like(list.q))); }
  const from = `FROM expenses e JOIN facilities f ON f.id = e.facility_id LEFT JOIN maintenance_tickets m ON m.id = e.maintenance_id WHERE ${where.join(" AND ")}${s.sql}`;
  const all = [...params, ...s.params];
  const totals = ctx.db.one<{ n: number; total: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(e.amount_cents), 0) AS total ${from}`, all)!;
  const rows = ctx.db.all<Record<string, any>>(`SELECT e.*, f.name AS facility_name, m.ticket_no ${from} ORDER BY ${list.orderBy}, e.created_at DESC LIMIT ? OFFSET ?`, [...all, list.limit, list.offset]);
  const sum = (a: string, b: string) => ctx.db.num(`SELECT COALESCE(SUM(e.amount_cents), 0) FROM expenses e WHERE e.expense_date BETWEEN ? AND ?${s.sql}`, [a, b, ...s.params]);
  const thisMonth = sum(startOfMonth(t), t);
  const lastMonth = sum(addMonths(startOfMonth(t), -1), `${addMonths(startOfMonth(t), -1).slice(0, 8)}31`);
  const ytd = sum(`${t.slice(0, 4)}-01-01`, t);

  const form = (e?: Record<string, any>) => (
    <>
      {e && <input type="hidden" name="id" value={e.id} />}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date"><input className="input" type="date" name="expense_date" defaultValue={e?.expense_date ?? t} required /></Field>
        <Field label={`Amount (${cur})`}><input className="input" name="amount" inputMode="decimal" defaultValue={e ? centsInput(e.amount_cents) : ""} placeholder="0.00" required /></Field>
        <Field label="Category"><select className="select" name="category" defaultValue={e?.category ?? "maintenance"}>{EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
        <Field label="Facility"><select className="select" name="facility_id" defaultValue={e?.facility_id ?? ctx.facilityId ?? ctx.facilities[0]?.id}>{ctx.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
        <Field label="Vendor"><input className="input" name="vendor" defaultValue={e?.vendor ?? ""} maxLength={120} /></Field>
        <Field label="Paid by"><select className="select" name="method" defaultValue={e?.method ?? "bank_transfer"}>{PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
        <Field label="Description" className="col-span-2"><input className="input" name="description" defaultValue={e?.description ?? ""} required maxLength={200} /></Field>
        <Field label="Reference" className="col-span-2"><input className="input" name="reference" defaultValue={e?.reference ?? ""} maxLength={80} /></Field>
      </div>
    </>
  );

  return (
    <>
      <PageHeader eyebrow="Finance" title="Expenses" blurb="What the business spends — utilities, repairs, insurance, wages. Expenses feed the profit and cash-flow reports."
        actions={edit && <ModalForm label="Add expense" title="Add an expense" action={saveExpenseAction} className="btn btn-primary" icon="plus" submit="Save expense">{form()}</ModalForm>} />
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label="This month" value={money(thisMonth, cur)} tone="neutral" icon="wallet" />
        <StatCard label="Last month" value={money(lastMonth, cur)} tone="neutral" icon="calendar" />
        <StatCard label="Year to date" value={money(ytd, cur)} tone="neutral" icon="chart" />
      </div>
      <Toolbar query={query} placeholder="Search by description, vendor or reference…" exportHref={exportUrl("expenses", query)} filters={[{ name: "category", label: "Category", options: EXPENSE_CATEGORIES }]}>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}>From<input type="date" name="from" defaultValue={param(query, "from")} className="input w-auto" /></label>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}>To<input type="date" name="to" defaultValue={param(query, "to")} className="input w-auto" /></label>
      </Toolbar>
      <Card dense>
        {rows.length === 0 ? <EmptyState title="No expenses match" /> : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="date" label="Date" base="/expenses" query={query} list={list} />
                  <th>Description</th>
                  <SortTh col="category" label="Category" base="/expenses" query={query} list={list} />
                  <SortTh col="vendor" label="Vendor" base="/expenses" query={query} list={list} />
                  {ctx.facilities.length > 1 && <th>Facility</th>}
                  <SortTh col="amount" label="Amount" base="/expenses" query={query} list={list} right />
                  {edit && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{formatDate(e.expense_date)}</td>
                    <td className="primary" style={{ fontWeight: 500 }}>{e.description}{e.ticket_no && <a className="link text-xs ml-2" href={`/maintenance/${e.maintenance_id}`}>{e.ticket_no}</a>}</td>
                    <td>{label(EXPENSE_CATEGORIES, e.category)}</td>
                    <td>{e.vendor ?? "—"}</td>
                    {ctx.facilities.length > 1 && <td>{e.facility_name}</td>}
                    <td className="r num">{money(e.amount_cents, cur)}</td>
                    {edit && (
                      <td className="r whitespace-nowrap">
                        <ModalForm label="Edit" title="Edit expense" action={saveExpenseAction} className="btn btn-ghost btn-sm" submit="Save expense">{form(e)}</ModalForm>
                        <ConfirmButton action={deleteExpenseAction} fields={{ id: e.id }} label="Delete" className="btn btn-ghost btn-sm" confirm="Delete this expense?" title="quiet" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={ctx.facilities.length > 1 ? 5 : 4}>{totals.n} {totals.n === 1 ? "expense" : "expenses"} in this view</td><td className="r num">{money(totals.total, cur)}</td>{edit && <td />}</tr></tfoot>
            </table>
          </div>
        )}
        <Pager base="/expenses" query={query} list={list} total={totals.n} />
      </Card>
    </>
  );
}
