"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="adm-form adm-login-form">
      <label className="adm-field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label className="adm-field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <p className="adm-msg adm-msg-error" role="alert" aria-live="assertive">
        {state?.error ?? ""}
      </p>
      <button type="submit" className="adm-btn adm-btn-primary adm-btn-block" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
