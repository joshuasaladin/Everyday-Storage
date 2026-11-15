/**
 * Dates, Aruba-local. The server runs on UTC; every "today" in the app comes
 * from here so invoices, due dates and reminders roll over at Aruba midnight.
 * Client-safe: no database, no Node APIs.
 */
export const TIME_ZONE = "America/Aruba";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function parts(at: Date) {
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Today in Aruba, YYYY-MM-DD. Tests can pin it with SHQ_TODAY. */
export function today(at: Date = new Date()): string {
  if (typeof process !== "undefined" && process.env?.SHQ_TODAY) return process.env.SHQ_TODAY;
  return parts(at).day;
}

export function localHour(at: Date = new Date()): number {
  return parts(at).hour;
}

export function nowIso(): string {
  return new Date().toISOString();
}

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = toDate(value);
  return !Number.isNaN(d.getTime()) && toIso(d) === value;
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Calendar-month arithmetic that clamps to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number, anchorDay?: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const day = anchorDay ?? d;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(day, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 864e5);
}

/** Completed whole months between two dates. */
export function monthsBetween(a: string, b: string): number {
  if (b < a) return 0;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  let months = (by - ay) * 12 + (bm - am);
  if (bd < ad && bd < daysInMonth(by, bm)) months -= 1;
  return Math.max(0, months);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${iso.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(key: string, withYear = false): string {
  const [y, m] = key.split("-").map(Number);
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}
