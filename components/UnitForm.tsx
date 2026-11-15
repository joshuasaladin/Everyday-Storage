import { ActionForm } from "./forms";
import { Check, Field } from "./ui";
import { saveUnitAction } from "@/lib/actions/units";
import { UNIT_SIZES, UNIT_TYPES } from "@/lib/units";
import { centsInput } from "@/lib/format";

export default function UnitForm({ unit, facilities, facilityId, currency }: {
  unit?: Record<string, any>; facilities: { id: string; name: string }[]; facilityId: string | null; currency: string;
}) {
  return (
    <ActionForm action={saveUnitAction} submit={unit ? "Save changes" : "Create unit"} cancelHref={unit ? `/units/${unit.id}` : "/units"} className="panel p-5 max-w-3xl">
      {unit && <input type="hidden" name="id" value={unit.id} />}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Unit number" hint="Unique within the facility, e.g. A12.">
          <input className="input" name="unit_number" defaultValue={unit?.unit_number} required maxLength={20} autoFocus={!unit} />
        </Field>
        {unit ? (
          <Field label="Facility"><input className="input" value={facilities.find((f) => f.id === unit.facility_id)?.name ?? ""} disabled readOnly /></Field>
        ) : (
          <Field label="Facility">
            <select className="select" name="facility_id" defaultValue={facilityId ?? facilities[0]?.id}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Type">
          <select className="select" name="type" defaultValue={unit?.type ?? "standard"}>
            {UNIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Size class">
          <select className="select" name="size_label" defaultValue={unit?.size_label ?? "medium"}>
            {UNIT_SIZES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <Field label="Width (ft)"><input className="input" name="width_ft" type="number" step="0.5" min="0.5" defaultValue={unit?.width_ft ?? ""} required /></Field>
          <Field label="Depth (ft)"><input className="input" name="depth_ft" type="number" step="0.5" min="0.5" defaultValue={unit?.depth_ft ?? ""} required /></Field>
          <Field label="Height (ft)"><input className="input" name="height_ft" type="number" step="0.5" min="0" defaultValue={unit?.height_ft || ""} /></Field>
        </div>
        <Field label={`Monthly price (${currency})`}>
          <input className="input" name="monthly_price" inputMode="decimal" defaultValue={centsInput(unit?.monthly_price_cents)} placeholder="0.00" required />
        </Field>
        <Field label="Location" hint="Building, row or floor.">
          <input className="input" name="location" defaultValue={unit?.location ?? ""} maxLength={120} />
        </Field>
        <Field label="Available from" hint="Optional — when the unit can next be rented.">
          <input className="input" type="date" name="available_from" defaultValue={unit?.available_from ?? ""} />
        </Field>
        <Field label="Features" hint="Climate control, drive-up access, power…">
          <input className="input" name="features" defaultValue={unit?.features ?? ""} maxLength={500} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea className="textarea" name="notes" defaultValue={unit?.notes ?? ""} />
        </Field>
        <div className="sm:col-span-2">
          <Check name="offline" label="Take this unit offline" defaultChecked={Boolean(unit?.offline)} hint="Marks it unavailable for rent. Occupancy, reservations and maintenance still set the status automatically." />
        </div>
      </div>
    </ActionForm>
  );
}
