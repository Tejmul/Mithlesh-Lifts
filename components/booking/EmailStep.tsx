"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SendCodeResponse, SessionResponse } from "@/lib/shared/api";
import { detailsSchema, sendEmailCodeSchema, verifyCodeSchema } from "@/lib/shared/validation";
import { ApiError, apiFetch } from "./api-client";
import { countryOptions } from "./countries";

type Fields = { fullName: string; email: string; country: string; phone: string };
type FieldErrors = Partial<Record<keyof Fields | "code" | "form", string>>;

type Props = {
  /** Came from "Log in": email only. */
  loggingIn: boolean;
  /** Email verified but no account yet (a "Log in" with a new email): ask name + phone. */
  needsDetails: boolean;
  verifiedEmail: string | null;
  initial: Partial<Fields>;
  onVerified: (res: SessionResponse) => void;
  onSessionExpired: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  notice?: string | null;
};

/**
 * Step ① (docs/FLOW.md): name, email, mobile → we email a 6-digit code → enter it → calendar.
 * "Log in" asks only for the email. The phone is where the team calls; the email is the account.
 */
export function EmailStep({ headingRef, ...p }: Props) {
  const [fields, setFields] = useState<Fields>({
    fullName: p.initial.fullName ?? "",
    email: p.initial.email ?? "",
    country: p.initial.country ?? "IN",
    phone: p.initial.phone ?? "",
  });
  const [phase, setPhase] = useState<"enter" | "code">("enter");
  const [sentTo, setSentTo] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!resendAt) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= resendAt) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [resendAt]);

  useEffect(() => {
    if (phase === "code") codeRef.current?.focus();
  }, [phase]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));
  const secondsLeft = resendAt ? Math.max(0, Math.ceil((resendAt - now) / 1000)) : 0;
  const mode = p.loggingIn ? "login" : "book";

  function showFieldErrors(byField: FieldErrors) {
    setErrors(byField);
    const first = (["fullName", "email", "phone", "code"] as const).find((k) => byField[k]);
    const target = { fullName: nameRef, email: emailRef, phone: phoneRef, code: codeRef };
    if (first) target[first].current?.focus();
  }

  function apiErrorMessage(err: ApiError) {
    switch (err.code) {
      case "OTP_COOLDOWN":
        return "A code was sent very recently. Please wait a moment before asking for another one.";
      case "RATE_LIMITED":
        return "Too many attempts. Please wait a few minutes and try again.";
      case "OTP_SEND_FAILED":
        return "We couldn't send the code. Check the email address and try again.";
      case "OTP_INVALID":
        return "That code is wrong or has expired. Check your email, or send a new code.";
      default:
        return err.message;
    }
  }

  async function run<T>(fn: () => Promise<T>, onError: (err: ApiError) => void): Promise<T | undefined> {
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      setStatus("");
      if (!(err instanceof ApiError)) throw err;
      if (err.code === "SESSION_EXPIRED") p.onSessionExpired();
      else onError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const parsed = sendEmailCodeSchema.safeParse({
      mode,
      email: fields.email,
      ...(p.loggingIn ? {} : { fullName: fields.fullName, country: fields.country, phone: fields.phone }),
    });
    if (!parsed.success) {
      return showFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    }
    setErrors({});
    setStatus("Sending your code…");
    const res = await run(
      () => apiFetch<SendCodeResponse>("/api/booking/email/send", { method: "POST", body: parsed.data }),
      (err) =>
        err.fields
          ? showFieldErrors(err.fields as FieldErrors)
          : setErrors(phase === "code" ? { code: apiErrorMessage(err) } : { form: apiErrorMessage(err) }),
    );
    if (!res) return;
    const n = Date.now();
    setNow(n);
    setResendAt(Date.parse(res.resendAvailableAt) || n + 45_000);
    setSentTo(res.sentTo);
    setCode("");
    setPhase("code");
    setStatus(`Code sent to ${res.sentTo}.`);
  }

  async function verify() {
    const parsed = verifyCodeSchema.safeParse({ code });
    if (!parsed.success) return showFieldErrors({ code: "Enter the 6-digit code from the email." });
    setErrors({});
    setStatus("Checking your code…");
    const res = await run(
      () => apiFetch<SessionResponse>("/api/booking/email/verify", { method: "POST", body: parsed.data }),
      (err) => showFieldErrors({ code: apiErrorMessage(err) }),
    );
    if (res) {
      setStatus("Email confirmed.");
      p.onVerified(res);
    }
  }

  async function saveDetails() {
    const parsed = detailsSchema.safeParse({ fullName: fields.fullName, country: fields.country, phone: fields.phone });
    if (!parsed.success) {
      return showFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    }
    setErrors({});
    const res = await run(
      () => apiFetch<SessionResponse>("/api/booking/details", { method: "POST", body: parsed.data }),
      (err) => (err.fields ? showFieldErrors(err.fields as FieldErrors) : setErrors({ form: apiErrorMessage(err) })),
    );
    if (res) p.onVerified(res);
  }

  const nameField = (
    <div className={`field${errors.fullName ? " has-error" : ""}`}>
      <label htmlFor="fullName">Your name</label>
      <input
        ref={nameRef}
        id="fullName"
        type="text"
        autoComplete="name"
        autoCapitalize="words"
        placeholder="Rahul Sharma"
        value={fields.fullName}
        onChange={set("fullName")}
        aria-invalid={errors.fullName ? true : undefined}
        aria-describedby={errors.fullName ? "fullName-error" : undefined}
        maxLength={80}
      />
      {errors.fullName && (
        <p id="fullName-error" className="field-error">
          {errors.fullName}
        </p>
      )}
    </div>
  );

  const phoneField = (
    <div className="phone-row">
      <div className="field field-country">
        <label htmlFor="country">Country code</label>
        <select id="country" autoComplete="tel-country-code" value={fields.country} onChange={set("country")}>
          {countryOptions().map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className={`field field-phone${errors.phone ? " has-error" : ""}`}>
        <label htmlFor="phone">Mobile number</label>
        <input
          ref={phoneRef}
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={fields.phone}
          onChange={set("phone")}
          aria-invalid={errors.phone ? true : undefined}
          aria-describedby={errors.phone ? "phone-error" : undefined}
          maxLength={20}
        />
        {errors.phone && (
          <p id="phone-error" className="field-error">
            {errors.phone}
          </p>
        )}
      </div>
    </div>
  );

  const formError = errors.form && (
    <p className="notice notice-error" role="alert">
      {errors.form}
    </p>
  );

  // ---- verified email, no account yet ("Log in" with a new email)
  if (p.needsDetails) {
    return (
      <section className="step" aria-labelledby="step-title">
        <h2 id="step-title" ref={headingRef} tabIndex={-1}>
          Almost there
        </h2>
        <p className="step-lede">
          {p.verifiedEmail ? `${p.verifiedEmail} is confirmed. ` : ""}Add your name and the number our team should call.
        </p>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void saveDetails();
          }}
        >
          {nameField}
          {phoneField}
          {formError}
          <div className="step-actions">
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
              {busy ? "Saving…" : "Continue"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="step" aria-labelledby="step-title">
      <h2 id="step-title" ref={headingRef} tabIndex={-1}>
        {phase === "code" ? "Check your email" : p.loggingIn ? "Log in with your email" : "Your details"}
      </h2>
      <p className="step-lede">
        {phase === "code"
          ? `We sent a 6-digit code to ${sentTo}. It can take a minute; check spam too.`
          : p.loggingIn
            ? "We'll email you a code. No password needed."
            : "We'll email you a code to confirm it's you. Our team calls you on this number."}
      </p>
      {p.notice && (
        <p className="notice notice-error" role="alert">
          {p.notice}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      {phase === "enter" ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {!p.loggingIn && nameField}
          <div className={`field${errors.email ? " has-error" : ""}`}>
            <label htmlFor="email">Email</label>
            <input
              ref={emailRef}
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={fields.email}
              onChange={set("email")}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "email-error" : undefined}
              maxLength={254}
            />
            {errors.email && (
              <p id="email-error" className="field-error">
                {errors.email}
              </p>
            )}
          </div>
          {!p.loggingIn && phoneField}
          {formError}
          <div className="step-actions">
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
              {busy ? "Sending code…" : "Email me a code"}
            </button>
          </div>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <div className={`field${errors.code ? " has-error" : ""}`}>
            <label htmlFor="otp">6-digit code</label>
            <input
              ref={codeRef}
              id="otp"
              className="otp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={errors.code ? true : undefined}
              aria-describedby={errors.code ? "otp-error" : undefined}
            />
            {errors.code && (
              <p id="otp-error" className="field-error" role="alert">
                {errors.code}
              </p>
            )}
            {process.env.NODE_ENV !== "production" && (
              <p className="dev-note">
                Dev mode: with the mock email provider, codes appear{" "}
                <a href="/api/dev/outbox?channel=email" target="_blank" rel="noopener">
                  here
                </a>
                .
              </p>
            )}
          </div>
          <div className="step-actions">
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
              {busy ? "Checking…" : "Confirm & continue"}
            </button>
          </div>
          <div className="otp-links">
            <button type="button" className="link-btn" onClick={() => void send()} disabled={secondsLeft > 0 || busy}>
              {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setPhase("enter");
                setCode("");
                setErrors({});
              }}
            >
              Change details
            </button>
          </div>
        </form>
      )}

      <p className="privacy-note">
        We only use your details for your call and booking updates. <Link href="/privacy">Privacy</Link>
      </p>
    </section>
  );
}
