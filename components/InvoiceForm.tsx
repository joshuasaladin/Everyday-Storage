"use client";

import { useState } from "react";
import Icon from "./Icon";
import { ActionForm } from "./forms";
import { createInvoiceAction } from "@/lib/actions/billing";
import { money } from "@/lib/format";

type Line = { key: number; kind: string; description: string; amount: string; taxable: boolean };

export default function InvoiceForm({
  renters, agreements, facilities, currency, taxRate, today, defaultRenter,
}: {
  renters: { id: string; label: string }[];
  agreements: { id: string; renter_id: string; label: string }[];
  facilities: { id: string; name: string }[];
  currency: string; taxRate: number; today: string; defaultRenter?: string;
}) {
  const [renter, setRenter] = useState(defaultRenter ?? "");
  const [lines, setLines] = useState<Line[]>([{ key: 1, kind: "fee", description: "", amount: "", taxable: true }]);
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const cents = (v: string) => Math.round((Number(v.replace(/,/g, "")) || 0) * 100);
  const charges = lines.filter((l) => l.kind !== "discount").reduce((a, l) => a + cents(l.amount), 0);
  const discounts = lines.filter((l) => l.kind === "discount").reduce((a, l) => a + cents(l.amount), 0);
  const taxable = Math.max(0, lines.filter((l) => l.taxable).reduce((a, l) => a + (l.kind === "discount" ? -1 : 1) * cents(l.amount), 0));
  const tax = Math.round((taxable * taxRate) / 10000);
  const mine = agreements.filter((a) => a.renter_id === renter);

  return (
    <ActionForm action={createInvoiceAction} submit="Create invoice" cancelHref="/invoices" className="max-w-4xl space-y-5">
      <section className="panel p-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="label">Renter</span>
            <select className="select" name="renter_id" value={renter} onChange={(e) => setRenter(e.target.value)} required>
              <option value="">Choose a renter…</option>
              {renters.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Related agreement</span>
            <select className="select" name="agreement_id" defaultValue="" key={renter}>
              <option value="">None</option>
              {mine.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Issue date</span><input className="input" type="date" name="issue_date" defaultValue={today} required /></label>
          <label className="block"><span className="label">Due date</span><input className="input" type="date" name="due_date" defaultValue={today} required /></label>
          {facilities.length > 1 && (
            <label className="block">
              <span className="label">Facility</span>
              <select className="select" name="facility_id">{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
              <span className="hint block">Used when no agreement is chosen.</span>
            </label>
          )}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold mb-3">Lines</h2>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={l.key} className="grid grid-cols-12 gap-2 items-start">
              <select className="select col-span-4 sm:col-span-2" name="line_kind" value={l.kind} onChange={(e) => set(l.key, { kind: e.target.value })} aria-label="Line type">
                <option value="fee">Fee</option>
                <option value="other">Other charge</option>
                <option value="discount">Discount</option>
              </select>
              <input className="input col-span-8 sm:col-span-5" name="line_description" placeholder="Description, e.g. Lock replacement" value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} aria-label="Description" maxLength={200} />
              <input className="input col-span-5 sm:col-span-2" name="line_amount" placeholder="0.00" inputMode="decimal" value={l.amount} onChange={(e) => set(l.key, { amount: e.target.value })} aria-label={`Amount in ${currency}`} />
              <label className="col-span-5 sm:col-span-2 flex items-center gap-2 text-sm h-[2.35rem]">
                <input type="checkbox" name="line_taxable" value={String(i)} checked={l.taxable} onChange={(e) => set(l.key, { taxable: e.target.checked })} />
                Taxable
              </label>
              <button type="button" className="btn btn-ghost btn-icon col-span-2 sm:col-span-1" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-sm mt-3" onClick={() => setLines((ls) => [...ls, { key: Math.max(...ls.map((x) => x.key)) + 1, kind: "fee", description: "", amount: "", taxable: true }])}>
          <Icon name="plus" className="w-3.5 h-3.5" />Add line
        </button>

        <dl className="mt-5 ml-auto max-w-xs text-sm space-y-1.5">
          <div className="flex justify-between"><dt style={{ color: "var(--ink-3)" }}>Charges</dt><dd className="num">{money(charges, currency)}</dd></div>
          {discounts > 0 && <div className="flex justify-between"><dt style={{ color: "var(--ink-3)" }}>Discounts</dt><dd className="num">{money(-discounts, currency)}</dd></div>}
          {taxRate > 0 && <div className="flex justify-between"><dt style={{ color: "var(--ink-3)" }}>Tax ({taxRate / 100}%)</dt><dd className="num">{money(tax, currency)}</dd></div>}
          <div className="flex justify-between pt-1.5 hair font-semibold"><dt>Total</dt><dd className="num">{money(Math.max(0, charges - discounts) + tax, currency)}</dd></div>
        </dl>
      </section>

      <section className="panel p-5">
        <label className="block"><span className="label">Notes on the invoice</span><textarea className="textarea" name="notes" maxLength={1000} /></label>
      </section>
    </ActionForm>
  );
}
