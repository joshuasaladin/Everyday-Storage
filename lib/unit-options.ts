/** Unit types, size classes and statuses. Client-safe: used by forms in the browser too. */

export const UNIT_TYPES = [
  { value: "storage_unit", label: "Storage unit" },
  { value: "warehouse", label: "Warehouse" },
];

export const UNIT_SIZES = [
  { value: "small", label: "Small" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Large" },
];

/** Fixed dimensions (metres) for the standard sizes. Large varies, so it has none. */
export const SIZE_PRESETS: Record<string, { width: number; depth: number; height: number } | undefined> = {
  small: { width: 1.5, depth: 3, height: 2.4 },
  standard: { width: 3, depth: 3, height: 2.4 },
};

export const UNIT_STATUSES = [
  { value: "available", label: "Available", tone: "good" },
  { value: "occupied", label: "Occupied", tone: "info" },
  { value: "reserved", label: "Reserved", tone: "warn" },
  { value: "unavailable", label: "Unavailable", tone: "muted" },
] as const;

export type UnitStatus = (typeof UNIT_STATUSES)[number]["value"];

export function label(list: readonly { value: string; label: string }[], value: unknown): string {
  return list.find((o) => o.value === value)?.label ?? String(value ?? "—");
}
