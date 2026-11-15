import { Card, Check, Chip, EmptyState, Field, Notice, PageHeader, Tabs } from "@/components/ui";
import { ActionForm, ConfirmButton, ModalForm } from "@/components/forms";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { outboxAction, runAutomationAction, saveAutomationAction } from "@/lib/actions/admin";
import { providerStatus } from "@/lib/email";
import { formatDateTime, timeAgo, titleCase } from "@/lib/format";
import { param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automations" };

const CONFIG_LABELS: Record<string, string> = {
  days_before: "Days before",
  days_after: "Days after the due date",
  remind_days_before: "Remind this many days before",
};

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("automations.view");
  const query = await searchParams;
  const { db, settings } = ctx;
  const view = param(query, "view") || "rules";
  const edit = can(ctx.user.role, "automations.edit");
  const rules = db.all<Record<string, any>>(`SELECT * FROM automations ORDER BY rowid`);
  const mail = providerStatus(db);
  const failedMail = db.num(`SELECT COUNT(*) FROM email_outbox WHERE status IN ('failed','dead')`);
  const failedJobs = db.num(`SELECT COUNT(*) FROM jobs WHERE status IN ('failed','dead')`);
  const lastDaily = db.one<Record<string, any>>(`SELECT * FROM jobs WHERE type = 'daily' ORDER BY created_at DESC LIMIT 1`);

  return (
    <>
      <PageHeader eyebrow="Operations" title="Automations"
        blurb={`The routine work that runs by itself every day at ${String(settings.automation_hour).padStart(2, "0")}:00 Aruba time. Each step is safe to run twice — an invoice or reminder is never duplicated.`}
        actions={edit && <ConfirmButton action={runAutomationAction} fields={{ key: "__tick" }} label="Run pending jobs now" icon="refresh" className="btn" />} />

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <div className="panel p-4"><div className="eyebrow mb-1">Last daily run</div><div className="text-sm font-semibold">{lastDaily ? formatDateTime(lastDaily.finished_at ?? lastDaily.created_at) : "Not yet run"}</div><div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{lastDaily?.result ?? "Runs once the scheduled hour has passed."}</div></div>
        <div className="panel p-4"><div className="eyebrow mb-1">Email delivery</div><div className="text-sm font-semibold">{mail.provider === "log" ? "Recording only" : titleCase(mail.provider)}</div><div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{mail.note}</div></div>
        <div className="panel p-4"><div className="eyebrow mb-1">Needs a look</div><div className="text-sm font-semibold" style={{ color: failedMail + failedJobs ? "var(--bad-fg)" : undefined }}>{failedMail} failed {failedMail === 1 ? "email" : "emails"} · {failedJobs} failed {failedJobs === 1 ? "job" : "jobs"}</div><div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>Failures retry with a growing delay, then stop for you to review.</div></div>
      </div>

      <Tabs active={view} tabs={[
        { key: "rules", label: "Rules", href: "/automations" },
        { key: "outbox", label: "Email outbox", href: "/automations?view=outbox", count: failedMail },
        { key: "jobs", label: "Job log", href: "/automations?view=jobs", count: failedJobs },
      ]} />

      {view === "rules" && (
        <div className="grid lg:grid-cols-2 gap-4">
          {rules.map((a) => {
            const config = JSON.parse(a.config || "{}") as Record<string, unknown>;
            const lists = Object.entries(config).filter(([, v]) => Array.isArray(v)) as [string, number[]][];
            return (
              <div key={a.key} className="panel p-4 flex flex-col">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <h2 className="text-sm font-semibold">{a.name}</h2>
                  <Chip tone={a.enabled ? "good" : "muted"} dot>{a.enabled ? "On" : "Off"}</Chip>
                </div>
                <p className="text-sm mb-3" style={{ color: "var(--ink-3)" }}>{a.description}</p>
                {lists.length > 0 && <p className="text-sm mb-3">{lists.map(([k, v]) => `${CONFIG_LABELS[k] ?? titleCase(k)}: ${v.join(", ")}`).join(" · ")}</p>}
                <div className="text-xs mb-3" style={{ color: "var(--ink-3)" }}>{a.last_run_at ? `Last run ${timeAgo(a.last_run_at)} — ${a.last_result}` : "Has not run yet"}</div>
                {edit && (
                  <div className="flex flex-wrap gap-2 mt-auto">
                    <ConfirmButton action={runAutomationAction} fields={{ key: a.key }} label="Run now" icon="zap" />
                    <ModalForm label="Settings" title={a.name} blurb={a.description} action={saveAutomationAction} className="btn btn-sm" icon="gear" submit="Save">
                      <input type="hidden" name="key" value={a.key} />
                      <div className="space-y-4">
                        <Check name="enabled" label="Run this automatically every day" defaultChecked={Boolean(a.enabled)} />
                        {lists.map(([k, v]) => (
                          <Field key={k} label={CONFIG_LABELS[k] ?? titleCase(k)} hint="Whole numbers of days, separated by commas."><input className="input" name={k} defaultValue={v.join(", ")} /></Field>
                        ))}
                        {a.key === "late_fees" && <Notice>The fee amount and grace period are set under Settings → Billing.</Notice>}
                        {a.key === "generate_invoices" && <Notice>Billing day, lead time and proration are set under Settings → Billing.</Notice>}
                      </div>
                    </ModalForm>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view === "outbox" && <Outbox ctx={ctx} edit={edit} />}
      {view === "jobs" && <Jobs ctx={ctx} edit={edit} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireStaff>>;

function Outbox({ ctx, edit }: { ctx: Ctx; edit: boolean }) {
  const rows = ctx.db.all<Record<string, any>>(`SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 150`);
  return (
    <>
      {edit && (
        <Card className="mb-4" title="Send a test message">
          <ActionForm action={outboxAction} submit="Send test" submitClass="btn" className="max-w-md" resetOnOk>
            <input type="hidden" name="op" value="test" />
            <Field label="To"><input className="input" type="email" name="to" required /></Field>
          </ActionForm>
        </Card>
      )}
      <Card dense>
        {rows.length === 0 ? <EmptyState title="No email yet" hint="Invoices, reminders and notices appear here as they are sent." /> : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Type</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{formatDateTime(e.sent_at ?? e.created_at)}</td>
                    <td>{e.to_email}</td>
                    <td className="primary" style={{ fontWeight: 500 }}>
                      <details><summary>{e.subject}</summary><pre className="text-xs whitespace-pre-wrap mt-2 font-sans" style={{ color: "var(--ink-2)" }}>{e.body_text}</pre></details>
                      {e.last_error && <div className="text-xs" style={{ color: "var(--bad-fg)" }}>{e.last_error}</div>}
                    </td>
                    <td>{titleCase(e.kind)}</td>
                    <td><Chip tone={e.status === "sent" ? "good" : e.status === "queued" ? "info" : "bad"} dot>{e.status === "sent" ? (e.provider === "log" ? "Recorded" : "Sent") : e.status === "dead" ? "Gave up" : titleCase(e.status)}</Chip>{e.attempts > 1 && <div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{e.attempts} attempts</div>}</td>
                    <td className="r">{edit && (e.status === "failed" || e.status === "dead") && <ConfirmButton action={outboxAction} fields={{ op: "retry", id: e.id }} label="Retry" title="quiet" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Jobs({ ctx, edit }: { ctx: Ctx; edit: boolean }) {
  const rows = ctx.db.all<Record<string, any>>(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 150`);
  return (
    <Card dense>
      {rows.length === 0 ? <EmptyState title="No jobs have run yet" /> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Queued</th><th>Job</th><th>Result</th><th>Attempts</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((j) => {
                const payload = JSON.parse(j.payload || "{}") as Record<string, string>;
                return (
                  <tr key={j.id}>
                    <td className="whitespace-nowrap">{formatDateTime(j.created_at)}</td>
                    <td className="primary" style={{ fontWeight: 500 }}>{j.type === "daily" ? "Daily run" : titleCase(payload.key ?? j.type)}<div className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{j.dedupe_key}</div></td>
                    <td>{j.result ?? ""}{j.last_error && <div className="text-xs" style={{ color: "var(--bad-fg)" }}>{j.last_error}</div>}</td>
                    <td className="num">{j.attempts} / {j.max_attempts}</td>
                    <td><Chip tone={j.status === "done" ? "good" : j.status === "queued" || j.status === "running" ? "info" : "bad"} dot>{j.status === "dead" ? "Gave up" : titleCase(j.status)}</Chip></td>
                    <td className="r">{edit && (j.status === "failed" || j.status === "dead") && <ConfirmButton action={outboxAction} fields={{ op: "retry_job", id: j.id }} label="Retry" title="quiet" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
