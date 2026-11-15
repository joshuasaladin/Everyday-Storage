import { can, type Cap, type Role } from "./roles";

export type NavItem = { href: string; label: string; icon: string; cap: Cap };
export type NavGroup = { group: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: "grid", cap: "units.view" },
      { href: "/map", label: "Facility map", icon: "map", cap: "units.view" },
    ],
  },
  {
    group: "Rentals",
    items: [
      { href: "/units", label: "Storage units", icon: "door", cap: "units.view" },
      { href: "/renters", label: "Renters", icon: "users", cap: "renters.view" },
      { href: "/agreements", label: "Agreements", icon: "pen", cap: "agreements.view" },
      { href: "/reservations", label: "Reservations", icon: "bookmark", cap: "reservations.view" },
    ],
  },
  {
    group: "Finance",
    items: [
      { href: "/invoices", label: "Invoices", icon: "receipt", cap: "finance.view" },
      { href: "/payments", label: "Payments", icon: "card", cap: "finance.view" },
      { href: "/expenses", label: "Expenses", icon: "wallet", cap: "finance.view" },
      { href: "/reports", label: "Reports", icon: "chart", cap: "reports.view" },
    ],
  },
  {
    group: "Operations",
    items: [
      { href: "/maintenance", label: "Maintenance", icon: "wrench", cap: "maintenance.view" },
      { href: "/automations", label: "Automations", icon: "zap", cap: "automations.view" },
    ],
  },
  {
    group: "Admin",
    items: [
      { href: "/settings", label: "Settings", icon: "gear", cap: "settings.edit" },
      { href: "/audit", label: "Audit log", icon: "history", cap: "audit.view" },
    ],
  },
];

export function navFor(role: Role): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.cap)) })).filter((g) => g.items.length);
}
