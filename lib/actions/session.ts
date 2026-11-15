"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, demoEnabled, destroySession, getCtx, hasLiveSession, login, passwordProblem, setFacility, setWorkspace } from "../auth";
import { getDb } from "../db";
import { hashPassword, verifyPassword } from "../crypto";
import { audit } from "../audit";
import { nowIso } from "../clock";
import { act, Form, UserError, type ActionState } from "../validate";
import { DEMO_LOGIN } from "../seed";

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const f = new Form(form);
    const email = f.req("email");
    const password = String(form.get("password") ?? "");
    if (!email || !password) throw new UserError("Enter your email and password.");
    // an account is looked up in the live workspace first, then in the demo one
    let result = await login("live", email, password);
    if (!result.ok && demoEnabled()) {
      const demo = getDb("demo").one(`SELECT 1 FROM users WHERE email = ?`, [email.toLowerCase()]);
      if (demo) result = await login("demo", email, password);
    }
    if (!result.ok) throw new UserError(result.error);
    redirect(result.role === "renter" ? "/portal" : "/");
  });
}

/** "Explore the demo" on the sign-in page: signs straight into the example data. */
export async function demoLoginAction(): Promise<void> {
  if (!demoEnabled()) redirect("/login");
  const db = getDb("demo");
  const user = db.one<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [DEMO_LOGIN.email]);
  if (!user) redirect("/login");
  await createSession("demo", user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function switchWorkspaceAction(form: FormData): Promise<void> {
  const target = form.get("workspace") === "demo" ? "demo" : "live";
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  if (target === "demo") {
    if (!demoEnabled() || ctx.user.role === "renter") redirect("/");
    // a signed-in staff member is given the matching demo seat
    const db = getDb("demo");
    const seat = db.one<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [DEMO_LOGIN.email]);
    if (seat) await createSession("demo", seat.id);
  } else if (await hasLiveSession()) {
    await setWorkspace("live");
  } else {
    await destroySession();
    redirect("/login");
  }
  redirect("/");
}

export async function setFacilityAction(form: FormData): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const picked = String(form.get("facility_id") ?? "");
  await setFacility(ctx.facilities.some((f) => f.id === picked) ? picked : null);
  revalidatePath("/", "layout");
}

export async function setThemeAction(form: FormData): Promise<void> {
  const theme = String(form.get("theme") ?? "system");
  const jar = await cookies();
  if (theme === "light" || theme === "dark") jar.set("shq_theme", theme, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  else jar.delete("shq_theme");
  revalidatePath("/", "layout");
}

export async function changePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await getCtx();
    if (!ctx) throw new UserError("Your session has ended. Sign in again.");
    const current = String(form.get("current_password") ?? "");
    const next = String(form.get("new_password") ?? "");
    const problem = passwordProblem(next);
    if (problem) throw new UserError(problem, { new_password: problem });
    const row = ctx.db.one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = ?`, [ctx.user.id]);
    if (!row || !verifyPassword(current, row.password_hash)) throw new UserError("Your current password is not correct.", { current_password: "Incorrect" });
    ctx.db.tx(() => {
      ctx.db.run(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`, [hashPassword(next), nowIso(), ctx.user.id]);
      // every other signed-in device is signed out
      ctx.db.run(`DELETE FROM sessions WHERE user_id = ?`, [ctx.user.id]);
      audit(ctx.db, ctx.actor, "password", "user", ctx.user.id, "Changed their password");
    });
    await createSession(ctx.workspace, ctx.user.id);
    return { ok: "Password updated. Other devices have been signed out." };
  });
}
