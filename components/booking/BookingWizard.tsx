"use client";

import { parsePhoneNumberFromString } from "libphonenumber-js";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingResponse, BookingSessionView, BookingView, SessionResponse, StartSessionRequest } from "@/lib/shared/api";
import { createAccountSchema, maskPhone, trackingSchema } from "@/lib/shared/validation";
import { ApiError, apiFetch } from "./api-client";
import { canonicalZone, fmtDate, fmtTime, fmtZoneShort } from "./format";
import { PhoneStep, type AuthMode } from "./PhoneStep";
import { Progress } from "./Progress";
import { SlotPicker, type Slot } from "./SlotPicker";

type Step = 1 | "name" | 2;
type Boot = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

function detectTimeZone() {
  try {
    return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata");
  } catch {
    return "Asia/Kolkata";
  }
}

function readTracking(sp: URLSearchParams): StartSessionRequest {
  const out: StartSessionRequest = {};
  for (const key of ["source", "campaign", "mc"] as const) {
    const v = sp.get(key);
    if (!v) continue;
    const ok = trackingSchema.shape[key].safeParse(v);
    if (ok.success && ok.data) out[key] = ok.data;
  }
  return out;
}

async function startSession(body: StartSessionRequest) {
  try {
    return await apiFetch<SessionResponse>("/api/booking/start", { method: "POST", body });
  } catch (err) {
    // One quiet retry for transient failures before showing an error.
    if (err instanceof ApiError && (err.code === "RATE_LIMITED" || err.code === "VALIDATION")) throw err;
    await new Promise((r) => setTimeout(r, 800));
    return apiFetch<SessionResponse>("/api/booking/start", { method: "POST", body });
  }
}

export function BookingWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tracking] = useState(() => readTracking(new URLSearchParams(searchParams.toString())));

  const [boot, setBoot] = useState<Boot>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<BookingSessionView | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [expired, setExpired] = useState(false);

  const [mode, setMode] = useState<AuthMode>(() => (searchParams.get("login") ? "login" : "signup"));
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("IN");
  const [phone, setPhone] = useState("");
  const [phoneNotice, setPhoneNotice] = useState<string | null>(null);

  const [timeZone, setTimeZone] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slotsReload, setSlotsReload] = useState(0);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  /** Apply a fresh session snapshot: confirmation, returning visitor, name, or the right step. */
  const applySession = useCallback(
    (s: BookingSessionView, opts: { initial: boolean }) => {
      if (s.bookingReference) {
        router.replace("/booking/confirmation");
        return;
      }
      const next = searchParams.get("next");
      if (s.account && next && /^\/account(\/|$)/.test(next)) {
        router.replace(next);
        return;
      }
      setSession(s);
      if (opts.initial) {
        const known = s.phoneE164 ?? s.pendingPhoneE164;
        const parsed = known ? parsePhoneNumberFromString(known) : undefined;
        if (parsed?.country) {
          setCountry(parsed.country);
          setPhone(parsed.formatNational());
        }
      }
      setStep(!s.phoneVerified ? 1 : s.account ? 2 : "name");
    },
    [router, searchParams],
  );

  useEffect(() => {
    let cancelled = false;
    startSession(tracking)
      .then(({ session: s }) => {
        if (cancelled) return;
        setTimeZone((tz) => tz || detectTimeZone());
        applySession(s, { initial: true });
        setBoot({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBoot({
          status: "error",
          message:
            err instanceof ApiError && err.code === "RATE_LIMITED"
              ? "Too many requests right now. Please wait a minute and try again."
              : err instanceof ApiError && err.code === "NETWORK"
                ? "We couldn't connect. Check your internet connection and try again."
                : "We couldn't load the booking form. Please try again.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, applySession, tracking]);

  // Move focus to the step heading when the step changes (not on first paint)
  useEffect(() => {
    if (boot.status !== "ready") return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, boot.status, session?.upcomingBooking]);

  async function refreshSession() {
    try {
      const { session: s } = await apiFetch<SessionResponse>("/api/booking/start", { method: "POST", body: tracking });
      applySession(s, { initial: false });
    } catch {
      setExpired(true);
    }
  }

  if (expired) {
    return (
      <div className="wizard-card">
        <div className="state-block" role="alert">
          <h2 className="h3">Your session timed out.</h2>
          <p className="muted">For your security, sessions expire after a while. Start again. It only takes a minute.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Start again
          </button>
        </div>
      </div>
    );
  }

  if (boot.status === "loading") {
    return (
      <div className="wizard-card" aria-busy="true">
        <p className="sr-only" role="status">
          Loading…
        </p>
        <WizardSkeleton />
      </div>
    );
  }

  if (boot.status === "error") {
    return (
      <div className="wizard-card">
        <div className="notice notice-error" role="alert">
          <p>{boot.message}</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setBoot({ status: "loading" });
              setAttempt((a) => a + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const callMinutes = session?.callMinutes ?? 30;
  const upcoming = session?.phoneVerified ? session.upcomingBooking : null;

  if (upcoming) {
    return (
      <div className="wizard-card">
        <UpcomingBooking booking={upcoming} headingRef={headingRef} />
      </div>
    );
  }

  return (
    <div className="wizard-card">
      <Progress step={step === 2 ? 2 : 1} />

      {step === 1 && (
        <PhoneStep
          mode={mode}
          onModeChange={setMode}
          fullName={fullName}
          onFullNameChange={setFullName}
          country={country}
          phone={phone}
          onCountryChange={setCountry}
          onPhoneChange={setPhone}
          verifiedPhone={session?.phoneVerified ? session.phoneE164 : null}
          headingRef={headingRef}
          notice={phoneNotice}
          onSessionExpired={() => setExpired(true)}
          onContinueVerified={() => setStep(session?.account ? 2 : "name")}
          onVerified={({ session: s }) => {
            setPhoneNotice(null);
            applySession(s, { initial: false });
          }}
        />
      )}

      {step === "name" && (
        <NameStep
          headingRef={headingRef}
          initial={fullName}
          onDone={(s) => applySession(s, { initial: false })}
          onSessionExpired={() => setExpired(true)}
        />
      )}

      {step === 2 && session && (
        <TimeStep
          headingRef={headingRef}
          session={session}
          callMinutes={callMinutes}
          timeZone={timeZone}
          onTimeZoneChange={setTimeZone}
          slot={slot}
          onSlotChange={(s) => {
            setSlot(s);
            if (s) setSlotNotice(null);
          }}
          slotsReload={slotsReload}
          notice={slotNotice}
          onBooked={() => router.replace("/booking/confirmation")}
          onSlotGone={() => {
            setSlot(null);
            setSlotNotice("That time was just taken by someone else. Please pick another. The times below are up to date.");
            setSlotsReload((k) => k + 1);
          }}
          onAlreadyBooked={() => void refreshSession()}
          onPhoneNotVerified={() => {
            setPhoneNotice("Please verify your number again.");
            setStep(1);
          }}
          onSessionExpired={() => setExpired(true)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- name (only when a "log in" number had no account)

function NameStep({
  headingRef,
  initial,
  onDone,
  onSessionExpired,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  initial: string;
  onDone: (s: BookingSessionView) => void;
  onSessionExpired: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function save() {
    const parsed = createAccountSchema.safeParse({ fullName: name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter your name.");
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { session } = await apiFetch<SessionResponse>("/api/booking/account", { method: "POST", body: parsed.data });
      onDone(session);
    } catch (err) {
      if (err instanceof ApiError && err.code === "SESSION_EXPIRED") return onSessionExpired();
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <section className="step" aria-labelledby="step-title">
      <h2 id="step-title" ref={headingRef} tabIndex={-1}>
        One last thing: your name
      </h2>
      <p className="step-lede">Your number is verified. Tell us your name so our team knows who they&apos;re calling.</p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className={`field${error ? " has-error" : ""}`}>
          <label htmlFor="acct-name">Your name</label>
          <input
            ref={inputRef}
            id="acct-name"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            placeholder="Rahul Sharma"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "acct-name-error" : undefined}
            maxLength={80}
          />
          {error && (
            <p id="acct-name-error" className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="step-actions">
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={pending} aria-busy={pending}>
            {pending ? "Creating your account…" : "Continue"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- time + one-tap booking

function TimeStep({
  headingRef,
  ...p
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  session: BookingSessionView;
  callMinutes: number;
  timeZone: string;
  onTimeZoneChange: (tz: string) => void;
  slot: Slot | null;
  onSlotChange: (s: Slot | null) => void;
  slotsReload: number;
  notice: string | null;
  onBooked: () => void;
  onSlotGone: () => void;
  onAlreadyBooked: () => void;
  onPhoneNotVerified: () => void;
  onSessionExpired: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per chosen slot: double taps never create two bookings.
  const [idem, setIdem] = useState<{ start: string; key: string } | null>(null);

  async function book() {
    if (!p.slot || pending) return;
    const key = idem?.start === p.slot.start ? idem.key : crypto.randomUUID();
    setIdem({ start: p.slot.start, key });
    setPending(true);
    setError(null);
    try {
      await apiFetch<BookingResponse>("/api/booking/confirm", {
        method: "POST",
        body: { start: p.slot.start, timeZone: p.timeZone, idempotencyKey: key },
      });
      p.onBooked(); // keep the button disabled while we navigate
    } catch (err) {
      setPending(false);
      if (!(err instanceof ApiError)) throw err;
      switch (err.code) {
        case "SLOT_TAKEN":
        case "SLOT_UNAVAILABLE":
          return p.onSlotGone();
        case "ALREADY_BOOKED":
          return p.onAlreadyBooked();
        case "PHONE_NOT_VERIFIED":
          return p.onPhoneNotVerified();
        case "SESSION_EXPIRED":
          return p.onSessionExpired();
        case "RATE_LIMITED":
          return setError("Too many attempts. Please wait a minute and try again.");
        case "NETWORK":
          return setError("We couldn't connect. Check your internet connection and try again.");
        default:
          return setError(err.message);
      }
    }
  }

  const account = p.session.account;
  const firstName = account?.fullName?.trim().split(/\s+/)[0];

  return (
    <section className="step" aria-labelledby="step-title">
      {account && (
        <p className="hello">
          <span>{firstName ? `Hi ${firstName}` : "You're logged in"}</span>
          <span className="client-id">ID {account.clientCode}</span>
        </p>
      )}
      <h2 id="step-title" ref={headingRef} tabIndex={-1}>
        Book a time. Our sales team will contact you.
      </h2>
      <p className="step-lede">
        A {p.callMinutes}-minute call to {p.session.phoneE164 ? maskPhone(p.session.phoneE164) : "your verified number"}.
      </p>
      {p.notice && (
        <p className="notice notice-error" role="alert">
          {p.notice}
        </p>
      )}
      <SlotPicker
        timeZone={p.timeZone}
        onTimeZoneChange={p.onTimeZoneChange}
        selected={p.slot}
        onSelect={p.onSlotChange}
        reloadKey={p.slotsReload}
        labelledBy="step-title"
      />
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <div className={`book-bar${p.slot ? " is-ready" : ""}`}>
        <p className="sr-only" role="status" aria-live="polite">
          {pending ? "Booking your call…" : p.slot ? `Selected ${fmtDate(p.slot.start, p.timeZone)} at ${fmtTime(p.slot.start, p.timeZone)}` : ""}
        </p>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={!p.slot || pending}
          aria-busy={pending}
          onClick={() => void book()}
        >
          {pending
            ? "Booking…"
            : p.slot
              ? `Book ${fmtDayShort(p.slot.start, p.timeZone)} · ${fmtTime(p.slot.start, p.timeZone)}`
              : "Pick a day and time above"}
        </button>
        <p className="book-bar-note">You can reschedule or cancel anytime before the call.</p>
      </div>
    </section>
  );
}

function fmtDayShort(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

function WizardSkeleton() {
  return (
    <div className="wizard-skeleton" aria-hidden="true">
      <span className="skeleton" style={{ width: "40%", height: 14 }} />
      <span className="skeleton" style={{ height: 4 }} />
      <span className="skeleton" style={{ width: "60%", height: 28, marginTop: 20 }} />
      <span className="skeleton" style={{ height: 52 }} />
      <span className="skeleton" style={{ height: 54 }} />
    </div>
  );
}

// ---------------------------------------------------------------- returning visitor

function UpcomingBooking({
  booking,
  headingRef,
}: {
  booking: BookingView;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const tz = booking.customerTimeZone;
  return (
    <section className="step" aria-labelledby="step-title">
      <h2 id="step-title" ref={headingRef} tabIndex={-1}>
        You already have a call booked.
      </h2>
      <p className="confirm-lede">
        Our sales team will call you on <strong>{maskPhone(booking.phoneE164)}</strong> at{" "}
        <strong>
          {fmtTime(booking.start, tz)} {fmtZoneShort(booking.start, tz)}
        </strong>{" "}
        on {fmtDate(booking.start, tz)}.
      </p>
      {booking.manageUrl ? (
        <div className="step-actions">
          <a className="btn btn-primary btn-lg" href={booking.manageUrl}>
            Reschedule
          </a>
          <a className="btn btn-danger btn-lg" href={booking.manageUrl}>
            Cancel call
          </a>
        </div>
      ) : (
        <p className="notice">It&apos;s too close to the call to change it online. If something comes up, DM us on Instagram.</p>
      )}
    </section>
  );
}
