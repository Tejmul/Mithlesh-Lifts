import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BookingSummary } from "@/components/booking/BookingSummary";
import { fmtDate, fmtTime, fmtZoneShort, googleCalendarUrl } from "@/components/booking/format";
import { maskPhone } from "@/lib/shared/validation";
import { SiteShell } from "@/components/site/SiteShell";
import { getSessionFromCookies } from "@/lib/server/booking-session";
import { toBookingView } from "@/lib/server/bookings/service";
import { getCurrentCustomer } from "@/lib/server/customer-auth";
import { db } from "@/lib/server/db";

export const metadata: Metadata = {
  title: "Your call is booked",
  robots: { index: false },
};

export default function ConfirmationPage() {
  return (
    <SiteShell current="none" stickyCta={false}>
      <div className="page narrow-page">
        <Suspense fallback={<ConfirmationSkeleton />}>
          <Confirmation />
        </Suspense>
      </div>
    </SiteShell>
  );
}

function ConfirmationSkeleton() {
  return (
    <div className="wizard-card" aria-busy="true">
      <p className="sr-only" role="status">
        Loading your booking…
      </p>
      <div className="wizard-skeleton" aria-hidden="true">
        <span className="skeleton" style={{ width: "50%", height: 32 }} />
        <span className="skeleton" style={{ height: 200 }} />
      </div>
    </div>
  );
}

async function Confirmation() {
  // Booking logs the customer in; their account page is the confirmation (docs/FLOW.md ③).
  if (await getCurrentCustomer()) redirect("/account");
  const session = await getSessionFromCookies();
  const record = session?.bookingId
    ? await db.booking.findUnique({ where: { id: session.bookingId }, include: { lead: true } })
    : null;

  if (!record) {
    return (
      <div className="wizard-card state-block">
        <p className="eyebrow">Booking</p>
        <h1>We couldn&apos;t find a booking here.</h1>
        <p className="muted">
          If you booked on another device or browser, open the booking page and verify your number to see your call.
          Otherwise, you can book one now.
        </p>
        <div className="state-actions">
          <Link className="btn btn-primary btn-lg" href="/book">
            Book a call
          </Link>
        </div>
      </div>
    );
  }

  const booking = await toBookingView(record);
  const cancelled = booking.status === "CANCELLED";
  const calUrl = googleCalendarUrl({
    title: "Coaching call · Coach Scale Systems",
    start: booking.start,
    end: booking.end,
    details: `Booking reference ${booking.reference}.${booking.meetingUrl ? ` Join: ${booking.meetingUrl}` : ""}`,
  });

  return (
    <div className="wizard-card confirm-card">
      {cancelled ? (
        <>
          <p className="eyebrow">Booking {booking.reference}</p>
          <h1>This call was cancelled.</h1>
          <p className="muted">Want to pick a new time?</p>
        </>
      ) : (
        <>
          <span className="confirm-badge" aria-hidden="true" />
          <h1>You&apos;re booked.</h1>
          <p className="confirm-lede">
            Our sales team will call you on <strong>{maskPhone(booking.phoneE164)}</strong> at{" "}
            <strong>
              {fmtTime(booking.start, booking.customerTimeZone)} {fmtZoneShort(booking.start, booking.customerTimeZone)}
            </strong>{" "}
            on {fmtDate(booking.start, booking.customerTimeZone)}.
          </p>
        </>
      )}

      <BookingSummary booking={booking} />

      {!cancelled && (
        <>
          <div className="state-actions">
            {booking.manageUrl && (
              <>
                <a className="btn btn-ghost btn-lg" href={booking.manageUrl}>
                  Reschedule
                </a>
                <a className="btn btn-danger btn-lg" href={booking.manageUrl}>
                  Cancel call
                </a>
              </>
            )}
            <a className="btn btn-ghost btn-lg" href={calUrl} target="_blank" rel="noopener">
              Add to Google Calendar<span className="sr-only"> (opens in new tab)</span>
            </a>
          </div>
          <p className="field-hint">
            {booking.manageUrl
              ? "You can reschedule or cancel anytime before the call. To change it later, open this page again and verify your number."
              : "It's too close to the call to change it online. If something comes up, DM us on Instagram."}
          </p>
          <div className="call-prep">
            <h2 className="h3">Before the call</h2>
            <ul className="tick-list">
              <li>Keep your phone nearby at the time you picked.</li>
              <li>Think about your goal and your current training and eating routine.</li>
              <li>Our team will recommend the right coaching plan and send you a personalised quote. You decide after.</li>
            </ul>
          </div>
        </>
      )}
      {cancelled && (
        <div className="state-actions">
          <Link className="btn btn-primary btn-lg" href="/book">
            Book a call
          </Link>
        </div>
      )}
    </div>
  );
}
