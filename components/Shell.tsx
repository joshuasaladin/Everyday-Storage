"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import type { NavGroup } from "@/lib/nav";
import { logoutAction, setFacilityAction, setThemeAction, switchWorkspaceAction } from "@/lib/actions/session";

type Props = {
  nav: NavGroup[];
  user: { name: string; role: string };
  workspace: "live" | "demo";
  demoAvailable: boolean;
  canReturnLive: boolean;
  facilities: { id: string; name: string }[];
  facilityId: string | null;
  theme: "light" | "dark" | "system";
  quickAdd: { href: string; label: string; icon: string }[];
  children: React.ReactNode;
};

function useOutside(ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const on = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", on);
      document.removeEventListener("keydown", key);
    };
  }, [ref, close]);
}

function Menu({ button, children, align = "right" }: { button: (open: boolean) => React.ReactNode; children: React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{button(open)}</div>
      {open && (
        <div
          className="absolute z-40 mt-2 panel p-1.5 rise"
          style={{ [align]: 0, minWidth: "13rem" }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const itemClass = "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-left hover:bg-[var(--muted-bg)]";

export default function Shell({ nav, user, workspace, demoAvailable, canReturnLive, facilities, facilityId, theme, quickAdd, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";

  const sidebar = (
    <div className="flex flex-col h-full">
      <Link href="/" className="flex items-center gap-3 px-4 pt-5 pb-3 hover:opacity-90" onClick={() => setOpen(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-640.png" alt="Everyday Storage Aruba" width={58} height={58} style={{ borderRadius: 10, display: "block" }} />
        <span className="leading-tight">
          <span className="block text-[.95rem] font-bold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "#fff" }}>Storage HQ</span>
          <span className="block text-[.7rem] font-semibold uppercase tracking-[.14em]" style={{ color: "#fd8933" }}>Everyday Storage</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {nav.map((group) => (
          <div key={group.group}>
            <div className="nav-group">{group.group}</div>
            {group.items.map((item) => (
              <Link key={item.href} href={item.href} className="nav-link" data-active={isActive(item.href)} onClick={() => setOpen(false)}>
                <Icon name={item.icon} className="w-[17px] h-[17px] shrink-0" />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="px-3 py-3" style={{ borderTop: "1px solid var(--side-line)" }}>
        <Link href="/account" className="flex items-center gap-2.5 rounded-lg px-1 py-1 hover:opacity-85" onClick={() => setOpen(false)}>
          <div className="grid place-items-center w-8 h-8 rounded-full text-xs font-bold shrink-0" style={{ background: "#fd8933", color: "#1c1304" }}>
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate" style={{ color: "var(--side-ink)" }}>{user.name}</div>
            <div className="text-xs capitalize truncate" style={{ color: "var(--side-ink-2)" }}>{user.role}</div>
          </div>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      <aside className="side hidden lg:flex w-[248px] shrink-0 flex-col sticky top-0 h-screen no-print">{sidebar}</aside>

      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex no-print">
          <div className="absolute inset-0" style={{ background: "var(--overlay)" }} onClick={() => setOpen(false)} />
          <aside className="side relative w-[272px] h-full flex flex-col rise">{sidebar}</aside>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {workspace === "demo" && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs font-medium no-print" style={{ background: "var(--accent)", color: "#fff" }}>
            <span>Demo workspace — example data only. Nothing here touches your real records, and no real email is sent.</span>
            {canReturnLive && (
              <form action={switchWorkspaceAction}>
                <input type="hidden" name="workspace" value="live" />
                <button className="underline underline-offset-2 font-semibold cursor-pointer">Back to live workspace</button>
              </form>
            )}
          </div>
        )}

        <header
          className="sticky top-0 z-30 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-7 h-14 backdrop-blur no-print"
          style={{ background: "color-mix(in srgb, var(--bg) 86%, transparent)", borderBottom: "1px solid var(--line)" }}
        >
          <button className="btn btn-ghost btn-icon lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Icon name="menu" className="w-5 h-5" />
          </button>

          <form action="/search" className="relative flex-1 max-w-md">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input name="q" className="input input-icon" placeholder="Search units, renters, invoices…" autoComplete="off" aria-label="Search" />
          </form>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {facilities.length > 1 && (
              <form action={setFacilityAction} className="hidden sm:block">
                <select
                  name="facility_id"
                  defaultValue={facilityId ?? ""}
                  className="select w-auto"
                  aria-label="Facility"
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                >
                  <option value="">All facilities</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </form>
            )}

            <form action={setThemeAction}>
              <input type="hidden" name="theme" value={nextTheme} />
              <button className="btn btn-ghost btn-icon" aria-label={`Theme: ${theme}. Switch to ${nextTheme}.`} title={`Theme: ${theme}`}>
                <Icon name={theme === "dark" ? "moon" : theme === "light" ? "sun" : "sparkle"} className="w-[18px] h-[18px]" />
              </button>
            </form>

            {quickAdd.length > 0 && (
              <Menu
                button={() => (
                  <button className="btn btn-primary" aria-haspopup="menu">
                    <Icon name="plus" className="w-4 h-4" />
                    <span className="hidden sm:inline">New</span>
                  </button>
                )}
              >
                {quickAdd.map((q) => (
                  <Link key={q.href} href={q.href} className={itemClass}>
                    <Icon name={q.icon} className="w-4 h-4" />
                    {q.label}
                  </Link>
                ))}
              </Menu>
            )}

            <Menu
              button={() => (
                <button className="grid place-items-center w-9 h-9 rounded-full text-xs font-bold cursor-pointer" style={{ background: "var(--muted-bg)", color: "var(--ink-2)" }} aria-label="Account menu">
                  {initials}
                </button>
              )}
            >
              <div className="px-2.5 py-2 text-xs" style={{ color: "var(--ink-3)" }}>
                Signed in as <span className="font-semibold" style={{ color: "var(--ink)" }}>{user.name}</span>
              </div>
              <Link href="/account" className={itemClass}><Icon name="user" className="w-4 h-4" />Account & password</Link>
              {facilities.length > 1 && (
                <div className="sm:hidden px-2.5 py-1.5">
                  <form action={setFacilityAction}>
                    <select name="facility_id" defaultValue={facilityId ?? ""} className="select" aria-label="Facility" onClick={(e) => e.stopPropagation()} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
                      <option value="">All facilities</option>
                      {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </form>
                </div>
              )}
              {workspace === "live" && demoAvailable && (
                <form action={switchWorkspaceAction}>
                  <input type="hidden" name="workspace" value="demo" />
                  <button className={itemClass}><Icon name="sparkle" className="w-4 h-4" />Open demo workspace</button>
                </form>
              )}
              <form action={logoutAction}>
                <button className={itemClass}><Icon name="logout" className="w-4 h-4" />Sign out</button>
              </form>
            </Menu>
          </div>
        </header>

        <main className="flex-1 px-3 sm:px-4 lg:px-7 py-5 lg:py-8 max-w-[1440px] w-full">{children}</main>
      </div>
    </div>
  );
}
