import PasswordForm from "@/components/PasswordForm";
import { Card, Detail } from "@/components/ui";
import { requireRenter } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PortalAccountPage() {
  const ctx = await requireRenter();
  const r = ctx.db.one<Record<string, any>>(`SELECT first_name, last_name, company, email, phone, address FROM renters WHERE id = ?`, [ctx.renterId])!;
  return (
    <>
      <h1 className="page-title mb-5">Account</h1>
      <div className="grid md:grid-cols-2 gap-5 items-start">
        <Card title="Your details">
          <div className="space-y-3">
            <Detail label="Name">{`${r.first_name} ${r.last_name}`.trim()}</Detail>
            {r.company && <Detail label="Company">{r.company}</Detail>}
            <Detail label="Email (sign-in)">{ctx.user.email}</Detail>
            <Detail label="Phone">{r.phone}</Detail>
            <Detail label="Address">{r.address}</Detail>
          </div>
          <p className="hint mt-4">To change any of these, contact us — {[ctx.settings.business_phone, ctx.settings.business_email].filter(Boolean).join(" · ") || "at the office"}.</p>
        </Card>
        <Card title="Password"><PasswordForm /></Card>
      </div>
    </>
  );
}
