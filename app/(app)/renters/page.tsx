import Link from "next/link";
import Icon from "@/components/Icon";
import RowLink from "@/components/RowLink";
import { unitOrder, unitOrderSql } from "@/lib/unit-options";
import { Card, EmptyState, PageHeader, StatusChip } from "@/components/ui";
import { exportUrl, Pager, SortTh, Toolbar } from "@/components/table";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { RENTER_STATUSES } from "@/lib/renters";
import { money, renterName } from "@/lib/format";
import { like, listParams, param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Renters" };

const SORT = { name: "COALESCE(NULLIF(r.company, ''), r.last_name || r.first_name) COLLATE NOCASE", no: "r.renter_no", units: "first_unit_order", balance: "balance", status: "r.status" };

export default async function RentersPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("renters.view");
  const query = await searchParams;
  const list = listParams(query, SORT, "name");
  const money$ = can(ctx.user.role, "finance.view");
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (param(query, "status")) {
    where.push("r.status = ?");
    params.push(param(query, "status"));
  }
  if (param(query, "kind")) {
    where.push("r.kind = ?");
    params.push(param(query, "kind"));
  }
  if (param(query, "owing") === "1") where.push("(SELECT COALESCE(SUM(balance_cents), 0) FROM invoices i WHERE i.renter_id = r.id AND i.status IN ('open','partial')) > 0");
  if (ctx.facilityId) {
    where.push("(EXISTS (SELECT 1 FROM agreements a WHERE a.renter_id = r.id AND a.facility_id = ?) OR NOT EXISTS (SELECT 1 FROM agreements a WHERE a.renter_id = r.id))");
    params.push(ctx.facilityId);
  }
  if (list.q) {
    where.push(`(r.first_name || ' ' || r.last_name LIKE ? ESCAPE '\\' OR r.company LIKE ? ESCAPE '\\' OR r.email LIKE ? ESCAPE '\\' OR r.phone LIKE ? ESCAPE '\\' OR r.renter_no LIKE ? ESCAPE '\\')`);
    params.push(...Array(5).fill(like(list.q)));
  }
  const total = ctx.db.num(`SELECT COUNT(*) FROM renters r WHERE ${where.join(" AND ")}`, params);
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT r.*,
            (SELECT COUNT(*) FROM agreements a WHERE a.renter_id = r.id AND a.status = 'active') AS units,
            (SELECT GROUP_CONCAT(unit_number, ', ') FROM (SELECT u.unit_number FROM agreements a JOIN units u ON u.id = a.unit_id
               WHERE a.renter_id = r.id AND a.status IN ('active','pending_signature') ORDER BY ${unitOrderSql()})) AS unit_list,
            (SELECT ${unitOrder()[0].replace(" COLLATE NOCASE", "")} || '|' || printf('%09d', ${unitOrder()[1]}) FROM agreements a JOIN units u ON u.id = a.unit_id
               WHERE a.renter_id = r.id AND a.status IN ('active','pending_signature') ORDER BY ${unitOrderSql()} LIMIT 1) AS first_unit_order,
            (SELECT COALESCE(SUM(balance_cents), 0) FROM invoices i WHERE i.renter_id = r.id AND i.status IN ('open','partial')) AS balance
       FROM renters r WHERE ${where.join(" AND ")} ORDER BY ${list.orderBy} LIMIT ? OFFSET ?`,
    [...params, list.limit, list.offset],
  );
  const cur = ctx.settings.base_currency;

  return (
    <>
      <PageHeader
        eyebrow="Rentals"
        title="Renters"
        blurb="Everyone who rents, has rented or has asked about a unit — with their units, balance and documents in one place."
        actions={can(ctx.user.role, "renters.edit") && <Link href="/renters/new" className="btn btn-primary"><Icon name="plus" />Add renter</Link>}
      />
      <Toolbar
        query={query}
        placeholder="Search by name, company, email or phone…"
        exportHref={exportUrl("renters", query)}
        filters={[
          { name: "status", label: "Status", options: RENTER_STATUSES },
          { name: "kind", label: "Type", options: [{ value: "individual", label: "Individual" }, { value: "business", label: "Business" }] },
          ...(money$ ? [{ name: "owing", label: "Balance", options: [{ value: "1", label: "Owes money" }] }] : []),
        ]}
      />
      <Card dense>
        {rows.length === 0 ? <EmptyState title="No renters match" hint="Clear the filters, or add a renter." /> : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="name" label="Renter" base="/renters" query={query} list={list} />
                  <th>Contact</th>
                  <SortTh col="units" label="Unit" base="/renters" query={query} list={list} />
                  {money$ && <SortTh col="balance" label="Balance" base="/renters" query={query} list={list} right />}
                  <SortTh col="status" label="Status" base="/renters" query={query} list={list} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RowLink key={r.id} href={`/renters/${r.id}`}>
                    <td className="primary">
                      <Link href={`/renters/${r.id}`} className="link-ink">{renterName(r)}</Link>
                      <div className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{r.renter_no}{r.kind === "business" ? ` · ${r.first_name} ${r.last_name}` : ""}</div>
                    </td>
                    <td><div>{r.phone ?? "—"}</div><div className="text-xs" style={{ color: "var(--ink-3)" }}>{r.email}</div></td>
                    <td>{r.unit_list ?? <span style={{ color: "var(--ink-3)" }}>—</span>}</td>
                    {money$ && <td className="r num" style={r.balance > 0 ? { color: "var(--bad-fg)", fontWeight: 600 } : undefined}>{r.balance > 0 ? money(r.balance, cur) : "—"}</td>}
                    <td><StatusChip list={RENTER_STATUSES} value={r.status} /></td>
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager base="/renters" query={query} list={list} total={total} />
      </Card>
    </>
  );
}
