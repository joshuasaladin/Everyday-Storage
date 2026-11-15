"use server";

import { redirect } from "next/navigation";
import { guard } from "../guard";
import { audit } from "../audit";
import { nowIso } from "../clock";
import { hashPassword, randomToken } from "../crypto";
import { createUser } from "../auth";
import { act, Form, UserError, type ActionState } from "../validate";
import { createRenter, ID_TYPES, renterDeleteBlocker, renterIdNumber, updateRenter, type RenterInput } from "../renters";
import { addManualCredit } from "../billing";
import { queuePlain } from "../email";
import { can } from "../roles";
import { renterName } from "../format";

export async function saveRenterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("renters.edit");
    const f = new Form(form);
    const renterId = f.str("id");
    const kind = f.oneOf("kind", ["individual", "business"] as const);
    const input: RenterInput = {
      kind,
      first_name: f.req("first_name", { max: 80, label: kind === "business" ? "Contact first name" : "First name" }),
      last_name: f.str("last_name", { max: 80 }) ?? "",
      company: f.str("company", { max: 160, required: kind === "business", label: "Company name" }),
      email: f.email("email"),
      phone: f.str("phone", { max: 40 }),
      phone_alt: f.str("phone_alt", { max: 40 }),
      id_type: f.str("id_type") ? f.oneOf("id_type", ID_TYPES.map((t) => t.value), { label: "ID type" }) : null,
      address: f.str("address", { max: 200 }),
      city: f.str("city", { max: 80 }),
      country: f.str("country", { max: 80 }),
      emergency_name: f.str("emergency_name", { max: 120 }),
      emergency_phone: f.str("emergency_phone", { max: 40 }),
      emergency_relation: f.str("emergency_relation", { max: 60 }),
      notes: f.text("notes", { max: 4000 }),
    };
    // ID numbers are only read from the form for roles allowed to see them
    if (can(ctx.user.role, "renters.sensitive") && form.has("id_number")) {
      const idNumber = String(form.get("id_number") ?? "").trim();
      if (idNumber.length > 40) throw new UserError("That ID number is too long.");
      if (idNumber || form.get("clear_id") === "on") input.id_number = idNumber;
    }
    f.check();
    if (renterId) {
      if (!ctx.db.one(`SELECT 1 FROM renters WHERE id = ?`, [renterId])) throw new UserError("Renter not found.");
      updateRenter(ctx.db, renterId, input);
      audit(ctx.db, ctx.actor, "update", "renter", renterId, `Updated ${renterName(input)}`);
      redirect(`/renters/${renterId}`);
    }
    const newId = createRenter(ctx.db, input);
    audit(ctx.db, ctx.actor, "create", "renter", newId, `Added renter ${renterName(input)}`);
    redirect(String(form.get("next") ?? "").startsWith("/agreements/new") ? `/agreements/new?renter=${newId}` : `/renters/${newId}`);
  });
}

export async function deleteRenterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("renters.edit");
    const renterId = String(form.get("id") ?? "");
    const renter = ctx.db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [renterId]);
    if (!renter) throw new UserError("Renter not found.");
    const blocker = renterDeleteBlocker(ctx.db, renterId);
    if (blocker) throw new UserError(blocker);
    ctx.db.run(`DELETE FROM renters WHERE id = ?`, [renterId]);
    audit(ctx.db, ctx.actor, "delete", "renter", renterId, `Deleted renter ${renterName(renter)}`);
    redirect("/renters");
  });
}

/** Shows the stored ID number once, and records that it was looked at. */
export async function revealIdAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("renters.sensitive");
    const renterId = String(form.get("id") ?? "");
    const value = renterIdNumber(ctx.db, renterId);
    if (!value) throw new UserError("No ID number is stored for this renter.");
    audit(ctx.db, ctx.actor, "reveal_id", "renter", renterId, "Viewed the stored ID number");
    return { ok: value };
  });
}

/** Create (or reset) the renter's customer-portal login. The temporary password is shown once. */
export async function portalLoginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("renters.edit");
    const renterId = String(form.get("id") ?? "");
    const mode = String(form.get("mode") ?? "create");
    const renter = ctx.db.one<Record<string, any>>(`SELECT * FROM renters WHERE id = ?`, [renterId]);
    if (!renter) throw new UserError("Renter not found.");
    const existing = ctx.db.one<{ id: string; email: string; status: string }>(`SELECT id, email, status FROM users WHERE renter_id = ?`, [renterId]);

    if (mode === "disable" || mode === "enable") {
      if (!existing) throw new UserError("This renter has no portal login.");
      ctx.db.run(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`, [mode === "disable" ? "disabled" : "active", nowIso(), existing.id]);
      if (mode === "disable") ctx.db.run(`DELETE FROM sessions WHERE user_id = ?`, [existing.id]);
      audit(ctx.db, ctx.actor, "portal", "renter", renterId, `Portal access ${mode}d`);
      return { ok: `Portal access ${mode}d.` };
    }

    if (!renter.email) throw new UserError("Add an email address for this renter first — it is their sign-in.");
    const password = `${randomToken(6)}-${Math.floor(100 + Math.random() * 900)}`;
    if (existing) {
      ctx.db.run(`UPDATE users SET email = ?, password_hash = ?, must_change_password = 1, status = 'active', updated_at = ? WHERE id = ?`, [
        renter.email, hashPassword(password), nowIso(), existing.id,
      ]);
      ctx.db.run(`DELETE FROM sessions WHERE user_id = ?`, [existing.id]);
    } else {
      createUser(ctx.db, { email: renter.email, name: renterName(renter), role: "renter", password, renterId, mustChange: true });
    }
    queuePlain(ctx.db, {
      kind: "portal_invite", to: renter.email, toName: renterName(renter),
      subject: `Your ${ctx.settings.business_name} customer portal`,
      body: `Dear ${renter.first_name},\n\nYou can now see your unit, agreement, invoices and receipts online.\n\nSign in with this email address. Your temporary password was given to you by our team — you will be asked to choose your own the first time you sign in.`,
      entity: "renter", entityId: renterId, renterId,
    });
    audit(ctx.db, ctx.actor, "portal", "renter", renterId, existing ? "Portal password reset" : "Portal login created");
    return { ok: `Sign-in: ${renter.email} · Temporary password: ${password} — shown once, pass it on securely.` };
  });
}

export async function addCreditAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("finance.edit");
    const f = new Form(form);
    const renterId = f.req("renter_id");
    const cents = f.cents("amount", { required: true, min: 1 }) ?? 0;
    const reason = f.req("reason", { max: 200 });
    f.check();
    if (!ctx.db.one(`SELECT 1 FROM renters WHERE id = ?`, [renterId])) throw new UserError("Renter not found.");
    addManualCredit(ctx.db, ctx.actor, renterId, cents, reason);
    return { ok: "Credit added." };
  });
}
