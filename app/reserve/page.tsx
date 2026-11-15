import { ActionForm } from "@/components/forms";
import { Field } from "@/components/ui";
import { getDb } from "@/lib/db";
import { publicReserveAction } from "@/lib/actions/public";
import { getSettings, taxRateBp } from "@/lib/settings";
import { today } from "@/lib/clock";
import { label, syncAllUnits, UNIT_SIZES, UNIT_TYPES } from "@/lib/units";
import { area, dims, money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reserve a storage unit", robots: { index: true, follow: true } };

/** The public booking page. It only ever reads the live workspace, and only what a customer may see. */
export default async function ReservePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const db = getDb("live");
  const s = getSettings(db);
  const picked = (await searchParams).unit;
  syncAllUnits(db);
  const facilities = db.all<Record<string, any>>(`SELECT id, name, address FROM facilities WHERE status = 'active' ORDER BY name`);
  const units = db.all<Record<string, any>>(
    `SELECT u.id, u.unit_number, u.type, u.size_label, u.width_ft, u.depth_ft, u.height_ft, u.monthly_price_cents, u.features, u.facility_id, f.name AS facility_name
       FROM units u JOIN facilities f ON f.id = u.facility_id AND f.status = 'active'
      WHERE u.status = 'available' AND (u.available_from IS NULL OR u.available_from <= date('now', '+30 day')) ORDER BY u.monthly_price_cents, u.unit_number`,
  );
  const tax = taxRateBp(db);
  const chosen = units.find((u) => u.id === picked);
  const t = today();

  return (
    <div className="min-h-screen">
      <header className="side">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-640.png" alt="" width={64} height={64} style={{ borderRadius: 10 }} />
          <div>
            <div className="text-[.7rem] font-semibold uppercase tracking-[.14em]" style={{ color: "#fd8933" }}>{s.business_name}</div>
            <h1 className="page-title" style={{ color: "#fff", fontSize: "1.5rem" }}>Reserve a storage unit</h1>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 sm:py-8">
        {!s.public_reservations_enabled ? (
          <div className="panel p-6 max-w-xl"><h2 className="section-title mb-2">Online reservations are closed</h2><p className="text-sm" style={{ color: "var(--ink-2)" }}>Please call us{s.business_phone ? ` on ${s.business_phone}` : ""} and we will find you a unit.</p></div>
        ) : (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
            <section>
              <h2 className="section-title mb-1">{units.length ? "Available now" : "We are full at the moment"}</h2>
              <p className="text-sm mb-4" style={{ color: "var(--ink-3)" }}>
                {units.length ? `Choose a unit and we will hold it for you for ${s.reservation_hold_days} days — no payment needed to reserve.` : "Join the waitlist and we will contact you as soon as a unit that fits comes free."}
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {units.map((u) => (
                  <a key={u.id} href={`/reserve?unit=${u.id}#form`} className="panel p-4 block hover:-translate-y-px transition-transform" style={u.id === picked ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent)" } : undefined}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="eyebrow mb-0.5">{label(UNIT_SIZES, u.size_label)} · {label(UNIT_TYPES, u.type)}</div>
                        <div className="section-title">{dims(u)}</div>
                      </div>
                      <div className="text-right">
                        <div className="stat-value" style={{ fontSize: "1.25rem" }}>{money(u.monthly_price_cents, s.base_currency)}</div>
                        <div className="text-xs" style={{ color: "var(--ink-3)" }}>per month{tax ? " + tax" : ""}</div>
                      </div>
                    </div>
                    <div className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>{area(u)} sq ft · Unit {u.unit_number}{facilities.length > 1 ? ` · ${u.facility_name}` : ""}</div>
                    {u.features && <div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{u.features}</div>}
                  </a>
                ))}
              </div>
            </section>

            <aside className="panel p-5 lg:sticky lg:top-6" id="form">
              <h2 className="section-title mb-1">{chosen ? `Reserve unit ${chosen.unit_number}` : "Join the waitlist"}</h2>
              <p className="text-sm mb-4" style={{ color: "var(--ink-3)" }}>
                {chosen ? `${dims(chosen)} · ${money(chosen.monthly_price_cents, s.base_currency)} per month.` : units.length ? "Pick a unit on the left, or tell us what you need and we will call you." : "Tell us what you need."}
                {chosen && <> <a className="link" href="/reserve#form">Clear</a></>}
              </p>
              <ActionForm action={publicReserveAction} submit={chosen ? "Reserve this unit" : "Join the waitlist"} pendingLabel="Sending…" submitClass="btn btn-primary w-full" resetOnOk>
                {chosen && <input type="hidden" name="unit_id" value={chosen.id} />}
                <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
                <div className="space-y-4">
                  {chosen ? <input type="hidden" name="facility_id" value={chosen.facility_id} /> : facilities.length > 1 ? (
                    <Field label="Location"><select className="select" name="facility_id">{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
                  ) : <input type="hidden" name="facility_id" value={facilities[0]?.id ?? ""} />}
                  <Field label="Your name"><input className="input" name="name" required maxLength={120} autoComplete="name" /></Field>
                  <Field label="Phone"><input className="input" name="phone" required maxLength={40} autoComplete="tel" placeholder="+297 …" /></Field>
                  <Field label="Email"><input className="input" type="email" name="email" required autoComplete="email" /></Field>
                  {!chosen && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Size"><select className="select" name="desired_size" defaultValue=""><option value="">Any</option>{UNIT_SIZES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
                      <Field label="Type"><select className="select" name="desired_type" defaultValue=""><option value="">Any</option>{UNIT_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></Field>
                    </div>
                  )}
                  <Field label="When do you want to move in?"><input className="input" type="date" name="desired_start" min={t} /></Field>
                  <Field label="Anything else?"><textarea className="textarea" name="notes" maxLength={600} style={{ minHeight: "4rem" }} /></Field>
                </div>
              </ActionForm>
              <p className="hint mt-3">We only use your details to arrange your storage. Already a customer? <a className="link" href="/login">Sign in</a>.</p>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
