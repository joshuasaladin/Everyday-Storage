import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Two completely separate SQLite files:
 *
 *   live  — real production records            DATA_DIR/storage.db
 *   demo  — example data for testing/training  DATA_DIR/demo/storage-demo.db
 *
 * Example data never sits next to real records: it is a different database
 * (and a different uploads folder), selected per session. Every library
 * function takes the DB it should talk to, so nothing can cross over.
 */
export type Workspace = "live" | "demo";

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

export function workspaceDir(ws: Workspace): string {
  return ws === "demo" ? path.join(DATA_DIR, "demo") : DATA_DIR;
}

export function uploadDir(ws: Workspace): string {
  return path.join(workspaceDir(ws), "uploads");
}

export class DB {
  constructor(
    public raw: Database.Database,
    public workspace: Workspace,
  ) {}

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
  var __shqDbs: Partial<Record<Workspace, DB>> | undefined;
}

function open(ws: Workspace, file?: string): DB {
  const dir = workspaceDir(ws);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(uploadDir(ws), { recursive: true });

  const raw = new Database(file ?? path.join(dir, ws === "demo" ? "storage-demo.db" : "storage.db"));
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma("busy_timeout = 5000");
  const fresh = !raw.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'units'`).get();
  raw.exec(fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  const { migrate, SCHEMA_VERSION } = require("./migrate") as typeof import("./migrate");
  if (fresh) raw.pragma(`user_version = ${SCHEMA_VERSION}`);
  else migrate(raw);
  return new DB(raw, ws);
}

export function getDb(ws: Workspace): DB {
  global.__shqDbs ??= {};
  let db = global.__shqDbs[ws];
  if (!db) {
    if (ws === "demo") resetStaleDemo();
    db = open(ws);
    global.__shqDbs[ws] = db;
    // lazy requires: bootstrap pulls in modules that import this file
    const { bootstrap } = require("./bootstrap") as typeof import("./bootstrap");
    bootstrap(db);
  }
  return db;
}

/**
 * Example data is cheaper to rebuild than to migrate: when the code expects a
 * newer schema than the demo file has, the demo is thrown away and re-seeded.
 */
function resetStaleDemo(): void {
  const file = path.join(workspaceDir("demo"), "storage-demo.db");
  if (!fs.existsSync(file)) return;
  const { SCHEMA_VERSION } = require("./migrate") as typeof import("./migrate");
  const probe = new Database(file);
  const version = Number(probe.pragma("user_version", { simple: true }));
  probe.close();
  if (version < SCHEMA_VERSION) {
    for (const f of ["storage-demo.db", "storage-demo.db-wal", "storage-demo.db-shm"]) fs.rmSync(path.join(workspaceDir("demo"), f), { force: true });
    fs.rmSync(uploadDir("demo"), { recursive: true, force: true });
  }
}

/** An isolated in-memory database with schema + defaults — used by the tests. */
export function memoryDb(): DB {
  const db = open("demo", ":memory:");
  const { ensureDefaults } = require("./bootstrap") as typeof import("./bootstrap");
  ensureDefaults(db);
  return db;
}

/** Throw the demo database away so it is rebuilt from the seed on next use. */
export function dropDemo(): void {
  const db = global.__shqDbs?.demo;
  if (db) {
    db.raw.close();
    delete global.__shqDbs!.demo;
  }
  const dir = workspaceDir("demo");
  for (const f of ["storage-demo.db", "storage-demo.db-wal", "storage-demo.db-shm"]) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
  fs.rmSync(uploadDir("demo"), { recursive: true, force: true });
}

export function id(): string {
  return crypto.randomUUID();
}
