import Link from "next/link";
import { unitOrderSql } from "@/lib/unit-options";
import FacilityMap, { type MapUnit } from "@/components/FacilityMap";
import { PageHeader, Field, EmptyState, Card } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { resizeGridAction } from "@/lib/actions/units";
import { label, nextFreeCell, UNIT_SIZES, UNIT_TYPES } from "@/lib/units";
import { area, dims, formatDate, renterName } from "@/lib/format";
import { param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facility map" };

export default async function MapPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("units.view");
  const query = await searchParams;
  const { db } = ctx;
  const picked = param(query, "facility");
  const facility = ctx.facilities.find((f) => f.id === picked) ?? ctx.facilities.find((f) => f.id === ctx.facilityId) ?? ctx.facilities[0];
  if (!facility) return <EmptyState title="No facilities yet" />;
  const fac = db.one<{ map_cols: number; map_rows: number; address: string | null }>(`SELECT map_cols, map_rows, address FROM facilities WHERE id = ?`, [facility.id])!;

  // any unit without a position gets the next free cell, so nothing is ever missing from the map
  for (const u of db.all<{ id: string }>(`SELECT id FROM units WHERE facility_id = ? AND map_x IS NULL`, [facility.id])) {
    const cell = nextFreeCell(db, facility.id);
    db.run(`UPDATE units SET map_x = ?, map_y = ? WHERE id = ?`, [cell.x, cell.y, u.id]);
  }

  const rows = db.all<Record<string, any>>(
    `SELECT u.*,
            a.id AS agreement_id, a.end_date, a.term_type, a.status AS ag_status, a.start_date, a.move_out_date,
            r.id AS renter_id, r.first_name, r.last_name, r.company, r.kind,
            res.name AS res_name, res.hold_until
       FROM units u
       LEFT JOIN agreements a ON a.unit_id = u.id AND a.status IN ('active','pending_signature')
       LEFT JOIN renters r ON r.id = a.renter_id
       LEFT JOIN reservations res ON res.unit_id = u.id AND res.status IN ('pending','confirmed')
      WHERE u.facility_id = ? ORDER BY ${unitOrderSql()}`,
    [facility.id],
  );
  const maxRow = Math.max(fac.map_rows, ...rows.map((u) => (u.map_y ?? 0) + u.map_h));

  const units: MapUnit[] = rows.map((u) => ({
    id: u.id, number: u.unit_number, status: u.status, type: label(UNIT_TYPES, u.type), size: label(UNIT_SIZES, u.size_label),
    dims: dims(u), area: area(u), price: u.monthly_price_cents, location: u.location,
    x: u.map_x ?? 0, y: u.map_y ?? 0, w: u.map_w, h: u.map_h,
    renter: u.renter_id ? renterName(u) : (u.res_name ?? null),
    renterId: u.renter_id ?? null,
    agreementId: u.agreement_id ?? null,
    until: u.agreement_id
      ? u.ag_status === "pending_signature" ? `Awaiting signature · starts ${formatDate(u.start_date)}`
        : u.move_out_date ? `Moving out ${formatDate(u.move_out_date)}`
        : u.term_type === "fixed" ? `Fixed term to ${formatDate(u.end_date)}` : `Month-to-month since ${formatDate(u.start_date)}`
      : u.hold_until ? `Held until ${formatDate(u.hold_until)}` : null,
    note: u.offline ? "Switched offline" : null,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Facility map"
        title={facility.name}
        blurb={fac.address ?? "A live, colour-coded layout of every unit. Click a unit for its details."}
        actions={
          <>
            {ctx.facilities.length > 1 && ctx.facilities.map((f) => (
              <Link key={f.id} href={`/map?facility=${f.id}`} className={`btn ${f.id === facility.id ? "btn-primary" : ""}`}>{f.name}</Link>
            ))}
            {can(ctx.user.role, "units.edit") && (
              <ModalForm label="Grid size" title="Grid size" blurb="How many cells the layout has. Units keep their positions." action={resizeGridAction} className="btn" icon="grid">
                <input type="hidden" name="facility_id" value={facility.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Columns"><input className="input" type="number" name="map_cols" min={4} max={40} defaultValue={fac.map_cols} required /></Field>
                  <Field label="Rows"><input className="input" type="number" name="map_rows" min={2} max={60} defaultValue={maxRow} required /></Field>
                </div>
              </ModalForm>
            )}
          </>
        }
      />
      {units.length === 0 ? (
        <Card><EmptyState title="No units at this facility yet" action={can(ctx.user.role, "units.edit") ? <Link href="/units/new" className="btn btn-primary">Add a unit</Link> : undefined} /></Card>
      ) : (
        <FacilityMap
          units={units} cols={fac.map_cols} rows={maxRow} currency={ctx.settings.base_currency}
          canEdit={can(ctx.user.role, "units.edit")} canAgreements={can(ctx.user.role, "agreements.edit")} initial={param(query, "unit") || undefined}
        />
      )}
    </>
  );
}
