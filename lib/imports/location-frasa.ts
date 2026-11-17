import type { DB } from "../db";
import { audit } from "../audit";

/** One-time, requested 17 Nov 2026: every storage unit is at Frasa. Runs once, only on the live data that has the fresh-start import. */
const MARKER = "import:location-frasa";

export function runFrasaLocation(db: DB): number | null {
  if (!db.one(`SELECT 1 FROM counters WHERE name = 'import:current-renters-2026-11'`)) return null;
  if (db.one(`SELECT 1 FROM counters WHERE name = ?`, [MARKER])) return null;
  return db.tx(() => {
    const n = db.run(`UPDATE units SET location = 'Frasa', updated_at = datetime('now')`).changes;
    db.run(`INSERT INTO counters (name, value) VALUES (?, 1)`, [MARKER]);
    audit(db, { id: null, name: "Location update", role: "system" }, "update", "unit", null, `Location set to Frasa on all ${n} units`);
    return n;
  });
}
