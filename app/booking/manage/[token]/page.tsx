import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ManageBooking } from "@/components/booking/ManageBooking";
import { SiteShell } from "@/components/site/SiteShell";
import { getBookingByManageToken, toBookingView } from "@/lib/server/bookings/service";
import { INSTAGRAM_DM_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Manage your booking",
  robots: { index: false },
  referrer: "no-referrer",
};

export default function ManagePage({ params }: PageProps<"/booking/manage/[token]">) {
  return (
    <SiteShell current="none" stickyCta={false}>
      <div className="page narrow-page">
        <Suspense
          fallback={
            <div className="wizard-card" aria-busy="true">
              <p className="sr-only" role="status">
                Loading your booking…
              </p>
              <div className="wizard-skeleton" aria-hidden="true">
                <span className="skeleton" style={{ width: "50%", height: 32 }} />
                <span className="skeleton" style={{ height: 200 }} />
              </div>
            </div>
          }
        >
          <Manage params={params} />
        </Suspense>
      </div>
    </SiteShell>
  );
}

async function Manage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = token.length <= 512 ? await getBookingByManageToken(token) : null;

  if (!record) {
    return (
      <div className="wizard-card state-block">
        <p className="eyebrow">Manage booking</p>
        <h1>This link is no longer valid.</h1>
        <p className="muted">
          Links stop working after a booking is rescheduled or once it&apos;s too close to the call. To manage your
          call, open the booking page and verify your number, or{" "}
          <a href={INSTAGRAM_DM_URL} target="_blank" rel="noopener">
            DM us on Instagram<span className="sr-only"> (opens in new tab)</span>
          </a>
          .
        </p>
        <div className="state-actions">
          <Link className="btn btn-primary btn-lg" href="/book">
            Go to booking
          </Link>
        </div>
      </div>
    );
  }

  const booking = await toBookingView(record);
  return <ManageBooking token={token} initial={booking} />;
}
