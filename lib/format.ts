import { daysBetween, today } from "./clock";

/** Client-safe formatting helpers. Money is always integer cents. */

export const CURRENCIES: Record<string, { symbol: string; label: string }> = {
  USD: { symbol: "$", label: "US Dollar" },
  AWG: { symbol: "Afl.", label: "Aruban Florin" },
};

export function money(cents: unknown, currency = "USD"): string {
  const n = Number(cents ?? 0) / 100;
  if (!Number.isFinite(n)) return "—";
  const sym = CURRENCIES[currency]?.symbol ?? `${currency} `;
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const spaced = sym.length > 1 ? `${sym} ` : sym;
  return `${n < 0 ? "−" : ""}${spaced}${body}`;
}

/** 1,284 · 12.9K · 4.2M — for stat tiles and axis ticks. */
export function compactMoney(cents: unknown, currency = "USD"): string {
  const n = Number(cents ?? 0) / 100;
  if (!Number.isFinite(n)) return "—";
  const sym = CURRENCIES[currency]?.symbol ?? `${currency} `;
  const spaced = sym.length > 1 ? `${sym} ` : sym;
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000) body = `${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  else if (abs >= 10_000) body = `${(abs / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  else body = abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${n < 0 ? "−" : ""}${spaced}${body}`;
}

/** "1,250.50" → 125050. Returns null when it is not a number. */
export function parseCents(value: unknown): number | null {
  const raw = String(value ?? "").replace(/[,\s$]/g, "").trim();
  if (!raw || !/^-?\d+(\.\d{1,2})?$/.test(raw)) return null;
  return Math.round(Number(raw) * 100);
}

export function centsInput(cents: unknown): string {
  if (cents === null || cents === undefined || cents === "") return "";
  return (Number(cents) / 100).toFixed(2);
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(value: unknown): string {
  if (!value) return "—";
  const s = String(value);
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: s.length === 10 ? "UTC" : "America/Aruba",
  });
}

export function formatDateTime(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Aruba",
  });
}

export function relativeDay(value: unknown): string {
  if (!value) return "—";
  const days = daysBetween(today(), String(value).slice(0, 10));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export function timeAgo(value: unknown): string {
  if (!value) return "";
  const then = new Date(String(value)).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function fileSize(bytes: unknown): string {
  const n = Number(bytes ?? 0);
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function initials(name: unknown): string {
  return String(name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function titleCase(value: unknown): string {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function renterName(r: { first_name?: unknown; last_name?: unknown; company?: unknown; kind?: unknown } | null | undefined): string {
  if (!r) return "—";
  const person = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
  if (r.kind === "business" && r.company) return String(r.company);
  return person || String(r.company ?? "—");
}

/** "1.5 × 3 × 2.4 m" — every unit size in the app is in metres. */
export function dims(u: { width_m?: unknown; depth_m?: unknown; height_m?: unknown }): string {
  const w = Number(u.width_m ?? 0);
  const d = Number(u.depth_m ?? 0);
  const h = Number(u.height_m ?? 0);
  if (!w || !d) return "—";
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return h ? `${n(w)} × ${n(d)} × ${n(h)} m` : `${n(w)} × ${n(d)} m`;
}

/** Floor area in square metres, to one decimal. */
export function area(u: { width_m?: unknown; depth_m?: unknown }): number {
  return Math.round(Number(u.width_m ?? 0) * Number(u.depth_m ?? 0) * 10) / 10;
}
