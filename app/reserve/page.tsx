import ReserveForm, { type ReserveOption } from "@/components/ReserveForm";
import { getDb } from "@/lib/db";
import { getSettings, taxRateBp } from "@/lib/settings";
import { today } from "@/lib/clock";
import { SIZE_PRESETS } from "@/lib/unit-options";
import { area, dims, money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reserve a storage unit", robots: { index: true, follow: true } };

/**
 * The public booking page. It shows the three kinds of space on offer at their
 * standard prices (Settings → Prices) — never which individual units are free —
 * and only records requests.
 */
export default async function ReservePage() {
  const db = getDb();
  const s = getSettings(db);
  const facilities = db.all<{ id: string; name: string }>(`SELECT id, name FROM facilities WHERE status = 'active' ORDER BY name`);
  const perMonth = taxRateBp(db) ? "per month, plus tax" : "per month";
  const price = (cents: number) => (cents > 0 ? money(cents, s.base_currency) : "Price on request");

  const preset = (key: "small" | "standard") => {
    const p = SIZE_PRESETS[key]!;
    const u = { width_m: p.width, depth_m: p.depth, height_m: p.height };
    return { size: dims(u), area: `${area(u)} m² floor space` };
  };
  const options: ReserveOption[] = [
    { key: "small", title: "Small", ...preset("small"), price: price(s.price_small_cents), priceNote: s.price_small_cents ? perMonth : "", note: null },
    { key: "standard", title: "Standard", ...preset("standard"), price: price(s.price_standard_cents), priceNote: s.price_standard_cents ? perMonth : "", note: null },
    {
      key: "warehouse", title: "Warehouse", size: "Size varies", area: "Tell us the square metres you need",
      price: s.price_warehouse_from_cents ? `From ${money(s.price_warehouse_from_cents, s.base_currency)}` : "Price on request",
      priceNote: s.price_warehouse_from_cents ? perMonth : "", note: s.warehouse_price_note || null,
    },
  ];

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
          <ReserveForm options={options} facilities={facilities} holdDays={s.reservation_hold_days} today={today()} />
        )}
        {(s.business_phone || s.business_email) && (
          <p className="text-xs mt-8" style={{ color: "var(--ink-3)" }}>Questions? {[s.business_phone, s.business_email].filter(Boolean).join(" · ")}</p>
        )}
      </main>
    </div>
  );
}
