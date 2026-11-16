"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, getCtx, login, passwordProblem, setFacility } from "../auth";
import { hashPassword, verifyPassword } from "../crypto";
import { audit } from "../audit";
import { nowIso } from "../clock";
import { act, Form, UserError, type ActionState } from "../validate";

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const f = new Form(form);
    const email = f.req("email");
    const password = String(form.get("password") ?? "");
    if (!email || !password) throw new UserError("Enter your email and password.");
    const result = await login(email, password);
    if (!result.ok) throw new UserError(result.error);
    redirect("/");
  });
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
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
    await createSession(ctx.user.id);
    return { ok: "Password updated. Other devices have been signed out." };
  });
}
