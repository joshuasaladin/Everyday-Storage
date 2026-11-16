import Link from "next/link";
import Icon from "@/components/Icon";
import { Card, Chip, EmptyState, Notice, StatCard } from "@/components/ui";
import { BarChart, LineChart, SegmentBar } from "@/components/charts";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { dashboard, monthKeys, monthlySeries } from "@/lib/reports";
import { addMonths, daysBetween, monthLabel, startOfMonth, today } from "@/lib/clock";
import { compactMoney, formatDate, money, percent, renterName, timeAgo } from "@/lib/format";
import type { Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff();
  const query = await searchParams;
  const { db, facilityId, settings } = ctx;
  const cur = settings.base_currency;
  const money$ = can(ctx.user.role, "finance.view");
  const d = dashboard(db, facilityId);
  const t = today();
  const series = monthlySeries(db, monthKeys(addMonths(startOfMonth(t), -11).slice(0, 7), 12), facilityId);
  const facility = ctx.facilities.find((f) => f.id === facilityId);

  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "America/Aruba" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const activity = can(ctx.user.role, "audit.view")
    ? db.all<Record<string, any>>(`SELECT * FROM audit_log WHERE action <> 'login' ORDER BY at DESC LIMIT 7`)
    : [];
  const needsSetup = d.total === 0;

  return (
    <>
      <div className="mb-6">
        <div className="eyebrow mb-1">
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Aruba" })}
          {" · "}{facility ? facility.name : ctx.facilities.length > 1 ? "All facilities" : ctx.facilities[0]?.name}
        </div>
        <h1 className="page-title">{greeting}, {ctx.user.name.split(" ")[0]}</h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--ink-3)" }}>
          {needsSetup
            ? "Add your storage units to get started."
            : `${d.occupied} of ${d.total} units occupied${money$ && d.overdueCount ? ` · ${d.overdueCount} overdue ${d.overdueCount === 1 ? "invoice" : "invoices"} to chase` : ""}.`}
        </p>
      </div>

      {query.denied && <div className="mb-5"><Notice tone="warn">Your role does not have access to that page.</Notice></div>}

      {needsSetup && (
        <Card className="mb-6">
          <EmptyState
            title="No storage units yet"
            hint="Create your units, then add renters and agreements."
            action={can(ctx.user.role, "units.edit") ? <Link href="/units/new" className="btn btn-primary"><Icon name="plus" />Add the first unit</Link> : undefined}
          />
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <StatCard label="Occupancy" value={percent(d.occupancy)} sub={`${d.occupied} of ${d.total} units`} tone="good" icon="chart" href="/units?status=occupied" />
        <StatCard label="Available" value={d.available} sub="ready to rent" tone="good" icon="door" href="/units?status=available" />
        <StatCard label="Reserved" value={d.reserved} sub={`${d.holds} ${d.holds === 1 ? "hold" : "holds"} · ${d.waitlist} open ${d.waitlist === 1 ? "request" : "requests"}`} tone="warn" icon="bookmark" href="/reservations" />
        <StatCard label="Total units" value={d.total} sub={d.unavailable ? `${d.unavailable} offline` : "all in service"} tone="neutral" icon="building" href="/units" />
      </div>

      {money$ && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard label="Recurring monthly revenue" value={compactMoney(d.mrr, cur)} sub={d.potential ? `${percent(d.mrr / d.potential)} of ${compactMoney(d.potential, cur)} potential` : undefined} tone="good" icon="repeat" href="/agreements?status=active" />
          <StatCard label="Outstanding" value={compactMoney(d.outstanding, cur)} sub={`${d.outstandingCount} open ${d.outstandingCount === 1 ? "invoice" : "invoices"}`} tone={d.outstanding ? "warn" : "good"} icon="receipt" href="/invoices?status=unpaid" />
          <StatCard label="Overdue" value={compactMoney(d.overdue, cur)} sub={`${d.overdueCount} ${d.overdueCount === 1 ? "invoice" : "invoices"} past due`} tone={d.overdue ? "bad" : "good"} icon="alert" href="/invoices?status=overdue" />
          <StatCard label="Collected this month" value={compactMoney(d.collectedThisMonth, cur)} sub={`${compactMoney(d.depositsHeld, cur)} held in deposits`} tone="info" icon="card" href="/payments" />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5 mb-5 items-start">
        {money$ && (
          <Card title="Revenue and collections — last 12 months" className="lg:col-span-2" action={<Link href="/reports" className="btn btn-ghost btn-sm">Reports<Icon name="chevron" className="w-3 h-3" /></Link>}>
            <BarChart
              ariaLabel="Monthly invoiced revenue and money collected over the last 12 months"
              currency={cur}
              series={[{ name: "Invoiced revenue", color: "var(--series-1)" }, { name: "Collected", color: "var(--series-2)" }]}
              data={series.map((m) => ({ label: m.label, note: monthLabel(m.key, true), values: [m.revenue, m.collected] }))}
            />
          </Card>
        )}

        <Card title="Units by status" className={money$ ? "" : "lg:col-span-3"} action={<Link href="/map" className="btn btn-ghost btn-sm">Map<Icon name="chevron" className="w-3 h-3" /></Link>}>
          <SegmentBar
            parts={[
              { label: "Occupied", value: d.occupied, color: "var(--info-fg)" },
              { label: "Available", value: d.available, color: "var(--good-fg)" },
              { label: "Reserved", value: d.reserved, color: "var(--warn-fg)" },
              { label: "Unavailable", value: d.unavailable, color: "var(--muted-fg)" },
            ]}
          />
          <div className="hair mt-4 pt-4">
            <div className="eyebrow mb-2">Occupancy trend</div>
            <LineChart
              ariaLabel="Occupancy rate at each month end over the last 12 months"
              format="percent" height={150} area
              series={[{ name: "Occupancy", color: "var(--series-1)" }]}
              data={series.map((m) => ({ label: m.label, note: monthLabel(m.key, true), values: [m.occupancy] }))}
            />
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {money$ && (
          <Card title="Overdue invoices" dense action={<Link href="/invoices?status=overdue" className="btn btn-ghost btn-sm">All overdue<Icon name="chevron" className="w-3 h-3" /></Link>}>
            {d.overdueInvoices.length === 0 ? (
              <EmptyState title="Nothing is overdue" hint="Every issued invoice is paid or still within its due date." />
            ) : (
              <ul>
                {d.overdueInvoices.map((inv, i) => (
                  <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <div className="min-w-0 flex-1">
                      <Link href={`/invoices/${inv.id}`} className="link-ink text-sm font-medium">{inv.invoice_no}</Link>
                      <span className="text-sm" style={{ color: "var(--ink-3)" }}> · {renterName(inv)}{inv.unit_number ? ` · ${inv.unit_number}` : ""}</span>
                      <div className="text-xs" style={{ color: "var(--bad-fg)" }}>{daysBetween(inv.due_date, t)} days overdue</div>
                    </div>
                    <span className="text-sm font-semibold num">{money(inv.balance_cents, inv.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="Agreements ending in the next 60 days" dense action={can(ctx.user.role, "agreements.view") ? <Link href="/agreements?status=expiring" className="btn btn-ghost btn-sm">All<Icon name="chevron" className="w-3 h-3" /></Link> : undefined}>
          {d.expiring.length === 0 ? (
            <EmptyState title="No fixed terms ending soon" />
          ) : (
            <ul>
              {d.expiring.map((a, i) => {
                const left = daysBetween(t, a.end_date);
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                    <div className="min-w-0 flex-1">
                      <Link href={can(ctx.user.role, "agreements.view") ? `/agreements/${a.id}` : `/renters/${a.renter_id}`} className="link-ink text-sm font-medium">
                        Unit {a.unit_number} · {renterName(a)}
                      </Link>
                      <div className="text-xs" style={{ color: "var(--ink-3)" }}>
                        Ends {formatDate(a.end_date)} · {a.renewal_option === "auto_renew" ? "renews automatically" : a.renewal_option === "end" ? "ends, unit frees up" : "continues month-to-month"}
                      </div>
                    </div>
                    <Chip tone={left <= 14 ? "bad" : left <= 30 ? "warn" : "neutral"}>{left === 0 ? "today" : `${left} days`}</Chip>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Needs attention" dense>
          <ul>
            {[
              d.pendingSignatures > 0 && { href: "/agreements?status=pending_signature", icon: "pen", text: `${d.pendingSignatures} agreement${d.pendingSignatures === 1 ? "" : "s"} awaiting signature`, show: can(ctx.user.role, "agreements.view") },
              d.moveOuts.length > 0 && { href: "/agreements?status=moving_out", icon: "logout", text: `${d.moveOuts.length} move-out${d.moveOuts.length === 1 ? "" : "s"} in progress — next ${formatDate(d.moveOuts[0].move_out_date)}`, show: can(ctx.user.role, "agreements.view") },
              d.holds > 0 && { href: "/reservations", icon: "bookmark", text: `${d.holds} reservation hold${d.holds === 1 ? "" : "s"} to convert into agreements`, show: true },
              d.waitlist > 0 && { href: "/reservations?status=waitlist", icon: "clock", text: `${d.waitlist} open ${d.waitlist === 1 ? "request" : "requests"} from customers to match to a unit`, show: true },
            ].filter((x): x is { href: string; icon: string; text: string; show: boolean } => Boolean(x && x.show)).map((item, i) => (
              <li key={item.href} style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                <Link href={item.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--panel-2)]">
                  <Icon name={item.icon} className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{item.text}</span>
                  <Icon name="chevron" className="w-3 h-3" />
                </Link>
              </li>
            ))}
          </ul>
          {d.pendingSignatures + d.moveOuts.length + d.holds + d.waitlist === 0 && <EmptyState title="All clear" hint="No signatures, move-outs or holds waiting." />}
        </Card>

        {activity.length > 0 && (
          <Card title="Recent activity" dense action={<Link href="/audit" className="btn btn-ghost btn-sm">Audit log<Icon name="chevron" className="w-3 h-3" /></Link>}>
            <ul>
              {activity.map((e, i) => (
                <li key={e.id} className="px-4 py-2.5 text-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                  <span style={{ color: "var(--ink)" }}>{e.summary}</span>
                  <div className="text-xs" style={{ color: "var(--ink-3)" }}>{e.actor_name} · {timeAgo(e.at)}</div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
