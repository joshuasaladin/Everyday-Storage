import { ActionForm } from "./forms";
import { Check, Field } from "./ui";
import { saveRenterAction } from "@/lib/actions/renters";
import { ID_TYPES } from "@/lib/renters";

export default function RenterForm({ renter, canSensitive, next }: { renter?: Record<string, any>; canSensitive: boolean; next?: string }) {
  return (
    <ActionForm action={saveRenterAction} submit={renter ? "Save changes" : "Add renter"} cancelHref={renter ? `/renters/${renter.id}` : "/renters"} className="max-w-3xl space-y-5">
      {renter && <input type="hidden" name="id" value={renter.id} />}
      {next && <input type="hidden" name="next" value={next} />}
      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-4">Who they are</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Renter type">
            <select className="select" name="kind" defaultValue={renter?.kind ?? "individual"}>
              <option value="individual">Individual</option>
              <option value="business">Business</option>
            </select>
          </Field>
          <Field label="Company name" hint="For a business renter.">
            <input className="input" name="company" defaultValue={renter?.company ?? ""} maxLength={160} />
          </Field>
          <Field label="First name"><input className="input" name="first_name" defaultValue={renter?.first_name ?? ""} required maxLength={80} autoFocus={!renter} /></Field>
          <Field label="Last name"><input className="input" name="last_name" defaultValue={renter?.last_name ?? ""} maxLength={80} /></Field>
          <Field label="Email" hint="Invoices, reminders and the portal sign-in use this address.">
            <input className="input" type="email" name="email" defaultValue={renter?.email ?? ""} maxLength={254} />
          </Field>
          <Field label="Phone"><input className="input" name="phone" defaultValue={renter?.phone ?? ""} maxLength={40} placeholder="+297 …" /></Field>
          <Field label="Address" className="sm:col-span-2"><input className="input" name="address" defaultValue={renter?.address ?? ""} maxLength={200} /></Field>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-4">Identification</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="ID type">
            <select className="select" name="id_type" defaultValue={renter?.id_type ?? ""}>
              <option value="">—</option>
              {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          {canSensitive ? (
            <Field label="ID number" hint={renter?.id_last4 ? `On file, ending ${renter.id_last4}. Leave blank to keep it.` : "Stored encrypted. Only managers and above can view it."}>
              <input className="input" name="id_number" autoComplete="off" maxLength={40} placeholder={renter?.id_last4 ? `•••• ${renter.id_last4}` : ""} />
            </Field>
          ) : (
            <Field label="ID number"><input className="input" disabled readOnly value={renter?.id_last4 ? `•••• ${renter.id_last4}` : "Managers can add this"} /></Field>
          )}
          {canSensitive && renter?.id_last4 && <div className="sm:col-span-2"><Check name="clear_id" label="Remove the stored ID number" /></div>}
        </div>
      </section>

      <section className="panel p-5">
        <Field label="Notes"><textarea className="textarea" name="notes" defaultValue={renter?.notes ?? ""} /></Field>
      </section>
    </ActionForm>
  );
}
