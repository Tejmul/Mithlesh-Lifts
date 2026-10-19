"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SendCodeResponse, SessionResponse } from "@/lib/shared/api";
import { maskPhone, sendCodeSchema, verifyCodeSchema } from "@/lib/shared/validation";
import { ApiError, apiFetch } from "./api-client";
import { countryOptions } from "./countries";

type Props = {
  country: string;
  phone: string;
  onCountryChange: (c: string) => void;
  onPhoneChange: (p: string) => void;
  /** Already-verified number for this session (when the visitor came back to step 1). */
  verifiedPhone: string | null;
  onVerified: (res: SessionResponse) => void;
  onContinueVerified: () => void;
  onSessionExpired: () => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  notice?: string | null;
};

type Sent = { sentTo: string; resendAt: number };

const nowMs = () => Date.now();

export function PhoneStep({ headingRef, ...p }: Props) {
  const [phase, setPhase] = useState<"enter" | "code">("enter");
  const [changing, setChanging] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState("");
  const [now, setNow] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Resend countdown
  useEffect(() => {
    if (!sent) return;
    const t = window.setInterval(() => {
      const n = nowMs();
      setNow(n);
      if (n >= sent.resendAt) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [sent]);

  useEffect(() => {
    if (phase === "code") codeRef.current?.focus();
  }, [phase]);

  const secondsLeft = sent ? Math.max(0, Math.ceil((sent.resendAt - now) / 1000)) : 0;
  const options = countryOptions();

  async function send() {
    setFormError(null);
    setCodeError(null);
    const parsed = sendCodeSchema.safeParse({ country: p.country, phone: p.phone });
    if (!parsed.success) {
      setPhoneError(parsed.error.issues[0]?.message ?? "Enter a valid mobile number.");
      phoneRef.current?.focus();
      return;
    }
    setPhoneError(null);
    setSending(true);
    setStatus("Sending your code…");
    try {
      const res = await apiFetch<SendCodeResponse>("/api/booking/phone/send", {
        method: "POST",
        body: { country: parsed.data.country, phone: parsed.data.phone },
      });
      const n = nowMs();
      setNow(n);
      setSent({ sentTo: res.sentTo, resendAt: Date.parse(res.resendAvailableAt) || n + 30_000 });
      setCode("");
      setPhase("code");
      setChanging(false);
      setStatus(`Code sent to ${maskPhone(res.sentTo)}.`);
    } catch (err) {
      setStatus("");
      if (!(err instanceof ApiError)) throw err;
      if (err.code === "SESSION_EXPIRED") return p.onSessionExpired();
      if (err.code === "VALIDATION" && err.fields?.phone) {
        setPhoneError(err.fields.phone);
        phoneRef.current?.focus();
        return;
      }
      const msg =
        err.code === "OTP_COOLDOWN"
          ? "A code was sent very recently. Please wait a moment before asking for another one."
          : err.code === "RATE_LIMITED"
            ? "Too many attempts. Please wait a few minutes and try again."
            : err.code === "OTP_SEND_FAILED"
              ? "We couldn't send a code to that number. Check the number and try again, or try again in a minute."
              : err.message;
      if (phase === "code") setCodeError(msg);
      else setFormError(msg);
    } finally {
      setSending(false);
    }
  }

  async function verify() {
    setFormError(null);
    const parsed = verifyCodeSchema.safeParse({ code });
    if (!parsed.success) {
      setCodeError("Enter the 6-digit code from the SMS.");
      codeRef.current?.focus();
      return;
    }
    setCodeError(null);
    setVerifying(true);
    setStatus("Checking your code…");
    try {
      const res = await apiFetch<SessionResponse>("/api/booking/phone/verify", {
        method: "POST",
        body: { code: parsed.data.code },
      });
      setStatus("Number verified.");
      p.onVerified(res);
    } catch (err) {
      setStatus("");
      if (!(err instanceof ApiError)) throw err;
      if (err.code === "SESSION_EXPIRED") return p.onSessionExpired();
      setCodeError(
        err.code === "OTP_INVALID"
          ? "That code is wrong or has expired. Check the SMS, or send a new code."
          : err.code === "RATE_LIMITED"
            ? "Too many attempts. Please wait a few minutes, then send a new code."
            : err.message,
      );
      codeRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  }

  const showVerified = p.verifiedPhone && !changing && phase === "enter";

  return (
    <section className="step" aria-labelledby="step-title">
      <h2 id="step-title" ref={headingRef} tabIndex={-1}>
        {phase === "code" ? "Enter your code" : "Your mobile number"}
      </h2>
      <p className="step-lede">
        {phase === "code"
          ? `We sent a code by SMS to ${sent ? maskPhone(sent.sentTo) : "your number"}.`
          : "We'll text you a one-time code to confirm it's you."}
      </p>

      {p.notice && (
        <p className="notice notice-error" role="alert">
          {p.notice}
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      {showVerified ? (
        <div className="verified-box">
          <p>
            <span className="check" aria-hidden="true" /> Verified: <strong>{maskPhone(p.verifiedPhone!)}</strong>
          </p>
          <div className="step-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={p.onContinueVerified}>
              Continue
            </button>
            <button type="button" className="btn btn-ghost btn-lg" onClick={() => setChanging(true)}>
              Use a different number
            </button>
          </div>
        </div>
      ) : phase === "enter" ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="phone-row">
            <div className="field field-country">
              <label htmlFor="country">Country code</label>
              <select
                id="country"
                autoComplete="tel-country-code"
                value={p.country}
                onChange={(e) => p.onCountryChange(e.target.value)}
              >
                {options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={`field field-phone${phoneError ? " has-error" : ""}`}>
              <label htmlFor="phone">Mobile number</label>
              <input
                ref={phoneRef}
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="98765 43210"
                value={p.phone}
                onChange={(e) => p.onPhoneChange(e.target.value)}
                aria-invalid={phoneError ? true : undefined}
                aria-describedby={phoneError ? "phone-error" : undefined}
                maxLength={20}
              />
              {phoneError && (
                <p id="phone-error" className="field-error">
                  {phoneError}
                </p>
              )}
            </div>
          </div>
          {formError && (
            <p className="notice notice-error" role="alert">
              {formError}
            </p>
          )}
          <div className="step-actions">
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={sending} aria-busy={sending}>
              {sending ? "Sending code…" : "Send code"}
            </button>
            {p.verifiedPhone && (
              <button type="button" className="btn btn-ghost btn-lg" onClick={() => setChanging(false)}>
                Keep {maskPhone(p.verifiedPhone)}
              </button>
            )}
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
          <div className={`field${codeError ? " has-error" : ""}`}>
            <label htmlFor="otp">6-digit code</label>
            <input
              ref={codeRef}
              id="otp"
              className="otp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              aria-invalid={codeError ? true : undefined}
              aria-describedby={`otp-hint${codeError ? " otp-error" : ""}`}
            />
            <p id="otp-hint" className="field-hint">
              Didn&apos;t get it? Check the number, then resend.
            </p>
            {codeError && (
              <p id="otp-error" className="field-error" role="alert">
                {codeError}
              </p>
            )}
            {process.env.NODE_ENV !== "production" && (
              <p className="dev-note">
                Dev mode: codes appear{" "}
                <a href="/api/dev/outbox?channel=sms" target="_blank" rel="noopener">
                  here
                </a>
                .
              </p>
            )}
          </div>
          <div className="step-actions">
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={verifying} aria-busy={verifying}>
              {verifying ? "Verifying…" : "Verify"}
            </button>
          </div>
          <div className="otp-links">
            <button
              type="button"
              className="link-btn"
              onClick={() => void send()}
              disabled={secondsLeft > 0 || sending}
            >
              {sending ? "Sending…" : secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setPhase("enter");
                setChanging(true);
                setCode("");
                setCodeError(null);
                window.setTimeout(() => phoneRef.current?.focus(), 0);
              }}
            >
              Change number
            </button>
          </div>
        </form>
      )}

      <p className="privacy-note">
        Your number is only used for your call and booking updates.{" "}
        <Link href="/privacy">Privacy</Link>
      </p>
    </section>
  );
}
