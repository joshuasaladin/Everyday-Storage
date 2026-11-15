import { id, type DB } from "./db";
import { nowIso, today } from "./clock";

export { UNIT_TYPES, UNIT_SIZES, UNIT_STATUSES, SIZE_PRESETS, label, type UnitStatus } from "./unit-options";
import type { UnitStatus } from "./unit-options";

/**
 * A unit's status is never typed in — it follows from what is attached to it:
 * occupied (a running agreement) › unavailable (switched offline) › reserved
 * (a hold, or an agreement that has not started / not been signed) › available.
 */
export function syncUnitStatus(db: DB, unitId: string | null | undefined, asOf: string = today()): void {
  if (!unitId) return;
  const unit = db.one<{ offline: number; status: string }>(`SELECT offline, status FROM units WHERE id = ?`, [unitId]);
  if (!unit) return;

  const live = db.one<{ status: string; start_date: string }>(
    `SELECT status, start_date FROM agreements
      WHERE unit_id = ? AND status IN ('active','pending_signature') LIMIT 1`,
    [unitId],
  );
  let status: UnitStatus = "available";
  if (live && live.status === "active" && live.start_date <= asOf) status = "occupied";
  else if (unit.offline) status = "unavailable";
  else if (
    live ||
    db.one(`SELECT 1 FROM reservations WHERE unit_id = ? AND status IN ('pending','confirmed') LIMIT 1`, [unitId])
  )
    status = "reserved";

  if (status !== unit.status) {
    db.run(`UPDATE units SET status = ?, updated_at = ? WHERE id = ?`, [status, nowIso(), unitId]);
  }
}

export function syncAllUnits(db: DB, asOf: string = today()): void {
  for (const u of db.all<{ id: string }>(`SELECT id FROM units`)) syncUnitStatus(db, u.id, asOf);
}

export type UnitInput = {
  facility_id: string;
  unit_number: string;
  type: string;
  size_label: string;
  width_m: number;
  depth_m: number;
  height_m: number;
  location: string | null;
  monthly_price_cents: number;
  offline: number;
  features: string | null;
  notes: string | null;
};

/** First free cell on the facility grid, scanning row by row. */
export function nextFreeCell(db: DB, facilityId: string): { x: number; y: number } {
  const fac = db.one<{ map_cols: number; map_rows: number }>(
    `SELECT map_cols, map_rows FROM facilities WHERE id = ?`,
    [facilityId],
  );
  const cols = fac?.map_cols ?? 16;
  const taken = new Set<string>();
  for (const u of db.all<{ map_x: number; map_y: number; map_w: number; map_h: number }>(
    `SELECT map_x, map_y, map_w, map_h FROM units WHERE facility_id = ? AND map_x IS NOT NULL`,
    [facilityId],
  )) {
    for (let dx = 0; dx < u.map_w; dx++) for (let dy = 0; dy < u.map_h; dy++) taken.add(`${u.map_x + dx},${u.map_y + dy}`);
  }
  for (let y = 0; y < 200; y++) for (let x = 0; x < cols; x++) if (!taken.has(`${x},${y}`)) return { x, y };
  return { x: 0, y: 0 };
}

export function createUnit(db: DB, input: UnitInput): string {
  const unitId = id();
  const cell = nextFreeCell(db, input.facility_id);
  const stamp = nowIso();
  db.run(
    `INSERT INTO units (id, facility_id, unit_number, type, size_label, width_m, depth_m, height_m, location,
                        monthly_price_cents, offline, features, notes, map_x, map_y, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      unitId, input.facility_id, input.unit_number, input.type, input.size_label, input.width_m, input.depth_m,
      input.height_m, input.location, input.monthly_price_cents, input.offline,
      input.features, input.notes, cell.x, cell.y, stamp, stamp,
    ],
  );
  // grow the grid if the new unit landed below the last row
  db.run(`UPDATE facilities SET map_rows = MAX(map_rows, ?) WHERE id = ?`, [cell.y + 1, input.facility_id]);
  syncUnitStatus(db, unitId);
  return unitId;
}

export function updateUnit(db: DB, unitId: string, input: UnitInput): void {
  db.run(
    `UPDATE units SET unit_number = ?, type = ?, size_label = ?, width_m = ?, depth_m = ?, height_m = ?,
            location = ?, monthly_price_cents = ?, offline = ?, features = ?, notes = ?, updated_at = ?
      WHERE id = ?`,
    [
      input.unit_number, input.type, input.size_label, input.width_m, input.depth_m, input.height_m,
      input.location, input.monthly_price_cents, input.offline, input.features,
      input.notes, nowIso(), unitId,
    ],
  );
  syncUnitStatus(db, unitId);
}

/** A unit with any history (agreements, invoices) is kept; only an untouched one can be deleted. */
export function unitDeleteBlocker(db: DB, unitId: string): string | null {
  if (db.one(`SELECT 1 FROM agreements WHERE unit_id = ? LIMIT 1`, [unitId]))
    return "This unit has rental history, so it cannot be deleted. Switch it offline instead.";
  if (db.one(`SELECT 1 FROM reservations WHERE unit_id = ? AND status IN ('pending','confirmed') LIMIT 1`, [unitId]))
    return "This unit has a live reservation. Cancel it first.";
  return null;
}

export function unitOccupant(db: DB, unitId: string) {
  return db.one(
    `SELECT a.id AS agreement_id, a.agreement_no, a.status AS agreement_status, a.start_date, a.end_date,
            a.term_type, a.monthly_rate_cents, a.move_out_date,
            r.id AS renter_id, r.first_name, r.last_name, r.company, r.kind, r.phone, r.email
       FROM agreements a JOIN renters r ON r.id = a.renter_id
      WHERE a.unit_id = ? AND a.status IN ('active','pending_signature') LIMIT 1`,
    [unitId],
  );
}
