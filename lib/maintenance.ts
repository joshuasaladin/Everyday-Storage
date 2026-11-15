import { id, type DB } from "./db";
import { audit, type Actor } from "./audit";
import { nowIso, today } from "./clock";
import { syncUnitStatus } from "./units";

export const TICKET_STATUSES = [
  { value: "open", label: "Open", tone: "warn" },
  { value: "in_progress", label: "In progress", tone: "info" },
  { value: "waiting", label: "Waiting on parts", tone: "neutral" },
  { value: "done", label: "Done", tone: "good" },
  { value: "cancelled", label: "Cancelled", tone: "muted" },
] as const;

export const TICKET_PRIORITIES = [
  { value: "low", label: "Low", tone: "muted" },
  { value: "normal", label: "Normal", tone: "neutral" },
  { value: "high", label: "High", tone: "warn" },
  { value: "urgent", label: "Urgent", tone: "bad" },
] as const;

export const TICKET_CATEGORIES = [
  { value: "general", label: "General" },
  { value: "door", label: "Door / lock" },
  { value: "electrical", label: "Electrical / lighting" },
  { value: "leak", label: "Leak / water" },
  { value: "pest", label: "Pest control" },
  { value: "cleaning", label: "Cleaning" },
  { value: "security", label: "Security / cameras" },
  { value: "grounds", label: "Grounds / gate" },
];

export const EXPENSE_CATEGORIES = [
  { value: "utilities", label: "Utilities" },
  { value: "maintenance", label: "Repairs & maintenance" },
  { value: "insurance", label: "Insurance" },
  { value: "security", label: "Security" },
  { value: "payroll", label: "Payroll" },
  { value: "marketing", label: "Marketing" },
  { value: "supplies", label: "Supplies" },
  { value: "software", label: "Software & fees" },
  { value: "rent_lease", label: "Land lease / rent" },
  { value: "taxes", label: "Taxes & permits" },
  { value: "other", label: "Other" },
];

export type TicketInput = {
  facility_id: string;
  unit_id: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  unit_unavailable: number;
  due_date: string | null;
  resolution?: string | null;
};

export function createTicket(db: DB, actor: Actor, input: TicketInput): string {
  return db.tx(() => {
    const ticketId = id();
    const no = db.nextNumber("MT", today().slice(0, 4));
    const stamp = nowIso();
    db.run(
      `INSERT INTO maintenance_tickets (id, ticket_no, facility_id, unit_id, title, description, category, priority, status,
                                        assigned_to, unit_unavailable, due_date, reported_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketId, no, input.facility_id, input.unit_id, input.title, input.description, input.category, input.priority,
        input.status, input.assigned_to, input.unit_unavailable, input.due_date, actor.name, stamp, stamp,
      ],
    );
    syncUnitStatus(db, input.unit_id);
    audit(db, actor, "create", "maintenance", ticketId, `Opened ${no} — ${input.title}`);
    return ticketId;
  });
}

export function updateTicket(db: DB, actor: Actor, ticketId: string, input: TicketInput): void {
  db.tx(() => {
    const before = db.one<Record<string, any>>(`SELECT * FROM maintenance_tickets WHERE id = ?`, [ticketId]);
    if (!before) throw new Error("Ticket not found.");
    const closing = (input.status === "done" || input.status === "cancelled") && !before.completed_at;
    const reopening = input.status !== "done" && input.status !== "cancelled";
    db.run(
      `UPDATE maintenance_tickets SET unit_id = ?, title = ?, description = ?, category = ?, priority = ?, status = ?,
              assigned_to = ?, unit_unavailable = ?, due_date = ?, resolution = ?, completed_at = ?, updated_at = ?
        WHERE id = ?`,
      [
        input.unit_id, input.title, input.description, input.category, input.priority, input.status, input.assigned_to,
        input.unit_unavailable, input.due_date, input.resolution ?? before.resolution,
        closing ? nowIso() : reopening ? null : before.completed_at, nowIso(), ticketId,
      ],
    );
    syncUnitStatus(db, before.unit_id);
    syncUnitStatus(db, input.unit_id);
    if (before.status !== input.status) audit(db, actor, "status", "maintenance", ticketId, `${before.ticket_no} → ${input.status}`);
    else audit(db, actor, "update", "maintenance", ticketId, `Updated ${before.ticket_no}`);
  });
}

export type ExpenseInput = {
  facility_id: string;
  expense_date: string;
  category: string;
  vendor: string | null;
  description: string;
  amount_cents: number;
  method: string | null;
  reference: string | null;
  maintenance_id: string | null;
  unit_id: string | null;
};

export function createExpense(db: DB, actor: Actor, input: ExpenseInput): string {
  const expenseId = id();
  const stamp = nowIso();
  db.run(
    `INSERT INTO expenses (id, facility_id, expense_date, category, vendor, description, amount_cents, method, reference,
                           maintenance_id, unit_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      expenseId, input.facility_id, input.expense_date, input.category, input.vendor, input.description,
      input.amount_cents, input.method, input.reference, input.maintenance_id, input.unit_id, actor.id, stamp, stamp,
    ],
  );
  audit(db, actor, "create", "expense", expenseId, `Expense ${(input.amount_cents / 100).toFixed(2)} — ${input.description}`);
  return expenseId;
}
