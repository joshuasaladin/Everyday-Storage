import AgreementForm from "@/components/AgreementForm";
import { Notice, PageHeader } from "@/components/ui";
import { requireStaff, scope } from "@/lib/auth";
import { today } from "@/lib/clock";
import { taxRateBp } from "@/lib/settings";
import { dims, money, renterName } from "@/lib/format";
import { param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "New agreement" };

export default async function NewAgreementPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("agreements.edit");
  const query = await searchParams;
  const { db, settings } = ctx;
  const cur = settings.base_currency;
  const s = scope(ctx, "u.facility_id");
  const reservationId = param(query, "reservation");
  const reservation = reservationId ? db.one<Record<string, any>>(`SELECT * FROM reservations WHERE id = ? AND status IN ('pending','confirmed')`, [reservationId]) : null;

  // free units, plus the one a reservation being converted is holding
  const units = db.all<Record<string, any>>(
    `SELECT u.*, f.name AS facility_name FROM units u JOIN facilities f ON f.id = u.facility_id
      WHERE (u.status = 'available' OR u.id = ?)${s.sql} ORDER BY f.name, u.unit_number`,
    [reservation?.unit_id ?? "", ...s.params],
  );
  const renters = db.all<Record<string, any>>(`SELECT id, renter_no, kind, first_name, last_name, company FROM renters ORDER BY COALESCE(NULLIF(company, ''), last_name || first_name) COLLATE NOCASE`);

  return (
    <>
      <PageHeader title="New rental agreement" back={{ href: "/agreements", label: "Agreements" }} blurb="Set the term and charges. The renter then signs — online, on this device, or on paper — and billing begins." />
      {reservation && (
        <div className="mb-5">
          <Notice>Converting reservation {reservation.reservation_no} for <strong>{reservation.name}</strong>. {reservation.renter_id ? "" : "Add them as a renter first if they are not in the list, then choose them below."}</Notice>
        </div>
      )}
      <AgreementForm
        currency={cur}
        taxRate={taxRateBp(db)}
        reservationId={reservation?.id}
        units={units.map((u) => ({ id: u.id, price: u.monthly_price_cents, facility: u.facility_name, label: `${u.unit_number} · ${dims(u)} · ${money(u.monthly_price_cents, cur)}/mo${ctx.facilities.length > 1 ? ` · ${u.facility_name}` : ""}` }))}
        renters={renters.map((r) => ({ id: r.id, label: `${renterName(r)} (${r.renter_no})` }))}
        defaults={{
          unit: reservation?.unit_id ?? (param(query, "unit") || undefined),
          renter: reservation?.renter_id ?? (param(query, "renter") || undefined),
          start: reservation?.desired_start && reservation.desired_start >= today() ? reservation.desired_start : today(),
          billing_mode: settings.billing_mode_default, billing_day: settings.billing_day_default, prorate: settings.prorate_first_month,
          notice: settings.default_notice_days, depositMonths: settings.default_deposit_months,
        }}
      />
    </>
  );
}
