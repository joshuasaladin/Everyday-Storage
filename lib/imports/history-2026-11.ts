import { id, type DB } from "../db";
import { audit, type Actor } from "../audit";
import { addDays, nowIso } from "../clock";
import { getSettings } from "../settings";
import { periodFor, prorate, recalcInvoice, type AgreementRow } from "../billing";
import { formatDate } from "../format";

/**
 * One-time: put the rent history in, as the owner asked on 17 Nov 2026.
 *
 * The fresh-start import loaded the current agreements with billing starting
 * at December 2026. Everything before that was paid outside Storage HQ, so for
 * each agreement every rent period from its start date to the end of November
 * 2026 becomes an invoice at the agreement's current rate, with a matching
 * payment dated the first day of the period (method "other", note "Paid before
 * Storage HQ"). A first period that starts mid-month is prorated like any
 * other. No tax is added to history, and nothing is emailed.
 *
 * Runs once, and only on the database where the fresh-start import ran.
 */
const MARKER = "import:rent-history-2026-11";
const AFTER = "import:current-renters-2026-11";
const UNTIL = "2026-12-01";
const NOTE = "Paid before Storage HQ";
const ACTOR: Actor = { id: null, name: "Rent history import", role: "system" };

export function shouldRunHistory(db: DB): boolean {
  return Boolean(db.one(`SELECT 1 FROM counters WHERE name = ?`, [AFTER])) && !db.one(`SELECT 1 FROM counters WHERE name = ?`, [MARKER]);
}

export function runRentHistory(db: DB): { invoices: number; total_cents: number } {
  const s = getSettings(db);
  const stamp = nowIso();
  return db.tx(() => {
    let invoices = 0;
    let total = 0;
    const ags = db.all<AgreementRow & { unit_number: string }>(
      `SELECT a.*, u.unit_number FROM agreements a JOIN units u ON u.id = a.unit_id
        WHERE a.status IN ('active','ended') AND a.start_date < ? ORDER BY a.start_date`,
      [UNTIL],
    );
    for (const ag of ags) {
      let start = ag.start_date;
      for (let guard = 0; guard < 240 && start < UNTIL; guard++) {
        const period = periodFor(ag, start);
        const end = period.end >= UNTIL ? addDays(UNTIL, -1) : period.end;
        start = addDays(period.end, 1);
        if (db.one(`SELECT 1 FROM invoices WHERE agreement_id = ? AND period_start = ? AND kind = 'rent' AND status <> 'void'`, [ag.id, period.start])) continue;

        const amount = prorate(ag.monthly_rate_cents, period.ratio) - prorate(ag.discount_cents, period.ratio);
        if (amount <= 0) continue;
        const span = `${formatDate(period.start)} – ${formatDate(end)}`;
        const invoiceId = id();
        db.run(
          `INSERT INTO invoices (id, invoice_no, facility_id, renter_id, agreement_id, unit_id, kind, period_start, period_end,
                                 issue_date, due_date, status, currency, tax_rate_bp, notes, sent_at, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'rent', ?, ?, ?, ?, 'open', ?, 0, ?, ?, NULL, ?, ?)`,
          [
            invoiceId, db.nextNumber(s.invoice_prefix || "INV", period.start.slice(0, 4)), ag.facility_id, ag.renter_id, ag.id, ag.unit_id,
            period.start, end, period.start, period.start, s.base_currency, NOTE, `${period.start}T12:00:00.000Z`, stamp, stamp,
          ],
        );
        db.run(
          `INSERT INTO invoice_lines (id, invoice_id, kind, description, quantity, unit_price_cents, amount_cents, taxable, sort, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
          [
            id(), invoiceId, period.prorated ? "prorated_rent" : "rent",
            `Storage rent — unit ${ag.unit_number} (${span})${period.prorated ? ` · ${period.days} days, prorated` : ""}`,
            period.prorated ? Number(period.ratio.toFixed(4)) : 1, ag.monthly_rate_cents, amount, stamp,
          ],
        );
        const paymentId = id();
        db.run(
          `INSERT INTO payments (id, payment_no, facility_id, renter_id, received_date, amount_cents, method, notes,
                                 reconciled_at, reconciled_by, statement_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'other', ?, ?, 'Rent history import', 'History before Storage HQ', ?, ?)`,
          [paymentId, db.nextNumber("PAY", period.start.slice(0, 4)), ag.facility_id, ag.renter_id, period.start, amount, NOTE, stamp, stamp, stamp],
        );
        db.run(`INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)`, [id(), paymentId, invoiceId, amount, stamp]);
        recalcInvoice(db, invoiceId);
        db.run(`UPDATE invoices SET paid_at = ? WHERE id = ?`, [`${period.start}T12:00:00.000Z`, invoiceId]);
        invoices += 1;
        total += amount;
      }
    }
    db.run(`INSERT INTO counters (name, value) VALUES (?, 1)`, [MARKER]);
    audit(db, ACTOR, "import", "invoice", null, `Rent history added: ${invoices} paid invoices (${(total / 100).toFixed(2)}) for every period from each agreement's start to 30 Nov 2026.`);
    return { invoices, total_cents: total };
  });
}
