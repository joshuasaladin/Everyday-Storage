import PaidCheckbox from "@/components/PaidCheckbox";
import RowLink from "@/components/RowLink";
import Link from "next/link";
import Icon from "@/components/Icon";
import { Card, EmptyState, InvoiceChip, PageHeader, Tabs } from "@/components/ui";
import { ConfirmButton } from "@/components/forms";
import { exportUrl, Pager, SortTh, Toolbar } from "@/components/table";
import { requireStaff, scope } from "@/lib/auth";
import { can } from "@/lib/roles";
import { generateNowAction } from "@/lib/actions/agreements";
import { displayStatus } from "@/lib/billing";
import { today } from "@/lib/clock";
import { formatDate, money, renterName } from "@/lib/format";
import { like, listParams, param, withQuery, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices" };

const SORT = { no: "i.invoice_no", renter: "COALESCE(NULLIF(r.company, ''), r.last_name || r.first_name) COLLATE NOCASE", issue: "i.issue_date", due: "i.due_date", total: "i.total_cents", balance: "i.balance_cents" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("finance.view");
  const query = await searchParams;
  const list = listParams(query, SORT, "issue", "desc");
  const s = scope(ctx, "i.facility_id");
  const t = today();
  const status = param(query, "status") || "all";
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (status === "unpaid") where.push("i.status IN ('open','partial') AND i.balance_cents > 0");
  else if (status === "overdue") {
    where.push("i.status IN ('open','partial') AND i.balance_cents > 0 AND i.due_date < ?");
    params.push(t);
  } else if (status === "paid" || status === "void") {
    where.push("i.status = ?");
    params.push(status);
  }
  for (const [key, col] of [["renter", "i.renter_id"], ["kind", "i.kind"]] as const) {
    if (param(query, key)) {
      where.push(`${col} = ?`);
      params.push(param(query, key));
    }
  }
  if (param(query, "from")) { where.push("i.issue_date >= ?"); params.push(param(query, "from")); }
  if (param(query, "to")) { where.push("i.issue_date <= ?"); params.push(param(query, "to")); }
  if (list.q) {
    where.push(`(i.invoice_no LIKE ? ESCAPE '\\' OR u.unit_number LIKE ? ESCAPE '\\' OR r.first_name || ' ' || r.last_name LIKE ? ESCAPE '\\' OR r.company LIKE ? ESCAPE '\\')`);
    params.push(...Array(4).fill(like(list.q)));
  }
  const from = `FROM invoices i JOIN renters r ON r.id = i.renter_id LEFT JOIN units u ON u.id = i.unit_id WHERE ${where.join(" AND ")}${s.sql}`;
  const all = [...params, ...s.params];
  const totals = ctx.db.one<{ n: number; total: number; balance: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN i.status <> 'void' THEN i.total_cents ELSE 0 END), 0) AS total, COALESCE(SUM(i.balance_cents), 0) AS balance ${from}`, all)!;
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT i.*, u.unit_number, r.first_name, r.last_name, r.company, r.kind ${from} ORDER BY ${list.orderBy}, i.invoice_no DESC LIMIT ? OFFSET ?`,
    [...all, list.limit, list.offset],
  );
  const count = (sql: string, p: unknown[] = []) => ctx.db.num(`SELECT COUNT(*) FROM invoices i WHERE ${sql}${s.sql}`, [...p, ...s.params]);
  const cur = ctx.settings.base_currency;
  const canPay = can(ctx.user.role, "finance.edit");
  const tab = (key: string) => withQuery("/invoices", query, { status: key === "all" ? null : key, page: null });
  const filteredRenter = param(query, "renter") ? ctx.db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [param(query, "renter")]) : null;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Invoices"
        blurb={filteredRenter ? <>Showing invoices for <strong>{renterName(filteredRenter)}</strong>. <Link className="link" href="/invoices">Show everyone</Link></> : "Rent invoices are generated automatically for each billing period. One-off invoices cover anything else."}
        actions={can(ctx.user.role, "finance.edit") && (
          <>
            <ConfirmButton action={generateNowAction} label="Run billing now" icon="refresh" className="btn" />
            <Link href="/invoices/new" className="btn btn-primary"><Icon name="plus" />New invoice</Link>
          </>
        )}
      />
      <Tabs
        active={status}
        tabs={[
          { key: "all", label: "All", href: tab("all") },
          { key: "unpaid", label: "Unpaid", href: tab("unpaid"), count: count("i.status IN ('open','partial') AND i.balance_cents > 0") },
          { key: "overdue", label: "Overdue", href: tab("overdue"), count: count("i.status IN ('open','partial') AND i.balance_cents > 0 AND i.due_date < ?", [t]) },
          { key: "paid", label: "Paid", href: tab("paid") },
          { key: "void", label: "Void", href: tab("void") },
        ]}
      />
      <Toolbar query={query} keep={["status", "renter"]} placeholder="Search by invoice number, unit or renter…" exportHref={exportUrl("invoices", query)}
        filters={[{ name: "kind", label: "Type", options: [{ value: "rent", label: "Rent" }, { value: "one_off", label: "One-off" }] }]}>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}>From<input type="date" name="from" defaultValue={param(query, "from")} className="input w-auto" /></label>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}>To<input type="date" name="to" defaultValue={param(query, "to")} className="input w-auto" /></label>
      </Toolbar>
      <Card dense>
        {rows.length === 0 ? <EmptyState title="No invoices match" /> : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="no" label="Invoice" base="/invoices" query={query} list={list} />
                  <SortTh col="renter" label="Renter" base="/invoices" query={query} list={list} />
                  <th>Unit</th>
                  <th>Period</th>
                  <SortTh col="issue" label="Issued" base="/invoices" query={query} list={list} />
                  <SortTh col="due" label="Due" base="/invoices" query={query} list={list} />
                  <SortTh col="total" label="Total" base="/invoices" query={query} list={list} right />
                  <SortTh col="balance" label="Balance" base="/invoices" query={query} list={list} right />
                  <th>Status</th>
                  {canPay && <th>Paid</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <RowLink key={i.id} href={`/invoices/${i.id}`}>
                    <td className="primary"><Link href={`/invoices/${i.id}`} className="link-ink">{i.invoice_no}</Link></td>
                    <td><Link className="link" href={`/renters/${i.renter_id}`}>{renterName(i)}</Link></td>
                    <td>{i.unit_number ?? "—"}</td>
                    <td className="whitespace-nowrap">{i.period_start ? `${formatDate(i.period_start)} – ${formatDate(i.period_end)}` : <span style={{ color: "var(--ink-3)" }}>One-off</span>}</td>
                    <td className="whitespace-nowrap">{formatDate(i.issue_date)}</td>
                    <td className="whitespace-nowrap">{formatDate(i.due_date)}</td>
                    <td className="r num">{money(i.total_cents, i.currency)}</td>
                    <td className="r num" style={i.balance_cents > 0 ? { color: "var(--ink)", fontWeight: 600 } : undefined}>{money(i.balance_cents, i.currency)}</td>
                    <td><InvoiceChip status={displayStatus(i as never, t)} /></td>
                    {canPay && (
                      <td>{i.status !== "void" && <PaidCheckbox invoiceId={i.id} invoiceNo={i.invoice_no} paid={i.status === "paid"} />}</td>
                    )}
                  </RowLink>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={6}>{totals.n} {totals.n === 1 ? "invoice" : "invoices"} in this view</td><td className="r num">{money(totals.total, cur)}</td><td className="r num">{money(totals.balance, cur)}</td><td />{canPay && <td />}</tr>
              </tfoot>
            </table>
          </div>
        )}
        <Pager base="/invoices" query={query} list={list} total={totals.n} />
      </Card>
    </>
  );
}
