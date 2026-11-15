import RenterForm from "@/components/RenterForm";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { param, type Query } from "@/lib/query";

export const metadata = { title: "New renter" };

export default async function NewRenterPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("renters.edit");
  const next = param(await searchParams, "next");
  return (
    <>
      <PageHeader title="New renter" back={{ href: "/renters", label: "Renters" }} />
      <RenterForm canSensitive={can(ctx.user.role, "renters.sensitive")} next={next || undefined} />
    </>
  );
}
