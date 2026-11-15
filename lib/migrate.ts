import type Database from "better-sqlite3";

/**
 * Upgrades an existing database in place. Each step runs once, tracked by
 * SQLite's user_version, inside a transaction.
 *
 *   1 — units in metres: width_ft/depth_ft/height_ft become width_m/depth_m/height_m
 *       (values converted, 1 ft = 0.3048 m); types become storage_unit / warehouse;
 *       size classes become small / standard / large; maintenance no longer
 *       blocks units.
 *   2 — warehouse requests record the floor area wanted; customers no longer
 *       sign in, so renter accounts and their sessions are removed.
 *   3 — undo step 1's feet-to-metres conversion for units saved before it ran:
 *       in practice those sizes had been typed in metres. Only units last
 *       changed before the metric release (15 Nov 2026 02:34 UTC) are touched,
 *       so anything entered or edited since keeps its value.
 */
export const METRIC_RELEASE = "2026-11-15T02:34:00Z";
export const SCHEMA_VERSION = 3;

function columns(raw: Database.Database, table: string): Set<string> {
  return new Set((raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

export function migrate(raw: Database.Database): void {
  const version = Number(raw.pragma("user_version", { simple: true }));
  if (version >= SCHEMA_VERSION) return;

  raw.transaction(() => {
    if (version < 1) {
      const cols = columns(raw, "units");
      if (cols.has("width_ft")) {
        for (const d of ["width", "depth", "height"]) {
          raw.exec(`ALTER TABLE units RENAME COLUMN ${d}_ft TO ${d}_m`);
          raw.exec(`UPDATE units SET ${d}_m = ROUND(${d}_m * 0.3048, 2)`);
        }
      }
      raw.exec(`
        UPDATE units SET type = CASE WHEN type = 'warehouse' THEN 'warehouse' ELSE 'storage_unit' END;
        UPDATE units SET size_label = CASE size_label WHEN 'small' THEN 'small' WHEN 'large' THEN 'large' WHEN 'xl' THEN 'large' ELSE 'standard' END;
        UPDATE units SET status = 'available' WHERE status = 'maintenance';
        UPDATE reservations SET desired_type = CASE WHEN desired_type IS NULL THEN NULL WHEN desired_type = 'warehouse' THEN 'warehouse' ELSE 'storage_unit' END;
        UPDATE reservations SET desired_size = CASE WHEN desired_size IS NULL THEN NULL WHEN desired_size IN ('small','large') THEN desired_size WHEN desired_size = 'xl' THEN 'large' ELSE 'standard' END;
        DELETE FROM automations WHERE key NOT IN ('generate_invoices','send_invoices','due_reminders','overdue_reminders','late_fees','expiry_notices','renewals','move_outs','reservation_expiry');
      `);
    }
    if (version < 2) {
      if (!columns(raw, "reservations").has("desired_area_m2")) raw.exec(`ALTER TABLE reservations ADD COLUMN desired_area_m2 REAL`);
      raw.exec(`
        DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'renter');
        DELETE FROM users WHERE role = 'renter';
        UPDATE documents SET renter_visible = 0;
      `);
    }
    if (version < 3 && version >= 1) {
      raw.prepare(
        `UPDATE units SET width_m = ROUND(width_m / 0.3048, 1), depth_m = ROUND(depth_m / 0.3048, 1), height_m = ROUND(height_m / 0.3048, 1)
          WHERE updated_at < ?`,
      ).run(METRIC_RELEASE);
    }
    raw.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}
