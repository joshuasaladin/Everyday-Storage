import SignaturePad from "@/components/SignaturePad";
import { ActionForm } from "@/components/forms";
import { Field } from "@/components/ui";
import { getDb } from "@/lib/db";
import { agreementBySignToken } from "@/lib/agreements";
import { publicSignAction } from "@/lib/actions/public";
import { getSettings } from "@/lib/settings";
import Icon from "@/components/Icon";
import { formatDate, formatDateTime, renterName } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign your agreement" };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let found: { ag: Record<string, any>; renter: Record<string, any>; unit: Record<string, any>; business: string; contact: string } | null = null;
  {
    const db = getDb();
    const ag = agreementBySignToken(db, token);
    if (ag) {
      const settings = getSettings(db);
      found = {
        ag,
        renter: db.one<Record<string, any>>(`SELECT kind, first_name, last_name, company, email FROM renters WHERE id = ?`, [ag.renter_id])!,
        unit: db.one<Record<string, any>>(`SELECT unit_number, location FROM units WHERE id = ?`, [ag.unit_id])!,
        business: settings.business_name,
        contact: [settings.business_phone, settings.business_email].filter(Boolean).join(" · "),
      };
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
          <div className="panel p-6 sm:p-7">
            <div className="grid place-items-center w-11 h-11 rounded-full mb-4" style={{ background: "var(--good-bg)", color: "var(--good-fg)" }}>
              <Icon name="check" className="w-6 h-6" />
            </div>
            <h2 className="section-title mb-2">{found.ag.status === "active" ? "Thank you for signing!" : "This agreement has been signed"}</h2>
            <p className="text-sm mb-5" style={{ color: "var(--ink-2)" }}>
              {found.ag.status === "active"
                ? `Your rental agreement is now active. We will send your first invoice by email${found.renter.email ? ` to ${found.renter.email}` : ""}, and we look forward to seeing you at ${found.business}.`
                : "Thank you — there is nothing more you need to do."}
            </p>
            <dl className="grid sm:grid-cols-2 gap-4 panel-flat p-4 mb-5 text-sm">
              <div><dt className="label">Agreement</dt><dd>{found.ag.agreement_no}</dd></div>
              <div><dt className="label">Unit</dt><dd>{found.unit.unit_number}{found.unit.location ? ` · ${found.unit.location}` : ""}</dd></div>
              <div><dt className="label">Starts</dt><dd>{formatDate(found.ag.start_date)}</dd></div>
              <div><dt className="label">Signed by</dt><dd>{found.ag.signed_name} · {formatDateTime(found.ag.signed_at)}</dd></div>
            </dl>
            <a href={`/sign/${token}/pdf`} className="btn btn-primary" target="_blank" rel="noopener">
              <Icon name="download" className="w-4 h-4" />
              Download your signed copy
            </a>
            <p className="hint mt-4">Keep this copy for your records. Questions? {found.contact || "Just reply to our email."}</p>
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
