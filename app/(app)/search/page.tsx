import { unitOrderSql } from "@/lib/unit-options";
import Link from "next/link";
import { Card, EmptyState, InvoiceChip, PageHeader, StatusChip } from "@/components/ui";
import { requireStaff, scope } from "@/lib/auth";
import { can } from "@/lib/roles";
import { displayStatus } from "@/lib/billing";
import { AGREEMENT_STATUSES } from "@/lib/agreements";
import { RENTER_STATUSES } from "@/lib/renters";
import { UNIT_STATUSES } from "@/lib/units";
import { dims, money, renterName } from "@/lib/format";
import { like, param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff();
  const q = param(await searchParams, "q");
  const { db } = ctx;
  const role = ctx.user.role;
  const l = like(q);
  const esc = `ESCAPE '\\'`;
  const us = scope(ctx, "u.facility_id");
  const units = q ? db.all<Record<string, any>>(`SELECT u.* FROM units u WHERE (u.unit_number LIKE ? ${esc} OR u.location LIKE ? ${esc})${us.sql} ORDER BY ${unitOrderSql()} LIMIT 10`, [l, l, ...us.params]) : [];
  const renters = q ? db.all<Record<string, any>>(`SELECT id, renter_no, kind, first_name, last_name, company, email, phone, status FROM renters r WHERE r.first_name || ' ' || r.last_name LIKE ? ${esc} OR r.company LIKE ? ${esc} OR r.email LIKE ? ${esc} OR r.phone LIKE ? ${esc} OR r.renter_no LIKE ? ${esc} LIMIT 10`, [l, l, l, l, l]) : [];
  const agreements = q && can(role, "agreements.view") ? db.all<Record<string, any>>(`SELECT a.id, a.agreement_no, a.status, u.unit_number, r.first_name, r.last_name, r.company, r.kind FROM agreements a JOIN units u ON u.id = a.unit_id JOIN renters r ON r.id = a.renter_id WHERE a.agreement_no LIKE ? ${esc} LIMIT 10`, [l]) : [];
  const invoices = q && can(role, "finance.view") ? db.all<Record<string, any>>(`SELECT i.*, r.first_name, r.last_name, r.company, r.kind FROM invoices i JOIN renters r ON r.id = i.renter_id WHERE i.invoice_no LIKE ? ${esc} ORDER BY i.issue_date DESC LIMIT 10`, [l]) : [];
  const payments = q && can(role, "finance.view") ? db.all<Record<string, any>>(`SELECT p.*, r.first_name, r.last_name, r.company, r.kind FROM payments p JOIN renters r ON r.id = p.renter_id WHERE p.payment_no LIKE ? ${esc} OR p.reference LIKE ? ${esc} ORDER BY p.received_date DESC LIMIT 10`, [l, l]) : [];
  const total = units.length + renters.length + agreements.length + invoices.length + payments.length;
  const cur = ctx.settings.base_currency;
  const Row = ({ href, title, sub, right }: { href: string; title: string; sub: string; right?: React.ReactNode }) => (
    <li style={{ borderTop: "1px solid var(--line)" }}>
      <Link href={href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--panel-2)]">
        <div className="min-w-0 flex-1"><div className="text-sm font-medium">{title}</div><div className="text-xs truncate" style={{ color: "var(--ink-3)" }}>{sub}</div></div>
        {right}
      </Link>
    </li>
  );

  return (
    <>
      <PageHeader eyebrow="Search" title={q ? `Results for “${q}”` : "Search"} blurb={q ? `${total} ${total === 1 ? "match" : "matches"} across units, renters, agreements, invoices and payments.` : "Type a unit number, a name, a phone number, an invoice number or a payment reference in the box above."} />
      {q && total === 0 && <Card><EmptyState title="Nothing found" hint="Try part of a name, or just the number." /></Card>}
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {units.length > 0 && <Card title="Units" dense><ul className="-mt-px">{units.map((u) => <Row key={u.id} href={`/units/${u.id}`} title={`Unit ${u.unit_number}`} sub={`${dims(u)} · ${u.location ?? ""}`} right={<StatusChip list={UNIT_STATUSES} value={u.status} />} />)}</ul></Card>}
        {renters.length > 0 && <Card title="Renters" dense><ul className="-mt-px">{renters.map((r) => <Row key={r.id} href={`/renters/${r.id}`} title={renterName(r)} sub={[r.renter_no, r.phone, r.email].filter(Boolean).join(" · ")} right={<StatusChip list={RENTER_STATUSES} value={r.status} />} />)}</ul></Card>}
        {agreements.length > 0 && <Card title="Agreements" dense><ul className="-mt-px">{agreements.map((a) => <Row key={a.id} href={`/agreements/${a.id}`} title={a.agreement_no} sub={`Unit ${a.unit_number} · ${renterName(a)}`} right={<StatusChip list={AGREEMENT_STATUSES} value={a.status} />} />)}</ul></Card>}
        {invoices.length > 0 && <Card title="Invoices" dense><ul className="-mt-px">{invoices.map((i) => <Row key={i.id} href={`/invoices/${i.id}`} title={i.invoice_no} sub={`${renterName(i)} · ${money(i.total_cents, i.currency)}`} right={<InvoiceChip status={displayStatus(i as never)} />} />)}</ul></Card>}
        {payments.length > 0 && <Card title="Payments" dense><ul className="-mt-px">{payments.map((p) => <Row key={p.id} href={`/payments/${p.id}`} title={p.payment_no} sub={`${renterName(p)} · ${p.reference ?? p.method}`} right={<span className="text-sm font-semibold num">{money(p.amount_cents, cur)}</span>} />)}</ul></Card>}
      </div>
    </>
  );
}
