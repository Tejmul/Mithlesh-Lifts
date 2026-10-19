import type { BookingView } from "@/lib/shared/api";
import { fmtDate, fmtTime, fmtZoneShort, minutesBetween, zoneLabel } from "./format";

/** Read-only booking details (server or client). */
export function BookingSummary({ booking, timeZone }: { booking: BookingView; timeZone?: string }) {
  const tz = timeZone ?? booking.customerTimeZone;
  return (
    <dl className="review-list">
      <div>
        <dt>Reference</dt>
        <dd>
          <span className="mono">{booking.reference}</span>
        </dd>
      </div>
      <div>
        <dt>Date</dt>
        <dd>{fmtDate(booking.start, tz)}</dd>
      </div>
      <div>
        <dt>Time</dt>
        <dd>
          {fmtTime(booking.start, tz)} {fmtZoneShort(booking.start, tz)} ({zoneLabel(tz, booking.start)})
        </dd>
      </div>
      <div>
        <dt>Call length</dt>
        <dd>{minutesBetween(booking.start, booking.end)} minutes</dd>
      </div>
      {booking.meetingUrl && (
        <div>
          <dt>Call link</dt>
          <dd>
            <a href={booking.meetingUrl} target="_blank" rel="noopener" className="break">
              {booking.meetingUrl}
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
}
