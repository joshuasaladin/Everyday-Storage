import PasswordForm from "@/components/PasswordForm";
import { Card, Detail, Notice, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/session";
import { ROLES } from "@/lib/roles";
import { formatDateTime, titleCase } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await requireStaff();
  const sessions = ctx.db.all<Record<string, any>>(`SELECT created_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 6`, [ctx.user.id]);
  return (
    <>
      <PageHeader eyebrow="Account" title={ctx.user.name} />
      {ctx.user.must_change_password ? <div className="mb-5 max-w-3xl"><Notice tone="warn">You are using a temporary password. Choose your own below.</Notice></div> : null}
      <div className="grid md:grid-cols-2 gap-5 max-w-4xl items-start">
        <Card title="Your details">
          <div className="space-y-3">
            <Detail label="Email (sign-in)">{ctx.user.email}</Detail>
            <Detail label="Role">{titleCase(ctx.user.role)} — {ROLES.find((r) => r.value === ctx.user.role)?.blurb}</Detail>
            <Detail label="Workspace">{ctx.workspace === "demo" ? "Demo (example data)" : "Live"}</Detail>
          </div>
          <form action={logoutAction} className="mt-5"><button className="btn">Sign out</button></form>
        </Card>
        <Card title="Password"><PasswordForm /></Card>
        <Card title="Signed-in devices" dense className="md:col-span-2">
          <ul>
            {sessions.map((s, i) => (
              <li key={i} className="px-4 py-2.5 text-sm" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                <span>{formatDateTime(s.created_at)}</span><span style={{ color: "var(--ink-3)" }}> · {s.ip ?? "unknown address"} · {String(s.user_agent ?? "").slice(0, 90)}</span>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 text-xs hair" style={{ color: "var(--ink-3)" }}>Changing your password signs out every other device.</div>
        </Card>
      </div>
    </>
  );
}
