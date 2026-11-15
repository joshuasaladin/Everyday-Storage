import { id, type DB } from "./db";
import { audit, SYSTEM, type Actor } from "./audit";
import { addDays, addMonths, daysBetween, monthsBetween, nowIso, today } from "./clock";
import { randomToken, sha256 } from "./crypto";
import { generateDueInvoices } from "./billing";
import { syncUnitStatus } from "./units";
import { getSettings } from "./settings";
import { dims, formatDate, money, renterName } from "./format";

export const AGREEMENT_STATUSES = [
  { value: "pending_signature", label: "Awaiting signature", tone: "warn" },
  { value: "active", label: "Active", tone: "good" },
  { value: "ended", label: "Ended", tone: "muted" },
  { value: "cancelled", label: "Cancelled", tone: "muted" },
  { value: "draft", label: "Draft", tone: "neutral" },
] as const;

export const RENEWAL_OPTIONS = [
  { value: "month_to_month", label: "Continue month-to-month" },
  { value: "auto_renew", label: "Renew automatically for another term" },
  { value: "end", label: "End on the end date" },
];

export type AgreementInput = {
  facility_id: string;
  unit_id: string;
  renter_id: string;
  reservation_id?: string | null;
  term_type: "fixed" | "month_to_month";
  start_date: string;
  term_months: number | null;
  monthly_rate_cents: number;
  deposit_cents: number;
  discount_cents: number;
  discount_note: string | null;
  billing_mode: "anniversary" | "fixed_day";
  billing_day: number;
  prorate_first: number;
  renewal_option: "auto_renew" | "month_to_month" | "end";
  renewal_term_months: number | null;
  notice_days: number;
  notes: string | null;
};

export function endDateFor(start: string, termMonths: number): string {
  return addDays(addMonths(start, termMonths), -1);
}

/** Elapsed and remaining time on a contract, as of a given day. */
export function contractProgress(
  ag: { start_date: string; end_date: string | null; term_type: string; status: string; ended_at?: string | null; move_out_date?: string | null },
  asOf: string = today(),
) {
  const stop = ag.status === "ended" ? (ag.move_out_date ?? ag.ended_at?.slice(0, 10) ?? asOf) : asOf;
  const started = ag.start_date <= stop;
  const elapsedMonths = started ? monthsBetween(ag.start_date, stop) : 0;
  const elapsedDays = started ? daysBetween(ag.start_date, stop) : 0;
  let remainingMonths: number | null = null;
  let remainingDays: number | null = null;
  let pct: number | null = null;
  if (ag.end_date) {
    const afterEnd = addDays(ag.end_date, 1);
    remainingDays = Math.max(0, daysBetween(stop, afterEnd));
    remainingMonths = stop < afterEnd ? monthsBetween(stop, afterEnd) : 0;
    const total = Math.max(1, daysBetween(ag.start_date, afterEnd));
    pct = Math.min(1, Math.max(0, elapsedDays / total));
  }
  return { started, elapsedMonths, elapsedDays, remainingMonths, remainingDays, pct, startsIn: started ? 0 : daysBetween(asOf, ag.start_date) };
}

function termsFor(db: DB, input: AgreementInput, agreementNo: string): string {
  const s = getSettings(db);
  const unit = db.one<Record<string, any>>(`SELECT * FROM units WHERE id = ?`, [input.unit_id])!;
  const renter = db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [input.renter_id])!;
  const fac = db.one<Record<string, any>>(`SELECT * FROM facilities WHERE id = ?`, [input.facility_id])!;
  const end = input.term_type === "fixed" && input.term_months ? endDateFor(input.start_date, input.term_months) : null;
  const head = [
    `STORAGE RENTAL AGREEMENT ${agreementNo}`,
    ``,
    `Company: ${s.legal_name || s.business_name}, ${s.business_address}`,
    `Renter: ${renterName(renter)}${renter.address ? `, ${renter.address}` : ""}`,
    `Facility: ${fac.name}${fac.address ? `, ${fac.address}` : ""}`,
    `Unit: ${unit.unit_number} (${dims(unit)})`,
    `Term: ${input.term_type === "fixed" ? `Fixed, ${input.term_months} months — ${formatDate(input.start_date)} to ${formatDate(end)}` : `Month-to-month from ${formatDate(input.start_date)}`}`,
    `Monthly rent: ${money(input.monthly_rate_cents - input.discount_cents, s.base_currency)}${input.discount_cents ? ` (${money(input.monthly_rate_cents, s.base_currency)} less ${money(input.discount_cents, s.base_currency)} discount)` : ""}, plus applicable taxes`,
    `Security deposit: ${money(input.deposit_cents, s.base_currency)}`,
    `Notice period: ${input.notice_days} days`,
    `At the end of a fixed term: ${input.renewal_option === "auto_renew" ? `renews automatically for ${input.renewal_term_months ?? input.term_months} months` : input.renewal_option === "end" ? "the agreement ends" : "continues month-to-month"}`,
    ``,
  ];
  return `${head.join("\n")}${s.agreement_terms}`;
}

export function unitAvailableFor(db: DB, unitId: string, ignoreReservationId?: string | null): string | null {
  const unit = db.one<{ status: string; unit_number: string; offline: number }>(`SELECT status, unit_number, offline FROM units WHERE id = ?`, [unitId]);
  if (!unit) return "Choose a unit.";
  if (db.one(`SELECT 1 FROM agreements WHERE unit_id = ? AND status IN ('active','pending_signature')`, [unitId]))
    return `Unit ${unit.unit_number} is already under an agreement.`;
  if (unit.offline) return `Unit ${unit.unit_number} is switched offline.`;
  const hold = db.one<{ id: string; name: string }>(
    `SELECT id, name FROM reservations WHERE unit_id = ? AND status IN ('pending','confirmed')`,
    [unitId],
  );
  if (hold && hold.id !== ignoreReservationId) return `Unit ${unit.unit_number} is reserved for ${hold.name}.`;
  return null;
}

export function createAgreement(db: DB, actor: Actor, input: AgreementInput): string {
  return db.tx(() => {
    const blocker = unitAvailableFor(db, input.unit_id, input.reservation_id);
    if (blocker) throw new Error(blocker);
    const agId = id();
    const no = db.nextNumber("AGR", input.start_date.slice(0, 4));
    const end = input.term_type === "fixed" && input.term_months ? endDateFor(input.start_date, input.term_months) : null;
    const terms = termsFor(db, input, no);
    const stamp = nowIso();
    db.run(
      `INSERT INTO agreements (id, agreement_no, facility_id, unit_id, renter_id, reservation_id, term_type, start_date, end_date,
                               term_months, monthly_rate_cents, deposit_cents, discount_cents, discount_note, billing_mode,
                               billing_day, prorate_first, renewal_option, renewal_term_months, notice_days, status,
                               terms_snapshot, terms_sha256, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_signature', ?, ?, ?, ?, ?, ?)`,
      [
        agId, no, input.facility_id, input.unit_id, input.renter_id, input.reservation_id ?? null, input.term_type,
        input.start_date, end, input.term_type === "fixed" ? input.term_months : null, input.monthly_rate_cents,
        input.deposit_cents, input.discount_cents, input.discount_note, input.billing_mode, input.billing_day,
        input.prorate_first, input.term_type === "fixed" ? input.renewal_option : "month_to_month",
        input.renewal_term_months, input.notice_days, terms, sha256(terms), input.notes, actor.id, stamp, stamp,
      ],
    );
    if (input.reservation_id) {
      db.run(`UPDATE reservations SET status = 'converted', converted_agreement_id = ?, renter_id = ?, updated_at = ? WHERE id = ?`, [
        agId, input.renter_id, stamp, input.reservation_id,
      ]);
    }
    syncUnitStatus(db, input.unit_id);
    audit(db, actor, "create", "agreement", agId, `Created agreement ${no}`);
    return agId;
  });
}

/** A one-time link the renter can sign from. Only the hash is stored. */
export function issueSignLink(db: DB, actor: Actor, agreementId: string): string {
  const token = randomToken(24);
  db.run(`UPDATE agreements SET sign_token_hash = ?, sign_token_expires = ?, updated_at = ? WHERE id = ? AND status = 'pending_signature'`, [
    sha256(token), addDays(today(), 14), nowIso(), agreementId,
  ]);
  audit(db, actor, "sign_link", "agreement", agreementId, "Signing link issued");
  return token;
}

export function agreementBySignToken(db: DB, token: string) {
  const row = db.one<Record<string, any>>(`SELECT * FROM agreements WHERE sign_token_hash = ?`, [sha256(token)]);
  if (!row) return null;
  if (row.sign_token_expires && row.sign_token_expires < today()) return null;
  return row;
}

export type SignatureInput = {
  name: string;
  method: "e-sign" | "in-person" | "paper";
  signature_png?: string | null;
  ip?: string | null;
  user_agent?: string | null;
};

/**
 * Sign and activate. Records who signed, how, from where, and a hash of the
 * exact terms shown — then starts billing from the start date.
 */
export function signAgreement(db: DB, actor: Actor, agreementId: string, sig: SignatureInput): void {
  db.tx(() => {
    const ag = db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ?`, [agreementId]);
    if (!ag) throw new Error("Agreement not found.");
    if (ag.status !== "pending_signature") throw new Error("This agreement is not awaiting a signature.");
    if (!sig.name.trim()) throw new Error("Type the signer's full name.");
    if (sig.method !== "paper" && (!(sig.signature_png ?? "").startsWith("data:image/png;base64,") || (sig.signature_png ?? "").length < 600)) {
      throw new Error("Draw a signature in the box.");
    }
    if ((sig.signature_png?.length ?? 0) > 400_000) throw new Error("That signature image is too large.");
    const stamp = nowIso();
    db.run(
      `UPDATE agreements SET status = 'active', signed_at = ?, signed_name = ?, signed_method = ?, signature_png = ?,
              signed_ip = ?, signed_user_agent = ?, sign_token_hash = NULL, sign_token_expires = NULL,
              next_period_start = start_date, updated_at = ?
        WHERE id = ?`,
      [stamp, sig.name.trim(), sig.method, sig.signature_png ?? null, sig.ip ?? null, sig.user_agent?.slice(0, 300) ?? null, stamp, agreementId],
    );
    db.run(`UPDATE renters SET status = 'active', updated_at = ? WHERE id = ?`, [stamp, ag.renter_id]);
    syncUnitStatus(db, ag.unit_id);
    audit(db, actor, "sign", "agreement", agreementId, `${ag.agreement_no} signed by ${sig.name.trim()} (${sig.method})`, {
      terms_sha256: ag.terms_sha256,
    });
    generateDueInvoices(db, { agreementId, actor });
  });
}

export function cancelAgreement(db: DB, actor: Actor, agreementId: string, reason: string): void {
  db.tx(() => {
    const ag = db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ?`, [agreementId]);
    if (!ag || ag.status !== "pending_signature") throw new Error("Only an unsigned agreement can be cancelled. Use move-out for an active one.");
    db.run(`UPDATE agreements SET status = 'cancelled', ended_at = ?, ended_reason = ?, sign_token_hash = NULL, updated_at = ? WHERE id = ?`, [
      nowIso(), reason, nowIso(), agreementId,
    ]);
    syncUnitStatus(db, ag.unit_id);
    audit(db, actor, "cancel", "agreement", agreementId, `Cancelled ${ag.agreement_no} — ${reason}`);
  });
}

function settleRenter(db: DB, renterId: string) {
  const live = db.one(`SELECT 1 FROM agreements WHERE renter_id = ? AND status IN ('active','pending_signature') LIMIT 1`, [renterId]);
  db.run(`UPDATE renters SET status = ?, updated_at = ? WHERE id = ? AND status <> 'lead'`, [live ? "active" : "former", nowIso(), renterId]);
}

export function endAgreement(db: DB, actor: Actor, agreementId: string, reason: string, endedOn: string = today()): void {
  db.tx(() => {
    const ag = db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ?`, [agreementId]);
    if (!ag || ag.status !== "active") return;
    db.run(
      `UPDATE agreements SET status = 'ended', ended_at = ?, ended_reason = ?, next_period_start = NULL,
              move_out_date = COALESCE(move_out_date, ?), updated_at = ? WHERE id = ?`,
      [nowIso(), reason, endedOn, nowIso(), agreementId],
    );
    syncUnitStatus(db, ag.unit_id);
    settleRenter(db, ag.renter_id);
    audit(db, actor, "end", "agreement", agreementId, `${ag.agreement_no} ended — ${reason}`);
  });
}

/** Manual renewal: extend a fixed term (optionally at a new rate), or convert to a new fixed term. */
export function renewAgreement(db: DB, actor: Actor, agreementId: string, months: number, newRateCents: number | null, note: string | null): void {
  db.tx(() => {
    const ag = db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ?`, [agreementId]);
    if (!ag || ag.status !== "active") throw new Error("Only an active agreement can be renewed.");
    if (months < 1 || months > 120) throw new Error("Choose a renewal term between 1 and 120 months.");
    const from = ag.end_date && ag.end_date >= today() ? addDays(ag.end_date, 1) : today();
    const newEnd = endDateFor(from, months);
    db.run(
      `INSERT INTO agreement_renewals (id, agreement_id, kind, previous_end, new_end, previous_rate_cents, new_rate_cents, note, created_by, created_at)
       VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`,
      [id(), agreementId, ag.end_date, newEnd, ag.monthly_rate_cents, newRateCents ?? ag.monthly_rate_cents, note, actor.id, nowIso()],
    );
    db.run(
      `UPDATE agreements SET term_type = 'fixed', end_date = ?, term_months = ?, monthly_rate_cents = ?,
              renewal_requested_at = NULL, updated_at = ? WHERE id = ?`,
      [newEnd, months, newRateCents ?? ag.monthly_rate_cents, nowIso(), agreementId],
    );
    audit(db, actor, "renew", "agreement", agreementId, `${ag.agreement_no} renewed to ${formatDate(newEnd)}`);
  });
}

/**
 * What happens when a fixed term runs out — applied once the end date has
 * passed: renew for another term, roll to month-to-month, or end.
 */
export function processTermEnds(db: DB, asOf: string = today()): { renewed: number; rolled: number; ended: number } {
  const out = { renewed: 0, rolled: 0, ended: 0 };
  const due = db.all<Record<string, any>>(
    `SELECT * FROM agreements WHERE status = 'active' AND term_type = 'fixed' AND end_date IS NOT NULL AND end_date < ?`,
    [asOf],
  );
  for (const ag of due) {
    db.tx(() => {
      if (ag.move_out_date || ag.renewal_option === "end") {
        endAgreement(db, SYSTEM, ag.id, ag.move_out_date ? "Moved out" : "Fixed term completed", ag.move_out_date ?? ag.end_date);
        out.ended += 1;
      } else if (ag.renewal_option === "auto_renew") {
        const months = ag.renewal_term_months ?? ag.term_months ?? 12;
        const newEnd = endDateFor(addDays(ag.end_date, 1), months);
        db.run(
          `INSERT INTO agreement_renewals (id, agreement_id, kind, previous_end, new_end, previous_rate_cents, new_rate_cents, created_at)
           VALUES (?, ?, 'auto_renew', ?, ?, ?, ?, ?)`,
          [id(), ag.id, ag.end_date, newEnd, ag.monthly_rate_cents, ag.monthly_rate_cents, nowIso()],
        );
        db.run(`UPDATE agreements SET end_date = ?, updated_at = ? WHERE id = ?`, [newEnd, nowIso(), ag.id]);
        audit(db, SYSTEM, "renew", "agreement", ag.id, `${ag.agreement_no} renewed automatically to ${formatDate(newEnd)}`);
        out.renewed += 1;
      } else {
        db.run(
          `INSERT INTO agreement_renewals (id, agreement_id, kind, previous_end, new_end, previous_rate_cents, new_rate_cents, created_at)
           VALUES (?, ?, 'to_month_to_month', ?, NULL, ?, ?, ?)`,
          [id(), ag.id, ag.end_date, ag.monthly_rate_cents, ag.monthly_rate_cents, nowIso()],
        );
        db.run(`UPDATE agreements SET term_type = 'month_to_month', end_date = NULL, term_months = NULL, updated_at = ? WHERE id = ?`, [nowIso(), ag.id]);
        audit(db, SYSTEM, "renew", "agreement", ag.id, `${ag.agreement_no} continued month-to-month after its fixed term`);
        out.rolled += 1;
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------- move-outs

export const MOVE_OUT_STEPS = [
  { key: "step_notice", label: "Notice confirmed with the renter" },
  { key: "step_final_invoice", label: "Final invoice issued and settled" },
  { key: "step_inspection", label: "Unit inspected and empty" },
  { key: "step_lock_removed", label: "Lock removed, access revoked" },
  { key: "step_deposit", label: "Security deposit refunded or applied" },
] as const;

export function scheduleMoveOut(db: DB, actor: Actor, agreementId: string, date: string, requestedBy: "staff" | "renter", notes: string | null): string {
  return db.tx(() => {
    const ag = db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ?`, [agreementId]);
    if (!ag || ag.status !== "active") throw new Error("Only an active agreement can be moved out.");
    if (date < ag.start_date) throw new Error("The move-out date is before the agreement starts.");
    const existing = db.one<{ id: string }>(`SELECT id FROM move_outs WHERE agreement_id = ? AND status IN ('requested','scheduled')`, [agreementId]);
    const stamp = nowIso();
    const status = requestedBy === "renter" ? "requested" : "scheduled";
    let moId = existing?.id;
    if (moId) {
      db.run(`UPDATE move_outs SET move_out_date = ?, status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`, [date, status, notes, stamp, moId]);
    } else {
      moId = id();
      db.run(
        `INSERT INTO move_outs (id, agreement_id, move_out_date, status, requested_by, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [moId, agreementId, date, status, requestedBy, notes, stamp, stamp],
      );
    }
    if (status === "scheduled") {
      // billing stops at the move-out date; an already-invoiced later period is left for staff to credit
      db.run(`UPDATE agreements SET move_out_date = ?, updated_at = ? WHERE id = ?`, [date, stamp, agreementId]);
    }
    audit(db, actor, "move_out", "agreement", agreementId, `Move-out ${status} for ${formatDate(date)} (${ag.agreement_no})`);
    return moId;
  });
}

export function confirmMoveOut(db: DB, actor: Actor, moveOutId: string): void {
  db.tx(() => {
    const mo = db.one<Record<string, any>>(`SELECT * FROM move_outs WHERE id = ?`, [moveOutId]);
    if (!mo || mo.status !== "requested") return;
    db.run(`UPDATE move_outs SET status = 'scheduled', step_notice = 1, updated_at = ? WHERE id = ?`, [nowIso(), moveOutId]);
    db.run(`UPDATE agreements SET move_out_date = ?, updated_at = ? WHERE id = ?`, [mo.move_out_date, nowIso(), mo.agreement_id]);
    audit(db, actor, "move_out", "agreement", mo.agreement_id, `Move-out request confirmed for ${formatDate(mo.move_out_date)}`);
  });
}

export function cancelMoveOut(db: DB, actor: Actor, moveOutId: string): void {
  db.tx(() => {
    const mo = db.one<Record<string, any>>(`SELECT * FROM move_outs WHERE id = ?`, [moveOutId]);
    if (!mo || !["requested", "scheduled"].includes(mo.status)) return;
    db.run(`UPDATE move_outs SET status = 'cancelled', updated_at = ? WHERE id = ?`, [nowIso(), moveOutId]);
    const ag = db.one<Record<string, any>>(`SELECT * FROM agreements WHERE id = ?`, [mo.agreement_id])!;
    // resume billing from the day after the last invoiced period
    const lastEnd = db.one<{ e: string | null }>(
      `SELECT MAX(period_end) AS e FROM invoices WHERE agreement_id = ? AND kind = 'rent' AND status <> 'void'`,
      [mo.agreement_id],
    )?.e;
    db.run(`UPDATE agreements SET move_out_date = NULL, next_period_start = ?, updated_at = ? WHERE id = ? AND status = 'active'`, [
      lastEnd ? addDays(lastEnd, 1) : ag.start_date, nowIso(), mo.agreement_id,
    ]);
    audit(db, actor, "move_out", "agreement", mo.agreement_id, "Move-out cancelled");
  });
}

export function setMoveOutStep(db: DB, moveOutId: string, step: string, done: boolean): void {
  if (!MOVE_OUT_STEPS.some((s) => s.key === step)) throw new Error("Unknown step.");
  db.run(`UPDATE move_outs SET ${step} = ?, updated_at = ? WHERE id = ?`, [done ? 1 : 0, nowIso(), moveOutId]);
}

/** Close the move-out: ends the agreement and frees the unit. */
export function completeMoveOut(db: DB, actor: Actor, moveOutId: string): void {
  db.tx(() => {
    const mo = db.one<Record<string, any>>(`SELECT * FROM move_outs WHERE id = ?`, [moveOutId]);
    if (!mo || mo.status !== "scheduled") throw new Error("This move-out is not scheduled.");
    if (mo.move_out_date > today()) throw new Error("The move-out date has not arrived yet.");
    db.run(`UPDATE move_outs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), moveOutId]);
    endAgreement(db, actor, mo.agreement_id, "Moved out", mo.move_out_date);
  });
}
