import Link from "next/link";
import Icon from "@/components/Icon";
import { Card, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { AutoSubmitForm } from "@/components/forms";
import { BarChart, LineChart } from "@/components/charts";
import { requireStaff } from "@/lib/auth";
import { availableYears, yearReport } from "@/lib/report-data";
import { EXPENSE_CATEGORIES } from "@/lib/maintenance";
import { label, UNIT_TYPES } from "@/lib/units";
import { monthLabel } from "@/lib/clock";
import { compactMoney, formatDate, money, percent, renterName } from "@/lib/format";
import { param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("reports.view");
  const query = await searchParams;
  const years = availableYears(ctx.db);
  const year = years.includes(Number(param(query, "year"))) ? Number(param(query, "year")) : years[0];
  const r = yearReport(ctx.db, ctx.facilityId, year);
  const cur = ctx.settings.base_currency;
  const facility = ctx.facilities.find((f) => f.id === ctx.facilityId);
  const receivable = r.aging.reduce((a, b) => a + b.cents, 0);
  const maxAging = Math.max(1, ...r.aging.map((b) => b.cents));
  const maxCat = Math.max(1, ...r.expenseCategories.map((c) => c.total));
  const maxType = Math.max(1, ...r.unitTypes.map((c) => c.total));
  const dl = (kind: string, format: string) => `/api/reports?year=${year}&kind=${kind}&format=${format}`;

  return (
    <>
      <PageHeader
        eyebrow={`Reports · ${facility ? facility.name : "All facilities"}`}
        title={`Financial report ${year}`}
        blurb="Revenue is what was invoiced for each period, net of discounts and excluding tax. Collected is money actually received. Security deposits are shown separately and are never revenue."
        actions={
          <>
            <AutoSubmitForm>
              <select name="year" defaultValue={String(year)} className="select w-auto" aria-label="Year">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </AutoSubmitForm>
            <a href={dl("monthly", "csv")} className="btn" download><Icon name="download" />CSV</a>
            <a href={dl("full", "pdf")} className="btn btn-primary" target="_blank"><Icon name="download" />PDF report</a>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard label="Revenue" value={compactMoney(r.totals.revenue, cur)} sub={`plus ${compactMoney(r.totals.tax, cur)} tax collected for the government`} tone="good" icon="chart" />
        <StatCard label="Expenses" value={compactMoney(r.totals.expenses, cur)} sub={`${r.expenseCategories.length} categories`} tone="neutral" icon="wallet" />
        <StatCard label="Profit" value={compactMoney(r.totals.profit, cur)} sub={r.totals.revenue ? `${percent(r.totals.profit / r.totals.revenue)} margin` : "revenue − expenses"} tone={r.totals.profit >= 0 ? "good" : "bad"} icon="scale" />
        <StatCard label="Operating cash flow" value={compactMoney(r.totals.netCash, cur)} sub="collected − refunds − expenses" tone={r.totals.netCash >= 0 ? "info" : "bad"} icon="bank" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mb-5 items-start">
        <Card title={`Revenue, expenses and profit by month — ${year}`} className="lg:col-span-2">
          <BarChart ariaLabel={`Monthly revenue, expenses and profit for ${year}`} currency={cur} height={260}
            series={[{ name: "Revenue", color: "var(--series-1)" }, { name: "Expenses", color: "var(--series-2)" }, { name: "Profit", color: "var(--series-3)" }]}
            data={r.months.map((m) => ({ label: m.label, note: monthLabel(m.key, true), values: [m.revenue, m.expenses, m.profit] }))} />
        </Card>

        <Card title="Occupancy trend">
          <LineChart ariaLabel={`Occupancy at each month end in ${year}`} format="percent" area height={200}
            series={[{ name: "Occupancy", color: "var(--series-1)" }]}
            data={r.months.filter((m) => m.occupied > 0 || m.key <= new Date().toISOString().slice(0, 7)).map((m) => ({ label: m.label, note: `${monthLabel(m.key, true)} · ${m.occupied} of ${m.units} units`, values: [m.occupancy] }))} />
          <p className="hint">Average for the year so far: {percent(r.totals.avgOccupancy)}.</p>
        </Card>

        <Card title="Revenue forecast — next 6 months">
          <BarChart ariaLabel="Forecast rent for the next six months, split into contracted and expected" currency={cur} height={200}
            series={[{ name: "Contracted (fixed term)", color: "var(--series-1)" }, { name: "Expected (month-to-month, renewals)", color: "var(--series-3)" }]}
            data={r.forecast.map((m) => ({ label: m.label.slice(0, 3), note: m.label, values: [m.contracted, m.expected] }))} />
          <p className="hint">From agreements already on the books, before tax. Fixed terms are committed; the rest can end with notice.</p>
        </Card>
      </div>

      <Card title="Month by month" dense className="mb-5" action={<a href={dl("monthly", "csv")} className="btn btn-ghost btn-sm" download>CSV</a>}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Month</th><th className="r">Revenue</th><th className="r">Expenses</th><th className="r">Profit</th><th className="r">Collected</th><th className="r">Refunds</th><th className="r">Net cash</th><th className="r">Deposits in</th><th className="r">Deposits out</th><th className="r">Occupancy</th></tr></thead>
            <tbody>
              {r.months.map((m) => (
                <tr key={m.key}>
                  <td className="primary">{monthLabel(m.key, true)}</td>
                  <td className="r num">{money(m.revenue, cur)}</td>
                  <td className="r num">{money(m.expenses, cur)}</td>
                  <td className="r num" style={{ color: m.profit < 0 ? "var(--bad-fg)" : undefined }}>{money(m.profit, cur)}</td>
                  <td className="r num">{money(m.collected, cur)}</td>
                  <td className="r num">{m.refunds ? money(m.refunds, cur) : "—"}</td>
                  <td className="r num" style={{ color: m.netCash < 0 ? "var(--bad-fg)" : undefined }}>{money(m.netCash, cur)}</td>
                  <td className="r num">{m.depositsIn ? money(m.depositsIn, cur) : "—"}</td>
                  <td className="r num">{m.depositsOut ? money(m.depositsOut, cur) : "—"}</td>
                  <td className="r num">{m.occupied ? percent(m.occupancy) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{year}</td><td className="r num">{money(r.totals.revenue, cur)}</td><td className="r num">{money(r.totals.expenses, cur)}</td><td className="r num">{money(r.totals.profit, cur)}</td>
                <td className="r num">{money(r.totals.collected, cur)}</td><td className="r num">{money(r.totals.refunds, cur)}</td><td className="r num">{money(r.totals.netCash, cur)}</td>
                <td className="r num">{money(r.totals.depositsIn, cur)}</td><td className="r num">{money(r.totals.depositsOut, cur)}</td><td className="r num">{percent(r.totals.avgOccupancy)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Card title={`Outstanding receivables — ${money(receivable, cur)}`} action={<a href={dl("aging", "csv")} className="btn btn-ghost btn-sm" download>CSV</a>}>
          <Bars rows={r.aging.map((b) => ({ label: b.label, value: b.cents, max: maxAging, note: `${b.count} ${b.count === 1 ? "invoice" : "invoices"}`, color: b.key === "current" ? "var(--series-1)" : b.key === "1-30" ? "var(--warn-fg)" : "var(--bad-fg)" }))} cur={cur} />
          {r.debtors.length > 0 && (
            <div className="hair mt-4 pt-3">
              <div className="eyebrow mb-2">Largest balances</div>
              <ul className="space-y-1.5 text-sm">
                {r.debtors.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate"><Link className="link" href={`/renters/${d.id}`}>{renterName(d)}</Link><span style={{ color: "var(--ink-3)" }}> · {d.invoices} inv. · oldest due {formatDate(d.oldest_due)}</span></span>
                    <span className="num font-semibold">{money(d.balance, cur)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card title={`Expenses by category — ${year}`}>
            {r.expenseCategories.length === 0 ? <EmptyState title="No expenses recorded" /> : <Bars rows={r.expenseCategories.map((c) => ({ label: label(EXPENSE_CATEGORIES, c.category), value: c.total, max: maxCat, note: `${c.n} entries`, color: "var(--series-2)" }))} cur={cur} />}
          </Card>
          <Card title={`Revenue by unit type — ${year}`}>
            {r.unitTypes.length === 0 ? <EmptyState title="No revenue yet" /> : <Bars rows={r.unitTypes.map((c) => ({ label: label(UNIT_TYPES, c.type), value: c.total, max: maxType, note: `${c.n} units`, color: "var(--series-1)" }))} cur={cur} />}
          </Card>
        </div>
      </div>
    </>
  );
}

/** Ranked horizontal bars with the value at the end of each row — the table and the chart in one. */
function Bars({ rows, cur }: { rows: { label: string; value: number; max: number; note: string; color: string }[]; cur: string }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
            <span>{r.label} <span className="text-xs" style={{ color: "var(--ink-3)" }}>· {r.note}</span></span>
            <span className="num font-semibold">{money(r.value, cur)}</span>
          </div>
          <div className="meter" style={{ height: 8 }}><span style={{ width: `${Math.max(r.value > 0 ? 1.5 : 0, (r.value / r.max) * 100)}%`, background: r.color, borderRadius: "0 4px 4px 0" }} /></div>
        </li>
      ))}
    </ul>
  );
}
