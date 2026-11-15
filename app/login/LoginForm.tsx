"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions/session";
import { SubmitButton } from "@/components/forms";
import type { ActionState } from "@/lib/validate";

export default function LoginForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(loginAction, null);
  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" autoComplete="username" placeholder="you@everydaystorage.aw" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {state?.error && <p className="notice notice-bad" role="alert">{state.error}</p>}
      <SubmitButton className="btn btn-primary w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
