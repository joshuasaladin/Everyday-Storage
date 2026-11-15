import Link from "next/link";
import Icon from "./Icon";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "muted";

export function Chip({ tone = "neutral", children, dot }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return <span className={`chip chip-${tone}${dot ? " chip-dot" : ""}`}>{children}</span>;
}

/** A chip for a value from one of the status lists in lib/. */
export function StatusChip({ list, value }: { list: readonly { value: string; label: string; tone?: string }[]; value: unknown }) {
  const item = list.find((o) => o.value === value);
  return <Chip tone={(item?.tone as Tone) ?? "neutral"} dot>{item?.label ?? String(value ?? "—")}</Chip>;
}

const INVOICE_TONES: Record<string, Tone> = { paid: "good", open: "info", partial: "warn", overdue: "bad", void: "muted", draft: "neutral" };
const INVOICE_LABELS: Record<string, string> = { paid: "Paid", open: "Open", partial: "Part paid", overdue: "Overdue", void: "Void", draft: "Draft" };

export function InvoiceChip({ status }: { status: string }) {
  return <Chip tone={INVOICE_TONES[status] ?? "neutral"} dot>{INVOICE_LABELS[status] ?? status}</Chip>;
}

export function PageHeader({
  eyebrow,
  title,
  blurb,
  actions,
  back,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  blurb?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="btn btn-ghost btn-sm -ml-2 mb-2 no-print">
          <Icon name="back" className="w-3.5 h-3.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
          <h1 className="page-title">{title}</h1>
          {blurb && <p className="text-sm mt-1.5 max-w-2xl" style={{ color: "var(--ink-3)" }}>{blurb}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  dense,
  id,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
  id?: string;
}) {
  return (
    <section className={`panel ${className}`} id={id}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={dense ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  href,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  tone?: Tone;
  icon?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <span className="eyebrow">{label}</span>
        {icon && (
          <span className="grid place-items-center w-7 h-7 rounded-lg shrink-0" style={{ background: `var(--${tone}-bg)`, color: `var(--${tone}-fg)` }}>
            <Icon name={icon} className="w-4 h-4" />
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="text-xs mt-1.5" style={{ color: "var(--ink-3)" }}>{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="panel p-4 block hover:-translate-y-px transition-transform">{body}</Link>
  ) : (
    <div className="panel p-4">{body}</div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="font-medium" style={{ color: "var(--ink-2)" }}>{title}</div>
      {hint && <div className="mt-1">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="text-sm break-words" style={{ color: "var(--ink)" }}>{children || <span style={{ color: "var(--ink-3)" }}>—</span>}</div>
    </div>
  );
}

export function Lines({ text }: { text: unknown }) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return <span style={{ color: "var(--ink-3)" }}>—</span>;
  return (
    <div className="prose-lines text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
      {lines.map((line, i) => <p key={i}>{line}</p>)}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "good" | "bad" | "warn" | "info"; children: React.ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <Icon name={tone === "good" ? "check" : tone === "info" ? "info" : "alert"} className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="tabs mb-5">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className="tab" data-active={t.key === active} scroll={false}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 chip chip-muted" style={{ padding: "0 .4rem" }}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Meter({ value, tone }: { value: number; tone?: "good" | "warn" | "bad" }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="meter" role="img" aria-label={`${Math.round(pct)}%`}>
      <span style={{ width: `${pct}%`, background: tone ? `var(--${tone}-fg)` : undefined }} />
    </div>
  );
}

/** Label + control + optional hint, used by every form. */
export function Field({ label, hint, children, className = "" }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint block">{hint}</span>}
    </label>
  );
}

export function Check({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 text-sm cursor-pointer">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="hint block" style={{ marginTop: 2 }}>{hint}</span>}
      </span>
    </label>
  );
}
