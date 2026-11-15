import Link from "next/link";
import Icon from "@/components/Icon";
import { Card, Chip, EmptyState, Meter, PageHeader, StatusChip, Tabs } from "@/components/ui";
import { exportUrl, Pager, SortTh, Toolbar } from "@/components/table";
import { requireStaff, scope } from "@/lib/auth";
import { can } from "@/lib/roles";
import { AGREEMENT_STATUSES, contractProgress } from "@/lib/agreements";
import { addDays, today } from "@/lib/clock";
import { formatDate, money, renterName } from "@/lib/format";
import { like, listParams, param, withQuery, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agreements" };

const SORT = { no: "a.agreement_no", renter: "COALESCE(NULLIF(r.company, ''), r.last_name || r.first_name) COLLATE NOCASE", unit: "u.unit_number", start: "a.start_date", end: "COALESCE(a.end_date, '9999')", rate: "a.monthly_rate_cents" };

export default async function AgreementsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("agreements.view");
  const query = await searchParams;
  const list = listParams(query, SORT, "start", "desc");
  const s = scope(ctx, "a.facility_id");
  const t = today();
  const status = param(query, "status") || "active";
  const where: string[] = [];
  const params: unknown[] = [];
  if (status === "expiring") {
    where.push("a.status = 'active' AND a.term_type = 'fixed' AND a.end_date BETWEEN ? AND ?");
    params.push(t, addDays(t, 60));
  } else if (status === "moving_out") {
    where.push("a.status = 'active' AND EXISTS (SELECT 1 FROM move_outs m WHERE m.agreement_id = a.id AND m.status IN ('requested','scheduled'))");
  } else if (status !== "all") {
    where.push("a.status = ?");
    params.push(status);
  } else where.push("1 = 1");
  if (param(query, "term")) {
    where.push("a.term_type = ?");
    params.push(param(query, "term"));
  }
  if (list.q) {
    where.push(`(a.agreement_no LIKE ? ESCAPE '\\' OR u.unit_number LIKE ? ESCAPE '\\' OR r.first_name || ' ' || r.last_name LIKE ? ESCAPE '\\' OR r.company LIKE ? ESCAPE '\\')`);
    params.push(...Array(4).fill(like(list.q)));
  }
  const from = `FROM agreements a JOIN units u ON u.id = a.unit_id JOIN renters r ON r.id = a.renter_id WHERE ${where.join(" AND ")}${s.sql}`;
  const total = ctx.db.num(`SELECT COUNT(*) ${from}`, [...params, ...s.params]);
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT a.*, u.unit_number, r.first_name, r.last_name, r.company, r.kind ${from} ORDER BY ${list.orderBy} LIMIT ? OFFSET ?`,
    [...params, ...s.params, list.limit, list.offset],
  );
  const count = (sql: string, p: unknown[] = []) => ctx.db.num(`SELECT COUNT(*) FROM agreements a WHERE ${sql}${s.sql}`, [...p, ...s.params]);
  const cur = ctx.settings.base_currency;
  const tab = (key: string) => withQuery("/agreements", query, { status: key, page: null });

  return (
    <>
      <PageHeader
        eyebrow="Rentals"
        title="Rental agreements"
        blurb="Contracts between a renter and a unit: term, rate, deposit and renewal. Elapsed and remaining time are worked out for you."
        actions={can(ctx.user.role, "agreements.edit") && <Link href="/agreements/new" className="btn btn-primary"><Icon name="plus" />New agreement</Link>}
      />
      <Tabs
        active={status}
        tabs={[
          { key: "active", label: "Active", href: tab("active") },
          { key: "pending_signature", label: "Awaiting signature", href: tab("pending_signature"), count: count("a.status = 'pending_signature'") },
          { key: "expiring", label: "Ending soon", href: tab("expiring"), count: count("a.status = 'active' AND a.term_type = 'fixed' AND a.end_date BETWEEN ? AND ?", [t, addDays(t, 60)]) },
          { key: "moving_out", label: "Moving out", href: tab("moving_out"), count: count("a.status = 'active' AND EXISTS (SELECT 1 FROM move_outs m WHERE m.agreement_id = a.id AND m.status IN ('requested','scheduled'))") },
          { key: "ended", label: "Ended", href: tab("ended") },
          { key: "all", label: "All", href: tab("all") },
        ]}
      />
      <Toolbar
        query={query}
        keep={["status"]}
        placeholder="Search by agreement, unit or renter…"
        exportHref={exportUrl("agreements", { ...query, status })}
        filters={[{ name: "term", label: "Term", options: [{ value: "fixed", label: "Fixed term" }, { value: "month_to_month", label: "Month-to-month" }] }]}
      />
      <Card dense>
        {rows.length === 0 ? <EmptyState title="No agreements here" /> : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="no" label="Agreement" base="/agreements" query={query} list={list} />
                  <SortTh col="renter" label="Renter" base="/agreements" query={query} list={list} />
                  <SortTh col="unit" label="Unit" base="/agreements" query={query} list={list} />
                  <SortTh col="start" label="Start" base="/agreements" query={query} list={list} />
                  <SortTh col="end" label="End" base="/agreements" query={query} list={list} />
                  <th style={{ minWidth: 150 }}>Progress</th>
                  <SortTh col="rate" label="Rate / mo" base="/agreements" query={query} list={list} right />
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const p = contractProgress(a as never);
                  return (
                    <tr key={a.id}>
                      <td className="primary"><Link href={`/agreements/${a.id}`} className="link-ink">{a.agreement_no}</Link></td>
                      <td><Link className="link" href={`/renters/${a.renter_id}`}>{renterName(a)}</Link></td>
                      <td><Link className="link-ink" href={`/units/${a.unit_id}`}>{a.unit_number}</Link></td>
                      <td className="whitespace-nowrap">{formatDate(a.start_date)}</td>
                      <td className="whitespace-nowrap">{a.end_date ? formatDate(a.end_date) : <span style={{ color: "var(--ink-3)" }}>Month-to-month</span>}</td>
                      <td>
                        {!p.started ? <span className="text-xs" style={{ color: "var(--ink-3)" }}>starts in {p.startsIn} days</span> : (
                          <>
                            <div className="text-xs mb-1" style={{ color: "var(--ink-3)" }}>{p.elapsedMonths} mo elapsed{p.remainingMonths !== null && a.status === "active" ? ` · ${p.remainingMonths} mo left` : ""}</div>
                            {p.pct !== null && a.status === "active" && <Meter value={p.pct} tone={p.remainingDays! <= 30 ? "warn" : undefined} />}
                          </>
                        )}
                      </td>
                      <td className="r num">{money(a.monthly_rate_cents - a.discount_cents, cur)}</td>
                      <td>
                        <StatusChip list={AGREEMENT_STATUSES} value={a.status} />
                        {a.move_out_date && a.status === "active" && <div className="mt-1"><Chip tone="warn">out {formatDate(a.move_out_date)}</Chip></div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager base="/agreements" query={query} list={list} total={total} />
      </Card>
    </>
  );
}
