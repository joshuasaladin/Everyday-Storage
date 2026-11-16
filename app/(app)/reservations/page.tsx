import Link from "next/link";
import Icon from "@/components/Icon";
import { Card, Chip, EmptyState, Field, PageHeader, StatusChip, Tabs } from "@/components/ui";
import { ActionForm, ConfirmButton, CopyButton, ModalForm } from "@/components/forms";
import { exportUrl, Toolbar } from "@/components/table";
import { requireStaff, scope } from "@/lib/auth";
import { appOrigin } from "@/lib/origin";
import { can } from "@/lib/roles";
import { reservationAction, saveReservationAction } from "@/lib/actions/ops";
import { RESERVATION_STATUSES } from "@/lib/reservations";
import { label, UNIT_SIZES, UNIT_TYPES } from "@/lib/units";
import { addDays, daysBetween, today } from "@/lib/clock";
import { area, dims, formatDate, money } from "@/lib/format";
import { like, param, withQuery, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reservations" };

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("reservations.view");
  const query = await searchParams;
  const { db, settings } = ctx;
  const s = scope(ctx, "res.facility_id");
  const us = scope(ctx, "u.facility_id");
  const view = param(query, "status") || "holds";
  const edit = can(ctx.user.role, "reservations.edit");
  const canAgree = can(ctx.user.role, "agreements.edit");
  const cur = settings.base_currency;
  const t = today();
  const where = [view === "holds" ? "res.status IN ('pending','confirmed')" : view === "waitlist" ? "res.status = 'waitlist'" : view === "closed" ? "res.status IN ('converted','cancelled','expired')" : "1 = 1"];
  const params: unknown[] = [];
  const term = param(query, "q");
  if (term) { where.push(`(res.name LIKE ? ESCAPE '\\' OR res.email LIKE ? ESCAPE '\\' OR res.phone LIKE ? ESCAPE '\\' OR res.reservation_no LIKE ? ESCAPE '\\' OR u.unit_number LIKE ? ESCAPE '\\')`); params.push(...Array(5).fill(like(term))); }
  if (param(query, "source")) { where.push("res.source = ?"); params.push(param(query, "source")); }
  const rows = db.all<Record<string, any>>(
    `SELECT res.*, u.unit_number, u.width_m, u.depth_m, u.height_m, u.monthly_price_cents, f.name AS facility_name
       FROM reservations res JOIN facilities f ON f.id = res.facility_id LEFT JOIN units u ON u.id = res.unit_id
      WHERE ${where.join(" AND ")}${s.sql} ORDER BY CASE res.status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, COALESCE(res.hold_until, res.desired_start, res.created_at) LIMIT 300`,
    [...params, ...s.params],
  );
  const available = db.all<Record<string, any>>(
    `SELECT u.*, f.name AS facility_name FROM units u JOIN facilities f ON f.id = u.facility_id WHERE u.status = 'available'${us.sql} ORDER BY f.name, u.unit_number`,
    us.params,
  );
  const unitLabel = (u: Record<string, any>) => `${u.unit_number} · ${dims(u)} · ${label(UNIT_TYPES, u.type)} · ${money(u.monthly_price_cents, cur)}/mo${ctx.facilities.length > 1 ? ` · ${u.facility_name}` : ""}`;
  const count = (sql: string) => db.num(`SELECT COUNT(*) FROM reservations res WHERE ${sql}${s.sql}`, s.params);
  const tab = (key: string) => withQuery("/reservations", query, { status: key === "holds" ? null : key, new: null, unit: null });
  const bookingUrl = `${await appOrigin()}/reserve`;

  return (
    <>
      <PageHeader eyebrow="Rentals" title="Reservations and requests"
        blurb={`Requests from the booking page land under Requests & waitlist. Assign a unit to hold it for ${settings.reservation_hold_days} days, then turn the hold into a signed agreement.`}
        actions={edit && <Link href="/reservations?new=1" className="btn btn-primary"><Icon name="plus" />New reservation</Link>}
      />

      <div className="panel p-4 mb-5 flex flex-wrap items-center gap-3">
        <Icon name="external" className="w-4 h-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Public booking page</div>
          {settings.public_reservations_enabled ? (
            <div className="text-sm break-all" style={{ color: "var(--ink-3)" }}>Share this link so customers can request a storage unit or warehouse: <a className="link" href={bookingUrl} target="_blank" rel="noopener">{bookingUrl}</a></div>
          ) : (
            <div className="text-sm" style={{ color: "var(--ink-3)" }}>Online reservations are switched off. Turn them on under <Link className="link" href="/settings?tab=billing">Settings → Billing rules</Link>.</div>
          )}
        </div>
        {settings.public_reservations_enabled && (
          <span className="flex gap-2">
            <CopyButton text={bookingUrl} label="Copy link" />
            <a href={bookingUrl} target="_blank" rel="noopener" className="btn btn-sm">Open</a>
          </span>
        )}
      </div>

      {param(query, "new") && edit && (
        <Card title="New reservation" className="mb-5">
          <ActionForm action={saveReservationAction} submit="Save reservation" cancelHref="/reservations" resetOnOk>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Name"><input className="input" name="name" required maxLength={120} /></Field>
              <Field label="Phone"><input className="input" name="phone" maxLength={40} placeholder="+297 …" /></Field>
              <Field label="Email"><input className="input" type="email" name="email" maxLength={254} /></Field>
              <Field label="Unit to hold" className="lg:col-span-2" hint="Leave empty to add them as an open request instead.">
                <select className="select" name="unit_id" defaultValue={param(query, "unit")}>
                  <option value="">No unit yet — add as a request</option>
                  {available.map((u) => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
                </select>
              </Field>
              <Field label="Hold until"><input className="input" type="date" name="hold_until" min={t} defaultValue={addDays(t, settings.reservation_hold_days)} /></Field>
              <Field label="Wanted area (m²)" hint="For a warehouse request."><input className="input" type="number" name="desired_area_m2" min={1} max={10000} step="0.5" /></Field>
              <Field label="Wanted size"><select className="select" name="desired_size" defaultValue=""><option value="">Any</option>{UNIT_SIZES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
              <Field label="Wanted type"><select className="select" name="desired_type" defaultValue=""><option value="">Any</option>{UNIT_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
              <Field label="Move-in date"><input className="input" type="date" name="desired_start" min={t} /></Field>
              {ctx.facilities.length > 1 && (
                <Field label="Facility" hint="For a request without a unit."><select className="select" name="facility_id" defaultValue={ctx.facilityId ?? ctx.facilities[0].id}>{ctx.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
              )}
              <Field label="Notes" className="sm:col-span-2 lg:col-span-3"><input className="input" name="notes" maxLength={1000} /></Field>
            </div>
          </ActionForm>
        </Card>
      )}

      <Tabs active={view} tabs={[
        { key: "holds", label: "Unit holds", href: tab("holds"), count: count("res.status IN ('pending','confirmed')") },
        { key: "waitlist", label: "Requests & waitlist", href: tab("waitlist"), count: count("res.status = 'waitlist'") },
        { key: "closed", label: "Converted & closed", href: tab("closed") },
        { key: "all", label: "All", href: tab("all") },
      ]} />
      <Toolbar query={query} keep={["status"]} placeholder="Search by name, phone, email or unit…" exportHref={exportUrl("reservations", query)}
        filters={[{ name: "source", label: "Source", options: [{ value: "staff", label: "Staff" }, { value: "web", label: "Online" }, { value: "portal", label: "Portal" }] }]} />

      {rows.length === 0 ? (
        <Card><EmptyState title={view === "waitlist" ? "No open requests" : view === "holds" ? "No units on hold" : "Nothing here"} /></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((r) => {
            const left = r.hold_until ? daysBetween(t, r.hold_until) : null;
            const live = r.status === "pending" || r.status === "confirmed";
            const matches = r.status === "waitlist"
              ? available.filter((u) => u.facility_id === r.facility_id && (!r.desired_size || u.size_label === r.desired_size) && (!r.desired_type || u.type === r.desired_type)
                && (!r.desired_area_m2 || area(u) >= r.desired_area_m2))
              : [];
            return (
              <div key={r.id} className="panel p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.name}</div>
                    <div className="text-xs" style={{ color: "var(--ink-3)" }}>{r.reservation_no} · {r.source === "web" ? "online" : r.source} · {formatDate(r.created_at)}</div>
                  </div>
                  <StatusChip list={RESERVATION_STATUSES} value={r.status} />
                </div>
                <div className="text-sm space-y-1" style={{ color: "var(--ink-2)" }}>
                  <div>{[r.phone, r.email].filter(Boolean).join(" · ") || "No contact details"}</div>
                  {r.unit_id ? (
                    <div><Link className="link" href={`/units/${r.unit_id}`}>Unit {r.unit_number}</Link> · {dims(r)} · {money(r.monthly_price_cents, cur)}/mo{ctx.facilities.length > 1 ? ` · ${r.facility_name}` : ""}</div>
                  ) : (
                    <div>Wants: {r.desired_type === "warehouse" ? `Warehouse${r.desired_area_m2 ? `, about ${r.desired_area_m2} m²` : ""}` : [r.desired_size && `${label(UNIT_SIZES, r.desired_size)}`, r.desired_type && label(UNIT_TYPES, r.desired_type).toLowerCase()].filter(Boolean).join(" ") || "any unit"}{ctx.facilities.length > 1 ? ` · ${r.facility_name}` : ""}</div>
                  )}
                  {r.desired_start && <div>Move-in {formatDate(r.desired_start)}</div>}
                  {live && left !== null && <div><Chip tone={left <= 1 ? "bad" : left <= 3 ? "warn" : "neutral"}>{left < 0 ? "hold expired" : left === 0 ? "hold ends today" : `held ${left} more day${left === 1 ? "" : "s"}`}</Chip></div>}
                  {r.notes && <div className="text-xs" style={{ color: "var(--ink-3)" }}>{r.notes}</div>}
                </div>
                {edit && (live || r.status === "waitlist") && (
                  <div className="flex flex-wrap gap-2 mt-auto pt-1">
                    {live && canAgree && <Link href={`/agreements/new?reservation=${r.id}`} className="btn btn-sm btn-primary">Convert to agreement</Link>}
                    {r.status === "pending" && <ConfirmButton action={reservationAction} fields={{ id: r.id, op: "confirmed" }} label="Confirm" title="quiet" />}
                    {r.status === "waitlist" && (
                      matches.length > 0 ? (
                        <ModalForm label={`Assign a unit (${matches.length} match${matches.length === 1 ? "" : "es"})`} title={`Assign a unit to ${r.name}`} action={reservationAction} className="btn btn-sm btn-primary" submit="Assign and hold">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="op" value="assign" />
                          <Field label="Available unit"><select className="select" name="unit_id" required>{matches.map((u) => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}</select></Field>
                        </ModalForm>
                      ) : <span className="text-xs self-center" style={{ color: "var(--ink-3)" }}>No matching unit free yet — waiting</span>
                    )}
                    <ConfirmButton action={reservationAction} fields={{ id: r.id, op: "cancelled" }} label={r.status === "waitlist" ? "Remove" : "Cancel"} className="btn btn-ghost btn-sm" confirm={`Cancel the reservation for ${r.name}?`} title="quiet" />
                  </div>
                )}
                {r.status === "converted" && r.converted_agreement_id && canAgree && <Link className="link text-sm" href={`/agreements/${r.converted_agreement_id}`}>View the agreement</Link>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
