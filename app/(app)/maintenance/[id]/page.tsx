import Link from "next/link";
import { notFound } from "next/navigation";
import TicketForm from "@/components/TicketForm";
import { Card, Chip, Detail, EmptyState, Field, PageHeader, StatusChip } from "@/components/ui";
import { ModalForm } from "@/components/forms";
import { DocumentsPanel, HistoryPanel } from "@/components/panels";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { saveExpenseAction } from "@/lib/actions/billing";
import { EXPENSE_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/maintenance";
import { today } from "@/lib/clock";
import { formatDate, formatDateTime, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("maintenance.view");
  const { id } = await params;
  const { db } = ctx;
  const m = db.one<Record<string, any>>(
    `SELECT m.*, u.unit_number, f.name AS facility_name, us.name AS assignee FROM maintenance_tickets m JOIN facilities f ON f.id = m.facility_id
       LEFT JOIN units u ON u.id = m.unit_id LEFT JOIN users us ON us.id = m.assigned_to WHERE m.id = ?`,
    [id],
  );
  if (!m) notFound();
  const edit = can(ctx.user.role, "maintenance.edit");
  const money$ = can(ctx.user.role, "finance.view");
  const cur = ctx.settings.base_currency;
  const expenses = money$ ? db.all<Record<string, any>>(`SELECT * FROM expenses WHERE maintenance_id = ? ORDER BY expense_date DESC`, [id]) : [];
  const staff = db.all<{ id: string; name: string }>(`SELECT id, name FROM users WHERE role <> 'renter' AND status = 'active' ORDER BY name`);
  const units = db.all<Record<string, any>>(`SELECT id, unit_number FROM units WHERE facility_id = ? ORDER BY unit_number`, [m.facility_id]);
  const t = today();

  return (
    <>
      <PageHeader
        eyebrow={`${m.ticket_no} · ${m.facility_name}`}
        title={<span className="flex flex-wrap items-center gap-3">{m.title} <StatusChip list={TICKET_STATUSES} value={m.status} /></span>}
        back={{ href: "/maintenance", label: "Maintenance" }}
      />
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <Card title="Ticket">
            {edit ? (
              <TicketForm ticket={m} units={units.map((u) => ({ id: u.id, label: u.unit_number }))} staff={staff} facilities={ctx.facilities} facilityId={m.facility_id} />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Detail label="Details">{m.description}</Detail>
                <Detail label="Resolution">{m.resolution}</Detail>
              </div>
            )}
          </Card>
          <DocumentsPanel db={db} entity="maintenance" entityId={id} canEdit={edit} />
        </div>
        <div className="space-y-5">
          <Card title="At a glance">
            <div className="grid grid-cols-2 gap-4">
              <Detail label="Unit">{m.unit_id ? <Link className="link" href={`/units/${m.unit_id}`}>{m.unit_number}</Link> : "Facility-wide"}</Detail>
              <Detail label="Priority"><StatusChip list={TICKET_PRIORITIES} value={m.priority} /></Detail>
              <Detail label="Assigned to">{m.assignee ?? "Unassigned"}</Detail>
              <Detail label="Due">{m.due_date ? formatDate(m.due_date) : null}</Detail>
              <Detail label="Reported">{formatDate(m.created_at)} · {m.reported_by}</Detail>
              <Detail label="Completed">{m.completed_at ? formatDateTime(m.completed_at) : null}</Detail>
            </div>
            {m.unit_unavailable && !["done", "cancelled"].includes(m.status) ? <div className="mt-4"><Chip tone="bad">Unit {m.unit_number} is off the market until this is closed</Chip></div> : null}
          </Card>

          {money$ && (
            <Card title={`Costs — ${money(expenses.reduce((a, e) => a + e.amount_cents, 0), cur)}`} dense
              action={can(ctx.user.role, "finance.edit") ? (
                <ModalForm label="Add cost" title="Add a cost to this ticket" action={saveExpenseAction} className="btn btn-ghost btn-sm" icon="plus" submit="Save expense">
                  <input type="hidden" name="maintenance_id" value={id} />
                  <input type="hidden" name="facility_id" value={m.facility_id} />
                  {m.unit_id && <input type="hidden" name="unit_id" value={m.unit_id} />}
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Date"><input className="input" type="date" name="expense_date" defaultValue={t} required /></Field>
                    <Field label={`Amount (${cur})`}><input className="input" name="amount" inputMode="decimal" placeholder="0.00" required /></Field>
                    <Field label="Category"><select className="select" name="category" defaultValue="maintenance">{EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
                    <Field label="Vendor"><input className="input" name="vendor" maxLength={120} /></Field>
                    <Field label="Description" className="col-span-2"><input className="input" name="description" required maxLength={200} defaultValue={m.title} /></Field>
                  </div>
                </ModalForm>
              ) : undefined}>
              {expenses.length === 0 ? <EmptyState title="No costs recorded" /> : (
                <ul>
                  {expenses.map((e, i) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                      <div className="flex-1 min-w-0"><span className="text-sm font-medium">{e.description}</span><div className="text-xs" style={{ color: "var(--ink-3)" }}>{formatDate(e.expense_date)}{e.vendor ? ` · ${e.vendor}` : ""}</div></div>
                      <span className="text-sm font-semibold num">{money(e.amount_cents, cur)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <HistoryPanel db={db} entity="maintenance" entityId={id} />
        </div>
      </div>
    </>
  );
}
