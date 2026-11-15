import type { DB } from "./db";
import { addDays, addMonths, daysBetween, endOfMonth, monthLabel, startOfMonth, today } from "./clock";

/**
 * Every figure on the dashboard and in the reports comes from here.
 *
 * Definitions, used consistently:
 *   revenue    — invoiced charges net of discounts and goodwill credits,
 *                excluding tax, in the month of the billing period (accrual);
 *                plus any forfeited deposits
 *   collected  — money actually received, by date received (cash)
 *   deposits   — a liability ledger; never part of revenue or collected
 *   profit     — revenue − expenses
 *   net cash   — collected − refunds − expenses
 */
type Fac = string | null;
const fw = (facilityId: Fac, col = "facility_id") => (facilityId ? ` AND ${col} = ?` : "");
const fp = (facilityId: Fac) => (facilityId ? [facilityId] : []);

export type MonthRow = {
  key: string;
  label: string;
  revenue: number;
  tax: number;
  collected: number;
  refunds: number;
  expenses: number;
  profit: number;
  netCash: number;
  depositsIn: number;
  depositsOut: number;
  occupied: number;
  units: number;
  occupancy: number;
};

export function monthKeys(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonths(`${from}-01`, i).slice(0, 7));
}

function byMonth(db: DB, sql: string, params: unknown[]): Map<string, number> {
  return new Map(db.all<{ m: string; v: number }>(sql, params).map((r) => [r.m, Number(r.v ?? 0)]));
}

export function occupiedOn(db: DB, day: string, facilityId: Fac): number {
  return db.num(
    `SELECT COUNT(*) FROM agreements
      WHERE status IN ('active','ended') AND start_date <= ?
        AND (status = 'active' OR COALESCE(move_out_date, substr(ended_at, 1, 10)) > ?)${fw(facilityId)}`,
    [day, day, ...fp(facilityId)],
  );
}

export function monthlySeries(db: DB, keys: string[], facilityId: Fac): MonthRow[] {
  const f = fp(facilityId);
  const revenue = byMonth(db, `SELECT substr(COALESCE(period_start, issue_date), 1, 7) AS m, SUM(subtotal_cents - discount_cents) AS v FROM invoices WHERE status NOT IN ('void','draft')${fw(facilityId)} GROUP BY m`, f);
  const tax = byMonth(db, `SELECT substr(COALESCE(period_start, issue_date), 1, 7) AS m, SUM(tax_cents) AS v FROM invoices WHERE status NOT IN ('void','draft')${fw(facilityId)} GROUP BY m`, f);
  const goodwill = byMonth(
    db,
    `SELECT substr(COALESCE(i.period_start, i.issue_date), 1, 7) AS m, SUM(ca.amount_cents) AS v
       FROM credit_applications ca JOIN credits c ON c.id = ca.credit_id AND c.source = 'manual'
       JOIN invoices i ON i.id = ca.invoice_id WHERE i.status <> 'void'${fw(facilityId, "i.facility_id")} GROUP BY m`,
    f,
  );
  const forfeited = byMonth(db, `SELECT substr(txn_date, 1, 7) AS m, SUM(amount_cents) AS v FROM deposit_transactions WHERE type = 'forfeited'${fw(facilityId)} GROUP BY m`, f);
  const collected = byMonth(db, `SELECT substr(received_date, 1, 7) AS m, SUM(amount_cents) AS v FROM payments WHERE method <> 'deposit'${fw(facilityId)} GROUP BY m`, f);
  const refunds = byMonth(db, `SELECT substr(r.refund_date, 1, 7) AS m, SUM(r.amount_cents) AS v FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE 1 = 1${fw(facilityId, "p.facility_id")} GROUP BY m`, f);
  const expenses = byMonth(db, `SELECT substr(expense_date, 1, 7) AS m, SUM(amount_cents) AS v FROM expenses WHERE 1 = 1${fw(facilityId)} GROUP BY m`, f);
  const depIn = byMonth(db, `SELECT substr(txn_date, 1, 7) AS m, SUM(amount_cents) AS v FROM deposit_transactions WHERE type = 'collected'${fw(facilityId)} GROUP BY m`, f);
  const depOut = byMonth(db, `SELECT substr(txn_date, 1, 7) AS m, SUM(amount_cents) AS v FROM deposit_transactions WHERE type = 'refunded'${fw(facilityId)} GROUP BY m`, f);
  const units = db.num(`SELECT COUNT(*) FROM units WHERE 1 = 1${fw(facilityId)}`, f);
  const t = today();

  return keys.map((key) => {
    const end = endOfMonth(`${key}-01`);
    const day = end > t ? t : end;
    const future = `${key}-01` > t;
    const rev = (revenue.get(key) ?? 0) - (goodwill.get(key) ?? 0) + (forfeited.get(key) ?? 0);
    const exp = expenses.get(key) ?? 0;
    const col = collected.get(key) ?? 0;
    const ref = refunds.get(key) ?? 0;
    const occupied = future ? 0 : occupiedOn(db, day, facilityId);
    return {
      key, label: monthLabel(key), revenue: rev, tax: tax.get(key) ?? 0, collected: col, refunds: ref, expenses: exp,
      profit: rev - exp, netCash: col - ref - exp, depositsIn: depIn.get(key) ?? 0, depositsOut: depOut.get(key) ?? 0,
      occupied, units, occupancy: units ? occupied / units : 0,
    };
  });
}

export type AgingBucket = { key: string; label: string; cents: number; count: number };

export function aging(db: DB, facilityId: Fac, asOf: string = today()): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { key: "current", label: "Not yet due", cents: 0, count: 0 },
    { key: "1-30", label: "1–30 days", cents: 0, count: 0 },
    { key: "31-60", label: "31–60 days", cents: 0, count: 0 },
    { key: "61-90", label: "61–90 days", cents: 0, count: 0 },
    { key: "90+", label: "Over 90 days", cents: 0, count: 0 },
  ];
  for (const inv of db.all<{ due_date: string; balance_cents: number }>(
    `SELECT due_date, balance_cents FROM invoices WHERE status IN ('open','partial') AND balance_cents > 0${fw(facilityId)}`,
    fp(facilityId),
  )) {
    const over = daysBetween(inv.due_date, asOf);
    const b = over <= 0 ? buckets[0] : over <= 30 ? buckets[1] : over <= 60 ? buckets[2] : over <= 90 ? buckets[3] : buckets[4];
    b.cents += inv.balance_cents;
    b.count += 1;
  }
  return buckets;
}

export type ForecastRow = { key: string; label: string; contracted: number; expected: number; total: number; agreements: number };

/**
 * Rent expected over the coming months from agreements already on the books.
 * contracted = inside a fixed term; expected = month-to-month and renewals,
 * which the renter can still end with notice.
 */
export function forecast(db: DB, facilityId: Fac, months = 6): ForecastRow[] {
  const t = today();
  const ags = db.all<Record<string, any>>(
    `SELECT start_date, end_date, term_type, renewal_option, move_out_date, monthly_rate_cents, discount_cents
       FROM agreements WHERE status IN ('active','pending_signature')${fw(facilityId)}`,
    fp(facilityId),
  );
  return monthKeys(addMonths(startOfMonth(t), 1).slice(0, 7), months).map((key) => {
    const start = `${key}-01`;
    const end = endOfMonth(start);
    let contracted = 0;
    let expected = 0;
    let n = 0;
    for (const a of ags) {
      const last = a.move_out_date ?? (a.term_type === "fixed" && a.renewal_option === "end" ? a.end_date : null);
      if (a.start_date > end || (last && last < start)) continue;
      const net = a.monthly_rate_cents - a.discount_cents;
      n += 1;
      if (a.term_type === "fixed" && a.end_date && a.end_date >= end) contracted += net;
      else expected += net;
    }
    return { key, label: monthLabel(key, true), contracted, expected, total: contracted + expected, agreements: n };
  });
}

export function expensesByCategory(db: DB, facilityId: Fac, from: string, to: string) {
  return db.all<{ category: string; total: number; n: number }>(
    `SELECT category, SUM(amount_cents) AS total, COUNT(*) AS n FROM expenses
      WHERE expense_date BETWEEN ? AND ?${fw(facilityId)} GROUP BY category ORDER BY total DESC`,
    [from, to, ...fp(facilityId)],
  );
}

export function revenueByUnitType(db: DB, facilityId: Fac, from: string, to: string) {
  return db.all<{ type: string; total: number; n: number }>(
    `SELECT COALESCE(u.type, 'other') AS type, SUM(i.subtotal_cents - i.discount_cents) AS total, COUNT(DISTINCT i.unit_id) AS n
       FROM invoices i LEFT JOIN units u ON u.id = i.unit_id
      WHERE i.status NOT IN ('void','draft') AND COALESCE(i.period_start, i.issue_date) BETWEEN ? AND ?${fw(facilityId, "i.facility_id")}
      GROUP BY type ORDER BY total DESC`,
    [from, to, ...fp(facilityId)],
  );
}

export function topDebtors(db: DB, facilityId: Fac, limit = 8) {
  return db.all<Record<string, any>>(
    `SELECT r.id, r.first_name, r.last_name, r.company, r.kind, SUM(i.balance_cents) AS balance, COUNT(*) AS invoices,
            MIN(i.due_date) AS oldest_due
       FROM invoices i JOIN renters r ON r.id = i.renter_id
      WHERE i.status IN ('open','partial') AND i.balance_cents > 0${fw(facilityId, "i.facility_id")}
      GROUP BY r.id ORDER BY balance DESC LIMIT ?`,
    [...fp(facilityId), limit],
  );
}

export function dashboard(db: DB, facilityId: Fac) {
  const t = today();
  const f = fp(facilityId);
  const counts = Object.fromEntries(
    db.all<{ status: string; c: number }>(`SELECT status, COUNT(*) AS c FROM units WHERE 1 = 1${fw(facilityId)} GROUP BY status`, f).map((r) => [r.status, r.c]),
  ) as Record<string, number>;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const occupied = counts.occupied ?? 0;
  const monthStart = startOfMonth(t);
  return {
    total,
    occupied,
    available: counts.available ?? 0,
    reserved: counts.reserved ?? 0,
    maintenance: counts.maintenance ?? 0,
    unavailable: counts.unavailable ?? 0,
    occupancy: total ? occupied / total : 0,
    mrr: db.num(`SELECT COALESCE(SUM(monthly_rate_cents - discount_cents), 0) FROM agreements WHERE status = 'active' AND start_date <= ?${fw(facilityId)}`, [t, ...f]),
    potential: db.num(`SELECT COALESCE(SUM(monthly_price_cents), 0) FROM units WHERE 1 = 1${fw(facilityId)}`, f),
    outstanding: db.num(`SELECT COALESCE(SUM(balance_cents), 0) FROM invoices WHERE status IN ('open','partial')${fw(facilityId)}`, f),
    outstandingCount: db.num(`SELECT COUNT(*) FROM invoices WHERE status IN ('open','partial') AND balance_cents > 0${fw(facilityId)}`, f),
    overdue: db.num(`SELECT COALESCE(SUM(balance_cents), 0) FROM invoices WHERE status IN ('open','partial') AND due_date < ?${fw(facilityId)}`, [t, ...f]),
    overdueCount: db.num(`SELECT COUNT(*) FROM invoices WHERE status IN ('open','partial') AND balance_cents > 0 AND due_date < ?${fw(facilityId)}`, [t, ...f]),
    collectedThisMonth: db.num(`SELECT COALESCE(SUM(amount_cents - refunded_cents), 0) FROM payments WHERE method <> 'deposit' AND received_date >= ?${fw(facilityId)}`, [monthStart, ...f]),
    depositsHeld: db.num(`SELECT COALESCE(SUM(CASE WHEN type = 'collected' THEN amount_cents ELSE -amount_cents END), 0) FROM deposit_transactions WHERE 1 = 1${fw(facilityId)}`, f),
    pendingSignatures: db.num(`SELECT COUNT(*) FROM agreements WHERE status = 'pending_signature'${fw(facilityId)}`, f),
    openTickets: db.num(`SELECT COUNT(*) FROM maintenance_tickets WHERE status NOT IN ('done','cancelled')${fw(facilityId)}`, f),
    waitlist: db.num(`SELECT COUNT(*) FROM reservations WHERE status = 'waitlist'${fw(facilityId)}`, f),
    holds: db.num(`SELECT COUNT(*) FROM reservations WHERE status IN ('pending','confirmed')${fw(facilityId)}`, f),
    expiring: db.all<Record<string, any>>(
      `SELECT a.id, a.agreement_no, a.end_date, a.renewal_option, a.monthly_rate_cents, u.unit_number,
              r.id AS renter_id, r.first_name, r.last_name, r.company, r.kind
         FROM agreements a JOIN units u ON u.id = a.unit_id JOIN renters r ON r.id = a.renter_id
        WHERE a.status = 'active' AND a.term_type = 'fixed' AND a.end_date BETWEEN ? AND ?${fw(facilityId, "a.facility_id")}
        ORDER BY a.end_date LIMIT 8`,
      [t, addDays(t, 60), ...f],
    ),
    moveOuts: db.all<Record<string, any>>(
      `SELECT m.id, m.move_out_date, m.status, a.id AS agreement_id, a.agreement_no, u.unit_number,
              r.first_name, r.last_name, r.company, r.kind
         FROM move_outs m JOIN agreements a ON a.id = m.agreement_id JOIN units u ON u.id = a.unit_id JOIN renters r ON r.id = a.renter_id
        WHERE m.status IN ('requested','scheduled')${fw(facilityId, "a.facility_id")} ORDER BY m.move_out_date LIMIT 6`,
      f,
    ),
    overdueInvoices: db.all<Record<string, any>>(
      `SELECT i.id, i.invoice_no, i.due_date, i.balance_cents, i.currency, u.unit_number,
              r.id AS renter_id, r.first_name, r.last_name, r.company, r.kind
         FROM invoices i JOIN renters r ON r.id = i.renter_id LEFT JOIN units u ON u.id = i.unit_id
        WHERE i.status IN ('open','partial') AND i.balance_cents > 0 AND i.due_date < ?${fw(facilityId, "i.facility_id")}
        ORDER BY i.due_date LIMIT 8`,
      [t, ...f],
    ),
  };
}
