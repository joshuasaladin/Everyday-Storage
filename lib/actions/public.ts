"use server";

import { headers } from "next/headers";
import { getDb, type DB } from "../db";
import { nowIso } from "../clock";
import { act, Form, UserError, type ActionState } from "../validate";
import { agreementBySignToken, signAgreement } from "../agreements";
import { createReservation } from "../reservations";
import { getSettings } from "../settings";
import { queueInvoiceEmail, queuePlain } from "../email";
import { SYSTEM } from "../audit";
import { UNIT_SIZES, UNIT_TYPES } from "../units";

/** Public endpoints have no session, so they are throttled per IP in the database. */
function throttle(db: DB, bucket: string, ip: string | null, max: number, minutes: number) {
  const key = `${bucket}:${ip ?? "unknown"}`;
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const n = db.num(`SELECT COUNT(*) FROM login_attempts WHERE email = ? AND at > ?`, [key, since]);
  if (n >= max) throw new UserError("Too many attempts. Please try again later, or call us.");
  db.run(`INSERT INTO login_attempts (email, ip, success, at) VALUES (?, ?, 0, ?)`, [key, ip, nowIso()]);
}

async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null, ua: h.get("user-agent") };
}

/** The renter signs from their personal link. Works for whichever workspace issued the token. */
export async function publicSignAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const f = new Form(form);
    const token = f.req("token");
    const name = f.req("signed_name", { max: 120, label: "Your full name" });
    f.check();
    if (!f.bool("agree")) throw new UserError("Tick the box to confirm you have read and agree to the terms.", { agree: "Required" });
    const meta = await requestMeta();
    for (const ws of ["live", "demo"] as const) {
      if (ws === "demo" && process.env.DEMO_WORKSPACE === "off") continue;
      const db = getDb(ws);
      const ag = agreementBySignToken(db, token);
      if (!ag) continue;
      throttle(db, "sign", meta.ip, 12, 30);
      signAgreement(db, { id: null, name: `${name} (renter)`, role: "renter", ip: meta.ip }, ag.id, {
        name, method: "e-sign", signature_png: String(form.get("signature") ?? ""), ip: meta.ip, user_agent: meta.ua,
      });
      for (const inv of db.all<{ id: string }>(`SELECT id FROM invoices WHERE agreement_id = ? AND sent_at IS NULL`, [ag.id])) queueInvoiceEmail(db, inv.id);
      return { ok: "Signed. Thank you — a copy of your first invoice is on its way." };
    }
    throw new UserError("This signing link is no longer valid. Ask us to send a new one.");
  });
}

/** Online reservation from the public page. Creates a pending hold (or a waitlist entry) for staff to confirm. */
export async function publicReserveAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const db = getDb("live");
    const settings = getSettings(db);
    if (!settings.public_reservations_enabled) throw new UserError("Online reservations are not open at the moment. Please call us.");
    // a field real people never see or fill
    if (String(form.get("website") ?? "")) return { ok: "Thank you — we will be in touch." };
    const f = new Form(form);
    const unitId = f.str("unit_id");
    const facilityId = f.req("facility_id", { label: "Location" });
    const input = {
      facility_id: facilityId,
      unit_id: unitId,
      name: f.req("name", { max: 120, label: "Your name" }),
      email: f.email("email", { required: true }),
      phone: f.req("phone", { max: 40 }),
      desired_size: f.str("desired_size") ? f.oneOf("desired_size", UNIT_SIZES.map((s) => s.value)) : null,
      desired_type: f.str("desired_type") ? f.oneOf("desired_type", UNIT_TYPES.map((s) => s.value)) : null,
      desired_start: f.date("desired_start", { label: "Move-in date" }),
      source: "web" as const,
      notes: f.str("notes", { max: 600 }),
    };
    f.check();
    if (!db.one(`SELECT 1 FROM facilities WHERE id = ? AND status = 'active'`, [facilityId])) throw new UserError("Choose a location.");
    const meta = await requestMeta();
    throttle(db, "reserve", meta.ip, 5, 60);
    createReservation(db, { ...SYSTEM, name: "Online reservation", ip: meta.ip }, input);
    queuePlain(db, {
      kind: "reservation_received", to: input.email, toName: input.name,
      subject: `We received your reservation request — ${settings.business_name}`,
      body: `Dear ${input.name},\n\nThank you. ${unitId ? `We are holding a unit for you for ${settings.reservation_hold_days} days` : "You are on our waitlist"} and will contact you shortly to confirm the details.`,
    });
    return { ok: unitId ? `Reserved. We are holding the unit for ${settings.reservation_hold_days} days and will contact you to confirm.` : "You are on the waitlist. We will contact you as soon as a matching unit is free." };
  });
}
