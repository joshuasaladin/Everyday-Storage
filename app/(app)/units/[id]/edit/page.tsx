import { notFound } from "next/navigation";
import UnitForm from "@/components/UnitForm";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";

export const metadata = { title: "Edit unit" };

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff("units.edit");
  const { id } = await params;
  const unit = ctx.db.one<Record<string, any>>(`SELECT * FROM units WHERE id = ?`, [id]);
  if (!unit) notFound();
  return (
    <>
      <PageHeader title={`Edit unit ${unit.unit_number}`} back={{ href: `/units/${id}`, label: `Unit ${unit.unit_number}` }} />
      <UnitForm unit={unit} facilities={ctx.facilities} facilityId={ctx.facilityId} currency={ctx.settings.base_currency} />
    </>
  );
}
