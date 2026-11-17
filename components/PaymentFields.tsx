import { Check, Field } from "./ui";
import { IdempotencyKey } from "./forms";
import { PAYMENT_METHODS } from "@/lib/payments";
import { centsInput } from "@/lib/format";

/** The fields for booking a payment — shared by the invoice page and the payments page. */
export default function PaymentFields({
  currency, today, amount, renters, renterId, invoiceId, stay,
}: {
  currency: string; today: string; amount?: number; renters?: { id: string; label: string }[]; renterId?: string; invoiceId?: string; stay?: boolean;
}) {
  return (
    <>
      <IdempotencyKey />
      {invoiceId && <input type="hidden" name="invoice_id" value={invoiceId} />}
      {stay && <input type="hidden" name="stay" value="1" />}
      <div className="grid grid-cols-2 gap-4">
        {renters ? (
          <Field label="Renter" className="col-span-2" hint="Applied to their oldest unpaid invoices first. Anything more is kept as credit and used automatically on their next invoices — so they can pay months ahead.">
            <select className="select" name="renter_id" defaultValue={renterId ?? ""} required>
              <option value="">Choose a renter…</option>
              {renters.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
        ) : <input type="hidden" name="renter_id" value={renterId} />}
        <Field label="Amount received" hint={invoiceId ? "Enter less than the balance for a part payment." : undefined}>
          <input className="input" name="amount" inputMode="decimal" defaultValue={amount ? centsInput(amount) : ""} placeholder="0.00" required />
        </Field>
        <Field label="Currency" hint="Florin payments are converted at your set rate.">
          <select className="select" name="currency" defaultValue={currency}>
            <option value="USD">USD — US Dollar</option>
            <option value="AWG">AWG — Aruban Florin</option>
          </select>
        </Field>
        <Field label="Method">
          <select className="select" name="method" defaultValue="bank_transfer">
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Date received"><input className="input" type="date" name="received_date" defaultValue={today} max={today} required /></Field>
        <Field label="Transaction reference" className="col-span-2" hint="Bank reference, cheque or card slip number. Required except for cash — the same reference can never be booked twice.">
          <input className="input" name="reference" maxLength={80} autoComplete="off" />
        </Field>
        <Field label="Notes" className="col-span-2"><input className="input" name="notes" maxLength={300} /></Field>
      </div>
      <div className="mt-4 space-y-2.5">
        <Check name="send_receipt" label="Email a receipt to the renter" />
        <Check name="confirm_duplicate" label="This is a separate payment" hint="Only needed if you are warned that an identical payment already exists." />
      </div>
    </>
  );
}
