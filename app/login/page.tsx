import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { demoEnabled, getCtx } from "@/lib/auth";
import { demoLoginAction } from "@/lib/actions/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const ctx = await getCtx();
  if (ctx) redirect(ctx.user.role === "renter" ? "/portal" : "/");

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-640.png" alt="Everyday Storage Aruba" width={64} height={64} style={{ borderRadius: 12 }} />
            <div className="page-title" style={{ fontSize: "1.3rem" }}>Storage HQ</div>
          </div>

          <h1 className="page-title mb-1">Sign in</h1>
          <p className="text-sm mb-6" style={{ color: "var(--ink-3)" }}>
            Staff and renters use the same sign-in. Renters land in their customer portal.
          </p>

          <LoginForm />

          {demoEnabled() && (
            <form action={demoLoginAction} className="mt-4">
              <button className="btn w-full">Explore the demo workspace</button>
              <p className="hint text-center">Example data in a separate database — safe to click anything.</p>
            </form>
          )}

          <p className="text-xs mt-8" style={{ color: "var(--ink-3)" }}>
            Looking for a unit? <a className="link" href="/reserve">Reserve one online</a>. Accounts are created by an administrator.
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-col items-center justify-center px-12 py-12 text-center" style={{ background: "#293221" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Everyday Storage Aruba" width={380} height={380} style={{ maxWidth: "70%", height: "auto" }} />
        <p className="max-w-md mt-2" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.35rem", lineHeight: 1.3, color: "#fff" }}>
          Every unit, renter, agreement and invoice — in one place.
        </p>
        <p className="max-w-sm mt-3 text-sm" style={{ color: "#aab3a0" }}>
          Occupancy at a glance, invoices that send themselves, and a clear record of every payment and deposit.
        </p>
      </div>
    </div>
  );
}
