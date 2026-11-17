import { NextResponse } from "next/server";
import { unitOrderSql } from "@/lib/unit-options";
import { csvResponse } from "@/lib/api";
import { getCtx, scope, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { addDays, today } from "@/lib/clock";
import { csv$, toCsv } from "@/lib/csv";
import { can, type Cap } from "@/lib/roles";
import { displayStatus } from "@/lib/billing";
import { like } from "@/lib/query";
import { area, renterName } from "@/lib/format";

export const dynamic = "force-dynamic";

type Exporter = { cap: Cap; run: (ctx: Ctx, q: URLSearchParams) => { columns: string[]; rows: unknown[][] } };

/** WHERE-clause builder shared by the exports, mirroring the filters on each list page. */
function filters(q: URLSearchParams, spec: { eq?: Record<string, string>; search?: string[]; from?: string; to?: string }) {
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(spec.eq ?? {})) {
    const v = q.get(key);
    if (v) { where.push(`${col} = ?`); params.push(v); }
  }
  const term = q.get("q")?.trim();
  if (term && spec.search?.length) {
    where.push(`(${spec.search.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    params.push(...spec.search.map(() => like(term)));
  }
  if (spec.from && q.get("from")) { where.push(`${spec.from} >= ?`); params.push(q.get("from")); }
  if (spec.to && q.get("to")) { where.push(`${spec.to} <= ?`); params.push(q.get("to")); }
  return { where, params };
}

const NAME = "r.first_name || ' ' || r.last_name";

const EXPORTS: Record<string, Exporter> = {
  units: {
    cap: "units.view",
    run(ctx, q) {
      const f = filters(q, { eq: { status: "u.status", type: "u.type", size: "u.size_label" }, search: ["u.unit_number", "u.location", NAME, "r.company"] });
      const s = scope(ctx, "u.facility_id");
      const rows = ctx.db.all<Record<string, any>>(
        `SELECT u.*, f.name AS facility, r.first_name, r.last_name, r.company, r.kind, a.agreement_no FROM units u JOIN facilities f ON f.id = u.facility_id
           LEFT JOIN agreements a ON a.unit_id = u.id AND a.status IN ('active','pending_signature') LEFT JOIN renters r ON r.id = a.renter_id
          WHERE ${f.where.join(" AND ")}${s.sql} ORDER BY f.name, ${unitOrderSql()}`,
        [...f.params, ...s.params],
      );
      return {
        columns: ["Facility", "Unit", "Type", "Size", "Width m", "Depth m", "Height m", "Area m2", "Location", "Monthly price", "Status", "Renter", "Agreement", "Features"],
        rows: rows.map((u) => [u.facility, u.unit_number, u.type, u.size_label, u.width_m, u.depth_m, u.height_m, area(u), u.location, csv$(u.monthly_price_cents), u.status, u.agreement_no ? renterName(u) : "", u.agreement_no, u.features]),
      };
    },
  },
  renters: {
    cap: "renters.view",
    run(ctx, q) {
      const f = filters(q, { eq: { status: "r.status", kind: "r.kind" }, search: [NAME, "r.company", "r.email", "r.phone", "r.renter_no"] });
      const finance = can(ctx.user.role, "finance.view");
      const rows = ctx.db.all<Record<string, any>>(
        `SELECT r.*, (SELECT GROUP_CONCAT(u.unit_number, ' ') FROM agreements a JOIN units u ON u.id = a.unit_id WHERE a.renter_id = r.id AND a.status = 'active') AS units,
                (SELECT COALESCE(SUM(balance_cents), 0) FROM invoices i WHERE i.renter_id = r.id AND i.status IN ('open','partial')) AS balance
           FROM renters r WHERE ${f.where.join(" AND ")} ORDER BY r.renter_no`,
        f.params,
      );
      // the ID number is never exported
      return {
        columns: ["Renter no", "Type", "Name", "Contact", "Email", "Phone", "Address", "Status", "Units", ...(finance ? ["Balance owed"] : [])],
        rows: rows.map((r) => [r.renter_no, r.kind, renterName(r), `${r.first_name} ${r.last_name}`.trim(), r.email, r.phone, r.address, r.status, r.units, ...(finance ? [csv$(r.balance)] : [])]),
      };
    },
  },
  agreements: {
    cap: "agreements.view",
    run(ctx, q) {
      const f = filters(q, { eq: { term: "a.term_type" }, search: ["a.agreement_no", "u.unit_number", NAME, "r.company"] });
      const status = q.get("status") || "all";
      const t = today();
      if (status === "expiring") { f.where.push("a.status = 'active' AND a.term_type = 'fixed' AND a.end_date BETWEEN ? AND ?"); f.params.push(t, addDays(t, 60)); }
      else if (status === "moving_out") f.where.push("a.status = 'active' AND a.move_out_date IS NOT NULL");
      else if (status !== "all") { f.where.push("a.status = ?"); f.params.push(status); }
      const s = scope(ctx, "a.facility_id");
      const rows = ctx.db.all<Record<string, any>>(
        `SELECT a.*, u.unit_number, f.name AS facility, r.first_name, r.last_name, r.company, r.kind,
                (SELECT COALESCE(SUM(CASE WHEN type = 'collected' THEN amount_cents ELSE -amount_cents END), 0) FROM deposit_transactions d WHERE d.agreement_id = a.id) AS held
           FROM agreements a JOIN units u ON u.id = a.unit_id JOIN renters r ON r.id = a.renter_id JOIN facilities f ON f.id = a.facility_id
          WHERE ${f.where.join(" AND ")}${s.sql} ORDER BY a.agreement_no`,
        [...f.params, ...s.params],
      );
      return {
        columns: ["Agreement", "Facility", "Unit", "Renter", "Type", "Start", "End", "Term months", "Monthly rate", "Discount", "Deposit required", "Deposit held", "Renewal option", "Status", "Signed", "Move-out date"],
        rows: rows.map((a) => [a.agreement_no, a.facility, a.unit_number, renterName(a), a.term_type, a.start_date, a.end_date, a.term_months, csv$(a.monthly_rate_cents), csv$(a.discount_cents), csv$(a.deposit_cents), csv$(a.held), a.renewal_option, a.status, a.signed_at?.slice(0, 10), a.move_out_date]),
      };
    },
  },
  invoices: {
    cap: "finance.view",
    run(ctx, q) {
      const f = filters(q, { eq: { renter: "i.renter_id", kind: "i.kind" }, search: ["i.invoice_no", "u.unit_number", NAME, "r.company"], from: "i.issue_date", to: "i.issue_date" });
      const status = q.get("status");
      const t = today();
      if (status === "unpaid") f.where.push("i.status IN ('open','partial') AND i.balance_cents > 0");
      else if (status === "overdue") { f.where.push("i.status IN ('open','partial') AND i.balance_cents > 0 AND i.due_date < ?"); f.params.push(t); }
      else if (status === "paid" || status === "void") { f.where.push("i.status = ?"); f.params.push(status); }
      const s = scope(ctx, "i.facility_id");
      const rows = ctx.db.all<Record<string, any>>(
        `SELECT i.*, u.unit_number, r.first_name, r.last_name, r.company, r.kind FROM invoices i JOIN renters r ON r.id = i.renter_id LEFT JOIN units u ON u.id = i.unit_id
          WHERE ${f.where.join(" AND ")}${s.sql} ORDER BY i.issue_date, i.invoice_no`,
        [...f.params, ...s.params],
      );
      return {
        columns: ["Invoice", "Renter", "Unit", "Type", "Period start", "Period end", "Issued", "Due", "Currency", "Subtotal", "Discount", "Tax", "Total", "Paid", "Credited", "Balance", "Status", "Sent"],
        rows: rows.map((i) => [i.invoice_no, renterName(i), i.unit_number, i.kind, i.period_start, i.period_end, i.issue_date, i.due_date, i.currency, csv$(i.subtotal_cents), csv$(i.discount_cents), csv$(i.tax_cents), csv$(i.total_cents), csv$(i.paid_cents), csv$(i.credited_cents), csv$(i.balance_cents), displayStatus(i as never, t), i.sent_at?.slice(0, 10)]),
      };
    },
  },
  payments: {
    cap: "finance.view",
    run(ctx, q) {
      const f = filters(q, { eq: { method: "p.method", renter: "p.renter_id", pstatus: "p.status" }, search: ["p.payment_no", "p.reference", NAME, "r.company"], from: "p.received_date", to: "p.received_date" });
      const s = scope(ctx, "p.facility_id");
      const rows = ctx.db.all<Record<string, any>>(
        `SELECT p.*, r.first_name, r.last_name, r.company, r.kind,
                (SELECT GROUP_CONCAT(i.invoice_no, ' ') FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id WHERE pa.payment_id = p.id) AS invoices
           FROM payments p JOIN renters r ON r.id = p.renter_id WHERE ${f.where.join(" AND ")}${s.sql} ORDER BY p.received_date, p.payment_no`,
        [...f.params, ...s.params],
      );
      return {
        columns: ["Payment", "Received", "Renter", "Method", "Reference", "Amount", "Refunded", "Tendered currency", "Tendered amount", "Applied to", "Status", "Reconciled", "Statement"],
        rows: rows.map((p) => [p.payment_no, p.received_date, renterName(p), p.method, p.reference, csv$(p.amount_cents), csv$(p.refunded_cents), p.tendered_currency, p.tendered_cents ? csv$(p.tendered_cents) : "", p.invoices, p.status, p.reconciled_at?.slice(0, 10), p.statement_ref]),
      };
    },
  },
  deposits: {
    cap: "finance.view",
    run(ctx) {
      const s = scope(ctx, "d.facility_id");
      const rows = ctx.db.all<Record<string, any>>(
        `SELECT d.*, a.agreement_no, u.unit_number, r.first_name, r.last_name, r.company, r.kind FROM deposit_transactions d
           JOIN agreements a ON a.id = d.agreement_id JOIN units u ON u.id = a.unit_id JOIN renters r ON r.id = d.renter_id WHERE 1 = 1${s.sql} ORDER BY d.txn_date, d.created_at`,
        s.params,
      );
      return {
        columns: ["Date", "Agreement", "Unit", "Renter", "Type", "Amount", "Method", "Reference", "Notes"],
        rows: rows.map((d) => [d.txn_date, d.agreement_no, d.unit_number, renterName(d), d.type, csv$(d.type === "collected" ? d.amount_cents : -d.amount_cents), d.method, d.reference, d.notes]),
      };
    },
  },
  reservations: {
    cap: "reservations.view",
    run(ctx, q) {
      const f = filters(q, { eq: { status: "res.status", source: "res.source" }, search: ["res.name", "res.email", "res.phone", "res.reservation_no", "u.unit_number"] });
      const s = scope(ctx, "res.facility_id");
      const rows = ctx.db.all<Record<string, any>>(
        `SELECT res.*, u.unit_number, f.name AS facility FROM reservations res JOIN facilities f ON f.id = res.facility_id LEFT JOIN units u ON u.id = res.unit_id
          WHERE ${f.where.join(" AND ")}${s.sql} ORDER BY res.created_at`,
        [...f.params, ...s.params],
      );
      return { columns: ["Reservation", "Facility", "Unit", "Name", "Email", "Phone", "Wanted size", "Wanted type", "Wanted area m2", "Move-in", "Hold until", "Status", "Source", "Created", "Notes"], rows: rows.map((r) => [r.reservation_no, r.facility, r.unit_number, r.name, r.email, r.phone, r.desired_size, r.desired_type, r.desired_area_m2, r.desired_start, r.hold_until, r.status, r.source, r.created_at.slice(0, 10), r.notes]) };
    },
  },
  audit: {
    cap: "audit.view",
    run(ctx, q) {
      const f = filters(q, { eq: { entity: "entity", action: "action" }, search: ["summary", "actor_name"] });
      if (q.get("from")) { f.where.push("at >= ?"); f.params.push(q.get("from")); }
      if (q.get("to")) { f.where.push("at <= ?"); f.params.push(`${q.get("to")}T23:59:59Z`); }
      const rows = ctx.db.all<Record<string, any>>(`SELECT * FROM audit_log WHERE ${f.where.join(" AND ")} ORDER BY at DESC LIMIT 20000`, f.params);
      return { columns: ["When (UTC)", "Who", "Role", "Action", "Record type", "Record id", "Summary", "IP"], rows: rows.map((a) => [a.at, a.actor_name, a.actor_role, a.action, a.entity, a.entity_id, a.summary, a.ip]) };
    },
  },
};

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx();
  if (!ctx || ctx.user.role === "renter") return new NextResponse("Not signed in", { status: 401 });
  const { kind } = await params;
  const exporter = EXPORTS[kind];
  if (!exporter) return new NextResponse("Unknown export", { status: 404 });
  if (!can(ctx.user.role, exporter.cap)) return new NextResponse("Not permitted", { status: 403 });
  const { columns, rows } = exporter.run(ctx, new URL(req.url).searchParams);
  audit(ctx.db, ctx.actor, "export", kind, null, `Exported ${rows.length} ${kind} rows to CSV`);
  return csvResponse(toCsv(columns, rows), `${kind}-${today()}.csv`);
}
