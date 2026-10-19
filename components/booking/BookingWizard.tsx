"use client";

import { parsePhoneNumberFromString } from "libphonenumber-js";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingResponse, BookingSessionView, BookingView, SessionResponse, StartSessionRequest } from "@/lib/shared/api";
import { maskPhone, trackingSchema } from "@/lib/shared/validation";
import { ApiError, apiFetch } from "./api-client";
import { canonicalZone, fmtDate, fmtTime, fmtZoneShort, minutesBetween, zoneLabel } from "./format";
import { PhoneStep } from "./PhoneStep";
import { Progress } from "./Progress";
import { SlotPicker, type Slot } from "./SlotPicker";

type Step = 1 | 2 | 3;
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

  const [country, setCountry] = useState("IN");
  const [phone, setPhone] = useState("");
  const [phoneNotice, setPhoneNotice] = useState<string | null>(null);

  const [timeZone, setTimeZone] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slotsReload, setSlotsReload] = useState(0);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);

  const [idemKey, setIdemKey] = useState("");

  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  /** Apply a fresh session snapshot: confirmation, returning-visitor, or the right step. */
  const applySession = useCallback(
    (s: BookingSessionView, opts: { initial: boolean }) => {
      if (s.bookingReference) {
        router.replace("/booking/confirmation");
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
      setStep(s.phoneVerified ? 2 : 1);
    },
    [router],
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

  function goTo(s: Step) {
    if (s === 3) setIdemKey(crypto.randomUUID()); // one key per review screen
    setStep(s);
  }

  async function refreshSession() {
    try {
      const { session: s } = await apiFetch<SessionResponse>("/api/booking/start", {
        method: "POST",
        body: tracking,
      });
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
          <p className="muted">For your security, booking sessions expire after a while. Start again. It only takes a minute.</p>
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
        <Progress step={1} />
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
      <Progress step={step} />

      {step === 1 && (
        <PhoneStep
          country={country}
          phone={phone}
          onCountryChange={setCountry}
          onPhoneChange={setPhone}
          verifiedPhone={session?.phoneVerified ? session.phoneE164 : null}
          headingRef={headingRef}
          notice={phoneNotice}
          onSessionExpired={() => setExpired(true)}
          onContinueVerified={() => goTo(2)}
          onVerified={({ session: s }) => {
            setPhoneNotice(null);
            applySession(s, { initial: false });
          }}
        />
      )}

      {step === 2 && (
        <section className="step" aria-labelledby="step-title">
          <h2 id="step-title" ref={headingRef} tabIndex={-1}>
            Book a time. Our sales team will contact you.
          </h2>
          <p className="step-lede">
            A {callMinutes}-minute call to {session?.phoneE164 ? maskPhone(session.phoneE164) : "your verified number"}.
            Times are shown in your time zone.
          </p>
          {slotNotice && (
            <p className="notice notice-error" role="alert">
              {slotNotice}
            </p>
          )}
          <SlotPicker
            timeZone={timeZone}
            onTimeZoneChange={setTimeZone}
            selected={slot}
            onSelect={(s) => {
              setSlot(s);
              if (s) setSlotNotice(null);
            }}
            reloadKey={slotsReload}
            labelledBy="step-title"
          />
          <div className="step-actions step-actions-split">
            <button type="button" className="btn btn-ghost btn-lg" onClick={() => goTo(1)}>
              Back
            </button>
            <button type="button" className="btn btn-primary btn-lg" disabled={!slot} onClick={() => goTo(3)}>
              {slot ? `Continue with ${fmtTime(slot.start, timeZone)}` : "Choose a time"}
            </button>
          </div>
        </section>
      )}

      {step === 3 && slot && session && (
        <ReviewStep
          headingRef={headingRef}
          phoneE164={session.phoneE164}
          slot={slot}
          timeZone={timeZone}
          callMinutes={callMinutes}
          idempotencyKey={idemKey}
          onBack={() => goTo(2)}
          onEditPhone={() => goTo(1)}
          onBooked={() => router.replace("/booking/confirmation")}
          onSlotGone={() => {
            setSlot(null);
            setSlotNotice("Sorry, that time was just taken. Please pick another. The times below are up to date.");
            setSlotsReload((k) => k + 1);
            goTo(2);
          }}
          onAlreadyBooked={() => void refreshSession()}
          onPhoneNotVerified={() => {
            setPhoneNotice("Please verify your number again.");
            goTo(1);
          }}
          onSessionExpired={() => setExpired(true)}
        />
      )}
    </div>
  );
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

// ---------------------------------------------------------------- step 3

function ReviewStep({ headingRef, ...p }: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  phoneE164: string | null;
  slot: Slot;
  timeZone: string;
  callMinutes: number;
  idempotencyKey: string;
  onBack: () => void;
  onEditPhone: () => void;
  onBooked: () => void;
  onSlotGone: () => void;
  onAlreadyBooked: () => void;
  onPhoneNotVerified: () => void;
  onSessionExpired: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minutes = minutesBetween(p.slot.start, p.slot.end) || p.callMinutes;

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await apiFetch<BookingResponse>("/api/booking/confirm", {
        method: "POST",
        body: { start: p.slot.start, timeZone: p.timeZone, idempotencyKey: p.idempotencyKey },
      });
      p.onBooked(); // keep the button disabled while we navigate
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setPending(false);
        throw err;
      }
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
          setError("Too many attempts. Please wait a minute and try again.");
          break;
        case "NETWORK":
          setError("We couldn't connect. Check your internet connection and try again.");
          break;
        default:
          setError(err.message);
      }
      setPending(false);
    }
  }

  const rows: { label: string; value: string; edit?: () => void; editLabel?: string }[] = [
    {
      label: "Phone",
      value: p.phoneE164 ? `${maskPhone(p.phoneE164)} · verified` : "Verified",
      edit: p.onEditPhone,
      editLabel: "phone number",
    },
    { label: "Date", value: fmtDate(p.slot.start, p.timeZone), edit: p.onBack, editLabel: "date" },
    {
      label: "Time",
      value: `${fmtTime(p.slot.start, p.timeZone)} ${fmtZoneShort(p.slot.start, p.timeZone)} (${zoneLabel(p.timeZone, p.slot.start)})`,
      edit: p.onBack,
      editLabel: "time",
    },
    { label: "Call length", value: `${minutes} minutes` },
  ];

  return (
    <section className="step" aria-labelledby="step-title">
      <h2 id="step-title" ref={headingRef} tabIndex={-1}>
        Confirm your call
      </h2>
      <p className="step-lede">Our sales team will call you on your verified number at this time.</p>
      <dl className="review-list">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>
              <span>{r.value}</span>
              {r.edit && (
                <button type="button" className="link-btn" onClick={r.edit} disabled={pending}>
                  Change<span className="sr-only"> {r.editLabel}</span>
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="field-hint">You can reschedule or cancel anytime before the call.</p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {pending ? "Booking your call…" : ""}
      </p>
      <div className="step-actions step-actions-split">
        <button type="button" className="btn btn-ghost btn-lg" onClick={p.onBack} disabled={pending}>
          Back
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void confirm()} disabled={pending} aria-busy={pending}>
          {pending ? "Booking…" : "Book my call"}
        </button>
      </div>
    </section>
  );
}
