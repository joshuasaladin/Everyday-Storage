import { id, type DB } from "./db";
import { addDays, addMonths, nowIso, today } from "./clock";
import { hashPassword } from "./crypto";
import { SYSTEM, type Actor } from "./audit";
import { saveSettings } from "./settings";
import { createUnit, syncAllUnits } from "./units";
import { createRenter } from "./renters";
import { createAgreement, endAgreement, scheduleMoveOut } from "./agreements";
import { applyLateFees, generateDueInvoices } from "./billing";
import { recordDeposit, recordPayment, reconcilePayments, depositHeld } from "./payments";
import { createReservation } from "./reservations";

/**
 * The demo workspace: a believable 14 months of a storage business, built by
 * running the real engines (agreements → invoices → payments), so every
 * number on every screen reconciles. Dates are relative to today.
 *
 * This only ever runs against the demo database file.
 */
export const DEMO_LOGIN = { email: "demo@everydaystorage.aw", password: "demo-storage" };
export const DEMO_RENTER_LOGIN = { email: "marisol.croes@example.com", password: "demo-renter" };

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE: [string, string, string?][] = [
  ["Marisol", "Croes"], ["Ruben", "Tromp"], ["Anouk", "Arends"], ["Dwight", "Geerman"], ["Shanella", "Kelly"],
  ["Jairo", "Maduro"], ["Liesbeth", "van der Linden"], ["Giovanni", "Werleman"], ["Tamara", "Oduber"], ["Ricardo", "Lacle"],
  ["Emily", "Henriquez"], ["Marco", "Ras"], ["Sharine", "Figaroa"], ["Kevin", "Thiel"], ["Natasha", "Wever"],
  ["Edwin", "Boekhoudt"], ["Carla", "Dijkhoff"], ["Stefan", "Koolman"], ["Jeanine", "Vrolijk"], ["Rolando", "Erasmus"],
  ["Daphne", "Ruiz"], ["Michael", "Petrocchi"], ["Xiomara", "Lopez"], ["Hendrik", "Bislip"], ["Vanessa", "Semeleer"],
  ["Aruba Dive Supply", "", "Aruba Dive Supply N.V."], ["Island Events", "", "Island Events & Rentals"],
  ["Palm Beach Catering", "", "Palm Beach Catering V.B.A."], ["Bon Bini Tours", "", "Bon Bini Tours N.V."],
  ["One Happy Movers", "", "One Happy Movers"], ["Carlos", "Giel"], ["Ingrid", "Solognier"], ["Paul", "Jansen"],
  ["Rosa", "Kock"], ["Thomas", "Nicolaas"], ["Yolanda", "Rasmijn"], ["Derek", "Angela"], ["Mireya", "Flanegin"],
];
const STREETS = ["Caya G.F. Betico Croes", "Savaneta", "Paradera", "Tanki Leendert", "Ponton", "Sabana Blanco", "Noord", "Santa Cruz", "Pos Chiquito", "Malmok"];

export function seedDemo(db: DB): void {
  const rand = rng(20261114);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const T = today();
  const stamp = nowIso();
  const actor: Actor = { id: null, name: "Demo seed", role: "system" };

  db.tx(() => {
    saveSettings(db, {
      business_name: "Everyday Storage Aruba",
      legal_name: "Everyday Storage Aruba V.B.A.",
      business_address: "Sabana Blanco 14, Oranjestad, Aruba",
      business_phone: "+297 588 0100",
      business_email: "hello@everydaystorage.aw",
      business_website: "everydaystorage.aw",
      chamber_no: "H-00000 (demo)",
      price_small_cents: 6500,
      price_standard_cents: 11000,
      price_warehouse_from_cents: 18500,
    });
    db.run(`UPDATE taxes SET enabled = 1`);

    // ---- people who can sign in
    const user = (email: string, name: string, role: string, pw: string, renterId: string | null = null) => {
      const uid = id();
      db.run(
        `INSERT INTO users (id, email, name, role, password_hash, status, renter_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [uid, email, name, role, hashPassword(pw), renterId, stamp, stamp],
      );
      return uid;
    };
    user(DEMO_LOGIN.email, "Demo Owner", "owner", DEMO_LOGIN.password);
    user("manager@everydaystorage.aw", "Anouk Manager", "manager", DEMO_LOGIN.password);
    const staffId = user("staff@everydaystorage.aw", "Dwight Staff", "staff", DEMO_LOGIN.password);

    // ---- facilities and their unit grids
    const facility = (code: string, name: string, address: string, cols: number, rows: number) => {
      const fid = id();
      db.run(
        `INSERT INTO facilities (id, code, name, address, city, country, phone, map_cols, map_rows, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'Aruba', '+297 588 0100', ?, ?, ?, ?)`,
        [fid, code, name, address, address.split(", ").pop(), cols, rows, stamp, stamp],
      );
      return fid;
    };
    const ora = facility("ORA", "Oranjestad", "Sabana Blanco 14, Oranjestad", 16, 10);
    const nrd = facility("NRD", "Noord", "Caya Frans Figaroa 31, Noord", 12, 5);

    const place = (unitId: string, x: number, y: number, w: number, h: number) =>
      db.run(`UPDATE units SET map_x = ?, map_y = ?, map_w = ?, map_h = ? WHERE id = ?`, [x, y, w, h, unitId]);
    const unit = (
      fid: string, num: string, type: string, size: string, [w, d, h]: [number, number, number], price: number, loc: string,
      cell: [number, number, number, number], features: string | null = null,
    ) => {
      const uid = createUnit(db, {
        facility_id: fid, unit_number: num, type, size_label: size, width_m: w, depth_m: d, height_m: h,
        location: loc, monthly_price_cents: price, offline: 0, features, notes: null,
      });
      place(uid, ...cell);
      return uid;
    };
    const units: { id: string; fid: string; price: number; num: string }[] = [];
    const add = (...args: Parameters<typeof unit>) => units.push({ id: unit(...args), fid: args[0], price: args[5], num: args[1] });
    const n2 = (n: number) => String(n).padStart(2, "0");

    const SMALL: [number, number, number] = [1.5, 3, 2.4];
    const STANDARD: [number, number, number] = [3, 3, 2.4];
    for (let i = 0; i < 16; i++) add(ora, `A${n2(i + 1)}`, "storage_unit", "small", SMALL, 6500, "Building A · ground floor", [i, 0, 1, 1]);
    for (let i = 0; i < 8; i++) add(ora, `B${n2(i + 1)}`, "storage_unit", "standard", STANDARD, i < 4 ? 13500 : 11000, "Building B · north side", [i * 2, 2, 2, 1], i < 4 ? "Climate controlled, 24/7 access" : null);
    for (let i = 0; i < 8; i++) add(ora, `B${n2(i + 9)}`, "storage_unit", "standard", STANDARD, 11000, "Building B · south side", [i * 2, 3, 2, 1]);
    for (let i = 0; i < 8; i++) add(ora, `C${n2(i + 1)}`, "warehouse", "large", [6, 6, 3.5], i % 4 === 0 ? 21500 : 18500, "Building C", [i * 2, 5, 2, 2], i % 4 === 0 ? "Climate controlled" : null);
    for (let i = 0; i < 4; i++) add(ora, `D${n2(i + 1)}`, "warehouse", "large", [6, 12, 4.5], 32000, "Row D · drive-up", [i * 4, 8, 4, 2], "Roll-up door, vehicle access");
    for (let i = 0; i < 6; i++) add(nrd, `N${n2(i + 1)}`, "warehouse", "large", [6, 10, 4], 24000, "Yard · front row", [i * 2, 0, 2, 2], "Ground level, roll-up door");
    for (let i = 0; i < 6; i++) add(nrd, `N${n2(i + 7)}`, "warehouse", "large", i < 4 ? [6, 10, 4] : [5, 8, 3.5], i < 4 ? 24000 : 12000, "Yard · back row", [i * 2, 3, 2, 2]);

    // ---- renters
    const renters = PEOPLE.map(([first, last, company], i) => {
      const business = Boolean(company);
      const contact = business ? pick(PEOPLE.slice(0, 25)) : null;
      const fn = business ? contact![0] : first;
      const ln = business ? contact![1] : last;
      const email = i === 0 ? DEMO_RENTER_LOGIN.email : `${(business ? first : `${fn}.${ln}`).toLowerCase().replace(/[^a-z.]+/g, "")}@example.com`;
      return createRenter(db, {
        kind: business ? "business" : "individual",
        first_name: fn, last_name: ln, company: company ?? null, email,
        phone: `+297 5${60 + (i % 30)} ${String(1000 + Math.floor(rand() * 8999))}`,
        id_type: business ? "kvk" : "aruba_id",
        id_number: business ? `H${10000 + i * 37}` : `${String(70 + (i % 29))}0${String(100000 + Math.floor(rand() * 899999))}`,
        address: `${pick(STREETS)} ${1 + Math.floor(rand() * 140)}, ${pick(["Oranjestad", "Noord", "Santa Cruz", "Savaneta", "San Nicolas", "Paradera"])}`,
        status: "lead", notes: i === 3 ? "Prefers WhatsApp. Pays in florins at the office." : null,
      });
    });

    // ---- agreements: [unit index, renter index, months ago started, term (0 = month-to-month), renewal, ended after n months?]
    type Plan = [number, number, number, number, "auto_renew" | "month_to_month" | "end", number?];
    const plans: Plan[] = [
      [0, 0, 14, 0, "month_to_month"], [16, 0, 9, 12, "auto_renew"], [1, 1, 13, 12, "month_to_month"], [2, 2, 12, 0, "month_to_month"],
      [3, 3, 11, 12, "auto_renew"], [4, 4, 11, 6, "month_to_month"], [5, 5, 10, 0, "month_to_month"], [6, 6, 10, 12, "end"],
      [7, 7, 9, 0, "month_to_month"], [9, 8, 8, 12, "auto_renew"], [10, 9, 8, 0, "month_to_month"], [12, 10, 7, 6, "auto_renew"],
      [13, 11, 6, 0, "month_to_month"], [17, 12, 13, 12, "auto_renew"], [18, 13, 12, 12, "month_to_month"], [19, 14, 10, 0, "month_to_month"],
      [20, 15, 9, 12, "end"], [21, 16, 7, 0, "month_to_month"], [22, 17, 5, 6, "end"], [24, 18, 12, 12, "auto_renew"],
      [25, 19, 8, 0, "month_to_month"], [26, 20, 6, 12, "auto_renew"], [28, 21, 4, 0, "month_to_month"], [29, 22, 3, 12, "auto_renew"],
      [32, 25, 13, 12, "auto_renew"], [33, 26, 11, 12, "auto_renew"], [34, 27, 9, 0, "month_to_month"], [36, 28, 6, 12, "end"],
      [37, 23, 3, 0, "month_to_month"], [38, 24, 2, 6, "month_to_month"], [40, 29, 12, 12, "auto_renew"], [41, 25, 5, 12, "auto_renew"],
      [42, 30, 2, 0, "month_to_month"], [44, 31, 10, 12, "auto_renew"], [45, 32, 8, 0, "month_to_month"], [46, 26, 7, 12, "auto_renew"],
      [47, 33, 5, 6, "month_to_month"], [48, 34, 4, 0, "month_to_month"], [50, 29, 3, 12, "auto_renew"], [52, 35, 1, 0, "month_to_month"],
      // history: agreements that have already ended
      [8, 36, 14, 6, "end", 6], [14, 37, 13, 0, "month_to_month", 7], [30, 21, 12, 0, "month_to_month", 5], [43, 31, 14, 0, "month_to_month", 3],
    ];
    const lateRenters = new Set([5, 13, 22, 27, 33]);
    const made: { agId: string; renterIdx: number; ended?: number; start: string }[] = [];

    for (const [ui, ri, monthsAgo, term, renewal, endedAfter] of plans) {
      const u = units[ui];
      const day = 1 + Math.floor(rand() * 27);
      const start = `${addMonths(T, -monthsAgo).slice(0, 8)}${n2(day)}`;
      const discount = ri % 9 === 4 ? 1000 : 0;
      const agId = createAgreement(db, actor, {
        facility_id: u.fid, unit_id: u.id, renter_id: renters[ri], term_type: term ? "fixed" : "month_to_month",
        start_date: start, term_months: term || null, monthly_rate_cents: u.price, deposit_cents: u.price,
        discount_cents: discount, discount_note: discount ? "Multi-unit / loyalty discount" : null,
        billing_mode: ui % 3 === 0 ? "anniversary" : "fixed_day", billing_day: 1, prorate_first: 1,
        renewal_option: renewal, renewal_term_months: term || null, notice_days: 30, notes: null,
      });
      db.run(
        `UPDATE agreements SET status = 'active', signed_at = ?, signed_name = ?, signed_method = 'paper', next_period_start = start_date WHERE id = ?`,
        [`${start}T14:00:00.000Z`, `${PEOPLE[ri][2] ?? `${PEOPLE[ri][0]} ${PEOPLE[ri][1]}`}`, agId],
      );
      db.run(`UPDATE renters SET status = 'active' WHERE id = ?`, [renters[ri]]);
      recordDeposit(db, actor, { agreement_id: agId, type: "collected", amount_cents: u.price, txn_date: start, method: pick(["bank_transfer", "cash", "card"]) });
      if (endedAfter) db.run(`UPDATE agreements SET move_out_date = ? WHERE id = ?`, [addDays(addMonths(start, endedAfter), -1), agId]);
      made.push({ agId, renterIdx: ri, ended: endedAfter, start });
    }

    // fixed terms that ran out in the past follow their renewal option, month by month
    const { processTermEnds } = require("./agreements") as typeof import("./agreements");
    for (let m = 14; m >= 0; m--) {
      const asOf = addMonths(T, -m);
      processTermEnds(db, asOf);
      generateDueInvoices(db, { asOf, issueOnPeriodStart: true, actor: SYSTEM });
    }
    for (const m of made) {
      if (!m.ended) continue;
      const ag = db.one<{ status: string; move_out_date: string }>(`SELECT status, move_out_date FROM agreements WHERE id = ?`, [m.agId])!;
      if (ag.status === "active") endAgreement(db, actor, m.agId, "Moved out", ag.move_out_date);
    }

    // ---- payments: most invoices are paid a few days around the due date
    const invoices = db.all<Record<string, any>>(
      `SELECT i.*, a.renter_id AS rid FROM invoices i JOIN agreements a ON a.id = i.agreement_id ORDER BY i.due_date, i.invoice_no`,
    );
    const renterIndex = new Map(renters.map((r, i) => [r, i]));
    let ref = 48210;
    for (const inv of invoices) {
      const ri = renterIndex.get(inv.renter_id)!;
      const late = lateRenters.has(ri);
      const age = Math.round((new Date(T).getTime() - new Date(inv.due_date).getTime()) / 864e5);
      if (age < -2) continue; // not due yet
      const roll = rand();
      if (late && age < 75) {
        if (age < 40 || roll < 0.5) continue; // still unpaid
      } else if (age < 12 && roll < 0.22) continue;
      const fresh = db.one<{ balance_cents: number }>(`SELECT balance_cents FROM invoices WHERE id = ?`, [inv.id])!;
      if (fresh.balance_cents <= 0) continue;
      const partial = age < 30 && roll > 0.93;
      const method = pick(["bank_transfer", "bank_transfer", "bank_transfer", "cash", "card", "card", "check"]);
      let date = addDays(inv.due_date, Math.floor(rand() * (late ? 24 : 7)) - 2);
      if (date > T) date = T;
      if (date < inv.issue_date) date = inv.issue_date;
      recordPayment(db, actor, {
        renter_id: inv.renter_id, amount_cents: partial ? Math.round(fresh.balance_cents / 200) * 100 : fresh.balance_cents,
        method, received_date: date, reference: method === "cash" ? null : `${method === "check" ? "CHQ" : method === "card" ? "POS" : "BT"}-${ref++}`,
        invoice_ids: [inv.id], spill: false, confirm_duplicate: true,
      });
    }
    // one overpayment, so the credit feature has something to show
    recordPayment(db, actor, { renter_id: renters[2], amount_cents: 5000, method: "cash", received_date: addDays(T, -6), invoice_ids: [], spill: false, confirm_duplicate: true, notes: "Paid ahead at the office" });

    // settle deposits for the agreements that ended
    for (const m of made.filter((x) => x.ended)) {
      const held = depositHeld(db, m.agId);
      const out = db.one<{ move_out_date: string }>(`SELECT move_out_date FROM agreements WHERE id = ?`, [m.agId])!;
      if (held > 0) recordDeposit(db, actor, { agreement_id: m.agId, type: "refunded", amount_cents: held, txn_date: addDays(out.move_out_date, 5), method: "bank_transfer", notes: "Refunded after move-out inspection" });
    }

    applyLateFees(db, { asOf: T, actor: SYSTEM });

    // bank reconciliation is up to date until a month ago
    for (let m = 14; m >= 1; m--) {
      const month = addMonths(T, -m).slice(0, 7);
      const ids = db.all<{ id: string }>(`SELECT id FROM payments WHERE substr(received_date, 1, 7) = ? AND method <> 'deposit'`, [month]).map((r) => r.id);
      if (ids.length) reconcilePayments(db, { id: null, name: "Anouk Manager", role: "manager" }, ids, `Bank statement ${month}`);
    }

    // a move-out in progress, an agreement waiting for a signature
    scheduleMoveOut(db, actor, made[10].agId, addDays(T, 12), "staff", "Moving off-island at the end of the month.");
    const pending = createAgreement(db, actor, {
      facility_id: units[11].fid, unit_id: units[11].id, renter_id: renters[36], term_type: "fixed", start_date: addDays(T, 4),
      term_months: 12, monthly_rate_cents: units[11].price, deposit_cents: units[11].price, discount_cents: 0, discount_note: null,
      billing_mode: "fixed_day", billing_day: 1, prorate_first: 1, renewal_option: "auto_renew", renewal_term_months: 12, notice_days: 30, notes: null,
    });
    void pending;

    // ---- reservations and the waitlist
    createReservation(db, actor, { facility_id: ora, unit_id: units[15].id, name: "Sheila Dirksz", email: "sheila.dirksz@example.com", phone: "+297 594 2210", desired_size: "small", desired_type: "storage_unit", desired_start: addDays(T, 5), source: "staff", notes: "Wants a ground-floor locker.", status: "confirmed" });
    createReservation(db, actor, { facility_id: ora, unit_id: units[27].id, name: "Luis Quant", email: "luis.quant@example.com", phone: "+297 560 8841", desired_size: "standard", desired_type: "storage_unit", desired_start: addDays(T, 9), source: "web", notes: null });
    createReservation(db, actor, { facility_id: ora, unit_id: null, name: "Fabiola Maduro", email: "fabiola@example.com", phone: "+297 593 0077", desired_size: "large", desired_type: "warehouse", desired_start: addDays(T, 20), source: "web", notes: "Needs drive-up access for a boat trailer." });
    createReservation(db, actor, { facility_id: ora, unit_id: null, name: "Gilbert Stamper", email: "g.stamper@example.com", phone: "+297 562 4419", desired_size: "large", desired_type: "warehouse", desired_start: addDays(T, 30), source: "staff", notes: "Climate controlled only — storing artwork." });
    createReservation(db, actor, { facility_id: nrd, unit_id: null, name: "Nord Construction N.V.", email: "office@nordconstruction.example.com", phone: "+297 586 1200", desired_size: "large", desired_type: "warehouse", desired_start: addDays(T, 14), source: "staff", notes: "Two containers if possible." });

    syncAllUnits(db);
  });
}
