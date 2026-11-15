"use server";

import { redirect } from "next/navigation";
import { guard, facilityOf } from "../guard";
import { audit } from "../audit";
import { today } from "../clock";
import { act, Form, UserError, type ActionState } from "../validate";
import { createTicket, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, updateTicket, type TicketInput } from "../maintenance";
import { assignUnit, createReservation, setReservationStatus } from "../reservations";
import { deleteDocument, DOC_CATEGORIES, storeDocument } from "../files";
import { UNIT_SIZES, UNIT_TYPES } from "../units";
import { can } from "../roles";

export async function saveTicketAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("maintenance.edit");
    const f = new Form(form);
    const ticketId = f.str("id");
    const unitId = f.str("unit_id");
    const unit = unitId ? ctx.db.one<{ facility_id: string }>(`SELECT facility_id FROM units WHERE id = ?`, [unitId]) : null;
    if (unitId && !unit) throw new UserError("Unit not found.");
    const input: TicketInput = {
      facility_id: unit?.facility_id ?? facilityOf(ctx, form),
      unit_id: unitId,
      title: f.req("title", { max: 160 }),
      description: f.text("description", { max: 4000 }),
      category: f.oneOf("category", TICKET_CATEGORIES.map((c) => c.value), { fallback: "general" }),
      priority: f.oneOf("priority", TICKET_PRIORITIES.map((c) => c.value), { fallback: "normal" }),
      status: f.oneOf("status", TICKET_STATUSES.map((c) => c.value), { fallback: "open" }),
      assigned_to: f.str("assigned_to"),
      unit_unavailable: f.bool("unit_unavailable") && unitId ? 1 : 0,
      due_date: f.date("due_date"),
      resolution: f.text("resolution", { max: 2000 }),
    };
    f.check();
    if (input.assigned_to && !ctx.db.one(`SELECT 1 FROM users WHERE id = ? AND role <> 'renter'`, [input.assigned_to])) throw new UserError("Choose a staff member.");
    if (ticketId) {
      updateTicket(ctx.db, ctx.actor, ticketId, input);
      return { ok: "Ticket saved." };
    }
    const newId = createTicket(ctx.db, ctx.actor, input);
    redirect(`/maintenance/${newId}`);
  });
}

export async function ticketStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("maintenance.edit");
    const ticketId = String(form.get("id") ?? "");
    const status = String(form.get("status") ?? "");
    const t = ctx.db.one<Record<string, any>>(`SELECT * FROM maintenance_tickets WHERE id = ?`, [ticketId]);
    if (!t) throw new UserError("Ticket not found.");
    if (!TICKET_STATUSES.some((s) => s.value === status)) throw new UserError("Choose a valid status.");
    updateTicket(ctx.db, ctx.actor, ticketId, { ...(t as TicketInput), status });
    return { ok: "Saved." };
  });
}

export async function saveReservationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("reservations.edit");
    const f = new Form(form);
    const unitId = f.str("unit_id");
    const unit = unitId ? ctx.db.one<{ facility_id: string }>(`SELECT facility_id FROM units WHERE id = ?`, [unitId]) : null;
    if (unitId && !unit) throw new UserError("Unit not found.");
    const input = {
      facility_id: unit?.facility_id ?? facilityOf(ctx, form),
      unit_id: unitId,
      renter_id: f.str("renter_id"),
      name: f.req("name", { max: 120 }),
      email: f.email("email"),
      phone: f.str("phone", { max: 40 }),
      desired_size: f.str("desired_size") ? f.oneOf("desired_size", UNIT_SIZES.map((s) => s.value)) : null,
      desired_type: f.str("desired_type") ? f.oneOf("desired_type", UNIT_TYPES.map((s) => s.value)) : null,
      desired_start: f.date("desired_start"),
      hold_until: f.date("hold_until"),
      source: "staff" as const,
      notes: f.text("notes", { max: 1000 }),
    };
    f.check();
    if (!input.email && !input.phone) throw new UserError("Add a phone number or an email so you can reach them.");
    if (input.hold_until && input.hold_until < today()) throw new UserError("The hold date is in the past.");
    createReservation(ctx.db, ctx.actor, input);
    return { ok: unitId ? "Unit reserved." : "Added to the waitlist." };
  });
}

export async function reservationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("reservations.edit");
    const resId = String(form.get("id") ?? "");
    const op = String(form.get("op") ?? "");
    if (op === "assign") {
      assignUnit(ctx.db, ctx.actor, resId, String(form.get("unit_id") ?? ""));
      return { ok: "Unit assigned and held." };
    }
    if (op !== "confirmed" && op !== "cancelled") throw new UserError("Unknown action.");
    setReservationStatus(ctx.db, ctx.actor, resId, op);
    return { ok: op === "confirmed" ? "Reservation confirmed." : "Reservation cancelled and the unit released." };
  });
}

const DOC_ENTITIES: Record<string, { table: string; cap: "renters.edit" | "agreements.edit" | "units.edit" | "maintenance.edit" | "finance.edit" }> = {
  renter: { table: "renters", cap: "renters.edit" },
  agreement: { table: "agreements", cap: "agreements.edit" },
  unit: { table: "units", cap: "units.edit" },
  maintenance: { table: "maintenance_tickets", cap: "maintenance.edit" },
  expense: { table: "expenses", cap: "finance.edit" },
};

export async function uploadDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard();
    const entity = String(form.get("entity") ?? "");
    const entityId = String(form.get("entity_id") ?? "");
    const spec = DOC_ENTITIES[entity];
    if (!spec) throw new UserError("Documents cannot be attached here.");
    if (!can(ctx.user.role, spec.cap)) throw new UserError("Your role does not allow this.");
    const row = ctx.db.one<Record<string, any>>(`SELECT * FROM ${spec.table} WHERE id = ?`, [entityId]);
    if (!row) throw new UserError("Record not found.");
    const file = form.get("file");
    if (!(file instanceof File)) throw new UserError("Choose a file to upload.");
    const category = String(form.get("category") ?? "other");
    await storeDocument(ctx.db, ctx.actor, file, {
      entity, entityId,
      renterId: entity === "renter" ? entityId : entity === "agreement" ? row.renter_id : null,
      category: DOC_CATEGORIES.some((c) => c.value === category) ? category : "other",
      renterVisible: form.get("renter_visible") === "on" && (entity === "renter" || entity === "agreement"),
    });
    return { ok: "Uploaded." };
  });
}

export async function deleteDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard();
    const doc = ctx.db.one<Record<string, any>>(`SELECT * FROM documents WHERE id = ?`, [String(form.get("id") ?? "")]);
    if (!doc) throw new UserError("Document not found.");
    const spec = DOC_ENTITIES[doc.entity];
    if (!spec || !can(ctx.user.role, spec.cap)) throw new UserError("Your role does not allow this.");
    if (form.get("op") === "toggle") {
      ctx.db.run(`UPDATE documents SET renter_visible = 1 - renter_visible WHERE id = ? AND renter_id IS NOT NULL`, [doc.id]);
      audit(ctx.db, ctx.actor, "update", doc.entity, doc.entity_id, `${doc.name} ${doc.renter_visible ? "hidden from" : "shared with"} the renter`);
      return { ok: "Saved." };
    }
    await deleteDocument(ctx.db, ctx.actor, doc.id);
    return { ok: "Deleted." };
  });
}
