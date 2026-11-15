import Link from "next/link";
import Icon from "./Icon";
import { AutoSubmitForm } from "./forms";
import { withQuery, type ListParams, type Query } from "@/lib/query";

/** A column header that sorts by its column; click again to reverse. */
export function SortTh({ col, label, base, query, list, right }: { col: string; label: string; base: string; query: Query; list: ListParams; right?: boolean }) {
  const active = list.sort === col;
  const dir = active && list.dir === "asc" ? "desc" : "asc";
  return (
    <th className={right ? "r" : undefined} aria-sort={active ? (list.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={withQuery(base, query, { sort: col, dir, page: null })} scroll={false} style={right ? { flexDirection: "row-reverse" } : undefined}>
        {label}
        <Icon name={active ? (list.dir === "asc" ? "up" : "down") : "sort"} className="w-3 h-3" />
      </Link>
    </th>
  );
}

export function Pager({ base, query, list, total }: { base: string; query: Query; list: ListParams; total: number }) {
  const pages = Math.max(1, Math.ceil(total / list.limit));
  if (total <= list.limit) {
    return <div className="px-4 py-2.5 text-xs" style={{ color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>{total} {total === 1 ? "record" : "records"}</div>;
  }
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs" style={{ color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>
      <span>{list.offset + 1}–{Math.min(list.offset + list.limit, total)} of {total}</span>
      <span className="flex items-center gap-1.5">
        {list.page > 1 && <Link className="btn btn-sm" href={withQuery(base, query, { page: list.page - 1 })} scroll={false}>Previous</Link>}
        <span>Page {list.page} of {pages}</span>
        {list.page < pages && <Link className="btn btn-sm" href={withQuery(base, query, { page: list.page + 1 })} scroll={false}>Next</Link>}
      </span>
    </div>
  );
}

export type Filter = { name: string; label: string; options: readonly { value: string; label: string }[] };

/** Search + filters that apply themselves, and a CSV export of exactly what is filtered. */
export function Toolbar({
  query,
  placeholder,
  filters = [],
  exportHref,
  children,
  keep = [],
}: {
  query: Query;
  placeholder: string;
  filters?: Filter[];
  exportHref?: string;
  children?: React.ReactNode;
  keep?: string[];
}) {
  const val = (k: string) => (typeof query[k] === "string" ? (query[k] as string) : "");
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 no-print">
      <AutoSubmitForm className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        {["sort", "dir", ...keep].map((k) => val(k) && <input key={k} type="hidden" name={k} value={val(k)} />)}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input name="q" type="search" defaultValue={val("q")} className="input input-icon" placeholder={placeholder} aria-label={placeholder} />
        </div>
        {filters.map((f) => (
          <select key={f.name} name={f.name} defaultValue={val(f.name)} className="select w-auto" aria-label={f.label}>
            <option value="">{f.label}: all</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {children}
      </AutoSubmitForm>
      {exportHref && (
        <a href={exportHref} className="btn" download>
          <Icon name="download" className="w-4 h-4" />
          <span className="hidden sm:inline">Export CSV</span>
        </a>
      )}
    </div>
  );
}

export function exportUrl(kind: string, query: Query): string {
  return withQuery(`/api/export/${kind}`, query, { page: null });
}
