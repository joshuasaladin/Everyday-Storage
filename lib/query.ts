/** URL query helpers: filters, sorting and paging all live in the address bar, so views are shareable. */
export type Query = Record<string, string | string[] | undefined>;

export function param(query: Query, key: string): string {
  const v = query[key];
  return typeof v === "string" ? v.trim() : "";
}

export type ListParams = {
  q: string;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  orderBy: string;
  limit: number;
  offset: number;
};

/** `sortable` maps a public column key to the SQL it sorts by — nothing from the URL reaches SQL directly. */
export function listParams(query: Query, sortable: Record<string, string>, defaultSort: string, defaultDir: "asc" | "desc" = "asc", pageSize = 50): ListParams {
  const sort = param(query, "sort") in sortable ? param(query, "sort") : defaultSort;
  const dirRaw = param(query, "dir");
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : sort === defaultSort ? defaultDir : "asc";
  const page = Math.max(1, Number.parseInt(param(query, "page") || "1", 10) || 1);
  return { q: param(query, "q"), sort, dir, page, orderBy: `${sortable[sort]} ${dir === "desc" ? "DESC" : "ASC"}`, limit: pageSize, offset: (page - 1) * pageSize };
}

export function withQuery(base: string, query: Query, patch: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (typeof v === "string" && v) params.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") params.delete(k);
    else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}

export function like(q: string): string {
  return `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
}
