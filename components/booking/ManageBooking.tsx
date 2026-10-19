"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { BookingResponse, BookingView } from "@/lib/shared/api";
import { INSTAGRAM_DM_URL } from "@/lib/site";
import { ApiError, apiFetch } from "./api-client";
import { BookingSummary } from "./BookingSummary";
import { fmtDate, fmtTime, fmtZoneShort } from "./format";
import { SlotPicker, type Slot } from "./SlotPicker";

type Mode = "view" | "reschedule" | "rescheduled" | "cancelled" | "too-late" | "invalid";

export function ManageBooking({ token: initialToken, initial }: { token: string; initial: BookingView }) {
  const [booking, setBooking] = useState(initial);
  const [token, setToken] = useState(initialToken);
  const [mode, setMode] = useState<Mode>(
    initial.status === "CANCELLED" ? "cancelled" : initial.manageUrl ? "view" : "too-late",
  );
  const [timeZone, setTimeZone] = useState(initial.customerTimeZone);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  function handleError(err: unknown) {
    if (!(err instanceof ApiError)) throw err;
    switch (err.code) {
      case "TOO_LATE_TO_CHANGE":
        setMode("too-late");
        break;
      case "NOT_FOUND":
      case "FORBIDDEN":
      case "UNAUTHORIZED":
        setMode("invalid");
        break;
      case "SLOT_TAKEN":
      case "SLOT_UNAVAILABLE":
        setSlot(null);
        setReloadKey((k) => k + 1);
        setError("Sorry, that time was just taken. Please pick another. The times below are up to date.");
        break;
      case "RATE_LIMITED":
        setError("Too many attempts. Please wait a minute and try again.");
        break;
      default:
        setError(err.message);
    }
  }

  async function reschedule() {
    if (!slot || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<BookingResponse>("/api/booking/manage/reschedule", {
        method: "POST",
        body: { token, start: slot.start, timeZone },
      });
      setBooking(res.booking);
      if (res.booking.manageUrl) {
        try {
          const path = new URL(res.booking.manageUrl).pathname;
          setToken(decodeURIComponent(path.split("/").pop() ?? token));
          window.history.replaceState(null, "", path);
        } catch {
          // keep the current URL
        }
      }
      setSlot(null);
      setMode("rescheduled");
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (err) {
      handleError(err);
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<BookingResponse>("/api/booking/manage/cancel", {
        method: "POST",
        body: { token, reason: reason.trim() || undefined },
      });
      setBooking(res.booking);
      dialogRef.current?.close();
      setMode("cancelled");
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch (err) {
      dialogRef.current?.close();
      handleError(err);
    } finally {
      setPending(false);
    }
  }

  const tz = booking.customerTimeZone;
  const when = `${fmtDate(booking.start, tz)} at ${fmtTime(booking.start, tz)} ${fmtZoneShort(booking.start, tz)}`;

  if (mode === "invalid") {
    return (
      <div className="wizard-card state-block">
        <h1 ref={headingRef} tabIndex={-1}>
          This link is no longer valid.
        </h1>
        <p className="muted">To manage your call, open the booking page and verify your number.</p>
        <div className="state-actions">
          <Link className="btn btn-primary btn-lg" href="/book">
            Book a call
          </Link>
        </div>
      </div>
    );
  }

  if (mode === "cancelled") {
    return (
      <div className="wizard-card state-block">
        <p className="eyebrow">Booking {booking.reference}</p>
        <h1 ref={headingRef} tabIndex={-1}>
          Your call is cancelled.
        </h1>
        <p className="muted">Changed your mind? You can book a new time whenever you&apos;re ready.</p>
        <div className="state-actions">
          <Link className="btn btn-primary btn-lg" href="/book">
            Book a call
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-card">
      <p className="eyebrow">Booking {booking.reference}</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {mode === "rescheduled" ? "Your call is moved." : mode === "reschedule" ? "Pick a new time" : "Your call"}
      </h1>

      {mode === "rescheduled" && (
        <p className="notice notice-success" role="status">
          New time: <strong>{when}</strong>. Our sales team will call you then. Older manage links no longer work;
          to change it again, use this page or verify your number on the booking page.
        </p>
      )}

      {mode === "too-late" && (
        <p className="notice" role="status">
          It&apos;s too close to the call to change it online. If something comes up,{" "}
          <a href={INSTAGRAM_DM_URL} target="_blank" rel="noopener">
            DM us on Instagram<span className="sr-only"> (opens in new tab)</span>
          </a>
          .
        </p>
      )}

      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}

      {mode === "reschedule" ? (
        <>
          <p className="step-lede">
            Currently: <strong className="text">{when}</strong>
          </p>
          <SlotPicker
            timeZone={timeZone}
            onTimeZoneChange={setTimeZone}
            selected={slot}
            onSelect={setSlot}
            reloadKey={reloadKey}
            excludeStart={booking.start}
          />
          <div className="step-actions step-actions-split">
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={() => {
                setMode("view");
                setSlot(null);
                setError(null);
              }}
              disabled={pending}
            >
              Back
            </button>
            <button type="button" className="btn btn-primary btn-lg" disabled={!slot || pending} aria-busy={pending} onClick={() => void reschedule()}>
              {pending ? "Moving…" : slot ? `Move to ${fmtTime(slot.start, timeZone)}` : "Choose a time"}
            </button>
          </div>
        </>
      ) : (
        <>
          <BookingSummary booking={booking} />
          {booking.manageUrl && mode !== "too-late" && (
            <div className="state-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => {
                  setError(null);
                  setMode("reschedule");
                  requestAnimationFrame(() => headingRef.current?.focus());
                }}
              >
                Reschedule
              </button>
              <button
                type="button"
                className="btn btn-danger btn-lg"
                onClick={() => {
                  setError(null);
                  dialogRef.current?.showModal();
                }}
              >
                Cancel call
              </button>
            </div>
          )}
        </>
      )}

      <dialog ref={dialogRef} className="dialog" aria-labelledby="cancel-title" aria-describedby="cancel-desc">
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            void cancel();
          }}
        >
          <h2 id="cancel-title">Cancel this call?</h2>
          <p id="cancel-desc" className="muted">
            {when}. You can always book a new time later.
          </p>
          <div className="field">
            <label htmlFor="cancel-reason">
              Reason <span className="muted">(optional)</span>
            </label>
            <textarea
              id="cancel-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="step-actions step-actions-split">
            <button type="button" className="btn btn-ghost btn-lg" onClick={() => dialogRef.current?.close()} disabled={pending}>
              Keep my call
            </button>
            <button type="submit" className="btn btn-danger btn-lg" disabled={pending} aria-busy={pending}>
              {pending ? "Cancelling…" : "Yes, cancel"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
