"use client";

import Link from "next/link";

/** Any unexpected server error on a public page: a calm message instead of Next's bare error screen. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page narrow-page">
      <div className="wizard-card state-block" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1>This page didn&apos;t load.</h1>
        <p className="muted">It&apos;s on our side, not yours. Please try again in a moment.</p>
        <div className="state-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => reset()}>
            Try again
          </button>
          <Link className="btn btn-ghost btn-lg" href="/book">
            Book a call
          </Link>
        </div>
      </div>
    </div>
  );
}
