/** Client-safe role + capability model. */
export type StaffRole = "owner" | "admin" | "manager" | "staff";
export type Role = StaffRole | "renter";

export const ROLES: { value: StaffRole; label: string; blurb: string }[] = [
  { value: "staff", label: "Staff", blurb: "Units, facility map, renters and reservations. No financial data." },
  { value: "manager", label: "Manager", blurb: "Everything staff sees, plus agreements, invoices, payments and reports." },
  { value: "admin", label: "Admin", blurb: "Everything, including refunds, settings, automations, users and the audit log." },
  { value: "owner", label: "Owner", blurb: "Full access. Cannot be demoted or disabled by an admin." },
];

const RANK: Record<Role, number> = { renter: 0, staff: 1, manager: 2, admin: 3, owner: 4 };

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** What each capability needs. One table, checked server-side on every read and write. */
export const CAPS = {
  "units.view": "staff",
  "units.edit": "manager",
  "renters.view": "staff",
  "renters.edit": "staff",
  "renters.sensitive": "manager", // ID numbers
  "reservations.view": "staff",
  "reservations.edit": "staff",
  "agreements.view": "manager",
  "agreements.edit": "manager",
  "finance.view": "manager",
  "finance.edit": "manager",
  "finance.refund": "admin",
  "reports.view": "manager",
  "automations.view": "manager",
  "automations.edit": "admin",
  "settings.edit": "admin",
  "users.manage": "admin",
  "audit.view": "admin",
} as const satisfies Record<string, StaffRole>;

export type Cap = keyof typeof CAPS;

export function can(role: Role, cap: Cap): boolean {
  return atLeast(role, CAPS[cap]);
}
