import { notFound } from "next/navigation";
import RenterForm from "@/components/RenterForm";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { renterName } from "@/lib/format";

export const metadata = { title: "Edit renter" };

export default async function EditRenterPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("renters.edit");
  const { id } = await params;
  const renter = ctx.db.one<Record<string, any>>(
    `SELECT id, kind, first_name, last_name, company, email, phone, phone_alt, id_type, id_last4, address, city, country,
            emergency_name, emergency_phone, emergency_relation, notes FROM renters WHERE id = ?`,
    [id],
  );
  if (!renter) notFound();
  return (
    <>
      <PageHeader title={`Edit ${renterName(renter)}`} back={{ href: `/renters/${id}`, label: renterName(renter) }} />
      <RenterForm renter={renter} canSensitive={can(ctx.user.role, "renters.sensitive")} />
    </>
  );
}
