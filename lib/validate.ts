import { isIsoDate } from "./clock";
import { parseCents } from "./format";

/** A problem the person can fix. Its message is safe to show. */
export class UserError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type ActionState = { error?: string; fields?: Record<string, string>; ok?: string; data?: Record<string, string> } | null;

type Opts = { required?: boolean; label?: string; max?: number; min?: number };

/** Reads and validates a submitted form, collecting every problem before failing. */
export class Form {
  errors: Record<string, string> = {};
  constructor(private form: FormData) {}

  private raw(name: string): string {
    const v = this.form.get(name);
    return typeof v === "string" ? v.trim() : "";
  }
  private fail(name: string, message: string) {
    this.errors[name] ??= message;
  }
  private name(name: string, o: Opts) {
    return o.label ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }

  str(name: string, o: Opts = {}): string | null {
    const v = this.raw(name);
    if (!v) {
      if (o.required) this.fail(name, `${this.name(name, o)} is required.`);
      return null;
    }
    if (v.length > (o.max ?? 300)) this.fail(name, `${this.name(name, o)} is too long.`);
    return v;
  }
  req(name: string, o: Opts = {}): string {
    return this.str(name, { ...o, required: true }) ?? "";
  }
  text(name: string, o: Opts = {}): string | null {
    return this.str(name, { max: 20000, ...o });
  }
  email(name: string, o: Opts = {}): string | null {
    const v = this.str(name, { max: 254, ...o });
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) this.fail(name, "Enter a valid email address.");
    return v ? v.toLowerCase() : null;
  }
  cents(name: string, o: Opts = {}): number | null {
    const v = this.raw(name);
    if (!v) {
      if (o.required) this.fail(name, `${this.name(name, o)} is required.`);
      return null;
    }
    const c = parseCents(v);
    if (c === null) {
      this.fail(name, `${this.name(name, o)} must be an amount like 125.00.`);
      return null;
    }
    if (c < (o.min ?? 0)) this.fail(name, `${this.name(name, o)} is too low.`);
    if (c > (o.max ?? 100_000_000)) this.fail(name, `${this.name(name, o)} is too high.`);
    return c;
  }
  num(name: string, o: Opts = {}): number | null {
    const v = this.raw(name);
    if (!v) {
      if (o.required) this.fail(name, `${this.name(name, o)} is required.`);
      return null;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      this.fail(name, `${this.name(name, o)} must be a number.`);
      return null;
    }
    if (o.min !== undefined && n < o.min) this.fail(name, `${this.name(name, o)} must be at least ${o.min}.`);
    if (o.max !== undefined && n > o.max) this.fail(name, `${this.name(name, o)} must be at most ${o.max}.`);
    return n;
  }
  int(name: string, o: Opts = {}): number | null {
    const n = this.num(name, o);
    if (n !== null && !Number.isInteger(n)) this.fail(name, `${this.name(name, o)} must be a whole number.`);
    return n;
  }
  date(name: string, o: Opts = {}): string | null {
    const v = this.raw(name);
    if (!v) {
      if (o.required) this.fail(name, `${this.name(name, o)} is required.`);
      return null;
    }
    if (!isIsoDate(v)) {
      this.fail(name, `${this.name(name, o)} is not a valid date.`);
      return null;
    }
    return v;
  }
  oneOf<T extends string>(name: string, allowed: readonly T[], o: Opts & { fallback?: T } = {}): T {
    const v = this.raw(name);
    if (!v && o.fallback !== undefined && !o.required) return o.fallback;
    if (!(allowed as readonly string[]).includes(v)) {
      this.fail(name, `Choose a valid ${this.name(name, o).toLowerCase()}.`);
      return (o.fallback ?? allowed[0]) as T;
    }
    return v as T;
  }
  bool(name: string): boolean {
    const v = this.form.get(name);
    return v === "on" || v === "1" || v === "true";
  }
  list(name: string): string[] {
    return this.form.getAll(name).filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  intList(name: string, o: Opts = {}): number[] {
    const v = this.raw(name);
    if (!v) return [];
    const parts = v.split(/[,\s]+/).filter(Boolean).map(Number);
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 365)) {
      this.fail(name, `${this.name(name, o)} must be whole numbers of days separated by commas.`);
      return [];
    }
    return [...new Set(parts)].sort((a, b) => a - b);
  }
  /** Throws with every collected problem. Call once all fields are read. */
  check(): void {
    const keys = Object.keys(this.errors);
    if (keys.length) throw new UserError(this.errors[keys[0]], this.errors);
  }
}

const isNextSignal = (err: unknown) =>
  typeof (err as { digest?: unknown })?.digest === "string" && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR)/.test((err as { digest: string }).digest);

/** Wrap a server action body: validation problems come back as state, redirects pass through. */
export async function act(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: "Saved." };
  } catch (err) {
    if (isNextSignal(err)) throw err;
    if (err instanceof UserError) return { error: err.message, fields: err.fields };
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed: units/.test(message)) return { error: "A unit with that number already exists at this facility." };
    if (/UNIQUE constraint failed: users.email/.test(message)) return { error: "Someone already signs in with that email." };
    if (/UNIQUE constraint failed: uq_agreement_unit_live|agreements.unit_id/.test(message)) return { error: "That unit is already under an agreement." };
    if (/UNIQUE constraint failed: facilities.code/.test(message)) return { error: "Another facility already uses that code." };
    if (/constraint failed/i.test(message)) {
      console.error("[action] constraint:", message);
      return { error: "That conflicts with an existing record, so nothing was changed." };
    }
    if (err instanceof Error && err.name === "Error") return { error: message };
    console.error("[action] unexpected:", err);
    return { error: "Something went wrong and nothing was saved. Please try again." };
  }
}
