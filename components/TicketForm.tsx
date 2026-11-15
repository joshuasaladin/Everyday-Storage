import { ActionForm } from "./forms";
import { Check, Field } from "./ui";
import { saveTicketAction } from "@/lib/actions/ops";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/maintenance";

export default function TicketForm({
  ticket, units, staff, facilities, facilityId, defaultUnit, cancelHref,
}: {
  ticket?: Record<string, any>; units: { id: string; label: string }[]; staff: { id: string; name: string }[];
  facilities: { id: string; name: string }[]; facilityId: string | null; defaultUnit?: string; cancelHref?: string;
}) {
  return (
    <ActionForm action={saveTicketAction} submit={ticket ? "Save ticket" : "Open ticket"} cancelHref={cancelHref}>
      {ticket && <input type="hidden" name="id" value={ticket.id} />}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="What needs doing" className="sm:col-span-2"><input className="input" name="title" defaultValue={ticket?.title ?? ""} required maxLength={160} /></Field>
        <Field label="Unit" hint="Leave empty for the grounds, gate or a whole building.">
          <select className="select" name="unit_id" defaultValue={ticket?.unit_id ?? defaultUnit ?? ""}>
            <option value="">Facility-wide</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </Field>
        {!ticket && facilities.length > 1 ? (
          <Field label="Facility" hint="Used when no unit is chosen.">
            <select className="select" name="facility_id" defaultValue={facilityId ?? facilities[0]?.id}>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </Field>
        ) : <input type="hidden" name="facility_id" value={ticket?.facility_id ?? facilityId ?? facilities[0]?.id} />}
        <Field label="Category"><select className="select" name="category" defaultValue={ticket?.category ?? "general"}>{TICKET_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
        <Field label="Priority"><select className="select" name="priority" defaultValue={ticket?.priority ?? "normal"}>{TICKET_PRIORITIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
        <Field label="Status"><select className="select" name="status" defaultValue={ticket?.status ?? "open"}>{TICKET_STATUSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
        <Field label="Assigned to">
          <select className="select" name="assigned_to" defaultValue={ticket?.assigned_to ?? ""}>
            <option value="">Unassigned</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Due date"><input className="input" type="date" name="due_date" defaultValue={ticket?.due_date ?? ""} /></Field>
        <Field label="Details" className="sm:col-span-2"><textarea className="textarea" name="description" defaultValue={ticket?.description ?? ""} /></Field>
        {ticket && <Field label="Resolution" className="sm:col-span-2" hint="What was done — filled in when the work is finished."><textarea className="textarea" name="resolution" defaultValue={ticket?.resolution ?? ""} /></Field>}
        <div className="sm:col-span-2">
          <Check name="unit_unavailable" label="This unit cannot be rented until the work is done" defaultChecked={Boolean(ticket?.unit_unavailable)} hint="Marks the unit as Maintenance on the map and takes it out of the available list until the ticket is closed." />
        </div>
      </div>
    </ActionForm>
  );
}
