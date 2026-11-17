import { id, type DB } from "./db";
import { audit, type Actor } from "./audit";
import { nowIso, today } from "./clock";
import { recalcInvoice } from "./billing";

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "check", label: "Cheque" },
  { value: "online", label: "Online payment" },
  { value: "other", label: "Other" },
];

export class PaymentError extends Error {
  constructor(
    message: string,
    public code: "duplicate" | "possible_duplicate" | "invalid" = "invalid",
  ) {
    super(message);
  }
}

export type PaymentInput = {
  renter_id: string;
  amount_cents: number;
  method: string;
  received_date: string;
  reference?: string | null;
  notes?: string | null;
  /** invoices to pay first, in order; whatever is left flows to the oldest open invoices */
  invoice_ids?: string[];
  /** when false, only invoice_ids are paid and the rest becomes credit */
  spill?: boolean;
  idempotency_key?: string | null;
  confirm_duplicate?: boolean;
  tendered_currency?: string | null;
  tendered_cents?: number | null;
  fx_rate?: number | null;
  gateway?: string | null;
  gateway_ref?: string | null;
  facility_id?: string | null;
};

export type PaymentResult = { payment_id: string; payment_no: string; duplicate: boolean; credit_cents: number };

/**
 * Book money actually received and allocate it to invoices.
 *
 * Three guards against booking the same money twice:
 *   1. idempotency_key — a double-submitted form returns the first payment
 *   2. unique (method, reference) — the same bank/cheque reference is refused
 *   3. same renter + amount + date + method — refused until explicitly confirmed
 */
export function recordPayment(db: DB, actor: Actor, input: PaymentInput): PaymentResult {
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
    throw new PaymentError("Enter an amount greater than zero.");
  }
  if (input.received_date > today() && !input.gateway) {
    throw new PaymentError("A payment cannot be dated in the future.");
  }
  const reference = input.reference?.trim() || null;

  return db.tx(() => {
    if (input.idempotency_key) {
      const prior = db.one<{ id: string; payment_no: string }>(
        `SELECT id, payment_no FROM payments WHERE idempotency_key = ?`,
        [input.idempotency_key],
      );
      if (prior) return { payment_id: prior.id, payment_no: prior.payment_no, duplicate: true, credit_cents: 0 };
    }
    if (input.gateway_ref) {
      const prior = db.one<{ id: string; payment_no: string }>(
        `SELECT id, payment_no FROM payments WHERE gateway = ? AND gateway_ref = ?`,
        [input.gateway ?? "", input.gateway_ref],
      );
      if (prior) return { payment_id: prior.id, payment_no: prior.payment_no, duplicate: true, credit_cents: 0 };
    }
    if (reference && input.method !== "cash") {
      const clash = db.one<{ payment_no: string }>(
        `SELECT payment_no FROM payments WHERE method = ? AND reference = ?`,
        [input.method, reference],
      );
      if (clash) {
        throw new PaymentError(
          `Reference "${reference}" is already booked as ${clash.payment_no}. The same payment cannot be recorded twice.`,
          "duplicate",
        );
      }
    }
    if (!input.confirm_duplicate && !input.gateway_ref) {
      const twin = db.one<{ payment_no: string }>(
        `SELECT payment_no FROM payments
          WHERE renter_id = ? AND amount_cents = ? AND received_date = ? AND method = ? AND status <> 'refunded'`,
        [input.renter_id, input.amount_cents, input.received_date, input.method],
      );
      if (twin) {
        throw new PaymentError(
          `${twin.payment_no} already records the same amount from this renter on this date by this method. Tick "This is a separate payment" to book it anyway.`,
          "possible_duplicate",
        );
      }
    }

    // which invoices this money goes to
    const targets: { id: string; balance_cents: number; facility_id: string }[] = [];
    const seen = new Set<string>();
    for (const invId of input.invoice_ids ?? []) {
      const inv = db.one<{ id: string; balance_cents: number; facility_id: string; renter_id: string; status: string }>(
        `SELECT id, balance_cents, facility_id, renter_id, status FROM invoices WHERE id = ?`,
        [invId],
      );
      if (!inv || inv.renter_id !== input.renter_id) throw new PaymentError("That invoice does not belong to this renter.");
      if (inv.status === "void" || inv.status === "draft") throw new PaymentError("That invoice is not open for payment.");
      if (inv.balance_cents > 0 && !seen.has(inv.id)) {
        targets.push(inv);
        seen.add(inv.id);
      }
    }
    if (input.spill !== false) {
      for (const inv of db.all<{ id: string; balance_cents: number; facility_id: string }>(
        `SELECT id, balance_cents, facility_id FROM invoices
          WHERE renter_id = ? AND status IN ('open','partial') AND balance_cents > 0
          ORDER BY due_date, created_at`,
        [input.renter_id],
      )) {
        if (!seen.has(inv.id)) {
          targets.push(inv);
          seen.add(inv.id);
        }
      }
    }

    const facilityId =
      input.facility_id ??
      targets[0]?.facility_id ??
      db.one<{ facility_id: string }>(
        `SELECT facility_id FROM agreements WHERE renter_id = ? ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`,
        [input.renter_id],
      )?.facility_id ??
      db.one<{ id: string }>(`SELECT id FROM facilities ORDER BY created_at LIMIT 1`)?.id;
    if (!facilityId) throw new PaymentError("No facility to book this payment under.");

    const paymentId = id();
    const no = db.nextNumber("PAY", input.received_date.slice(0, 4));
    const stamp = nowIso();
    db.run(
      `INSERT INTO payments (id, payment_no, facility_id, renter_id, received_date, amount_cents, method, reference,
                             tendered_currency, tendered_cents, fx_rate, gateway, gateway_ref, idempotency_key, notes,
                             created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paymentId, no, facilityId, input.renter_id, input.received_date, input.amount_cents, input.method, reference,
        input.tendered_currency ?? null, input.tendered_cents ?? null, input.fx_rate ?? null,
        input.gateway ?? null, input.gateway_ref ?? null, input.idempotency_key ?? null, input.notes ?? null,
        actor.id, stamp, stamp,
      ],
    );

    let left = input.amount_cents;
    for (const inv of targets) {
      if (left <= 0) break;
      const use = Math.min(left, inv.balance_cents);
      db.run(
        `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)`,
        [id(), paymentId, inv.id, use, stamp],
      );
      recalcInvoice(db, inv.id);
      left -= use;
    }
    if (left > 0) {
      // no credit is held for anyone: a payment can only cover what is actually owed
      const owed = input.amount_cents - left;
      throw new PaymentError(
        owed > 0
          ? `That is ${(left / 100).toFixed(2)} more than this renter owes (${(owed / 100).toFixed(2)}). Enter ${(owed / 100).toFixed(2)} or less.`
          : "This renter has no unpaid invoices to put this payment against.",
      );
    }
    audit(db, actor, "create", "payment", paymentId, `Recorded ${no} — ${(input.amount_cents / 100).toFixed(2)} by ${input.method}`, {
      reference,
      credit_cents: left,
    });
    return { payment_id: paymentId, payment_no: no, duplicate: false, credit_cents: left };
  });
}

/**
 * Refund part or all of a payment. The money is taken back in this order:
 * unallocated credit from the payment, credit from it already used on other
 * invoices, then its own invoice allocations (newest first) — and every
 * affected invoice re-opens by exactly the amount unwound.
 */
export function refundPayment(
  db: DB,
  actor: Actor,
  input: { payment_id: string; amount_cents: number; refund_date: string; method: string; reference?: string | null; reason?: string | null },
): string {
  return db.tx(() => {
    const pay = db.one<{ payment_no: string; amount_cents: number; refunded_cents: number; method: string }>(
      `SELECT payment_no, amount_cents, refunded_cents, method FROM payments WHERE id = ?`,
      [input.payment_id],
    );
    if (!pay) throw new PaymentError("Payment not found.");
    if (pay.method === "deposit") throw new PaymentError("A deposit applied to an invoice is reversed from the deposit ledger, not refunded here.");
    const refundable = pay.amount_cents - pay.refunded_cents;
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) throw new PaymentError("Enter a refund amount greater than zero.");
    if (input.amount_cents > refundable) throw new PaymentError(`Only ${(refundable / 100).toFixed(2)} of this payment can still be refunded.`);

    let left = input.amount_cents;
    const touched = new Set<string>();

    for (const c of db.all<{ id: string; remaining_cents: number }>(
      `SELECT id, remaining_cents FROM credits WHERE payment_id = ? AND remaining_cents > 0`,
      [input.payment_id],
    )) {
      if (left <= 0) break;
      const take = Math.min(left, c.remaining_cents);
      db.run(`UPDATE credits SET remaining_cents = remaining_cents - ?, amount_cents = MAX(amount_cents - ?, 1) WHERE id = ?`, [take, take, c.id]);
      left -= take;
    }
    if (left > 0) {
      for (const app of db.all<{ id: string; invoice_id: string; amount_cents: number }>(
        `SELECT ca.id, ca.invoice_id, ca.amount_cents FROM credit_applications ca
           JOIN credits c ON c.id = ca.credit_id WHERE c.payment_id = ? ORDER BY ca.created_at DESC`,
        [input.payment_id],
      )) {
        if (left <= 0) break;
        const take = Math.min(left, app.amount_cents);
        if (take === app.amount_cents) db.run(`DELETE FROM credit_applications WHERE id = ?`, [app.id]);
        else db.run(`UPDATE credit_applications SET amount_cents = amount_cents - ? WHERE id = ?`, [take, app.id]);
        touched.add(app.invoice_id);
        left -= take;
      }
    }
    if (left > 0) {
      for (const al of db.all<{ id: string; invoice_id: string; amount_cents: number }>(
        `SELECT id, invoice_id, amount_cents FROM payment_allocations WHERE payment_id = ? ORDER BY created_at DESC, rowid DESC`,
        [input.payment_id],
      )) {
        if (left <= 0) break;
        const take = Math.min(left, al.amount_cents);
        if (take === al.amount_cents) db.run(`DELETE FROM payment_allocations WHERE id = ?`, [al.id]);
        else db.run(`UPDATE payment_allocations SET amount_cents = amount_cents - ? WHERE id = ?`, [take, al.id]);
        touched.add(al.invoice_id);
        left -= take;
      }
    }
    for (const invId of touched) recalcInvoice(db, invId);

    const refundId = id();
    db.run(
      `INSERT INTO refunds (id, payment_id, refund_date, amount_cents, method, reference, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [refundId, input.payment_id, input.refund_date, input.amount_cents, input.method, input.reference ?? null, input.reason ?? null, actor.id, nowIso()],
    );
    const refunded = pay.refunded_cents + input.amount_cents;
    db.run(`UPDATE payments SET refunded_cents = ?, status = ?, updated_at = ? WHERE id = ?`, [
      refunded,
      refunded >= pay.amount_cents ? "refunded" : "partially_refunded",
      nowIso(),
      input.payment_id,
    ]);
    audit(db, actor, "refund", "payment", input.payment_id, `Refunded ${(input.amount_cents / 100).toFixed(2)} of ${pay.payment_no}`, {
      reason: input.reason,
    });
    return refundId;
  });
}

export function reconcilePayments(db: DB, actor: Actor, paymentIds: string[], statementRef: string | null): number {
  let n = 0;
  db.tx(() => {
    for (const pid of paymentIds) {
      n += db.run(
        `UPDATE payments SET reconciled_at = ?, reconciled_by = ?, statement_ref = ?, updated_at = ?
          WHERE id = ? AND reconciled_at IS NULL`,
        [nowIso(), actor.name, statementRef, nowIso(), pid],
      ).changes;
    }
    if (n) audit(db, actor, "reconcile", "payment", null, `Reconciled ${n} payment${n === 1 ? "" : "s"}${statementRef ? ` against ${statementRef}` : ""}`);
  });
  return n;
}

export function unreconcile(db: DB, actor: Actor, paymentId: string): void {
  db.run(`UPDATE payments SET reconciled_at = NULL, reconciled_by = NULL, statement_ref = NULL, updated_at = ? WHERE id = ?`, [nowIso(), paymentId]);
  audit(db, actor, "unreconcile", "payment", paymentId, "Reconciliation removed");
}

// ----------------------------------------------------------------- deposits

export function depositHeld(db: DB, agreementId: string): number {
  return db.num(
    `SELECT COALESCE(SUM(CASE WHEN type = 'collected' THEN amount_cents ELSE -amount_cents END), 0)
       FROM deposit_transactions WHERE agreement_id = ?`,
    [agreementId],
  );
}

export type DepositInput = {
  agreement_id: string;
  type: "collected" | "refunded" | "applied" | "forfeited";
  amount_cents: number;
  txn_date: string;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  idempotency_key?: string | null;
};

/**
 * The deposit ledger. A deposit is money held for the renter — a liability —
 * so collecting it creates no invoice and no payment. It only becomes revenue
 * if it is applied to an unpaid invoice or forfeited.
 */
export function recordDeposit(db: DB, actor: Actor, input: DepositInput): string {
  if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) throw new PaymentError("Enter an amount greater than zero.");
  return db.tx(() => {
    if (input.idempotency_key) {
      const prior = db.one<{ id: string }>(`SELECT id FROM deposit_transactions WHERE idempotency_key = ?`, [input.idempotency_key]);
      if (prior) return prior.id;
    }
    const ag = db.one<{ renter_id: string; facility_id: string; agreement_no: string }>(
      `SELECT renter_id, facility_id, agreement_no FROM agreements WHERE id = ?`,
      [input.agreement_id],
    );
    if (!ag) throw new PaymentError("Agreement not found.");
    const held = depositHeld(db, input.agreement_id);
    if (input.type !== "collected" && input.amount_cents > held) {
      throw new PaymentError(`Only ${(held / 100).toFixed(2)} is held on deposit for this agreement.`);
    }

    let paymentId: string | null = null;
    if (input.type === "applied") {
      const owed = db.num(
        `SELECT COALESCE(SUM(balance_cents), 0) FROM invoices WHERE renter_id = ? AND status IN ('open','partial')`,
        [ag.renter_id],
      );
      if (input.amount_cents > owed) {
        throw new PaymentError(`The renter only owes ${(owed / 100).toFixed(2)}. Apply that much and refund the rest.`);
      }
      const own = db
        .all<{ id: string }>(
          `SELECT id FROM invoices WHERE agreement_id = ? AND status IN ('open','partial') ORDER BY due_date`,
          [input.agreement_id],
        )
        .map((r) => r.id);
      paymentId = recordPayment(db, actor, {
        renter_id: ag.renter_id,
        amount_cents: input.amount_cents,
        method: "deposit",
        received_date: input.txn_date,
        notes: `Security deposit applied (${ag.agreement_no})`,
        invoice_ids: own,
        confirm_duplicate: true,
        facility_id: ag.facility_id,
      }).payment_id;
    }

    const txnId = id();
    db.run(
      `INSERT INTO deposit_transactions (id, facility_id, agreement_id, renter_id, type, amount_cents, txn_date, method,
                                         reference, payment_id, notes, idempotency_key, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txnId, ag.facility_id, input.agreement_id, ag.renter_id, input.type, input.amount_cents, input.txn_date,
        input.method ?? null, input.reference?.trim() || null, paymentId, input.notes ?? null,
        input.idempotency_key ?? null, actor.id, nowIso(),
      ],
    );
    audit(db, actor, "deposit", "agreement", input.agreement_id, `Deposit ${input.type}: ${(input.amount_cents / 100).toFixed(2)} (${ag.agreement_no})`);
    return txnId;
  });
}

export function renterBalance(db: DB, renterId: string): { outstanding: number; overdue: number; credit: number; deposits: number } {
  const t = today();
  return {
    outstanding: db.num(`SELECT COALESCE(SUM(balance_cents), 0) FROM invoices WHERE renter_id = ? AND status IN ('open','partial')`, [renterId]),
    overdue: db.num(`SELECT COALESCE(SUM(balance_cents), 0) FROM invoices WHERE renter_id = ? AND status IN ('open','partial') AND due_date < ?`, [renterId, t]),
    credit: db.num(`SELECT COALESCE(SUM(remaining_cents), 0) FROM credits WHERE renter_id = ?`, [renterId]),
    deposits: db.num(
      `SELECT COALESCE(SUM(CASE WHEN type = 'collected' THEN amount_cents ELSE -amount_cents END), 0)
         FROM deposit_transactions WHERE renter_id = ?`,
      [renterId],
    ),
  };
}

// ------------------------------------------------------------ tick as paid

const MARK = "markpaid:";

/**
 * "Paid" ticked on an invoice: books one payment for the whole balance, dated
 * today unless given, with the method chosen in Settings. Ticking twice books
 * nothing more (idempotency key per invoice and balance).
 */
export function markInvoicePaid(db: DB, actor: Actor, invoiceId: string, method: string, date: string = today()): PaymentResult {
  const inv = db.one<{ renter_id: string; balance_cents: number; paid_cents: number; status: string; invoice_no: string; facility_id: string }>(
    `SELECT renter_id, balance_cents, paid_cents, status, invoice_no, facility_id FROM invoices WHERE id = ?`,
    [invoiceId],
  );
  if (!inv) throw new PaymentError("Invoice not found.");
  if (inv.status === "void") throw new PaymentError("A void invoice cannot be paid.");
  if (inv.balance_cents <= 0) throw new PaymentError("This invoice is already paid.");
  return db.tx(() => {
    const r = recordPayment(db, actor, {
      renter_id: inv.renter_id, amount_cents: inv.balance_cents, method, received_date: date,
      invoice_ids: [invoiceId], spill: false, confirm_duplicate: true, facility_id: inv.facility_id,
      idempotency_key: `${MARK}${invoiceId}:${inv.paid_cents}`, notes: `Ticked as paid on ${inv.invoice_no}`,
    });
    // confirmed by the person ticking it, so there is nothing left to match against a statement
    db.run(`UPDATE payments SET reconciled_at = ?, reconciled_by = ?, statement_ref = 'Ticked as paid' WHERE id = ? AND reconciled_at IS NULL`, [nowIso(), actor.name, r.payment_id]);
    return r;
  });
}

/** Untick: removes the payment(s) that ticking created. Payments entered any other way are left alone. */
export function unmarkInvoicePaid(db: DB, actor: Actor, invoiceId: string): number {
  return db.tx(() => {
    const inv = db.one<{ invoice_no: string }>(`SELECT invoice_no FROM invoices WHERE id = ?`, [invoiceId]);
    if (!inv) throw new PaymentError("Invoice not found.");
    const ticked = db.all<{ id: string; payment_no: string; refunded_cents: number }>(
      `SELECT id, payment_no, refunded_cents FROM payments WHERE idempotency_key LIKE ?`,
      [`${MARK}${invoiceId}:%`],
    );
    if (!ticked.length) {
      throw new PaymentError("This invoice was paid through a recorded payment, not by ticking it. Open the payment to change it.");
    }
    if (ticked.some((p) => p.refunded_cents > 0)) throw new PaymentError("Part of that payment was refunded, so it cannot simply be unticked.");
    for (const p of ticked) {
      db.run(`DELETE FROM payment_allocations WHERE payment_id = ?`, [p.id]);
      db.run(`DELETE FROM payments WHERE id = ?`, [p.id]);
    }
    recalcInvoice(db, invoiceId);
    audit(db, actor, "unpaid", "invoice", invoiceId, `${inv.invoice_no} unticked — removed ${ticked.map((p) => p.payment_no).join(", ")}`);
    return ticked.length;
  });
}
