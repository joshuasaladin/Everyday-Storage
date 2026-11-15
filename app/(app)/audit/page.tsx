import { Card, EmptyState, PageHeader } from "@/components/ui";
import { exportUrl, Pager, Toolbar } from "@/components/table";
import { requireStaff } from "@/lib/auth";
import { formatDateTime, titleCase } from "@/lib/format";
import { like, listParams, param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

const LINKS: Record<string, string> = { unit: "/units", renter: "/renters", agreement: "/agreements", invoice: "/invoices", payment: "/payments", maintenance: "/maintenance" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("audit.view");
  const query = await searchParams;
  const list = listParams(query, { at: "at" }, "at", "desc", 100);
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  for (const key of ["entity", "action"] as const) if (param(query, key)) { where.push(`${key} = ?`); params.push(param(query, key)); }
  if (param(query, "from")) { where.push("at >= ?"); params.push(param(query, "from")); }
  if (param(query, "to")) { where.push("at <= ?"); params.push(`${param(query, "to")}T23:59:59Z`); }
  if (list.q) { where.push(`(summary LIKE ? ESCAPE '\\' OR actor_name LIKE ? ESCAPE '\\')`); params.push(like(list.q), like(list.q)); }
  const total = ctx.db.num(`SELECT COUNT(*) FROM audit_log WHERE ${where.join(" AND ")}`, params);
  const rows = ctx.db.all<Record<string, any>>(`SELECT * FROM audit_log WHERE ${where.join(" AND ")} ORDER BY at DESC LIMIT ? OFFSET ?`, [...params, list.limit, list.offset]);
  const entities = ctx.db.all<{ entity: string }>(`SELECT DISTINCT entity FROM audit_log ORDER BY entity`).map((e) => ({ value: e.entity, label: titleCase(e.entity) }));
  const actions = ctx.db.all<{ action: string }>(`SELECT DISTINCT action FROM audit_log ORDER BY action`).map((e) => ({ value: e.action, label: titleCase(e.action) }));

  return (
    <>
      <PageHeader eyebrow="Admin" title="Audit log" blurb="Who did what, and when. Entries are written by the system as things happen and cannot be edited or removed from the app." />
      <Toolbar query={query} placeholder="Search the log…" exportHref={exportUrl("audit", query)} filters={[{ name: "entity", label: "Record", options: entities }, { name: "action", label: "Action", options: actions }]}>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}>From<input type="date" name="from" defaultValue={param(query, "from")} className="input w-auto" /></label>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-3)" }}>To<input type="date" name="to" defaultValue={param(query, "to")} className="input w-auto" /></label>
      </Toolbar>
      <Card dense>
        {rows.length === 0 ? <EmptyState title="No entries match" /> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>What happened</th><th>Record</th><th>From</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{formatDateTime(e.at)}</td>
                    <td className="whitespace-nowrap">{e.actor_name}<div className="text-xs" style={{ color: "var(--ink-3)" }}>{e.actor_role}</div></td>
                    <td className="primary" style={{ fontWeight: 500 }}>{e.summary}</td>
                    <td>{LINKS[e.entity] && e.entity_id ? <a className="link" href={`${LINKS[e.entity]}/${e.entity_id}`}>{titleCase(e.entity)}</a> : titleCase(e.entity)}<div className="text-xs" style={{ color: "var(--ink-3)" }}>{titleCase(e.action)}</div></td>
                    <td className="text-xs">{e.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager base="/audit" query={query} list={list} total={total} />
      </Card>
    </>
  );
}
