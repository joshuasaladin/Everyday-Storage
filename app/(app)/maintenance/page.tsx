import Link from "next/link";
import Icon from "@/components/Icon";
import TicketForm from "@/components/TicketForm";
import { Card, Chip, EmptyState, PageHeader, StatusChip, Tabs } from "@/components/ui";
import { InlineSelect } from "@/components/forms";
import { exportUrl, Pager, SortTh, Toolbar } from "@/components/table";
import { requireStaff, scope } from "@/lib/auth";
import { can } from "@/lib/roles";
import { ticketStatusAction } from "@/lib/actions/ops";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/maintenance";
import { label } from "@/lib/units";
import { today } from "@/lib/clock";
import { formatDate, money } from "@/lib/format";
import { like, listParams, param, withQuery, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maintenance" };

const SORT = { ticket: "m.ticket_no", priority: "CASE m.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END", due: "COALESCE(m.due_date, '9999')", opened: "m.created_at", status: "m.status" };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("maintenance.view");
  const query = await searchParams;
  const { db } = ctx;
  const list = listParams(query, SORT, "priority");
  const s = scope(ctx, "m.facility_id");
  const view = param(query, "view") || "open";
  const edit = can(ctx.user.role, "maintenance.edit");
  const money$ = can(ctx.user.role, "finance.view");
  const t = today();
  const where: string[] = [view === "open" ? "m.status NOT IN ('done','cancelled')" : view === "closed" ? "m.status IN ('done','cancelled')" : "1 = 1"];
  const params: unknown[] = [];
  for (const [key, col] of [["priority", "m.priority"], ["category", "m.category"], ["assignee", "m.assigned_to"]] as const) {
    if (param(query, key)) { where.push(`${col} = ?`); params.push(param(query, key)); }
  }
  if (list.q) { where.push(`(m.title LIKE ? ESCAPE '\\' OR m.ticket_no LIKE ? ESCAPE '\\' OR u.unit_number LIKE ? ESCAPE '\\')`); params.push(...Array(3).fill(like(list.q))); }
  const from = `FROM maintenance_tickets m JOIN facilities f ON f.id = m.facility_id LEFT JOIN units u ON u.id = m.unit_id LEFT JOIN users us ON us.id = m.assigned_to WHERE ${where.join(" AND ")}${s.sql}`;
  const all = [...params, ...s.params];
  const total = db.num(`SELECT COUNT(*) ${from}`, all);
  const rows = db.all<Record<string, any>>(
    `SELECT m.*, u.unit_number, f.name AS facility_name, us.name AS assignee,
            (SELECT COALESCE(SUM(amount_cents), 0) FROM expenses e WHERE e.maintenance_id = m.id) AS cost
     ${from} ORDER BY ${list.orderBy}, m.created_at DESC LIMIT ? OFFSET ?`,
    [...all, list.limit, list.offset],
  );
  const staff = db.all<{ id: string; name: string }>(`SELECT id, name FROM users WHERE role <> 'renter' AND status = 'active' ORDER BY name`);
  const us = scope(ctx, "u.facility_id");
  const units = db.all<Record<string, any>>(`SELECT u.id, u.unit_number, f.name AS facility FROM units u JOIN facilities f ON f.id = u.facility_id WHERE 1 = 1${us.sql} ORDER BY f.name, u.unit_number`, us.params);
  const blocked = db.num(`SELECT COUNT(*) FROM units u WHERE u.status = 'maintenance'${us.sql}`, us.params);
  const tab = (key: string) => withQuery("/maintenance", query, { view: key === "open" ? null : key, page: null, new: null });
  const cur = ctx.settings.base_currency;

  return (
    <>
      <PageHeader eyebrow="Operations" title="Maintenance" blurb={`Repairs and upkeep, who is on them and what they cost.${blocked ? ` ${blocked} unit${blocked === 1 ? " is" : "s are"} currently off the market for maintenance.` : ""}`}
        actions={edit && <Link href="/maintenance?new=1" className="btn btn-primary"><Icon name="plus" />New ticket</Link>} />

      {param(query, "new") && edit && (
        <Card title="New maintenance ticket" className="mb-5">
          <TicketForm units={units.map((u) => ({ id: u.id, label: ctx.facilities.length > 1 ? `${u.unit_number} · ${u.facility}` : u.unit_number }))} staff={staff} facilities={ctx.facilities} facilityId={ctx.facilityId} defaultUnit={param(query, "unit") || undefined} cancelHref="/maintenance" />
        </Card>
      )}

      <Tabs active={view} tabs={[
        { key: "open", label: "Open", href: tab("open"), count: db.num(`SELECT COUNT(*) FROM maintenance_tickets m WHERE m.status NOT IN ('done','cancelled')${s.sql}`, s.params) },
        { key: "closed", label: "Closed", href: tab("closed") },
        { key: "all", label: "All", href: tab("all") },
      ]} />
      <Toolbar query={query} keep={["view"]} placeholder="Search tickets or units…" exportHref={exportUrl("maintenance", query)}
        filters={[
          { name: "priority", label: "Priority", options: TICKET_PRIORITIES },
          { name: "category", label: "Category", options: TICKET_CATEGORIES },
          { name: "assignee", label: "Assigned", options: staff.map((u) => ({ value: u.id, label: u.name })) },
        ]} />
      <Card dense>
        {rows.length === 0 ? <EmptyState title={view === "open" ? "No open tickets" : "No tickets match"} hint={view === "open" ? "Everything is in working order." : undefined} /> : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="ticket" label="Ticket" base="/maintenance" query={query} list={list} />
                  <th>Unit</th>
                  <SortTh col="priority" label="Priority" base="/maintenance" query={query} list={list} />
                  <SortTh col="status" label="Status" base="/maintenance" query={query} list={list} />
                  <th>Assigned</th>
                  <SortTh col="due" label="Due" base="/maintenance" query={query} list={list} />
                  {money$ && <th className="r">Cost</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const late = m.due_date && m.due_date < t && !["done", "cancelled"].includes(m.status);
                  return (
                    <tr key={m.id}>
                      <td className="primary">
                        <Link href={`/maintenance/${m.id}`} className="link-ink">{m.title}</Link>
                        <div className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{m.ticket_no} · {label(TICKET_CATEGORIES, m.category)}{ctx.facilities.length > 1 ? ` · ${m.facility_name}` : ""}</div>
                      </td>
                      <td>{m.unit_id ? <Link className="link" href={`/units/${m.unit_id}`}>{m.unit_number}</Link> : <span style={{ color: "var(--ink-3)" }}>Facility</span>}{m.unit_unavailable && !["done", "cancelled"].includes(m.status) ? <div className="mt-1"><Chip tone="bad">blocks renting</Chip></div> : null}</td>
                      <td><StatusChip list={TICKET_PRIORITIES} value={m.priority} /></td>
                      <td>{edit ? <InlineSelect action={ticketStatusAction} name="status" value={m.status} fields={{ id: m.id }} options={TICKET_STATUSES.map((x) => ({ value: x.value, label: x.label }))} ariaLabel={`Status of ${m.ticket_no}`} /> : <StatusChip list={TICKET_STATUSES} value={m.status} />}</td>
                      <td>{m.assignee ?? <span style={{ color: "var(--ink-3)" }}>Unassigned</span>}</td>
                      <td className="whitespace-nowrap" style={late ? { color: "var(--bad-fg)", fontWeight: 600 } : undefined}>{m.due_date ? formatDate(m.due_date) : "—"}{late ? " · late" : ""}</td>
                      {money$ && <td className="r num">{m.cost ? money(m.cost, cur) : "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager base="/maintenance" query={query} list={list} total={total} />
      </Card>
    </>
  );
}
