import { Card, Check, Chip, EmptyState, Field, Notice, PageHeader, Tabs } from "@/components/ui";
import { ActionForm, ConfirmButton, ModalForm } from "@/components/forms";
import { requireStaff } from "@/lib/auth";
import { resetDemoAction, saveFacilityAction, saveSettingsAction, saveTaxAction, saveUserAction } from "@/lib/actions/admin";
import { providerStatus } from "@/lib/email";
import { gatewayConfigured } from "@/lib/gateway";
import { ROLES } from "@/lib/roles";
import { centsInput, formatDate, money, titleCase } from "@/lib/format";
import { param, type Query } from "@/lib/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

const TABS = [
  ["business", "Business"], ["prices", "Prices"], ["currency", "Currency & tax"], ["billing", "Billing rules"], ["invoice", "Invoice template"],
  ["notifications", "Notifications"], ["users", "Users & roles"], ["facilities", "Facilities"], ["terms", "Agreement terms"], ["integrations", "Integrations & data"],
] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const ctx = await requireStaff("settings.edit");
  const query = await searchParams;
  const tab = TABS.some(([k]) => k === param(query, "tab")) ? param(query, "tab") : "business";
  const { db, settings: s } = ctx;

  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" blurb="How the business is described, billed and run. Every change is recorded in the audit log." />
      <Tabs active={tab} tabs={TABS.map(([key, label]) => ({ key, label, href: `/settings?tab=${key}` }))} />

      {tab === "business" && (
        <ActionForm action={saveSettingsAction} submit="Save" className="panel p-5 max-w-3xl">
          <input type="hidden" name="section" value="business" />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Business name" hint="Shown on invoices, emails and the booking page."><input className="input" name="business_name" defaultValue={s.business_name} required /></Field>
            <Field label="Legal name"><input className="input" name="legal_name" defaultValue={s.legal_name} /></Field>
            <Field label="Address" className="sm:col-span-2"><input className="input" name="business_address" defaultValue={s.business_address} /></Field>
            <Field label="Phone"><input className="input" name="business_phone" defaultValue={s.business_phone} /></Field>
            <Field label="Email"><input className="input" type="email" name="business_email" defaultValue={s.business_email} /></Field>
            <Field label="Website"><input className="input" name="business_website" defaultValue={s.business_website} /></Field>
            <Field label="Chamber of Commerce (KvK) no."><input className="input" name="chamber_no" defaultValue={s.chamber_no} /></Field>
            <Field label="Tax ID (persoonsnummer)"><input className="input" name="tax_id" defaultValue={s.tax_id} /></Field>
          </div>
        </ActionForm>
      )}

      {tab === "prices" && (
        <ActionForm action={saveSettingsAction} submit="Save prices" className="panel p-5 max-w-3xl">
          <input type="hidden" name="section" value="prices" />
          <p className="text-sm mb-5" style={{ color: "var(--ink-3)" }}>
            Standard monthly prices, shown to customers on the <a className="link" href="/reserve" target="_blank">booking page</a> and filled in for you when you add a unit of that size. You can still give any single unit its own price.
          </p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label={`Small storage unit (${s.base_currency} / month)`} hint="1.5 × 3 × 2.4 m">
              <input className="input" name="price_small" inputMode="decimal" defaultValue={centsInput(s.price_small_cents)} placeholder="0.00" required />
            </Field>
            <Field label={`Standard storage unit (${s.base_currency} / month)`} hint="3 × 3 × 2.4 m">
              <input className="input" name="price_standard" inputMode="decimal" defaultValue={centsInput(s.price_standard_cents)} placeholder="0.00" required />
            </Field>
            <Field label={`Warehouse — from (${s.base_currency} / month)`} hint="Optional. Leave empty to show “Price on request”.">
              <input className="input" name="price_warehouse_from" inputMode="decimal" defaultValue={s.price_warehouse_from_cents ? centsInput(s.price_warehouse_from_cents) : ""} placeholder="Price on request" />
            </Field>
            <Field label="Warehouse note" hint="Shown under the warehouse option on the booking page.">
              <input className="input" name="warehouse_price_note" defaultValue={s.warehouse_price_note} maxLength={200} />
            </Field>
          </div>
        </ActionForm>
      )}

      {tab === "currency" && (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <ActionForm action={saveSettingsAction} submit="Save" className="panel p-5">
            <input type="hidden" name="section" value="currency" />
            <h2 className="text-sm font-semibold mb-4">Currency</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Base currency" hint="Prices, invoices and reports are kept in this currency. It cannot be changed once invoices exist.">
                <select className="select" name="base_currency" defaultValue={s.base_currency}><option value="USD">USD — US Dollar</option><option value="AWG">AWG — Aruban Florin</option></select>
              </Field>
              <Field label="Florins per US dollar" hint="The florin is pegged at 1.79."><input className="input" name="awg_per_usd" type="number" step="0.0001" min="0.5" max="10" defaultValue={s.awg_per_usd} required /></Field>
              <div className="sm:col-span-2"><Check name="show_secondary_currency" label="Show the equivalent in the other currency on invoices" defaultChecked={s.show_secondary_currency} /></div>
            </div>
            <p className="hint mt-3">Payments can be taken in either currency; a florin payment is converted to the base currency at this rate when it is recorded.</p>
          </ActionForm>

          <Card title="Taxes" dense action={
            <ModalForm label="Add tax" title="Add a tax" action={saveTaxAction} className="btn btn-ghost btn-sm" icon="plus" submit="Save tax">
              <TaxFields />
            </ModalForm>
          }>
            <div className="p-4 pb-0"><Notice>Enabled taxes are added on top of taxable invoice lines. Aruba's turnover taxes (BBO/BAZV/BAVP) are provided as a starting point — confirm with your accountant whether and at what rate they apply to your rentals.</Notice></div>
            <ul className="mt-3">
              {db.all<Record<string, any>>(`SELECT * FROM taxes ORDER BY name`).map((t, i) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
                  <div className="flex-1"><span className="text-sm font-medium">{t.name}</span><div className="text-xs" style={{ color: "var(--ink-3)" }}>{t.rate_bp / 100}%</div></div>
                  <Chip tone={t.enabled ? "good" : "muted"} dot>{t.enabled ? "Charged" : "Off"}</Chip>
                  <ModalForm label="Edit" title={`Edit ${t.name}`} action={saveTaxAction} className="btn btn-ghost btn-sm" submit="Save tax"><TaxFields tax={t} /></ModalForm>
                  <ConfirmButton action={saveTaxAction} fields={{ id: t.id, op: "delete" }} label="Delete" className="btn btn-ghost btn-sm" confirm={`Delete ${t.name}?`} title="quiet" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "billing" && (
        <ActionForm action={saveSettingsAction} submit="Save" className="max-w-3xl space-y-5">
          <input type="hidden" name="section" value="billing" />
          <section className="panel p-5">
            <h2 className="text-sm font-semibold mb-4">Recurring invoices</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Default billing cycle" hint="Each agreement can override this.">
                <select className="select" name="billing_mode_default" defaultValue={s.billing_mode_default}><option value="fixed_day">Same day each month for everyone</option><option value="anniversary">Anniversary of each start date</option></select>
              </Field>
              <Field label="Billing day of the month"><input className="input" type="number" name="billing_day_default" min={1} max={28} defaultValue={s.billing_day_default} required /></Field>
              <Field label="Create invoices this many days ahead" hint="So renters receive them before the period starts."><input className="input" type="number" name="invoice_lead_days" min={0} max={30} defaultValue={s.invoice_lead_days} required /></Field>
              <Field label="Due this many days after the period starts"><input className="input" type="number" name="due_offset_days" min={0} max={60} defaultValue={s.due_offset_days} required /></Field>
              <div className="sm:col-span-2 space-y-2.5">
                <Check name="prorate_first_month" label="Prorate the first partial month by default" defaultChecked={s.prorate_first_month} />
                <Check name="auto_apply_credit" label="Apply a renter's credit to new invoices automatically" defaultChecked={s.auto_apply_credit} />
              </div>
            </div>
          </section>
          <section className="panel p-5">
            <h2 className="text-sm font-semibold mb-4">Late fees</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2"><Check name="late_fee_enabled" label="Charge a late fee on unpaid invoices" defaultChecked={s.late_fee_enabled} hint="Added once per invoice, after the grace period. It can be waived on the invoice." /></div>
              <Field label="Grace period (days after the due date)"><input className="input" type="number" name="late_fee_grace_days" min={0} max={90} defaultValue={s.late_fee_grace_days} required /></Field>
              <Field label="Fee type"><select className="select" name="late_fee_type" defaultValue={s.late_fee_type}><option value="flat">Flat amount</option><option value="percent">Percent of the unpaid balance</option></select></Field>
              <Field label={`Flat fee (${s.base_currency})`}><input className="input" name="late_fee_flat" inputMode="decimal" defaultValue={centsInput(s.late_fee_flat_cents)} /></Field>
              <Field label="Percent of balance"><input className="input" type="number" step="0.01" min="0" max="100" name="late_fee_percent" defaultValue={s.late_fee_percent_bp / 100} /></Field>
            </div>
          </section>
          <section className="panel p-5">
            <h2 className="text-sm font-semibold mb-4">Agreements and reservations</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Default notice period (days)"><input className="input" type="number" name="default_notice_days" min={0} max={365} defaultValue={s.default_notice_days} required /></Field>
              <Field label="Default deposit (months of rent)"><input className="input" type="number" step="0.5" name="default_deposit_months" min={0} max={12} defaultValue={s.default_deposit_months} required /></Field>
              <Field label="Reservation hold (days)"><input className="input" type="number" name="reservation_hold_days" min={1} max={90} defaultValue={s.reservation_hold_days} required /></Field>
              <div className="sm:col-span-3"><Check name="public_reservations_enabled" label="Let new customers reserve a unit online at /reserve" defaultChecked={s.public_reservations_enabled} /></div>
            </div>
          </section>
        </ActionForm>
      )}

      {tab === "invoice" && (
        <ActionForm action={saveSettingsAction} submit="Save" className="panel p-5 max-w-3xl">
          <input type="hidden" name="section" value="invoice" />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Invoice number prefix" hint={`Next invoice: ${s.invoice_prefix}-${new Date().getFullYear()}-0001 style.`}><input className="input" name="invoice_prefix" defaultValue={s.invoice_prefix} maxLength={8} required /></Field>
            <div />
            <Field label="How to pay" className="sm:col-span-2" hint="Printed on every unpaid invoice and included in reminders — bank name, account number, office hours."><textarea className="textarea" name="payment_instructions" defaultValue={s.payment_instructions} /></Field>
            <Field label="Footer line" className="sm:col-span-2"><input className="input" name="invoice_footer" defaultValue={s.invoice_footer} maxLength={300} /></Field>
          </div>
          <p className="hint mt-3">The invoice PDF uses your logo, the business details from the Business tab and the taxes from Currency & tax. Open any invoice and choose PDF to preview it.</p>
        </ActionForm>
      )}

      {tab === "notifications" && <Notifications ctx={ctx} />}
      {tab === "users" && <Users ctx={ctx} />}
      {tab === "facilities" && <Facilities ctx={ctx} />}

      {tab === "terms" && (
        <ActionForm action={saveSettingsAction} submit="Save terms" className="panel p-5 max-w-4xl">
          <input type="hidden" name="section" value="terms" />
          <Field label="Standard terms and conditions" hint="Added beneath the unit, renter, term and charges on every new agreement. Agreements already created keep the terms they were signed with. Have these reviewed by a lawyer before use.">
            <textarea className="textarea" name="agreement_terms" defaultValue={s.agreement_terms} style={{ minHeight: "28rem" }} required />
          </Field>
        </ActionForm>
      )}

      {tab === "integrations" && (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <Card title="Payment gateway">
            <div className="flex items-center justify-between gap-3 mb-2"><span className="text-sm font-medium">Online card payments</span><Chip tone={gatewayConfigured() ? "good" : "muted"} dot>{gatewayConfigured() ? "Connected" : "Not connected"}</Chip></div>
            <p className="text-sm" style={{ color: "var(--ink-3)" }}>
              Payments are recorded by staff today. The integration point for a gateway (for example CX Pay, Sentoo or Stripe) is ready: set <code>PAYMENT_LINK_TEMPLATE</code> and <code>PAYMENT_WEBHOOK_SECRET</code> on the server and point the provider's webhook at <code>/api/webhooks/payments</code>.
              An invoice is only marked paid when the gateway confirms the money — never when a request is sent.
            </p>
          </Card>
          <Card title="E-signature">
            <div className="flex items-center justify-between gap-3 mb-2"><span className="text-sm font-medium">Built-in signing</span><Chip tone="good" dot>Active</Chip></div>
            <p className="text-sm" style={{ color: "var(--ink-3)" }}>Renters sign from a personal link or on a staff device. The signature, signer's name, time, network address and a fingerprint of the exact terms are stored with the agreement. Fields for an external provider's reference (DocuSign, Dropbox Sign) are in place if you later need one.</p>
          </Card>
          <Card title="Demo workspace">
            <p className="text-sm mb-3" style={{ color: "var(--ink-3)" }}>Example data lives in a completely separate database from your real records. Open it from the account menu to train staff or try a feature safely.</p>
            {ctx.workspace === "demo" ? (
              <ConfirmButton action={resetDemoAction} label="Reset the demo data" icon="refresh" className="btn" confirm="Rebuild the demo workspace from scratch? Anything changed in the demo is discarded. Your live records are not touched." />
            ) : <Notice>You are in the live workspace. Switch to the demo workspace to reset its example data.</Notice>}
          </Card>
          <Card title="Your data">
            <p className="text-sm" style={{ color: "var(--ink-3)" }}>Every list has an Export CSV button that exports exactly what is filtered. The database is a single file on the server's disk (<code>storage.db</code>) with uploads beside it — back both up regularly. Renter ID numbers are encrypted in the database and never exported.</p>
          </Card>
        </div>
      )}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireStaff>>;

function TaxFields({ tax }: { tax?: Record<string, any> }) {
  return (
    <>
      {tax && <input type="hidden" name="id" value={tax.id} />}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><input className="input" name="name" defaultValue={tax?.name ?? ""} required maxLength={60} /></Field>
        <Field label="Rate (%)"><input className="input" name="rate" type="number" step="0.01" min="0" max="100" defaultValue={tax ? tax.rate_bp / 100 : ""} required /></Field>
        <div className="col-span-2"><Check name="enabled" label="Charge this tax on new invoices" defaultChecked={tax ? Boolean(tax.enabled) : true} /></div>
      </div>
    </>
  );
}

function Notifications({ ctx }: { ctx: Ctx }) {
  const s = ctx.settings;
  const mail = providerStatus(ctx.db);
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start max-w-5xl">
      <ActionForm action={saveSettingsAction} submit="Save" className="panel p-5">
        <input type="hidden" name="section" value="notifications" />
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Email provider" hint="Credentials are read from the server's environment, never stored here.">
            <select className="select" name="email_provider" defaultValue={s.email_provider}>
              <option value="log">Record only (no real email)</option>
              <option value="smtp">SMTP</option>
              <option value="resend">Resend</option>
            </select>
          </Field>
          <Field label="Daily run time (hour, Aruba time)" hint="When invoices are generated and reminders go out."><input className="input" type="number" name="automation_hour" min={0} max={23} defaultValue={s.automation_hour} required /></Field>
          <Field label="From name"><input className="input" name="email_from_name" defaultValue={s.email_from_name} required /></Field>
          <Field label="From address"><input className="input" type="email" name="email_from_address" defaultValue={s.email_from_address} required /></Field>
          <Field label="Reply-to address"><input className="input" type="email" name="email_reply_to" defaultValue={s.email_reply_to} /></Field>
        </div>
        <p className="hint mt-3">Which reminders are sent, and how many days before or after, is set on the Automations page.</p>
      </ActionForm>
      <Card title="Delivery status">
        <Chip tone={mail.provider === "log" ? "warn" : "good"} dot>{mail.provider === "log" ? "Recording only" : `Sending via ${titleCase(mail.provider)}`}</Chip>
        <p className="text-sm mt-3" style={{ color: "var(--ink-3)" }}>{mail.note}</p>
        <ul className="text-xs mt-3 space-y-1" style={{ color: "var(--ink-3)" }}>
          <li><strong>SMTP</strong>: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE</li>
          <li><strong>Resend</strong>: RESEND_API_KEY</li>
        </ul>
      </Card>
    </div>
  );
}

function Users({ ctx }: { ctx: Ctx }) {
  const users = ctx.db.all<Record<string, any>>(`SELECT id, email, name, role, status, last_login_at, created_at FROM users WHERE role <> 'renter' ORDER BY name`);
  const roles = ROLES.filter((r) => r.value !== "owner" || ctx.user.role === "owner");
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
      <Card title="Staff accounts" dense action={
        <ModalForm label="Add user" title="Add a staff account" action={saveUserAction} className="btn btn-ghost btn-sm" icon="plus" submit="Create account">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input className="input" name="name" required maxLength={120} /></Field>
            <Field label="Email (sign-in)"><input className="input" type="email" name="email" required /></Field>
            <Field label="Role"><select className="select" name="role" defaultValue="staff">{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
            <Field label="Temporary password" hint="At least 10 characters with a number."><input className="input" name="password" required minLength={10} autoComplete="new-password" /></Field>
          </div>
        </ModalForm>
      }>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="primary">{u.name}{u.id === ctx.user.id && <span className="text-xs font-normal" style={{ color: "var(--ink-3)" }}> · you</span>}<div className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{u.email}</div></td>
                  <td>{titleCase(u.role)}</td>
                  <td><Chip tone={u.status === "active" ? "good" : "muted"} dot>{titleCase(u.status)}</Chip></td>
                  <td className="whitespace-nowrap">{u.last_login_at ? formatDate(u.last_login_at) : "Never"}</td>
                  <td className="r whitespace-nowrap">
                    <ModalForm label="Edit" title={`Edit ${u.name}`} action={saveUserAction} className="btn btn-ghost btn-sm" submit="Save">
                      <input type="hidden" name="id" value={u.id} />
                      <div className="grid grid-cols-2 gap-4">
                        <Field label="Name" className="col-span-2"><input className="input" name="name" defaultValue={u.name} required /></Field>
                        <Field label="Role"><select className="select" name="role" defaultValue={u.role}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></Field>
                        <Field label="Status"><select className="select" name="status" defaultValue={u.status}><option value="active">Active</option><option value="disabled">Disabled</option></select></Field>
                      </div>
                    </ModalForm>
                    <ConfirmButton action={saveUserAction} fields={{ id: u.id, op: "reset" }} label="Reset password" className="btn btn-ghost btn-sm" confirm={`Issue a new temporary password for ${u.name}?`} />
                    {u.id !== ctx.user.id && <ConfirmButton action={saveUserAction} fields={{ id: u.id, op: "delete" }} label="Delete" className="btn btn-ghost btn-sm" confirm={`Delete ${u.name}'s account?`} title="quiet" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="What each role can do">
        <ul className="space-y-3">
          {ROLES.map((r) => <li key={r.value}><div className="text-sm font-semibold">{r.label}</div><div className="text-sm" style={{ color: "var(--ink-3)" }}>{r.blurb}</div></li>)}
        </ul>
      </Card>
    </div>
  );
}

function Facilities({ ctx }: { ctx: Ctx }) {
  const cur = ctx.settings.base_currency;
  const rows = ctx.db.all<Record<string, any>>(
    `SELECT f.*, (SELECT COUNT(*) FROM units u WHERE u.facility_id = f.id) AS units,
            (SELECT COUNT(*) FROM units u WHERE u.facility_id = f.id AND u.status = 'occupied') AS occupied,
            (SELECT COALESCE(SUM(monthly_rate_cents - discount_cents), 0) FROM agreements a WHERE a.facility_id = f.id AND a.status = 'active') AS mrr
       FROM facilities f ORDER BY f.status, f.name`,
  );
  const fields = (f?: Record<string, any>) => (
    <>
      {f && <input type="hidden" name="id" value={f.id} />}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><input className="input" name="name" defaultValue={f?.name ?? ""} required maxLength={120} /></Field>
        <Field label="Short code" hint="Up to 6 letters, e.g. ORA."><input className="input" name="code" defaultValue={f?.code ?? ""} required maxLength={6} /></Field>
        <Field label="Address" className="col-span-2"><input className="input" name="address" defaultValue={f?.address ?? ""} /></Field>
        <Field label="City / district"><input className="input" name="city" defaultValue={f?.city ?? ""} /></Field>
        <Field label="Phone"><input className="input" name="phone" defaultValue={f?.phone ?? ""} /></Field>
        <Field label="Email"><input className="input" type="email" name="email" defaultValue={f?.email ?? ""} /></Field>
        {f && <Field label="Status"><select className="select" name="status" defaultValue={f.status}><option value="active">Active</option><option value="archived">Archived</option></select></Field>}
      </div>
    </>
  );
  return (
    <Card title="Facilities" dense action={<ModalForm label="Add facility" title="Add a facility" action={saveFacilityAction} className="btn btn-ghost btn-sm" icon="plus" submit="Save facility">{fields()}</ModalForm>}>
      {rows.length === 0 ? <EmptyState title="No facilities" /> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Facility</th><th>Address</th><th className="r">Units</th><th className="r">Occupied</th><th className="r">Monthly rent</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td className="primary">{f.name}<div className="text-xs font-normal" style={{ color: "var(--ink-3)" }}>{f.code}</div></td>
                  <td>{f.address ?? "—"}</td>
                  <td className="r num">{f.units}</td>
                  <td className="r num">{f.units ? `${f.occupied} (${Math.round((f.occupied / f.units) * 100)}%)` : "—"}</td>
                  <td className="r num">{money(f.mrr, cur)}</td>
                  <td><Chip tone={f.status === "active" ? "good" : "muted"} dot>{titleCase(f.status)}</Chip></td>
                  <td className="r"><ModalForm label="Edit" title={`Edit ${f.name}`} action={saveFacilityAction} className="btn btn-ghost btn-sm" submit="Save facility">{fields(f)}</ModalForm></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-4 py-3 text-xs hair" style={{ color: "var(--ink-3)" }}>Units, agreements, invoices and payments all belong to a facility. Use the facility picker in the header to view one site or all of them together.</div>
    </Card>
  );
}
