import type { DB } from "./db";
import { nowIso } from "./clock";

export const DEFAULT_TERMS = `1. RENTAL. The Company rents to the Renter the storage unit described above ("the Unit") for the storage of personal or business property only. No person may live or sleep in the Unit.

2. TERM. This agreement begins on the start date shown above. A fixed-term agreement runs to its end date; a month-to-month agreement continues until either party gives written notice of the notice period shown above.

3. RENT. Rent is due in advance on the due date shown on each invoice. Rent unpaid after the grace period may incur the late fee in force at that time.

4. SECURITY DEPOSIT. The deposit is held by the Company as security and is not rent. It is refunded after move-out, less any unpaid charges or the cost of damage or cleaning.

5. USE OF THE UNIT. The Renter will not store hazardous, flammable, illegal or perishable goods, and will keep the Unit clean and undamaged. The Renter provides their own lock.

6. INSURANCE. Goods are stored at the Renter's sole risk. The Company does not insure the Renter's property and recommends the Renter does.

7. ACCESS. The Company may enter the Unit for inspection, maintenance or in an emergency, giving reasonable notice where practical.

8. DEFAULT. If rent stays unpaid, the Company may deny access to the Unit and end this agreement in accordance with the laws of Aruba.

9. MOVE-OUT. On ending this agreement the Renter will empty the Unit, leave it clean and remove their lock by the move-out date.

10. GOVERNING LAW. This agreement is governed by the laws of Aruba.`;

export const DEFAULTS = {
  business_name: "Everyday Storage Aruba",
  legal_name: "Everyday Storage Aruba",
  business_address: "Oranjestad, Aruba",
  business_phone: "",
  business_email: "",
  business_website: "",
  tax_id: "",
  chamber_no: "",

  base_currency: "USD" as "USD" | "AWG",
  awg_per_usd: 1.79,
  show_secondary_currency: true,

  invoice_prefix: "INV",
  invoice_footer: "Thank you for storing with Everyday Storage Aruba.",
  payment_instructions:
    "Pay by bank transfer, or by cash or card at the office. Please quote your invoice number as the payment reference.",

  billing_mode_default: "fixed_day" as "anniversary" | "fixed_day",
  billing_day_default: 1,
  prorate_first_month: true,
  invoice_lead_days: 5,
  due_offset_days: 0,
  auto_apply_credit: true,

  late_fee_enabled: true,
  late_fee_grace_days: 5,
  late_fee_type: "flat" as "flat" | "percent",
  late_fee_flat_cents: 2500,
  late_fee_percent_bp: 500,

  default_notice_days: 30,
  default_deposit_months: 1,
  reservation_hold_days: 7,
  public_reservations_enabled: true,

  email_provider: "log" as "log" | "smtp" | "resend",
  email_from_name: "Everyday Storage Aruba",
  email_from_address: "billing@everydaystorage.aw",
  email_reply_to: "",
  automation_hour: 7,

  payment_gateway: "none" as "none" | "generic",
  esign_provider: "built_in" as "built_in" | "external",

  agreement_terms: DEFAULT_TERMS,
};

export type Settings = typeof DEFAULTS;
export type SettingKey = keyof Settings;

export function getSettings(db: DB): Settings {
  const rows = db.all<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const row of rows) {
    if (!(row.key in DEFAULTS)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      /* keep the default */
    }
  }
  return out as Settings;
}

export function saveSettings(db: DB, patch: Partial<Settings>) {
  const stamp = nowIso();
  db.tx(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS) || value === undefined) continue;
      db.run(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [key, JSON.stringify(value), stamp],
      );
    }
  });
}

/** Convert base-currency cents into the other currency for display. */
export function secondary(s: Settings, cents: number): { currency: string; cents: number } {
  if (s.base_currency === "USD") return { currency: "AWG", cents: Math.round(cents * s.awg_per_usd) };
  return { currency: "USD", cents: Math.round(cents / s.awg_per_usd) };
}

export function toBase(s: Settings, cents: number, currency: string): { cents: number; rate: number } {
  if (currency === s.base_currency) return { cents, rate: 1 };
  if (s.base_currency === "USD") return { cents: Math.round(cents / s.awg_per_usd), rate: 1 / s.awg_per_usd };
  return { cents: Math.round(cents * s.awg_per_usd), rate: s.awg_per_usd };
}

export function activeTaxes(db: DB) {
  return db.all<{ id: string; name: string; rate_bp: number }>(
    `SELECT id, name, rate_bp FROM taxes WHERE enabled = 1 ORDER BY name`,
  );
}

export function taxRateBp(db: DB): number {
  return db.num(`SELECT COALESCE(SUM(rate_bp), 0) FROM taxes WHERE enabled = 1`);
}
