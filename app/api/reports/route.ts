import { NextResponse } from "next/server";
import { csvResponse, pdfResponse } from "@/lib/api";
import { getCtx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { monthLabel } from "@/lib/clock";
import { csv$, toCsv } from "@/lib/csv";
import { can } from "@/lib/roles";
import { reportPdf, type ReportTable } from "@/lib/pdf";
import { availableYears, yearReport } from "@/lib/report-data";
import { EXPENSE_CATEGORIES } from "@/lib/maintenance";
import { label, UNIT_TYPES } from "@/lib/units";
import { money, percent, renterName } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx || ctx.user.role === "renter") return new NextResponse("Not signed in", { status: 401 });
  if (!can(ctx.user.role, "reports.view")) return new NextResponse("Not permitted", { status: 403 });
  const q = new URL(req.url).searchParams;
  const years = availableYears(ctx.db);
  const year = years.includes(Number(q.get("year"))) ? Number(q.get("year")) : years[0];
  const r = yearReport(ctx.db, ctx.facilityId, year);
  const cur = ctx.settings.base_currency;
  const scopeName = ctx.facilities.find((f) => f.id === ctx.facilityId)?.name ?? "All facilities";
  audit(ctx.db, ctx.actor, "export", "report", null, `Downloaded the ${year} ${q.get("kind") ?? "full"} report (${q.get("format") ?? "pdf"})`);

  if (q.get("format") === "csv") {
    if (q.get("kind") === "aging") {
      return csvResponse(toCsv(["Bucket", "Invoices", `Amount (${cur})`], r.aging.map((b) => [b.label, b.count, csv$(b.cents)])), `receivables-aging-${year}.csv`);
    }
    return csvResponse(
      toCsv(
        ["Month", "Revenue", "Tax", "Expenses", "Profit", "Collected", "Refunds", "Net operating cash", "Deposits collected", "Deposits refunded", "Occupied units", "Total units", "Occupancy %"],
        r.months.map((m) => [m.key, csv$(m.revenue), csv$(m.tax), csv$(m.expenses), csv$(m.profit), csv$(m.collected), csv$(m.refunds), csv$(m.netCash), csv$(m.depositsIn), csv$(m.depositsOut), m.occupied, m.units, (m.occupancy * 100).toFixed(1)]),
      ),
      `financial-report-${year}.csv`,
    );
  }

  const $ = (c: number) => money(c, cur);
  const tables: ReportTable[] = [
    {
      title: "Summary",
      columns: ["Measure", "Amount"],
      rows: [
        ["Revenue (invoiced, net of discounts, excl. tax)", $(r.totals.revenue)], ["Expenses", $(r.totals.expenses)], ["Profit", $(r.totals.profit)],
        ["Collected", $(r.totals.collected)], ["Refunds", $(r.totals.refunds)], ["Operating cash flow", $(r.totals.netCash)],
        ["Tax invoiced", $(r.totals.tax)], ["Security deposits collected (liability)", $(r.totals.depositsIn)], ["Security deposits refunded", $(r.totals.depositsOut)],
        ["Average occupancy", percent(r.totals.avgOccupancy)],
      ],
    },
    {
      title: "Month by month",
      columns: ["Month", "Revenue", "Expenses", "Profit", "Collected", "Net cash", "Occupancy"],
      rows: r.months.map((m) => [monthLabel(m.key, true), $(m.revenue), $(m.expenses), $(m.profit), $(m.collected), $(m.netCash), m.occupied ? percent(m.occupancy) : "-"]),
    },
    { title: "Outstanding receivables", columns: ["Age", "Invoices", "Amount"], rows: r.aging.map((b) => [b.label, b.count, $(b.cents)]) },
    { title: "Largest balances", columns: ["Renter", "Invoices", "Balance"], rows: r.debtors.map((d) => [renterName(d), d.invoices, $(d.balance)]) },
    { title: "Revenue forecast (next 6 months)", columns: ["Month", "Contracted", "Expected", "Total"], rows: r.forecast.map((f) => [f.label, $(f.contracted), $(f.expected), $(f.total)]) },
    { title: "Expenses by category", columns: ["Category", "Entries", "Amount"], rows: r.expenseCategories.map((c) => [label(EXPENSE_CATEGORIES, c.category), c.n, $(c.total)]) },
    { title: "Revenue by unit type", columns: ["Unit type", "Units", "Revenue"], rows: r.unitTypes.map((c) => [label(UNIT_TYPES, c.type), c.n, $(c.total)]) },
  ].filter((t) => t.rows.length > 0);

  return pdfResponse(await reportPdf(ctx.db, `Financial report ${year}`, scopeName, tables), `financial-report-${year}.pdf`);
}
