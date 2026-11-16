import { getDb, id, type DB } from "./db";
import { addDays, daysBetween, localHour, nowIso, today } from "./clock";
import { audit, SYSTEM } from "./audit";
import { getSettings } from "./settings";
import { applyLateFees, generateDueInvoices } from "./billing";
import { processTermEnds } from "./agreements";
import { expireReservations } from "./reservations";
import { syncAllUnits } from "./units";
import { processOutbox, queueAgreementNotice, queueDueReminder, queueInvoiceEmail, queueOverdueReminder } from "./email";

/**
 * Background work.
 *
 * A durable queue in the database rather than timers in memory, so a restart
 * or a crash never loses or repeats work:
 *   - enqueue() is idempotent on dedupe_key ("auto:late_fees:2026-11-14")
 *   - a job is claimed with a compare-and-set before it runs
 *   - failures retry with exponential backoff, then stop as 'dead'
 *   - every handler is itself idempotent (unique indexes / dedupe keys), so
 *     even a job that ran halfway and is retried cannot double-bill or
 *     double-email
 *
 * The scheduler runs inside the web process (see instrumentation.ts) because
 * the SQLite file lives on this service's disk. POST /api/cron does the same
 * tick on demand, for hosts that prefer an external scheduler.
 */

const DAILY_ORDER = [
  "renewals", "reservation_expiry", "generate_invoices", "send_invoices", "late_fees",
  "due_reminders", "overdue_reminders", "expiry_notices", "move_outs",
] as const;

export function enqueue(db: DB, type: string, payload: Record<string, unknown>, dedupeKey: string, runAfter: string = nowIso()): boolean {
  return (
    db.run(
      `INSERT OR IGNORE INTO jobs (id, type, payload, dedupe_key, status, run_after, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      [id(), type, JSON.stringify(payload), dedupeKey, runAfter, nowIso()],
    ).changes > 0
  );
}

type Automation = { key: string; enabled: number; config: string };

function config<T>(a: Automation, key: string, fallback: T): T {
  try {
    const v = JSON.parse(a.config)[key];
    return v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** Run one automation for a given day. Returns a one-line result for the log. */
export function runAutomation(db: DB, key: string, asOf: string = today()): string {
  const a = db.one<Automation>(`SELECT key, enabled, config FROM automations WHERE key = ?`, [key]);
  if (!a) throw new Error(`Unknown automation ${key}`);
  let result = "";

  switch (key) {
    case "renewals": {
      const days = config<number[]>(a, "remind_days_before", [30]);
      let reminded = 0;
      for (const ag of db.all<Record<string, any>>(
        `SELECT id, end_date FROM agreements WHERE status = 'active' AND term_type = 'fixed' AND renewal_option = 'auto_renew'
            AND move_out_date IS NULL AND end_date >= ?`,
        [asOf],
      )) {
        const left = daysBetween(asOf, ag.end_date);
        const stage = days.filter((d) => left <= d).sort((x, y) => x - y)[0];
        if (stage !== undefined && queueAgreementNotice(db, ag.id, "renewal_reminder", `${ag.end_date}:${stage}`)) reminded += 1;
      }
      const r = processTermEnds(db, asOf);
      syncAllUnits(db, asOf);
      result = `${reminded} renewal reminder${reminded === 1 ? "" : "s"}; ${r.renewed} renewed, ${r.rolled} to month-to-month, ${r.ended} ended`;
      break;
    }
    case "reservation_expiry": {
      const n = expireReservations(db, asOf);
      result = `${n} hold${n === 1 ? "" : "s"} released`;
      break;
    }
    case "generate_invoices": {
      const r = generateDueInvoices(db, { asOf });
      result = `${r.created.length} invoice${r.created.length === 1 ? "" : "s"} created, ${r.skipped} already existed`;
      break;
    }
    case "send_invoices": {
      let n = 0;
      for (const inv of db.all<{ id: string }>(
        `SELECT id FROM invoices WHERE sent_at IS NULL AND status IN ('open','partial') AND issue_date >= ? AND issue_date <= ?`,
        [addDays(asOf, -14), asOf],
      )) {
        if (queueInvoiceEmail(db, inv.id)) n += 1;
      }
      result = `${n} invoice email${n === 1 ? "" : "s"} queued`;
      break;
    }
    case "late_fees": {
      const n = applyLateFees(db, { asOf }).length;
      result = `${n} late fee${n === 1 ? "" : "s"} added`;
      break;
    }
    case "due_reminders": {
      const days = config<number[]>(a, "days_before", [3]);
      let n = 0;
      for (const d of days) {
        for (const inv of db.all<{ id: string }>(
          `SELECT id FROM invoices WHERE status IN ('open','partial') AND balance_cents > 0 AND due_date = ?`,
          [addDays(asOf, d)],
        )) {
          if (queueDueReminder(db, inv.id, d)) n += 1;
        }
      }
      result = `${n} reminder${n === 1 ? "" : "s"} queued`;
      break;
    }
    case "overdue_reminders": {
      const days = config<number[]>(a, "days_after", [3, 7, 14, 30]);
      let n = 0;
      for (const inv of db.all<{ id: string; due_date: string }>(
        `SELECT id, due_date FROM invoices WHERE status IN ('open','partial') AND balance_cents > 0 AND due_date < ?`,
        [asOf],
      )) {
        const over = daysBetween(inv.due_date, asOf);
        // only the latest stage reached — never a burst of every missed stage at once
        const stage = days.filter((d) => d <= over).sort((x, y) => y - x)[0];
        if (stage !== undefined && queueOverdueReminder(db, inv.id, stage, over)) n += 1;
      }
      result = `${n} reminder${n === 1 ? "" : "s"} queued`;
      break;
    }
    case "expiry_notices": {
      const days = config<number[]>(a, "days_before", [60, 30, 7]);
      let n = 0;
      for (const ag of db.all<Record<string, any>>(
        `SELECT id, end_date FROM agreements WHERE status = 'active' AND term_type = 'fixed' AND renewal_option <> 'auto_renew'
            AND move_out_date IS NULL AND end_date >= ?`,
        [asOf],
      )) {
        const left = daysBetween(asOf, ag.end_date);
        const stage = days.filter((d) => left <= d).sort((x, y) => x - y)[0];
        if (stage !== undefined && queueAgreementNotice(db, ag.id, "expiry_notice", `${ag.end_date}:${stage}`)) n += 1;
      }
      result = `${n} notice${n === 1 ? "" : "s"} queued`;
      break;
    }
    case "move_outs": {
      const days = config<number[]>(a, "remind_days_before", [3]);
      let n = 0;
      for (const mo of db.all<Record<string, any>>(
        `SELECT id, agreement_id, move_out_date FROM move_outs WHERE status = 'scheduled' AND move_out_date >= ?`,
        [asOf],
      )) {
        const left = daysBetween(asOf, mo.move_out_date);
        const stage = days.filter((d) => left <= d).sort((x, y) => x - y)[0];
        if (stage !== undefined && queueAgreementNotice(db, mo.agreement_id, "move_out_reminder", `${mo.id}:${stage}`)) n += 1;
      }
      const overdue = db.num(`SELECT COUNT(*) FROM move_outs WHERE status = 'scheduled' AND move_out_date < ?`, [asOf]);
      result = `${n} reminder${n === 1 ? "" : "s"} queued; ${overdue} move-out${overdue === 1 ? "" : "s"} waiting to be completed`;
      break;
    }
    default:
      throw new Error(`No handler for automation ${key}`);
  }

  db.run(`UPDATE automations SET last_run_at = ?, last_result = ?, updated_at = ? WHERE key = ?`, [nowIso(), result, nowIso(), key]);
  return result;
}

async function handle(db: DB, job: { type: string; payload: string }): Promise<string> {
  const payload = JSON.parse(job.payload || "{}") as Record<string, string>;
  if (job.type === "daily") {
    const date = payload.date ?? today();
    let queued = 0;
    DAILY_ORDER.forEach((key, i) => {
      const a = db.one<{ enabled: number }>(`SELECT enabled FROM automations WHERE key = ?`, [key]);
      if (!a?.enabled) return;
      // staggered a second apart so they run in dependency order
      if (enqueue(db, "automation", { key, date }, `auto:${key}:${date}`, new Date(Date.now() + i * 1000).toISOString())) queued += 1;
    });
    db.run(`DELETE FROM sessions WHERE expires_at < ?`, [nowIso()]);
    db.run(`DELETE FROM login_attempts WHERE at < ?`, [new Date(Date.now() - 7 * 864e5).toISOString()]);
    return `${queued} automations queued for ${date}`;
  }
  if (job.type === "automation") return runAutomation(db, payload.key, payload.date ?? today());
  throw new Error(`Unknown job type ${job.type}`);
}

/** Claim and run every job that is due. */
export async function runDueJobs(db: DB, limit = 30): Promise<number> {
  // a job stuck in 'running' for 15 minutes belonged to a process that died
  db.run(`UPDATE jobs SET status = 'failed', last_error = 'Interrupted — retrying', run_after = ? WHERE status = 'running' AND locked_at < ?`, [
    nowIso(), new Date(Date.now() - 15 * 60_000).toISOString(),
  ]);
  let ran = 0;
  for (let i = 0; i < limit; i++) {
    const job = db.one<Record<string, any>>(
      `SELECT * FROM jobs WHERE status IN ('queued','failed') AND run_after <= ? ORDER BY run_after, created_at LIMIT 1`,
      [nowIso()],
    );
    if (!job) break;
    const claimed = db.run(
      `UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1 WHERE id = ? AND status IN ('queued','failed')`,
      [nowIso(), job.id],
    ).changes;
    if (!claimed) continue;
    ran += 1;
    try {
      const result = await handle(db, job as never);
      db.run(`UPDATE jobs SET status = 'done', result = ?, last_error = NULL, finished_at = ? WHERE id = ?`, [result, nowIso(), job.id]);
    } catch (err) {
      const attempts = job.attempts + 1;
      const dead = attempts >= job.max_attempts;
      const message = String(err instanceof Error ? err.message : err).slice(0, 500);
      db.run(`UPDATE jobs SET status = ?, last_error = ?, run_after = ?, finished_at = ? WHERE id = ?`, [
        dead ? "dead" : "failed", message, new Date(Date.now() + 2 ** attempts * 60_000).toISOString(), dead ? nowIso() : null, job.id,
      ]);
      if (dead) audit(db, SYSTEM, "job_failed", "job", job.id, `Job ${job.type} gave up after ${attempts} attempts: ${message}`);
      console.error(`[jobs] ${job.type} failed (attempt ${attempts}):`, message);
    }
  }
  return ran;
}

/** One scheduler heartbeat. */
export async function tick(): Promise<{ jobs: number; sent: number; failed: number }> {
  const db = getDb();
  const date = today();
  if (localHour() >= getSettings(db).automation_hour) enqueue(db, "daily", { date }, `daily:${date}`);
  const jobs = await runDueJobs(db);
  const mail = await processOutbox(db);
  return { jobs, ...mail };
}

/** "Run now" from the Automations page: runs through the queue so it is logged and retried like any other job. */
export async function runAutomationNow(db: DB, key: string): Promise<string> {
  const dedupe = `manual:${key}:${Date.now()}`;
  enqueue(db, "automation", { key, date: today() }, dedupe);
  await runDueJobs(db);
  await processOutbox(db);
  const job = db.one<{ status: string; result: string | null; last_error: string | null }>(`SELECT status, result, last_error FROM jobs WHERE dedupe_key = ?`, [dedupe]);
  if (job?.status !== "done") throw new Error(job?.last_error ?? "The job did not finish.");
  return job.result ?? "Done";
}

declare global {
  // eslint-disable-next-line no-var
  var __shqTimer: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __shqTicking: boolean | undefined;
}

export function startScheduler(): void {
  if (global.__shqTimer) return;
  if (process.env.SCHEDULER === "off") {
    console.log("[jobs] SCHEDULER=off — background jobs only run via POST /api/cron.");
    return;
  }
  const beat = async () => {
    if (global.__shqTicking) return; // never overlap with a slow previous beat
    global.__shqTicking = true;
    try {
      await tick();
    } catch (err) {
      console.error("[jobs] tick failed:", err instanceof Error ? err.message : err);
    } finally {
      global.__shqTicking = false;
    }
  };
  setTimeout(beat, 15_000);
  global.__shqTimer = setInterval(beat, 60_000);
  console.log("[jobs] scheduler started — checking every minute.");
}
