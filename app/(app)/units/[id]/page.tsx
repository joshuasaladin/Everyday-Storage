import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/components/Icon";
import { Card, Detail, EmptyState, Lines, PageHeader, StatusChip } from "@/components/ui";
import { ConfirmButton } from "@/components/forms";
import { DocumentsPanel, HistoryPanel } from "@/components/panels";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { deleteUnitAction } from "@/lib/actions/units";
import { label, UNIT_SIZES, UNIT_STATUSES, UNIT_TYPES, unitOccupant } from "@/lib/units";
import { AGREEMENT_STATUSES, contractProgress } from "@/lib/agreements";
import { area, dims, formatDate, money, renterName } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("units.view");
  const { id } = await params;
  const { db } = ctx;
  const unit = db.one<Record<string, any>>(`SELECT u.*, f.name AS facility_name FROM units u JOIN facilities f ON f.id = u.facility_id WHERE u.id = ?`, [id]);
  if (!unit) notFound();
  const cur = ctx.settings.base_currency;
  const role = ctx.user.role;
  const occupant = unitOccupant(db, id);
  const history = db.all<Record<string, any>>(
    `SELECT a.*, r.first_name, r.last_name, r.company, r.kind FROM agreements a JOIN renters r ON r.id = a.renter_id
      WHERE a.unit_id = ? ORDER BY a.start_date DESC`,
    [id],
  );
  const hold = db.one<Record<string, any>>(`SELECT * FROM reservations WHERE unit_id = ? AND status IN ('pending','confirmed')`, [id]);
  const earned = can(role, "finance.view")
    ? db.num(`SELECT COALESCE(SUM(subtotal_cents - discount_cents), 0) FROM invoices WHERE unit_id = ? AND status NOT IN ('void','draft')`, [id])
    : 0;

  return (
    <>
      <PageHeader
        eyebrow={`${unit.facility_name}${unit.location ? ` · ${unit.location}` : ""}`}
        title={<span className="flex flex-wrap items-center gap-3">Unit {unit.unit_number} <StatusChip list={UNIT_STATUSES} value={unit.status} /></span>}
        back={{ href: "/units", label: "Storage units" }}
        actions={
          <>
            <Link href={`/map?facility=${unit.facility_id}&unit=${id}`} className="btn"><Icon name="map" />On the map</Link>
            {unit.status === "available" && can(role, "agreements.edit") && <Link href={`/agreements/new?unit=${id}`} className="btn btn-primary"><Icon name="pen" />New agreement</Link>}
            {unit.status === "available" && can(role, "reservations.edit") && <Link href={`/reservations?new=1&unit=${id}`} className="btn"><Icon name="bookmark" />Reserve</Link>}
            {can(role, "units.edit") && <Link href={`/units/${id}/edit`} className="btn"><Icon name="edit" />Edit</Link>}
          </>
        }
      />

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <Card title="Unit details">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Detail label="Type">{label(UNIT_TYPES, unit.type)}</Detail>
              <Detail label="Size class">{label(UNIT_SIZES, unit.size_label)}</Detail>
              <Detail label="Dimensions">{dims(unit)}</Detail>
              <Detail label="Floor area">{area(unit)} m²</Detail>
              <Detail label="Monthly price">{money(unit.monthly_price_cents, cur)}</Detail>
              <div className="col-span-2 sm:col-span-3"><Detail label="Features">{unit.features}</Detail></div>
              {unit.notes && <div className="col-span-2 sm:col-span-3"><div className="label">Notes</div><Lines text={unit.notes} /></div>}
            </div>
          </Card>

          <Card title="Rental history" dense>
            {history.length === 0 ? (
              <EmptyState title="This unit has not been rented yet" />
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead><tr><th>Renter</th><th>Agreement</th><th>From</th><th>To</th><th>Duration</th><th className="r">Rate</th><th>Status</th></tr></thead>
                  <tbody>
                    {history.map((a) => {
                      const p = contractProgress(a as never);
                      return (
                        <tr key={a.id}>
                          <td className="primary"><Link href={`/renters/${a.renter_id}`} className="link-ink">{renterName(a)}</Link></td>
                          <td>{can(role, "agreements.view") ? <Link className="link" href={`/agreements/${a.id}`}>{a.agreement_no}</Link> : a.agreement_no}</td>
                          <td className="whitespace-nowrap">{formatDate(a.start_date)}</td>
                          <td className="whitespace-nowrap">{a.status === "ended" ? formatDate(a.move_out_date ?? a.ended_at) : a.end_date ? formatDate(a.end_date) : "Open-ended"}</td>
                          <td>{p.elapsedMonths} mo</td>
                          <td className="r num">{money(a.monthly_rate_cents, cur)}</td>
                          <td><StatusChip list={AGREEMENT_STATUSES} value={a.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <DocumentsPanel db={db} entity="unit" entityId={id} canEdit={can(role, "units.edit")} />
        </div>

        <div className="space-y-5">
          <Card title={occupant ? (occupant.agreement_status === "active" ? "Current renter" : "Awaiting signature") : hold ? "Reserved for" : "Occupancy"}>
            {occupant ? (
              <div className="space-y-3">
                <div>
                  <Link href={`/renters/${occupant.renter_id}`} className="link text-base">{renterName(occupant)}</Link>
                  <div className="text-sm" style={{ color: "var(--ink-3)" }}>{[occupant.phone, occupant.email].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Since">{formatDate(occupant.start_date)}</Detail>
                  <Detail label="Term">{occupant.term_type === "fixed" ? `to ${formatDate(occupant.end_date)}` : "Month-to-month"}</Detail>
                  <Detail label="Rate">{money(occupant.monthly_rate_cents, cur)}</Detail>
                  {occupant.move_out_date && <Detail label="Moving out">{formatDate(occupant.move_out_date)}</Detail>}
                </div>
                {can(role, "agreements.view") && <Link href={`/agreements/${occupant.agreement_id}`} className="btn w-full">{occupant.agreement_no}</Link>}
              </div>
            ) : hold ? (
              <div className="space-y-2 text-sm">
                <div className="font-medium">{hold.name}</div>
                <div style={{ color: "var(--ink-3)" }}>{[hold.phone, hold.email].filter(Boolean).join(" · ")}</div>
                <div>Held until {formatDate(hold.hold_until)}</div>
                <Link href="/reservations" className="btn w-full mt-2">{hold.reservation_no}</Link>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--ink-3)" }}>
                {unit.status === "available" ? "Vacant and ready to rent." : "Switched offline."}
              </p>
            )}
          </Card>

          {can(role, "finance.view") && (
            <Card title="Lifetime">
              <div className="grid grid-cols-2 gap-3">
                <Detail label="Rent invoiced">{money(earned, cur)}</Detail>
                <Detail label="Agreements">{history.length}</Detail>
              </div>
            </Card>
          )}

          <HistoryPanel db={db} entity="unit" entityId={id} />

          {can(role, "units.edit") && (
            <ConfirmButton action={deleteUnitAction} fields={{ id }} label="Delete unit" icon="trash" className="btn btn-danger btn-sm"
              confirm={`Delete unit ${unit.unit_number}? Only a unit with no rental history can be deleted.`} />
          )}
        </div>
      </div>
    </>
  );
}
