import { id, type DB } from "./db";
import { nowIso } from "./clock";
import { hashPassword, randomToken } from "./crypto";

export const AUTOMATIONS: { key: string; name: string; description: string; config: Record<string, unknown> }[] = [
  {
    key: "generate_invoices",
    name: "Monthly invoice generation",
    description: "Creates each renter's rent invoice ahead of its billing period, following the agreement's billing cycle. One invoice per period, however often it runs.",
    config: {},
  },
  {
    key: "send_invoices",
    name: "Invoice delivery",
    description: "Emails every newly generated invoice to the renter with the PDF attached.",
    config: {},
  },
  {
    key: "due_reminders",
    name: "Due-date reminders",
    description: "A friendly reminder before an unpaid invoice falls due.",
    config: { days_before: [3] },
  },
  {
    key: "overdue_reminders",
    name: "Overdue payment reminders",
    description: "Escalating reminders after the due date while an invoice stays unpaid.",
    config: { days_after: [3, 7, 14, 30] },
  },
  {
    key: "late_fees",
    name: "Late fees",
    description: "Adds the configured late fee once, after the grace period, to invoices that are still unpaid.",
    config: {},
  },
  {
    key: "expiry_notices",
    name: "Contract expiration notices",
    description: "Tells the renter (and the audit trail) that a fixed-term agreement is coming to an end.",
    config: { days_before: [60, 30, 7] },
  },
  {
    key: "renewals",
    name: "Renewals",
    description: "Sends a renewal reminder before the term ends, then applies the agreement's renewal option: renew, continue month-to-month, or end.",
    config: { remind_days_before: [30] },
  },
  {
    key: "move_outs",
    name: "Move-out workflow",
    description: "Reminds the renter before their move-out date and keeps the checklist moving: final invoice, inspection, lock, deposit.",
    config: { remind_days_before: [3] },
  },
  {
    key: "reservation_expiry",
    name: "Reservation hold expiry",
    description: "Releases a reserved unit when its hold date passes without an agreement.",
    config: {},
  },
];

/** Reference rows every workspace needs. Safe to run on every boot. */
export function ensureDefaults(db: DB): void {
  const stamp = nowIso();
  db.tx(() => {
    for (const a of AUTOMATIONS) {
      db.run(
        `INSERT INTO automations (key, name, description, enabled, config, updated_at) VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description`,
        [a.key, a.name, a.description, JSON.stringify(a.config), stamp],
      );
    }
    if (!db.one(`SELECT 1 FROM taxes LIMIT 1`)) {
      // present but off: the owner decides with their accountant whether and how much to charge
      db.run(`INSERT INTO taxes (id, name, rate_bp, enabled, created_at) VALUES (?, ?, ?, 0, ?)`, [
        id(), "BBO / BAZV / BAVP", 700, stamp,
      ]);
    }
  });
}

export function bootstrap(db: DB): void {
  ensureDefaults(db);
  // statuses are derived; recompute once per boot in case the rules changed
  const { syncAllUnits } = require("./units") as typeof import("./units");
  syncAllUnits(db);

  if (db.workspace === "demo") {
    if (!db.one(`SELECT 1 FROM users LIMIT 1`)) {
      const { seedDemo } = require("./seed") as typeof import("./seed");
      seedDemo(db);
    }
    return;
  }

  // live: a first facility and a first administrator, nothing else
  const stamp = nowIso();
  if (!db.one(`SELECT 1 FROM facilities LIMIT 1`)) {
    db.run(
      `INSERT INTO facilities (id, code, name, city, country, created_at, updated_at) VALUES (?, 'ESA', 'Everyday Storage Aruba', 'Oranjestad', 'Aruba', ?, ?)`,
      [id(), stamp, stamp],
    );
  }
  if (!db.one(`SELECT 1 FROM users WHERE role <> 'renter' LIMIT 1`)) {
    const email = (process.env.ADMIN_EMAIL ?? "admin@everydaystorage.aw").toLowerCase().trim();
    let password = process.env.ADMIN_PASSWORD;
    let generated = false;
    if (!password) {
      if (process.env.NODE_ENV === "production") {
        password = randomToken(12);
        generated = true;
      } else {
        password = "storage2026";
      }
    }
    db.run(
      `INSERT INTO users (id, email, name, role, password_hash, status, must_change_password, created_at, updated_at)
       VALUES (?, ?, 'Administrator', 'owner', ?, 'active', ?, ?, ?)`,
      [id(), email, hashPassword(password), generated ? 1 : 0, stamp, stamp],
    );
    if (generated) {
      console.log(`[storage-hq] First sign-in: ${email} / ${password}  — set ADMIN_PASSWORD to choose your own. Change it after signing in.`);
    }
  }
}
