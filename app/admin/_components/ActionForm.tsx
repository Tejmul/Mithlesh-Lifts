"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState, FormAction } from "./types";

type Props = {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  /** Rendered next to the submit button. */
  extra?: ReactNode;
};

/** Form bound to a server action with inline success/error feedback. */
export function ActionForm({ action, children, submitLabel, pendingLabel, variant = "primary", className, extra }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  return (
    <form action={formAction} className={className ? `adm-form ${className}` : "adm-form"} noValidate>
      {children}
      {state?.fields && (
        <ul className="adm-field-errors">
          {Object.entries(state.fields).map(([field, message]) => (
            <li key={field}>{message}</li>
          ))}
        </ul>
      )}
      <div className="adm-form-actions">
        <button type="submit" className={`adm-btn adm-btn-${variant}`} disabled={pending}>
          {pending ? (pendingLabel ?? "Saving…") : submitLabel}
        </button>
        {extra}
        <p className={state?.error ? "adm-msg adm-msg-error" : "adm-msg adm-msg-ok"} role="status" aria-live="polite">
          {state?.error ?? state?.ok ?? ""}
        </p>
      </div>
    </form>
  );
}
