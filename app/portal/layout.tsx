import Link from "next/link";
import { cookies } from "next/headers";
import Icon from "@/components/Icon";
import { requireRenter } from "@/lib/auth";
import { logoutAction, setThemeAction } from "@/lib/actions/session";

export const metadata = { title: "My storage" };

export default async function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const ctx = await requireRenter();
  const theme = (await cookies()).get("shq_theme")?.value;
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  return (
    <div className="min-h-screen flex flex-col">
      {ctx.workspace === "demo" && <div className="px-4 py-1.5 text-xs font-medium text-center" style={{ background: "var(--accent)", color: "#fff" }}>Demo portal — example data only.</div>}
      <header className="side no-print">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link href="/portal" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-640.png" alt="" width={44} height={44} style={{ borderRadius: 8 }} />
            <span className="leading-tight hidden sm:block">
              <span className="block text-sm font-bold" style={{ fontFamily: "var(--font-display)", color: "#fff" }}>{ctx.settings.business_name}</span>
              <span className="block text-[.68rem] font-semibold uppercase tracking-[.14em]" style={{ color: "#fd8933" }}>Customer portal</span>
            </span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <Link href="/portal" className="nav-link">Home</Link>
            <Link href="/portal/account" className="nav-link">Account</Link>
            <form action={setThemeAction}><input type="hidden" name="theme" value={next} /><button className="nav-link cursor-pointer" aria-label="Switch theme"><Icon name={theme === "dark" ? "moon" : "sun"} /></button></form>
            <form action={logoutAction}><button className="nav-link cursor-pointer"><Icon name="logout" /><span className="hidden sm:inline">Sign out</span></button></form>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 sm:py-8">{children}</main>
      <footer className="max-w-5xl w-full mx-auto px-4 py-6 text-xs" style={{ color: "var(--ink-3)" }}>
        {ctx.settings.business_name} · {[ctx.settings.business_phone, ctx.settings.business_email].filter(Boolean).join(" · ")}
      </footer>
    </div>
  );
}
