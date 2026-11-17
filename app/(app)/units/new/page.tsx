import UnitForm from "@/components/UnitForm";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";

export const metadata = { title: "New unit" };

export default async function NewUnitPage() {
  const ctx = await requireStaff("units.edit");
  return (
    <>
      <PageHeader title="New storage unit" back={{ href: "/units", label: "Storage units" }} blurb="It appears on the facility map in the next free cell — you can move it there afterwards." />
      <UnitForm facilities={ctx.facilities} facilityId={ctx.facilityId} defaultLocation={ctx.db.one<{ location: string | null }>(`SELECT location FROM units WHERE location IS NOT NULL AND location <> '' ORDER BY created_at DESC LIMIT 1`)?.location ?? ""} currency={ctx.settings.base_currency} prices={{ small: ctx.settings.price_small_cents, standard: ctx.settings.price_standard_cents }} />
    </>
  );
}
