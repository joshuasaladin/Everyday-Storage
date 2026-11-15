import InvoiceForm from "@/components/InvoiceForm";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { today } from "@/lib/clock";
import { taxRateBp } from "@/lib/settings";
import { renterName } from "@/lib/format";
import { param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("finance.edit");
  const query = await searchParams;
  const renters = ctx.db.all<Record<string, any>>(`SELECT id, renter_no, kind, first_name, last_name, company FROM renters ORDER BY COALESCE(NULLIF(company, ''), last_name || first_name) COLLATE NOCASE`);
  const agreements = ctx.db.all<Record<string, any>>(
    `SELECT a.id, a.renter_id, a.agreement_no, u.unit_number FROM agreements a JOIN units u ON u.id = a.unit_id WHERE a.status IN ('active','ended') ORDER BY a.agreement_no DESC`,
  );
  return (
    <>
      <PageHeader title="New invoice" back={{ href: "/invoices", label: "Invoices" }} blurb="For one-off charges — a lock, a cleaning fee, an administration charge. Monthly rent invoices are generated automatically." />
      <InvoiceForm
        currency={ctx.settings.base_currency}
        taxRate={taxRateBp(ctx.db)}
        today={today()}
        defaultRenter={param(query, "renter") || undefined}
        facilities={ctx.facilities}
        renters={renters.map((r) => ({ id: r.id, label: `${renterName(r)} (${r.renter_no})` }))}
        agreements={agreements.map((a) => ({ id: a.id, renter_id: a.renter_id, label: `${a.agreement_no} · unit ${a.unit_number}` }))}
      />
    </>
  );
}
