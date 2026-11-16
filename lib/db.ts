import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * One SQLite database for the business, DATA_DIR/storage.db, with uploaded
 * documents beside it in DATA_DIR/uploads.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

export class DB {
  constructor(public raw: Database.Database) {}

  all<T = Record<string, any>>(sql: string, params: unknown[] = []): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  one<T = Record<string, any>>(sql: string, params: unknown[] = []): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, params: unknown[] = []) {
    return this.raw.prepare(sql).run(...(params as never[]));
  }

  /** First column of the first row, as a number (0 when there is none). */
  num(sql: string, params: unknown[] = []): number {
    const row = this.raw.prepare(sql).raw().get(...(params as never[])) as unknown[] | undefined;
    return row ? Number(row[0] ?? 0) : 0;
  }

  /** Atomic unit of work. Nested calls become savepoints. */
  tx<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }

  /** INV-2026-0042 style numbers, gap-free per prefix and year. */
  nextNumber(prefix: string, year: string): string {
    const name = `${prefix}:${year}`;
    const row = this.one<{ value: number }>(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
      [name],
    );
    return `${prefix}-${year}-${String(row!.value).padStart(4, "0")}`;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __shqDb: DB | undefined;
}

function open(file: string): DB {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const raw = new Database(file);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 5000");
  const fresh = !raw.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'units'`).get();
  raw.exec(fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  const { migrate, SCHEMA_VERSION } = require("./migrate") as typeof import("./migrate");
  if (fresh) raw.pragma(`user_version = ${SCHEMA_VERSION}`);
  else migrate(raw);
  return new DB(raw);
}

export function getDb(): DB {
  if (!global.__shqDb) {
    global.__shqDb = open(path.join(DATA_DIR, "storage.db"));
    // the old demo workspace lived in DATA_DIR/demo; it is no longer part of the app
    fs.rmSync(path.join(DATA_DIR, "demo"), { recursive: true, force: true });
    // lazy require: bootstrap pulls in modules that import this file
    const { bootstrap } = require("./bootstrap") as typeof import("./bootstrap");
    bootstrap(global.__shqDb);
  }
  return global.__shqDb;
}

/** An isolated in-memory database with schema + defaults — used by the tests. */
export function memoryDb(): DB {
  const db = open(":memory:");
  const { ensureDefaults } = require("./bootstrap") as typeof import("./bootstrap");
  ensureDefaults(db);
  return db;
}

export function id(): string {
  return crypto.randomUUID();
}
