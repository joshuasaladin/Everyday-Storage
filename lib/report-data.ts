import type { DB } from "./db";
import { today } from "./clock";
import { aging, forecast, monthKeys, monthlySeries, revenueByUnitType, topDebtors } from "./reports";

/** One place that assembles a year's report, so the page, the CSV and the PDF always agree. */
export function yearReport(db: DB, facilityId: string | null, year: number) {
  const t = today();
  const months = monthlySeries(db, monthKeys(`${year}-01`, 12), facilityId);
  const upTo = year === Number(t.slice(0, 4)) ? t.slice(0, 7) : `${year}-12`;
  const elapsed = months.filter((m) => m.key <= upTo);
  const sum = (k: "revenue" | "tax" | "collected" | "refunds" | "netCash" | "depositsIn" | "depositsOut") => months.reduce((a, m) => a + m[k], 0);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return {
    year,
    months,
    totals: {
      revenue: sum("revenue"), tax: sum("tax"), collected: sum("collected"), refunds: sum("refunds"), netCash: sum("netCash"), depositsIn: sum("depositsIn"), depositsOut: sum("depositsOut"),
      avgOccupancy: elapsed.length ? elapsed.reduce((a, m) => a + m.occupancy, 0) / elapsed.length : 0,
    },
    aging: aging(db, facilityId, t),
    forecast: forecast(db, facilityId, 6),
    unitTypes: revenueByUnitType(db, facilityId, from, to),
    debtors: topDebtors(db, facilityId),
  };
}

export function availableYears(db: DB): number[] {
  const first = db.one<{ y: string | null }>(
    `SELECT MIN(y) AS y FROM (SELECT MIN(substr(issue_date, 1, 4)) AS y FROM invoices UNION ALL SELECT MIN(substr(received_date, 1, 4)) FROM payments)`,
  )?.y;
  const now = Number(today().slice(0, 4));
  const start = first ? Number(first) : now;
  return Array.from({ length: now - start + 1 }, (_, i) => now - i);
}
