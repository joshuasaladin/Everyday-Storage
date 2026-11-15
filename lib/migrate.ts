import type Database from "better-sqlite3";

/**
 * Upgrades an existing database in place. Each step runs once, tracked by
 * SQLite's user_version, inside a transaction.
 *
 *   1 — units in metres: width_ft/depth_ft/height_ft become width_m/depth_m/height_m
 *       (values converted, 1 ft = 0.3048 m); types become storage_unit / warehouse;
 *       size classes become small / standard / large; maintenance no longer
 *       blocks units.
 */
export const SCHEMA_VERSION = 1;

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
    raw.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}
