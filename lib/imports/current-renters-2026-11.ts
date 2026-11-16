import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, type DB } from "../db";
import { audit, type Actor } from "../audit";
import { monthsBetween, addDays, nowIso, today } from "../clock";
import { saveSettings, getSettings } from "../settings";
import { createUnit, syncAllUnits } from "../units";
import { createRenter } from "../renters";
import { createAgreement, processTermEnds } from "../agreements";

/**
 * One-time fresh start, requested 16 Nov 2026: remove every renter, agreement
 * and everything hanging off them (invoices, payments, deposits, credits,
 * documents), remove the existing units, and load the business's actual
 * current renters from their spreadsheet.
 *
 * Rules from the owner:
 *  - sizes are width × length in metres; height 2.4 m for all
 *    (1.5 × 3 = Small, 3 × 3 = Standard)
 *  - rent is the monthly amount in AWG
 *  - a fixed term that has already ended means the renter now pays
 *    month-to-month
 *  - Unit 10 and Unit 13 are month-to-month (13 has no start date on file;
 *    1 Nov 2026 is a placeholder)
 *  - Unit 22's dates were a typo: 1 Oct 2026 – 30 Mar 2027
 *  - billing in the app starts with December 2026 rent
 *  - the Stanvaste Nora billboard rental is left out
 *
 * Runs at most once (marker in `counters`), and only against a database that
 * existed before this import was written — never a fresh or test database.
 * A full copy of the database is saved beside it before anything is deleted.
 */
const MARKER = "import:current-renters-2026-11";
const WRITTEN = "2026-11-16T00:00:00Z";
const BILLING_FROM = "2026-12-01";

type Row = {
  unit: string;
  w: number;
  d: number;
  renter?: { kind: "individual" | "business"; first: string; last: string; company?: string };
  rent?: number; // AWG per month
  start?: string;
  end?: string | null; // null = month-to-month, no end on file
  note?: string;
};

const p = (first: string, last = ""): Row["renter"] => ({ kind: "individual", first, last });
const b = (company: string): Row["renter"] => ({ kind: "business", first: "", last: "", company });

export const ROWS: Row[] = [
  { unit: "1", w: 3, d: 3, renter: p("Felix L.", "Hoek"), rent: 375, start: "2025-01-01", end: "2025-06-30" },
  { unit: "2", w: 3, d: 3, renter: b("D&I Reshapers"), rent: 295, start: "2023-03-09", end: "2025-01-31" },
  { unit: "3", w: 3, d: 3, renter: p("Phillipe"), rent: 375, start: "2025-02-01", end: "2026-01-31" },
  { unit: "4", w: 3, d: 3, renter: p("Heather", "Arnold"), rent: 195, start: "2023-03-10", end: "2025-09-10" },
  { unit: "5", w: 3, d: 3, renter: p("Robert", "Tromp"), rent: 375, start: "2024-04-01", end: "2025-03-30" },
  { unit: "6", w: 1.5, d: 3, renter: p("Geert", "Rep"), rent: 225, start: "2026-02-11", end: "2026-07-31" },
  { unit: "7", w: 1.5, d: 3, renter: p("Carina", "Wever"), rent: 250, start: "2026-09-01", end: "2027-02-28" },
  { unit: "8", w: 3, d: 3, renter: p("Jadira", "Leter"), rent: 375, start: "2024-07-01", end: "2025-06-30" },
  { unit: "9", w: 3, d: 3, renter: p("Harm", "van de Seijp (UNI)"), rent: 375, start: "2024-07-01", end: "2025-06-30" },
  { unit: "10", w: 3, d: 3, renter: b("SGV Spring Group"), rent: 395, start: "2025-01-01", end: null },
  { unit: "11", w: 3, d: 3 },
  { unit: "12", w: 3, d: 3, renter: p("Jairzinho", "Theodora"), rent: 375, start: "2023-12-01", end: "2025-12-31", note: "Switched to a 3x3 unit in June." },
  { unit: "13", w: 1.5, d: 3, renter: p("Patrick", "Flader"), rent: 225, start: "2026-11-01", end: null, note: "No start date on file — 1 Nov 2026 entered as a placeholder." },
  { unit: "14", w: 1.5, d: 3, renter: p("Julisa M.", "Boekhoudt"), rent: 205, start: "2024-09-01", end: "2026-02-28" },
  { unit: "15", w: 1.5, d: 3, renter: p("Henriette/Roger", "Mendez"), rent: 205, start: "2024-10-01", end: "2025-05-31" },
  { unit: "16", w: 1.5, d: 3, renter: p("John B.", "Sprakfa"), rent: 250, start: "2026-06-17", end: "2026-12-31" },
  { unit: "17", w: 3, d: 3, renter: b("Optimus/Fargom Manpower"), rent: 375, start: "2025-01-01", end: "2025-06-30" },
  { unit: "18", w: 3, d: 3, renter: b("Casa Blanca 16.8 Real Estate vba"), rent: 375, start: "2024-09-01", end: "2026-02-28" },
  { unit: "19", w: 3, d: 3, renter: p("Diego F.", "Giraldo Osorio"), rent: 375, start: "2024-09-09", end: "2025-08-31" },
  { unit: "20", w: 3, d: 3, renter: b("T2 Bread Lab"), rent: 450, start: "2026-06-01", end: "2026-12-31" },
  { unit: "21", w: 3, d: 3, renter: p("Patick N.", "Richardson"), rent: 405, start: "2026-01-01", end: "2026-06-30" },
  { unit: "22", w: 3, d: 3, renter: b("Caribbean Port Agencies Inc."), rent: 495, start: "2026-10-01", end: "2027-03-30" },
  { unit: "23", w: 3, d: 3, renter: p("Starr", "Ramos"), rent: 450, start: "2026-06-15", end: "2026-12-31" },
  { unit: "24", w: 3, d: 3, renter: p("Claudia P.", "Agredo Gomez"), rent: 495, start: "2026-09-01", end: "2027-02-28" },
  { unit: "25", w: 3, d: 3, renter: b("Endeavor Catering VBA"), rent: 395, start: "2025-11-01", end: "2026-10-31" },
  { unit: "26", w: 3, d: 3, renter: b("GVH Gordon Ventures (Kulture Café)"), rent: 375, start: "2024-12-01", end: "2025-11-30" },
  { unit: "27", w: 1.5, d: 3, renter: p("Eldrich", "Tromp"), rent: 205, start: "2025-10-16", end: "2026-04-30" },
  { unit: "28", w: 1.5, d: 3, renter: b("Foundation Snoop Doggy"), rent: 225, start: "2026-05-07", end: "2027-04-30" },
];

const ACTOR: Actor = { id: null, name: "Fresh-start import", role: "system" };

export function shouldRunImport(db: DB): boolean {
  if (db.one(`SELECT 1 FROM counters WHERE name = ?`, [MARKER])) return false;
  // only the database that existed when the owner asked for this — never a new or test one
  return Boolean(db.one(`SELECT 1 FROM facilities WHERE created_at < ? LIMIT 1`, [WRITTEN]));
}

/** Copy of the whole database before anything is removed. Returns its path. */
function backup(db: DB): string | null {
  if (!db.raw.name || db.raw.memory) return null;
  const file = path.join(DATA_DIR, `backup-before-fresh-start-${nowIso().replace(/[:.]/g, "-")}.db`);
  db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

export function runCurrentRentersImport(db: DB): { backup: string | null; units: number; renters: number; agreements: number } {
  const saved = backup(db);
  const facility = db.one<{ id: string }>(`SELECT id FROM facilities WHERE status = 'active' ORDER BY created_at LIMIT 1`);
  if (!facility) throw new Error("No active facility to load the units into.");
  const t = today();
  const docs: string[] = [];

  const result = db.tx(() => {
    // --- clear everything tied to renters, agreements and units
    for (const d of db.all<{ storage_key: string }>(`SELECT storage_key FROM documents WHERE entity IN ('renter','agreement','unit')`)) docs.push(d.storage_key);
    db.raw.exec(`
      DELETE FROM credit_applications;
      DELETE FROM payment_allocations;
      DELETE FROM refunds;
      DELETE FROM payment_requests;
      DELETE FROM credits;
      DELETE FROM deposit_transactions;
      DELETE FROM invoice_lines;
      DELETE FROM invoices;
      DELETE FROM payments;
      DELETE FROM move_outs;
      DELETE FROM agreement_renewals;
      DELETE FROM documents WHERE entity IN ('renter','agreement','unit');
      DELETE FROM email_outbox WHERE status IN ('queued','failed');
      UPDATE reservations SET renter_id = NULL, converted_agreement_id = NULL;
      UPDATE reservations SET unit_id = NULL, hold_until = NULL, status = 'waitlist' WHERE status IN ('pending','confirmed');
      UPDATE reservations SET unit_id = NULL;
      DELETE FROM agreements;
      DELETE FROM users WHERE role = 'renter';
      DELETE FROM renters;
      DELETE FROM units;
      DELETE FROM counters WHERE name NOT LIKE 'RES:%' AND name NOT LIKE 'import:%';
    `);
    saveSettings(db, { base_currency: "AWG" });
    const s = getSettings(db);

    // --- units, renters, agreements
    let renters = 0;
    let agreements = 0;
    for (const r of ROWS) {
      const size = r.w === 1.5 ? "small" : "standard";
      const listPrice = r.rent ? r.rent * 100 : (size === "small" ? s.price_small_cents : s.price_standard_cents) || 37500;
      const unitId = createUnit(db, {
        facility_id: facility.id, unit_number: r.unit, type: "storage_unit", size_label: size,
        width_m: r.w, depth_m: r.d, height_m: 2.4, location: null, monthly_price_cents: listPrice,
        offline: 0, features: null, notes: null,
      });
      if (!r.renter || !r.rent || !r.start) continue;

      const renterId = createRenter(db, {
        kind: r.renter.kind, first_name: r.renter.first, last_name: r.renter.last, company: r.renter.company ?? null,
        email: null, phone: null, id_type: null, address: null, status: "active", notes: null,
      });
      renters += 1;

      const fixed = Boolean(r.end);
      const agId = createAgreement(db, ACTOR, {
        facility_id: facility.id, unit_id: unitId, renter_id: renterId, term_type: fixed ? "fixed" : "month_to_month",
        start_date: r.start, term_months: fixed ? Math.max(1, monthsBetween(r.start, addDays(r.end!, 1))) : null,
        monthly_rate_cents: r.rent * 100, deposit_cents: 0, discount_cents: 0, discount_note: null,
        billing_mode: "fixed_day", billing_day: 1, prorate_first: 1,
        // owner's practice: when a fixed term ends the renter carries on month-to-month
        renewal_option: "month_to_month", renewal_term_months: null, notice_days: s.default_notice_days, notes: r.note ?? null,
      });
      const name = r.renter.company ?? `${r.renter.first} ${r.renter.last}`.trim();
      db.run(
        `UPDATE agreements SET status = 'active', end_date = ?, signed_at = ?, signed_name = ?, signed_method = 'paper',
                next_period_start = ?, updated_at = ? WHERE id = ?`,
        [fixed ? r.end : null, `${r.start}T12:00:00.000Z`, name, BILLING_FROM, nowIso(), agId],
      );
      agreements += 1;
    }

    // ended fixed terms roll over to month-to-month, recorded in each agreement's renewal history
    processTermEnds(db, t);
    syncAllUnits(db, t);
    db.run(`INSERT INTO counters (name, value) VALUES (?, 1)`, [MARKER]);
    audit(db, ACTOR, "import", "renter", null, `Fresh start: removed all previous renters, agreements, invoices, payments and units; loaded ${ROWS.length} units, ${renters} renters and ${agreements} agreements. Billing starts with ${BILLING_FROM} rent.`, { backup: saved });
    return { backup: saved, units: ROWS.length, renters, agreements };
  });

  for (const key of docs) fs.rmSync(path.join(DATA_DIR, "uploads", key), { force: true });
  return result;
}
