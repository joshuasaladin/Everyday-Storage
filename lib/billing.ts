import { id, type DB } from "./db";
import { audit, SYSTEM, type Actor } from "./audit";
import { addDays, addMonths, daysBetween, daysInMonth, nowIso, today } from "./clock";
import { getSettings, taxRateBp, activeTaxes, type Settings } from "./settings";
import { formatDate } from "./format";

export type AgreementRow = {
  id: string;
  agreement_no: string;
  facility_id: string;
  unit_id: string;
  renter_id: string;
  term_type: "fixed" | "month_to_month";
  start_date: string;
  end_date: string | null;
  monthly_rate_cents: number;
  discount_cents: number;
  discount_note: string | null;
  billing_mode: "anniversary" | "fixed_day";
  billing_day: number;
  prorate_first: number;
  renewal_option: "auto_renew" | "month_to_month" | "end";
  status: string;
  next_period_start: string | null;
  move_out_date: string | null;
};

export type Period = {
  start: string;
  end: string;
  /** share of a full month this period is billed at (1 = a whole month) */
  ratio: number;
  days: number;
  prorated: boolean;
};

/** The last day that may still be billed, or null when billing is open-ended. */
export function lastBillableDay(ag: AgreementRow): string | null {
  if (ag.move_out_date) return ag.move_out_date;
  if (ag.term_type === "fixed" && ag.renewal_option === "end") return ag.end_date;
  return null;
}

/**
 * The billing period that starts on `start`.
 *
 * anniversary — each period runs from the start day to the day before the
 *               same day next month (31 Jan → 28 Feb → 31 Mar: clamped).
 * fixed_day   — every period starts on billing_day; a move-in on any other
 *               day gets a short first period, prorated by calendar days.
 * Either way a period cut short by the end of the agreement or a move-out is
 * prorated by days.
 */
export function periodFor(ag: AgreementRow, start: string): Period {
  let fullEnd: string;
  let ratio = 1;
  let prorated = false;

  if (ag.billing_mode === "anniversary") {
    const anchor = Number(ag.start_date.slice(8, 10));
    fullEnd = addDays(addMonths(start, 1, anchor), -1);
  } else {
    const day = Number(start.slice(8, 10));
    if (day === ag.billing_day) {
      fullEnd = addDays(addMonths(start, 1, ag.billing_day), -1);
    } else {
      // short first period up to the day before the next billing day
      const thisMonth = `${start.slice(0, 8)}${String(ag.billing_day).padStart(2, "0")}`;
      const nextBilling = thisMonth > start ? thisMonth : addMonths(thisMonth, 1, ag.billing_day);
      fullEnd = addDays(nextBilling, -1);
      if (ag.prorate_first) {
        const [y, m] = start.split("-").map(Number);
        ratio = (daysBetween(start, fullEnd) + 1) / daysInMonth(y, m);
        prorated = true;
      }
    }
  }

  let end = fullEnd;
  const last = lastBillableDay(ag);
  if (last && last < fullEnd) {
    end = last < start ? start : last;
    const fullDays = daysBetween(start, fullEnd) + 1;
    ratio = ratio * ((daysBetween(start, end) + 1) / fullDays);
    prorated = true;
  }
  return { start, end, ratio: Math.min(1, ratio), days: daysBetween(start, end) + 1, prorated };
}

export function prorate(cents: number, ratio: number): number {
  return Math.round(cents * ratio);
}

// ------------------------------------------------------------------ totals

/** Recompute an invoice from its lines, allocations and credits. The only place totals are written. */
export function recalcInvoice(db: DB, invoiceId: string): void {
  const inv = db.one<{ status: string; tax_rate_bp: number; paid_at: string | null }>(
    `SELECT status, tax_rate_bp, paid_at FROM invoices WHERE id = ?`,
    [invoiceId],
  );
  if (!inv) return;
  const lines = db.all<{ kind: string; amount_cents: number; taxable: number }>(
    `SELECT kind, amount_cents, taxable FROM invoice_lines WHERE invoice_id = ?`,
    [invoiceId],
  );
  let subtotal = 0;
  let discount = 0;
  let taxable = 0;
  for (const l of lines) {
    if (l.kind === "discount") discount += -l.amount_cents;
    else subtotal += l.amount_cents;
    if (l.taxable) taxable += l.amount_cents;
  }
  const tax = Math.round((Math.max(0, taxable) * inv.tax_rate_bp) / 10000);
  const total = Math.max(0, subtotal - discount) + tax;
  const paid = db.num(`SELECT COALESCE(SUM(amount_cents), 0) FROM payment_allocations WHERE invoice_id = ?`, [invoiceId]);
  const credited = db.num(`SELECT COALESCE(SUM(amount_cents), 0) FROM credit_applications WHERE invoice_id = ?`, [invoiceId]);
  const balance = total - paid - credited;

  let status = inv.status;
  if (status !== "void" && status !== "draft") {
    status = balance <= 0 ? "paid" : paid + credited > 0 ? "partial" : "open";
  }
  db.run(
    `UPDATE invoices SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, total_cents = ?,
            paid_cents = ?, credited_cents = ?, balance_cents = ?, status = ?,
            paid_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      subtotal, discount, tax, total, paid, credited, status === "void" ? 0 : Math.max(0, balance), status,
      status === "paid" ? (inv.paid_at ?? nowIso()) : null, nowIso(), invoiceId,
    ],
  );
}

export type LineInput = {
  kind: "rent" | "prorated_rent" | "late_fee" | "fee" | "discount" | "other";
  description: string;
  quantity?: number;
  unit_price_cents?: number;
  amount_cents: number;
  taxable?: boolean;
};

export function addLine(db: DB, invoiceId: string, line: LineInput): string {
  const lineId = id();
  const sort = db.num(`SELECT COALESCE(MAX(sort), 0) + 1 FROM invoice_lines WHERE invoice_id = ?`, [invoiceId]);
  const amount = line.kind === "discount" ? -Math.abs(line.amount_cents) : line.amount_cents;
  db.run(
    `INSERT INTO invoice_lines (id, invoice_id, kind, description, quantity, unit_price_cents, amount_cents, taxable, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      lineId, invoiceId, line.kind, line.description, line.quantity ?? 1,
      line.unit_price_cents ?? Math.abs(amount), amount, line.taxable === false ? 0 : 1, sort, nowIso(),
    ],
  );
  return lineId;
}

type NewInvoice = {
  facility_id: string;
  renter_id: string;
  agreement_id?: string | null;
  unit_id?: string | null;
  kind: "rent" | "one_off";
  period_start?: string | null;
  period_end?: string | null;
  issue_date: string;
  due_date: string;
  notes?: string | null;
  lines: LineInput[];
};

export function createInvoice(db: DB, actor: Actor, input: NewInvoice, settings: Settings = getSettings(db)): string {
  return db.tx(() => {
    const invoiceId = id();
    const no = db.nextNumber(settings.invoice_prefix || "INV", input.issue_date.slice(0, 4));
    const taxes = activeTaxes(db);
    const stamp = nowIso();
    db.run(
      `INSERT INTO invoices (id, invoice_no, facility_id, renter_id, agreement_id, unit_id, kind, period_start, period_end,
                             issue_date, due_date, status, currency, tax_rate_bp, tax_label, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId, no, input.facility_id, input.renter_id, input.agreement_id ?? null, input.unit_id ?? null,
        input.kind, input.period_start ?? null, input.period_end ?? null, input.issue_date, input.due_date,
        settings.base_currency, taxRateBp(db), taxes.map((t) => t.name).join(" + ") || null,
        input.notes ?? null, actor.id, stamp, stamp,
      ],
    );
    for (const line of input.lines) addLine(db, invoiceId, line);
    recalcInvoice(db, invoiceId);
    return invoiceId;
  });
}

// ------------------------------------------------------- recurring billing

export type GenerationResult = { created: string[]; skipped: number };

/**
 * Create every rent invoice that is due to exist as of `asOf`.
 *
 * Safe to run any number of times: each agreement remembers the next period
 * still to bill (next_period_start), and a unique index on
 * (agreement_id, period_start) makes a second invoice for the same period
 * impossible even if two runs race.
 */
export function generateDueInvoices(
  db: DB,
  opts: { asOf?: string; agreementId?: string; actor?: Actor; issueOnPeriodStart?: boolean } = {},
): GenerationResult {
  const asOf = opts.asOf ?? today();
  const actor = opts.actor ?? SYSTEM;
  const settings = getSettings(db);
  const horizon = addDays(asOf, settings.invoice_lead_days);
  const result: GenerationResult = { created: [], skipped: 0 };

  const agreements = db.all<AgreementRow>(
    `SELECT * FROM agreements
      WHERE status = 'active' AND next_period_start IS NOT NULL AND next_period_start <= ?
        ${opts.agreementId ? "AND id = ?" : ""}
      ORDER BY next_period_start`,
    opts.agreementId ? [horizon, opts.agreementId] : [horizon],
  );

  for (const first of agreements) {
    let ag = first;
    for (let guard = 0; guard < 60; guard++) {
      if (!ag.next_period_start || ag.next_period_start > horizon) break;
      const last = lastBillableDay(ag);
      if (last && ag.next_period_start > last) {
        db.run(`UPDATE agreements SET next_period_start = NULL, updated_at = ? WHERE id = ?`, [nowIso(), ag.id]);
        break;
      }
      const period = periodFor(ag, ag.next_period_start);
      const next = addDays(period.end, 1);

      const exists = db.one(
        `SELECT 1 FROM invoices WHERE agreement_id = ? AND period_start = ? AND kind = 'rent' AND status <> 'void'`,
        [ag.id, period.start],
      );
      if (exists) {
        result.skipped += 1;
      } else {
        const unit = db.one<{ unit_number: string }>(`SELECT unit_number FROM units WHERE id = ?`, [ag.unit_id]);
        const issue = opts.issueOnPeriodStart ? (period.start < asOf ? period.start : asOf) : asOf;
        const dueBase = addDays(period.start, settings.due_offset_days);
        const span = `${formatDate(period.start)} – ${formatDate(period.end)}`;
        const lines: LineInput[] = [
          {
            kind: period.prorated ? "prorated_rent" : "rent",
            description: `Storage rent — unit ${unit?.unit_number ?? ""} (${span})${period.prorated ? ` · ${period.days} days, prorated` : ""}`,
            quantity: period.prorated ? Number(period.ratio.toFixed(4)) : 1,
            unit_price_cents: ag.monthly_rate_cents,
            amount_cents: prorate(ag.monthly_rate_cents, period.ratio),
          },
        ];
        if (ag.discount_cents > 0) {
          lines.push({
            kind: "discount",
            description: ag.discount_note || "Discount",
            amount_cents: prorate(ag.discount_cents, period.ratio),
          });
        }
        try {
          db.tx(() => {
            const invoiceId = createInvoice(
              db,
              actor,
              {
                facility_id: ag.facility_id,
                renter_id: ag.renter_id,
                agreement_id: ag.id,
                unit_id: ag.unit_id,
                kind: "rent",
                period_start: period.start,
                period_end: period.end,
                issue_date: issue,
                due_date: dueBase < issue ? issue : dueBase,
                lines,
              },
              settings,
            );
            db.run(`UPDATE agreements SET next_period_start = ?, updated_at = ? WHERE id = ?`, [next, nowIso(), ag.id]);
            applyCredits(db, invoiceId); // anything paid ahead is used first
            const no = db.one<{ invoice_no: string }>(`SELECT invoice_no FROM invoices WHERE id = ?`, [invoiceId])!;
            audit(db, actor, "create", "invoice", invoiceId, `Generated ${no.invoice_no} for ${span}`, {
              agreement: ag.agreement_no,
            });
            result.created.push(invoiceId);
          });
        } catch (err) {
          // the unique index caught a concurrent run — that is the guard working
          if (String(err).includes("UNIQUE")) result.skipped += 1;
          else throw err;
        }
      }
      if (exists) {
        db.run(`UPDATE agreements SET next_period_start = ?, updated_at = ? WHERE id = ?`, [next, nowIso(), ag.id]);
      }
      ag = db.one<AgreementRow>(`SELECT * FROM agreements WHERE id = ?`, [ag.id])!;
    }
  }
  return result;
}

// --------------------------------------------------------------- late fees

export function lateFeeFor(settings: Settings, balanceCents: number): number {
  if (!settings.late_fee_enabled) return 0;
  if (settings.late_fee_type === "percent") return Math.round((balanceCents * settings.late_fee_percent_bp) / 10000);
  return settings.late_fee_flat_cents;
}

/** One late fee per invoice, once it is past due + grace. Idempotent via late_fee_applied_at. */
export function applyLateFees(db: DB, opts: { asOf?: string; actor?: Actor } = {}): string[] {
  const asOf = opts.asOf ?? today();
  const settings = getSettings(db);
  if (!settings.late_fee_enabled) return [];
  const cutoff = addDays(asOf, -settings.late_fee_grace_days);
  const due = db.all<{ id: string; invoice_no: string; balance_cents: number }>(
    `SELECT id, invoice_no, balance_cents FROM invoices
      WHERE status IN ('open','partial') AND balance_cents > 0
        AND late_fee_applied_at IS NULL AND due_date < ?`,
    [cutoff],
  );
  const applied: string[] = [];
  for (const inv of due) {
    const fee = lateFeeFor(settings, inv.balance_cents);
    if (fee <= 0) continue;
    db.tx(() => {
      // re-check inside the transaction so two runs cannot both add a fee
      const changed = db.run(
        `UPDATE invoices SET late_fee_applied_at = ? WHERE id = ? AND late_fee_applied_at IS NULL`,
        [nowIso(), inv.id],
      ).changes;
      if (!changed) return;
      addLine(db, inv.id, {
        kind: "late_fee",
        description: `Late fee (unpaid ${settings.late_fee_grace_days} days after the due date)`,
        amount_cents: fee,
        taxable: false,
      });
      recalcInvoice(db, inv.id);
      audit(db, opts.actor ?? SYSTEM, "late_fee", "invoice", inv.id, `Late fee added to ${inv.invoice_no}`);
      applied.push(inv.id);
    });
  }
  return applied;
}

// ------------------------------------------------------------------ credits

export function creditBalance(db: DB, renterId: string): number {
  return db.num(`SELECT COALESCE(SUM(remaining_cents), 0) FROM credits WHERE renter_id = ?`, [renterId]);
}

/** Use the renter's available credit (oldest first) against an invoice. Returns cents applied. */
export function applyCredits(db: DB, invoiceId: string, maxCents?: number): number {
  return db.tx(() => {
    const inv = db.one<{ renter_id: string; balance_cents: number; status: string }>(
      `SELECT renter_id, balance_cents, status FROM invoices WHERE id = ?`,
      [invoiceId],
    );
    if (!inv || inv.status === "void" || inv.status === "draft") return 0;
    let room = Math.min(inv.balance_cents, maxCents ?? inv.balance_cents);
    let applied = 0;
    const credits = db.all<{ id: string; remaining_cents: number }>(
      `SELECT id, remaining_cents FROM credits WHERE renter_id = ? AND remaining_cents > 0 ORDER BY created_at`,
      [inv.renter_id],
    );
    for (const c of credits) {
      if (room <= 0) break;
      const use = Math.min(room, c.remaining_cents);
      db.run(`UPDATE credits SET remaining_cents = remaining_cents - ? WHERE id = ?`, [use, c.id]);
      db.run(
        `INSERT INTO credit_applications (id, credit_id, invoice_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)`,
        [id(), c.id, invoiceId, use, nowIso()],
      );
      room -= use;
      applied += use;
    }
    if (applied > 0) recalcInvoice(db, invoiceId);
    return applied;
  });
}

export function addManualCredit(db: DB, actor: Actor, renterId: string, cents: number, reason: string): string {
  const creditId = id();
  db.run(
    `INSERT INTO credits (id, renter_id, source, amount_cents, remaining_cents, reason, created_by, created_at)
     VALUES (?, ?, 'manual', ?, ?, ?, ?, ?)`,
    [creditId, renterId, cents, cents, reason, actor.id, nowIso()],
  );
  audit(db, actor, "credit", "renter", renterId, `Credit of ${(cents / 100).toFixed(2)} added — ${reason}`);
  return creditId;
}

// --------------------------------------------------------------------- void

export function voidInvoice(db: DB, actor: Actor, invoiceId: string, reason: string): void {
  db.tx(() => {
    const inv = db.one<{ invoice_no: string; paid_cents: number; credited_cents: number; status: string }>(
      `SELECT invoice_no, paid_cents, credited_cents, status FROM invoices WHERE id = ?`,
      [invoiceId],
    );
    if (!inv) throw new Error("Invoice not found.");
    if (inv.status === "void") return;
    if (inv.paid_cents > 0) {
      throw new Error("This invoice has payments against it. Refund or move them before voiding.");
    }
    // hand any applied credit back to the renter
    for (const app of db.all<{ id: string; credit_id: string; amount_cents: number }>(
      `SELECT id, credit_id, amount_cents FROM credit_applications WHERE invoice_id = ?`,
      [invoiceId],
    )) {
      db.run(`UPDATE credits SET remaining_cents = remaining_cents + ? WHERE id = ?`, [app.amount_cents, app.credit_id]);
      db.run(`DELETE FROM credit_applications WHERE id = ?`, [app.id]);
    }
    db.run(
      `UPDATE invoices SET status = 'void', voided_at = ?, void_reason = ?, balance_cents = 0, updated_at = ? WHERE id = ?`,
      [nowIso(), reason, nowIso(), invoiceId],
    );
    recalcInvoice(db, invoiceId);
    audit(db, actor, "void", "invoice", invoiceId, `Voided ${inv.invoice_no} — ${reason}`);
  });
}

/** Stored status + the derived "overdue". */
export function displayStatus(inv: { status: string; due_date: string; balance_cents: number }, asOf: string = today()): string {
  if ((inv.status === "open" || inv.status === "partial") && inv.balance_cents > 0 && inv.due_date < asOf) return "overdue";
  return inv.status;
}
