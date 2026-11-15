import { cookies } from "next/headers";
import Shell from "@/components/Shell";
import { demoEnabled, hasLiveSession, requireStaff } from "@/lib/auth";
import { navFor } from "@/lib/nav";
import { can } from "@/lib/roles";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const ctx = await requireStaff();
  const theme = (await cookies()).get("shq_theme")?.value;
  const role = ctx.user.role;

  const quickAdd = [
    can(role, "renters.edit") && { href: "/renters/new", label: "Renter", icon: "users" },
    can(role, "agreements.edit") && { href: "/agreements/new", label: "Rental agreement", icon: "pen" },
    can(role, "finance.edit") && { href: "/payments?record=1", label: "Record a payment", icon: "card" },
    can(role, "finance.edit") && { href: "/invoices/new", label: "Invoice", icon: "receipt" },
    can(role, "reservations.edit") && { href: "/reservations?new=1", label: "Reservation", icon: "bookmark" },
    can(role, "units.edit") && { href: "/units/new", label: "Storage unit", icon: "door" },
  ].filter(Boolean) as { href: string; label: string; icon: string }[];

  return (
    <Shell
      nav={navFor(role)}
      user={{ name: ctx.user.name, role }}
      workspace={ctx.workspace}
      demoAvailable={demoEnabled()}
      canReturnLive={ctx.workspace === "demo" ? await hasLiveSession() : false}
      facilities={ctx.facilities.map((f) => ({ id: f.id, name: f.name }))}
      facilityId={ctx.facilityId}
      theme={theme === "light" || theme === "dark" ? theme : "system"}
      quickAdd={quickAdd}
    >
      {children}
    </Shell>
  );
}
