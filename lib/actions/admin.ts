"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard } from "../guard";
import { audit } from "../audit";
import { id, dropDemo, getDb } from "../db";
import { nowIso } from "../clock";
import { hashPassword, randomToken } from "../crypto";
import { createUser, passwordProblem } from "../auth";
import { act, Form, UserError, type ActionState } from "../validate";
import { saveSettings, type Settings } from "../settings";
import { runAutomationNow, tick } from "../jobs";
import { processOutbox, queuePlain, retryEmail } from "../email";
import { atLeast, type StaffRole } from "../roles";

export async function saveSettingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("settings.edit");
    const f = new Form(form);
    const section = f.req("section");
    let patch: Partial<Settings> = {};
    if (section === "business") {
      patch = {
        business_name: f.req("business_name", { max: 120 }), legal_name: f.str("legal_name", { max: 160 }) ?? "",
        business_address: f.str("business_address", { max: 240 }) ?? "", business_phone: f.str("business_phone", { max: 40 }) ?? "",
        business_email: f.email("business_email") ?? "", business_website: f.str("business_website", { max: 120 }) ?? "",
        tax_id: f.str("tax_id", { max: 40 }) ?? "", chamber_no: f.str("chamber_no", { max: 40 }) ?? "",
      };
    } else if (section === "currency") {
      patch = {
        base_currency: f.oneOf("base_currency", ["USD", "AWG"] as const),
        awg_per_usd: f.num("awg_per_usd", { required: true, min: 0.5, max: 10, label: "Exchange rate" }) ?? 1.79,
        show_secondary_currency: f.bool("show_secondary_currency"),
      };
      const old = ctx.settings.base_currency;
      if (patch.base_currency !== old && ctx.db.one(`SELECT 1 FROM invoices LIMIT 1`)) {
        throw new UserError(`Invoices already exist in ${old}. The base currency cannot be changed once billing has started — amounts would no longer add up.`);
      }
    } else if (section === "billing") {
      patch = {
        billing_mode_default: f.oneOf("billing_mode_default", ["anniversary", "fixed_day"] as const),
        billing_day_default: f.int("billing_day_default", { required: true, min: 1, max: 28, label: "Billing day" }) ?? 1,
        prorate_first_month: f.bool("prorate_first_month"),
        invoice_lead_days: f.int("invoice_lead_days", { required: true, min: 0, max: 30, label: "Lead days" }) ?? 5,
        due_offset_days: f.int("due_offset_days", { required: true, min: 0, max: 60, label: "Due offset" }) ?? 0,
        auto_apply_credit: f.bool("auto_apply_credit"),
        late_fee_enabled: f.bool("late_fee_enabled"),
        late_fee_grace_days: f.int("late_fee_grace_days", { required: true, min: 0, max: 90, label: "Grace period" }) ?? 5,
        late_fee_type: f.oneOf("late_fee_type", ["flat", "percent"] as const),
        late_fee_flat_cents: f.cents("late_fee_flat", { label: "Flat late fee" }) ?? 0,
        late_fee_percent_bp: Math.round((f.num("late_fee_percent", { min: 0, max: 100, label: "Late fee percent" }) ?? 0) * 100),
        default_notice_days: f.int("default_notice_days", { required: true, min: 0, max: 365, label: "Notice period" }) ?? 30,
        default_deposit_months: f.num("default_deposit_months", { required: true, min: 0, max: 12, label: "Deposit months" }) ?? 1,
        reservation_hold_days: f.int("reservation_hold_days", { required: true, min: 1, max: 90, label: "Hold days" }) ?? 7,
        public_reservations_enabled: f.bool("public_reservations_enabled"),
      };
    } else if (section === "invoice") {
      patch = {
        invoice_prefix: (f.req("invoice_prefix", { max: 8 }) || "INV").toUpperCase().replace(/[^A-Z0-9]/g, "") || "INV",
        invoice_footer: f.str("invoice_footer", { max: 300 }) ?? "",
        payment_instructions: f.text("payment_instructions", { max: 1500 }) ?? "",
      };
    } else if (section === "notifications") {
      patch = {
        email_provider: f.oneOf("email_provider", ["log", "smtp", "resend"] as const),
        email_from_name: f.req("email_from_name", { max: 120 }),
        email_from_address: f.email("email_from_address", { required: true }) ?? "",
        email_reply_to: f.email("email_reply_to") ?? "",
        automation_hour: f.int("automation_hour", { required: true, min: 0, max: 23, label: "Run hour" }) ?? 7,
      };
    } else if (section === "prices") {
      patch = {
        price_small_cents: f.cents("price_small", { required: true, label: "Small storage unit price" }) ?? 0,
        price_standard_cents: f.cents("price_standard", { required: true, label: "Standard storage unit price" }) ?? 0,
        price_warehouse_from_cents: f.cents("price_warehouse_from", { label: "Warehouse starting price" }) ?? 0,
        warehouse_price_note: f.str("warehouse_price_note", { max: 200 }) ?? "",
      };
    } else if (section === "terms") {
      patch = { agreement_terms: f.text("agreement_terms", { required: true, max: 20000, label: "Agreement terms" }) ?? "" };
    } else {
      throw new UserError("Unknown settings section.");
    }
    f.check();
    saveSettings(ctx.db, patch);
    audit(ctx.db, ctx.actor, "settings", "settings", section, `Updated ${section} settings`, { keys: Object.keys(patch) });
    revalidatePath("/", "layout");
    return { ok: "Settings saved." };
  });
}

export async function saveTaxAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("settings.edit");
    const f = new Form(form);
    const taxId = f.str("id");
    if (form.get("op") === "delete" && taxId) {
      ctx.db.run(`DELETE FROM taxes WHERE id = ?`, [taxId]);
      audit(ctx.db, ctx.actor, "settings", "tax", taxId, "Deleted a tax");
      return { ok: "Tax removed. Existing invoices keep the rate they were issued with." };
    }
    const name = f.req("name", { max: 60 });
    const rate = f.num("rate", { required: true, min: 0, max: 100, label: "Rate" }) ?? 0;
    const enabled = f.bool("enabled") ? 1 : 0;
    f.check();
    const bp = Math.round(rate * 100);
    if (taxId) ctx.db.run(`UPDATE taxes SET name = ?, rate_bp = ?, enabled = ? WHERE id = ?`, [name, bp, enabled, taxId]);
    else ctx.db.run(`INSERT INTO taxes (id, name, rate_bp, enabled, created_at) VALUES (?, ?, ?, ?, ?)`, [id(), name, bp, enabled, nowIso()]);
    audit(ctx.db, ctx.actor, "settings", "tax", taxId, `Tax "${name}" set to ${rate}% (${enabled ? "on" : "off"})`);
    return { ok: "Saved. The new rate applies to invoices issued from now on." };
  });
}

export async function saveUserAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("users.manage");
    const f = new Form(form);
    const userId = f.str("id");
    const op = f.str("op") ?? "save";
    const me = ctx.user;

    if (userId) {
      const target = ctx.db.one<{ id: string; role: StaffRole; name: string; email: string }>(`SELECT id, role, name, email FROM users WHERE id = ? AND role <> 'renter'`, [userId]);
      if (!target) throw new UserError("User not found.");
      if (target.role === "owner" && me.role !== "owner") throw new UserError("Only an owner can change an owner's account.");
      if (op === "reset") {
        const pw = `${randomToken(7)}-${Math.floor(100 + Math.random() * 900)}`;
        ctx.db.run(`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?`, [hashPassword(pw), nowIso(), userId]);
        ctx.db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
        audit(ctx.db, ctx.actor, "users", "user", userId, `Reset the password for ${target.name}`);
        return { ok: `Temporary password for ${target.email}: ${pw} — shown once.` };
      }
      if (op === "delete") {
        if (userId === me.id) throw new UserError("You cannot delete your own account.");
        ctx.db.run(`DELETE FROM users WHERE id = ?`, [userId]);
        audit(ctx.db, ctx.actor, "users", "user", userId, `Deleted the account of ${target.name}`);
        return { ok: "Account deleted." };
      }
      const role = f.oneOf("role", ["staff", "manager", "admin", "owner"] as const);
      const status = f.oneOf("status", ["active", "disabled"] as const);
      const name = f.req("name", { max: 120 });
      f.check();
      if (userId === me.id && (role !== me.role || status !== "active")) throw new UserError("You cannot change your own role or disable yourself.");
      if (role === "owner" && me.role !== "owner") throw new UserError("Only an owner can make someone an owner.");
      if (!atLeast(me.role, role)) throw new UserError("You cannot grant a role above your own.");
      ctx.db.run(`UPDATE users SET name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?`, [name, role, status, nowIso(), userId]);
      if (status === "disabled") ctx.db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
      audit(ctx.db, ctx.actor, "users", "user", userId, `${target.name}: role ${role}, ${status}`);
      return { ok: "User updated." };
    }

    const email = f.email("email", { required: true }) ?? "";
    const name = f.req("name", { max: 120 });
    const role = f.oneOf("role", ["staff", "manager", "admin", "owner"] as const);
    const password = String(form.get("password") ?? "");
    f.check();
    const problem = passwordProblem(password);
    if (problem) throw new UserError(problem, { password: problem });
    if (role === "owner" && me.role !== "owner") throw new UserError("Only an owner can create another owner.");
    const newId = createUser(ctx.db, { email, name, role, password, mustChange: true });
    audit(ctx.db, ctx.actor, "users", "user", newId, `Created ${role} account for ${name}`);
    return { ok: `Account created for ${email}. They will be asked to choose a new password when they first sign in.` };
  });
}

export async function saveFacilityAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("settings.edit");
    const f = new Form(form);
    const facilityId = f.str("id");
    const input = {
      code: f.req("code", { max: 6 }).toUpperCase().replace(/[^A-Z0-9]/g, ""),
      name: f.req("name", { max: 120 }),
      address: f.str("address", { max: 240 }),
      city: f.str("city", { max: 80 }),
      phone: f.str("phone", { max: 40 }),
      email: f.email("email"),
      status: f.oneOf("status", ["active", "archived"] as const, { fallback: "active" }),
    };
    f.check();
    if (!input.code) throw new UserError("Give the facility a short code, like ORA.");
    if (facilityId) {
      if (input.status === "archived") {
        if (ctx.db.one(`SELECT 1 FROM agreements WHERE facility_id = ? AND status IN ('active','pending_signature') LIMIT 1`, [facilityId])) throw new UserError("This facility still has live agreements.");
        if (ctx.db.num(`SELECT COUNT(*) FROM facilities WHERE status = 'active'`) <= 1) throw new UserError("At least one facility must stay active.");
      }
      ctx.db.run(`UPDATE facilities SET code = ?, name = ?, address = ?, city = ?, phone = ?, email = ?, status = ?, updated_at = ? WHERE id = ?`, [
        input.code, input.name, input.address, input.city, input.phone, input.email, input.status, nowIso(), facilityId,
      ]);
      audit(ctx.db, ctx.actor, "settings", "facility", facilityId, `Updated facility ${input.name}`);
    } else {
      const newId = id();
      ctx.db.run(`INSERT INTO facilities (id, code, name, address, city, phone, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        newId, input.code, input.name, input.address, input.city, input.phone, input.email, nowIso(), nowIso(),
      ]);
      audit(ctx.db, ctx.actor, "settings", "facility", newId, `Added facility ${input.name}`);
    }
    revalidatePath("/", "layout");
    return { ok: "Facility saved." };
  });
}

export async function saveAutomationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("automations.edit");
    const f = new Form(form);
    const key = f.req("key");
    const a = ctx.db.one<{ config: string; name: string }>(`SELECT config, name FROM automations WHERE key = ?`, [key]);
    if (!a) throw new UserError("Unknown automation.");
    const config = JSON.parse(a.config || "{}") as Record<string, unknown>;
    for (const field of Object.keys(config)) {
      if (Array.isArray(config[field]) && form.has(field)) {
        const days = f.intList(field, { label: "Days" });
        if (!days.length) throw new UserError("Enter at least one number of days, e.g. 3, 7, 14.");
        config[field] = days;
      }
    }
    f.check();
    const enabled = f.bool("enabled") ? 1 : 0;
    ctx.db.run(`UPDATE automations SET enabled = ?, config = ?, updated_at = ? WHERE key = ?`, [enabled, JSON.stringify(config), nowIso(), key]);
    audit(ctx.db, ctx.actor, "automation", "automation", key, `${a.name}: ${enabled ? "on" : "off"}`, config);
    return { ok: "Automation saved." };
  });
}

export async function runAutomationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("automations.edit");
    const key = String(form.get("key") ?? "");
    if (key === "__tick") {
      const r = await tick(ctx.workspace);
      return { ok: `Ran ${r.jobs} job${r.jobs === 1 ? "" : "s"}; ${r.sent} email${r.sent === 1 ? "" : "s"} sent${r.failed ? `, ${r.failed} failed` : ""}.` };
    }
    const result = await runAutomationNow(ctx.db, key);
    audit(ctx.db, ctx.actor, "automation", "automation", key, `Ran "${key}" manually: ${result}`);
    return { ok: result };
  });
}

export async function outboxAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("automations.edit");
    const op = String(form.get("op") ?? "");
    if (op === "retry") {
      retryEmail(ctx.db, String(form.get("id") ?? ""));
      await processOutbox(ctx.db);
      return { ok: "Retried." };
    }
    if (op === "retry_job") {
      ctx.db.run(`UPDATE jobs SET status = 'queued', attempts = 0, run_after = ?, last_error = NULL WHERE id = ? AND status IN ('failed','dead')`, [nowIso(), String(form.get("id") ?? "")]);
      await tick(ctx.workspace);
      return { ok: "Job re-queued." };
    }
    if (op === "test") {
      const to = new Form(form).email("to", { required: true });
      if (!to) throw new UserError("Enter an email address.");
      queuePlain(ctx.db, { kind: "test", to, subject: `Test email from ${ctx.settings.business_name}`, body: "This is a test message from Storage HQ. If you can read it, email delivery is working." });
      const r = await processOutbox(ctx.db);
      return { ok: r.failed ? "Delivery failed — see the outbox for the error." : "Test message processed — check the outbox below for how it was delivered." };
    }
    throw new UserError("Unknown action.");
  });
}

export async function resetDemoAction(_prev: ActionState, _form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await guard("settings.edit");
    if (ctx.workspace !== "demo") throw new UserError("Open the demo workspace first — this only ever resets example data.");
    dropDemo();
    getDb("demo"); // rebuilt from the seed
    redirect("/login");
  });
}
