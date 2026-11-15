import Link from "next/link";
import Icon from "@/components/Icon";
import { Card, EmptyState, PageHeader, StatusChip } from "@/components/ui";
import { exportUrl, Pager, SortTh, Toolbar } from "@/components/table";
import { requireStaff, scope } from "@/lib/auth";
import { can } from "@/lib/roles";
import { label, UNIT_SIZES, UNIT_STATUSES, UNIT_TYPES } from "@/lib/units";
import { area, dims, formatDate, money, renterName } from "@/lib/format";
import { like, listParams, param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Storage units" };

const SORT = { unit: "u.unit_number", type: "u.type", area: "u.width_ft * u.depth_ft", price: "u.monthly_price_cents", status: "u.status", location: "u.location" };

export default async function UnitsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("units.view");
  const query = await searchParams;
  const list = listParams(query, SORT, "unit");
  const s = scope(ctx, "u.facility_id");
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  for (const [key, col] of [["status", "u.status"], ["type", "u.type"], ["size", "u.size_label"]] as const) {
    if (param(query, key)) {
      where.push(`${col} = ?`);
      params.push(param(query, key));
    }
  }
  if (list.q) {
    where.push(`(u.unit_number LIKE ? ESCAPE '\\' OR u.location LIKE ? ESCAPE '\\' OR r.first_name || ' ' || r.last_name LIKE ? ESCAPE '\\' OR r.company LIKE ? ESCAPE '\\')`);
    params.push(like(list.q), like(list.q), like(list.q), like(list.q));
  }
  const from = `FROM units u
     LEFT JOIN agreements a ON a.unit_id = u.id AND a.status IN ('active','pending_signature')
     LEFT JOIN renters r ON r.id = a.renter_id
     JOIN facilities f ON f.id = u.facility_id
    WHERE ${where.join(" AND ")}${s.sql}`;
  const total = ctx.db.num(`SELECT COUNT(*) ${from}`, [...params, ...s.params]);
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT u.*, f.name AS facility_name, a.id AS agreement_id, a.end_date, a.move_out_date,
            r.id AS renter_id, r.first_name, r.last_name, r.company, r.kind
     ${from} ORDER BY ${list.orderBy}, u.unit_number LIMIT ? OFFSET ?`,
    [...params, ...s.params, list.limit, list.offset],
  );
  const cur = ctx.settings.base_currency;
  const multi = ctx.facilities.length > 1 && !ctx.facilityId;

  return (
    <>
      <PageHeader
        eyebrow="Rentals"
        title="Storage units"
        blurb="Every unit, its size, price and who is in it. Status follows agreements, reservations and maintenance automatically."
        actions={
          <>
            <Link href="/map" className="btn"><Icon name="map" />Map</Link>
            {can(ctx.user.role, "units.edit") && <Link href="/units/new" className="btn btn-primary"><Icon name="plus" />Add unit</Link>}
          </>
        }
      />
      <Toolbar
        query={query}
        placeholder="Search by unit, location or renter…"
        exportHref={exportUrl("units", query)}
        filters={[
          { name: "status", label: "Status", options: UNIT_STATUSES },
          { name: "type", label: "Type", options: UNIT_TYPES },
          { name: "size", label: "Size", options: UNIT_SIZES },
        ]}
      />
      <Card dense>
        {rows.length === 0 ? (
          <EmptyState title="No units match" hint="Clear the filters, or add a unit." />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="unit" label="Unit" base="/units" query={query} list={list} />
                  <SortTh col="type" label="Type" base="/units" query={query} list={list} />
                  <SortTh col="area" label="Size" base="/units" query={query} list={list} />
                  <SortTh col="location" label="Location" base="/units" query={query} list={list} />
                  <SortTh col="price" label="Price / mo" base="/units" query={query} list={list} right />
                  <SortTh col="status" label="Status" base="/units" query={query} list={list} />
                  <th>Renter</th>
                  <th>Available from</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td className="primary">
                      <Link href={`/units/${u.id}`} className="link-ink">{u.unit_number}</Link>
                      {multi && <div className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{u.facility_name}</div>}
                    </td>
                    <td>{label(UNIT_TYPES, u.type)}</td>
                    <td className="whitespace-nowrap">{dims(u)}<span className="text-xs" style={{ color: "var(--ink-3)" }}> · {area(u)} sq ft</span></td>
                    <td>{u.location ?? "—"}</td>
                    <td className="r num">{money(u.monthly_price_cents, cur)}</td>
                    <td><StatusChip list={UNIT_STATUSES} value={u.status} /></td>
                    <td>{u.renter_id ? <Link className="link" href={`/renters/${u.renter_id}`}>{renterName(u)}</Link> : "—"}</td>
                    <td className="whitespace-nowrap">
                      {u.status === "available" ? (u.available_from && u.available_from > new Date().toISOString().slice(0, 10) ? formatDate(u.available_from) : "Now")
                        : u.move_out_date ? formatDate(u.move_out_date) : u.status === "occupied" && u.end_date ? <span style={{ color: "var(--ink-3)" }}>term to {formatDate(u.end_date)}</span> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager base="/units" query={query} list={list} total={total} />
      </Card>
    </>
  );
}
