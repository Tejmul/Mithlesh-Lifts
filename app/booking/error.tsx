"use client";

import Link from "next/link";

export default function BookingError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page narrow-page">
      <div className="wizard-card state-block" role="alert">
        <p className="eyebrow">Booking</p>
        <h1>We couldn&apos;t load your booking.</h1>
        <p className="muted">This is on our side. Please try again in a moment.</p>
        <div className="state-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => reset()}>
            Try again
          </button>
          <Link className="btn btn-ghost btn-lg" href="/">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
