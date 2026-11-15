import { id, type DB } from "./db";
import { audit, SYSTEM, type Actor } from "./audit";
import { addDays, nowIso, today } from "./clock";
import { syncUnitStatus } from "./units";
import { getSettings } from "./settings";

export const RESERVATION_STATUSES = [
  { value: "pending", label: "Pending", tone: "warn" },
  { value: "confirmed", label: "Confirmed", tone: "info" },
  { value: "waitlist", label: "Waitlist", tone: "neutral" },
  { value: "converted", label: "Converted", tone: "good" },
  { value: "cancelled", label: "Cancelled", tone: "muted" },
  { value: "expired", label: "Expired", tone: "muted" },
] as const;

export type ReservationInput = {
  facility_id: string;
  unit_id: string | null;
  renter_id?: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  desired_size: string | null;
  desired_type: string | null;
  desired_area_m2?: number | null;
  desired_start: string | null;
  hold_until?: string | null;
  status?: "pending" | "confirmed" | "waitlist";
  source: "staff" | "web" | "portal";
  notes: string | null;
};

/** Hold a unit (or join the waitlist when no unit is given). */
export function createReservation(db: DB, actor: Actor, input: ReservationInput): string {
  return db.tx(() => {
    const settings = getSettings(db);
    let status = input.status ?? (input.unit_id ? (input.source === "staff" ? "confirmed" : "pending") : "waitlist");
    if (!input.unit_id) status = "waitlist";
    if (input.unit_id) {
      const unit = db.one<{ status: string; unit_number: string; facility_id: string }>(
        `SELECT status, unit_number, facility_id FROM units WHERE id = ?`,
        [input.unit_id],
      );
      if (!unit || unit.facility_id !== input.facility_id) throw new Error("That unit is not at this facility.");
      syncUnitStatus(db, input.unit_id);
      const fresh = db.one<{ status: string }>(`SELECT status FROM units WHERE id = ?`, [input.unit_id])!;
      if (fresh.status !== "available") throw new Error(`Unit ${unit.unit_number} is no longer available.`);
    }
    const resId = id();
    const no = db.nextNumber("RES", today().slice(0, 4));
    const stamp = nowIso();
    db.run(
      `INSERT INTO reservations (id, reservation_no, facility_id, unit_id, renter_id, name, email, phone, desired_size,
                                 desired_type, desired_area_m2, desired_start, hold_until, status, source, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resId, no, input.facility_id, input.unit_id, input.renter_id ?? null, input.name, input.email, input.phone,
        input.desired_size, input.desired_type, input.desired_area_m2 ?? null, input.desired_start,
        input.unit_id ? (input.hold_until ?? addDays(today(), settings.reservation_hold_days)) : null,
        status, input.source, input.notes, stamp, stamp,
      ],
    );
    syncUnitStatus(db, input.unit_id);
    audit(db, actor, "create", "reservation", resId, `${status === "waitlist" ? "Waitlist entry" : "Reservation"} ${no} for ${input.name}`);
    return resId;
  });
}

export function setReservationStatus(db: DB, actor: Actor, resId: string, status: "confirmed" | "cancelled" | "expired"): void {
  db.tx(() => {
    const res = db.one<Record<string, any>>(`SELECT * FROM reservations WHERE id = ?`, [resId]);
    if (!res) return;
    if (["converted", "cancelled", "expired"].includes(res.status)) return;
    if (status === "confirmed" && !res.unit_id) throw new Error("Assign a unit before confirming.");
    db.run(`UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?`, [status, nowIso(), resId]);
    syncUnitStatus(db, res.unit_id);
    audit(db, actor, status, "reservation", resId, `${res.reservation_no} ${status}`);
  });
}

/** Give a waitlisted person a unit: the entry becomes a confirmed hold. */
export function assignUnit(db: DB, actor: Actor, resId: string, unitId: string): void {
  db.tx(() => {
    const res = db.one<Record<string, any>>(`SELECT * FROM reservations WHERE id = ?`, [resId]);
    if (!res || !["waitlist", "pending"].includes(res.status)) throw new Error("This entry cannot be assigned a unit.");
    syncUnitStatus(db, unitId);
    const unit = db.one<{ status: string; unit_number: string; facility_id: string }>(`SELECT status, unit_number, facility_id FROM units WHERE id = ?`, [unitId]);
    if (!unit || unit.status !== "available") throw new Error("That unit is not available.");
    const hold = addDays(today(), getSettings(db).reservation_hold_days);
    db.run(`UPDATE reservations SET unit_id = ?, facility_id = ?, status = 'confirmed', hold_until = ?, updated_at = ? WHERE id = ?`, [
      unitId, unit.facility_id, hold, nowIso(), resId,
    ]);
    syncUnitStatus(db, unitId);
    audit(db, actor, "assign", "reservation", resId, `${res.reservation_no} assigned unit ${unit.unit_number}`);
  });
}

/** Release holds whose hold-until date has passed. */
export function expireReservations(db: DB, asOf: string = today()): number {
  const stale = db.all<{ id: string }>(
    `SELECT id FROM reservations WHERE status IN ('pending','confirmed') AND hold_until IS NOT NULL AND hold_until < ?`,
    [asOf],
  );
  for (const r of stale) setReservationStatus(db, SYSTEM, r.id, "expired");
  return stale.length;
}
