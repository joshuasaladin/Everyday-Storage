import SignaturePad from "@/components/SignaturePad";
import { ActionForm } from "@/components/forms";
import { Field } from "@/components/ui";
import { getDb } from "@/lib/db";
import { agreementBySignToken } from "@/lib/agreements";
import { publicSignAction } from "@/lib/actions/public";
import { getSettings } from "@/lib/settings";
import { renterName } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign your agreement" };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let found: { ag: Record<string, any>; renter: Record<string, any>; business: string } | null = null;
  for (const ws of ["live", "demo"] as const) {
    if (ws === "demo" && process.env.DEMO_WORKSPACE === "off") continue;
    const db = getDb(ws);
    const ag = agreementBySignToken(db, token);
    if (ag) {
      found = { ag, renter: db.one<Record<string, any>>(`SELECT kind, first_name, last_name, company FROM renters WHERE id = ?`, [ag.renter_id])!, business: getSettings(db).business_name };
      break;
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-640.png" alt="" width={52} height={52} style={{ borderRadius: 10 }} />
          <div>
            <div className="eyebrow">{found?.business ?? "Everyday Storage Aruba"}</div>
            <h1 className="page-title" style={{ fontSize: "1.35rem" }}>Rental agreement</h1>
          </div>
        </div>

        {!found ? (
          <div className="panel p-6">
            <h2 className="section-title mb-2">This link is no longer valid</h2>
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>It may have expired or already been used. Please contact us and we will send you a new one.</p>
          </div>
        ) : found.ag.status !== "pending_signature" ? (
          <div className="panel p-6">
            <h2 className="section-title mb-2">Already signed</h2>
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>Agreement {found.ag.agreement_no} has been signed. Thank you.</p>
          </div>
        ) : (
          <div className="panel p-5 sm:p-6">
            <p className="text-sm mb-4" style={{ color: "var(--ink-2)" }}>
              Please read the agreement below. When you are ready, type your name, sign in the box and confirm.
            </p>
            <div className="panel-flat p-4 mb-5 text-sm leading-relaxed whitespace-pre-wrap" style={{ maxHeight: 360, overflow: "auto" }}>{found.ag.terms_snapshot}</div>
            <ActionForm action={publicSignAction} submit="Sign agreement" pendingLabel="Signing…" submitClass="btn btn-primary w-full sm:w-auto">
              <input type="hidden" name="token" value={token} />
              <Field label="Your full name">
                <input className="input" name="signed_name" required maxLength={120} autoComplete="name"
                  defaultValue={found.renter.kind === "business" ? `${found.renter.first_name} ${found.renter.last_name}`.trim() : renterName(found.renter)} />
              </Field>
              <div className="mt-4"><div className="label">Signature</div><SignaturePad /></div>
              <label className="flex items-start gap-2.5 text-sm mt-4 cursor-pointer">
                <input type="checkbox" name="agree" className="mt-0.5" required />
                <span>I have read and agree to this agreement, and I agree that this electronic signature is the legal equivalent of my handwritten signature.</span>
              </label>
            </ActionForm>
            <p className="hint mt-4">We record the date, time and network address of your signature together with a fingerprint of this document.</p>
          </div>
        )}
      </div>
    </div>
  );
}
