"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "./forms";
import { createAgreementAction } from "@/lib/actions/agreements";
import { money } from "@/lib/format";

type UnitOpt = { id: string; label: string; price: number; facility: string };
type RenterOpt = { id: string; label: string };

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const dt = new Date(Date.UTC(ny, nm - 1, Math.min(d, last)));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The new-agreement form. Client-side only for the live summary; every rule is re-checked on the server. */
export default function AgreementForm({
  units, renters, defaults, currency, taxRate, reservationId,
}: {
  units: UnitOpt[]; renters: RenterOpt[]; currency: string; taxRate: number; reservationId?: string;
  defaults: { unit?: string; renter?: string; start: string; billing_mode: string; billing_day: number; prorate: boolean; notice: number; depositMonths: number };
}) {
  const [unitId, setUnitId] = useState(defaults.unit ?? "");
  const [term, setTerm] = useState<"fixed" | "month_to_month">("fixed");
  const [months, setMonths] = useState(12);
  const [start, setStart] = useState(defaults.start);
  const [rate, setRate] = useState(() => { const u = units.find((x) => x.id === defaults.unit); return u ? (u.price / 100).toFixed(2) : ""; });
  const [deposit, setDeposit] = useState(() => { const u = units.find((x) => x.id === defaults.unit); return u ? ((u.price * defaults.depositMonths) / 100).toFixed(2) : ""; });
  const [discount, setDiscount] = useState("");
  const [mode, setMode] = useState(defaults.billing_mode);
  const [renewal, setRenewal] = useState("month_to_month");

  const cents = (v: string) => Math.round((Number(v.replace(/,/g, "")) || 0) * 100);
  const net = Math.max(0, cents(rate) - cents(discount));
  const tax = Math.round((net * taxRate) / 10000);
  const end = useMemo(() => (term === "fixed" && /^\d{4}-\d{2}-\d{2}$/.test(start) && months > 0 ? addMonthsIso(start, months) : null), [term, start, months]);

  const pickUnit = (v: string) => {
    setUnitId(v);
    const u = units.find((x) => x.id === v);
    if (u) {
      setRate((u.price / 100).toFixed(2));
      setDeposit(((u.price * defaults.depositMonths) / 100).toFixed(2));
    }
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
      <ActionForm action={createAgreementAction} submit="Create agreement" cancelHref="/agreements" className="space-y-5">
        {reservationId && <input type="hidden" name="reservation_id" value={reservationId} />}
        <section className="panel p-5">
          <h2 className="text-sm font-semibold mb-4">Unit and renter</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">Unit</span>
              <select className="select" name="unit_id" value={unitId} onChange={(e) => pickUnit(e.target.value)} required>
                <option value="">Choose an available unit…</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
              <span className="hint block">Only units that are free to rent are listed.</span>
            </label>
            <label className="block">
              <span className="label">Renter</span>
              <select className="select" name="renter_id" defaultValue={defaults.renter ?? ""} required>
                <option value="">Choose a renter…</option>
                {renters.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <span className="hint block">Not listed? <a className="link" href="/renters/new?next=/agreements/new">Add a renter first</a>.</span>
            </label>
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="text-sm font-semibold mb-4">Term</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">Agreement type</span>
              <select className="select" name="term_type" value={term} onChange={(e) => setTerm(e.target.value as "fixed" | "month_to_month")}>
                <option value="fixed">Fixed term</option>
                <option value="month_to_month">Month-to-month</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Start date</span>
              <input className="input" type="date" name="start_date" value={start} onChange={(e) => setStart(e.target.value)} required />
            </label>
            {term === "fixed" && (
              <>
                <label className="block">
                  <span className="label">Term length (months)</span>
                  <input className="input" type="number" name="term_months" min={1} max={120} value={months} onChange={(e) => setMonths(Number(e.target.value))} required />
                  {end && <span className="hint block">Ends {end}.</span>}
                </label>
                <label className="block">
                  <span className="label">When the term ends</span>
                  <select className="select" name="renewal_option" value={renewal} onChange={(e) => setRenewal(e.target.value)}>
                    <option value="month_to_month">Continue month-to-month</option>
                    <option value="auto_renew">Renew automatically for another term</option>
                    <option value="end">End the agreement</option>
                  </select>
                </label>
                {renewal === "auto_renew" && (
                  <label className="block">
                    <span className="label">Renewal term (months)</span>
                    <input className="input" type="number" name="renewal_term_months" min={1} max={120} defaultValue={months} />
                  </label>
                )}
              </>
            )}
            <label className="block">
              <span className="label">Notice period (days)</span>
              <input className="input" type="number" name="notice_days" min={0} max={365} defaultValue={defaults.notice} />
            </label>
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="text-sm font-semibold mb-4">Charges and billing</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">Monthly rate ({currency})</span>
              <input className="input" name="monthly_rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" required />
            </label>
            <label className="block">
              <span className="label">Security deposit ({currency})</span>
              <input className="input" name="deposit" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0.00" />
              <span className="hint block">Held separately — never counted as revenue.</span>
            </label>
            <label className="block">
              <span className="label">Monthly discount ({currency})</span>
              <input className="input" name="discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
            </label>
            <label className="block">
              <span className="label">Discount reason</span>
              <input className="input" name="discount_note" maxLength={120} placeholder="e.g. Multi-unit discount" />
            </label>
            <label className="block">
              <span className="label">Billing cycle</span>
              <select className="select" name="billing_mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="fixed_day">Same day each month for everyone</option>
                <option value="anniversary">On the anniversary of the start date</option>
              </select>
            </label>
            {mode === "fixed_day" ? (
              <label className="block">
                <span className="label">Billing day of the month</span>
                <input className="input" type="number" name="billing_day" min={1} max={28} defaultValue={defaults.billing_day} />
              </label>
            ) : <input type="hidden" name="billing_day" value={defaults.billing_day} />}
            {mode === "fixed_day" && (
              <label className="flex items-start gap-2.5 text-sm cursor-pointer sm:col-span-2">
                <input type="checkbox" name="prorate_first" defaultChecked={defaults.prorate} className="mt-0.5" />
                <span>Prorate the first partial month<span className="hint block" style={{ marginTop: 2 }}>A move-in mid-cycle is charged only for the days up to the first billing day.</span></span>
              </label>
            )}
            <label className="block sm:col-span-2">
              <span className="label">Internal notes</span>
              <textarea className="textarea" name="notes" maxLength={4000} />
            </label>
          </div>
        </section>
      </ActionForm>

      <aside className="panel p-4 lg:sticky lg:top-20">
        <div className="eyebrow mb-2">Summary</div>
        <dl className="text-sm space-y-2">
          <div className="flex justify-between gap-3"><dt style={{ color: "var(--ink-3)" }}>Unit</dt><dd className="font-medium text-right">{units.find((u) => u.id === unitId)?.label.split(" · ")[0] ?? "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt style={{ color: "var(--ink-3)" }}>Term</dt><dd className="font-medium text-right">{term === "fixed" ? `${months} months${end ? ` · to ${end}` : ""}` : "Month-to-month"}</dd></div>
          <div className="flex justify-between gap-3"><dt style={{ color: "var(--ink-3)" }}>Rent</dt><dd className="num">{money(cents(rate), currency)}</dd></div>
          {cents(discount) > 0 && <div className="flex justify-between gap-3"><dt style={{ color: "var(--ink-3)" }}>Discount</dt><dd className="num">{money(-cents(discount), currency)}</dd></div>}
          {taxRate > 0 && <div className="flex justify-between gap-3"><dt style={{ color: "var(--ink-3)" }}>Tax ({taxRate / 100}%)</dt><dd className="num">{money(tax, currency)}</dd></div>}
          <div className="flex justify-between gap-3 pt-2 hair"><dt className="font-semibold">Monthly invoice</dt><dd className="font-semibold num">{money(net + tax, currency)}</dd></div>
          <div className="flex justify-between gap-3"><dt style={{ color: "var(--ink-3)" }}>Deposit to collect</dt><dd className="num">{money(cents(deposit), currency)}</dd></div>
          {term === "fixed" && <div className="flex justify-between gap-3"><dt style={{ color: "var(--ink-3)" }}>Contract value</dt><dd className="num">{money(net * months, currency)}</dd></div>}
        </dl>
        <p className="hint mt-3">The agreement is created awaiting signature and holds the unit. Billing starts when it is signed.</p>
      </aside>
    </div>
  );
}
