import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { requireAdmin } from "@/lib/server/admin/auth";
import { fmtDateTime, fmtInr, whatsappUrl } from "@/lib/server/admin/format";
import { db } from "@/lib/server/db";
import { reportError } from "@/lib/server/observability";
import { getAvailableSlots, type Slot } from "@/lib/server/scheduling/availability";
import { getSettings } from "@/lib/server/settings";
import { ActionForm } from "../../../_components/ActionForm";
import { StatusBadge } from "../../../_components/StatusBadge";
import {
  cancelAction,
  markClientAction,
  markNotConvertedAction,
  saveLeadAction,
  rescheduleAction,
  saveNotesAction,
  setStatusAction,
} from "./actions";

export const metadata: Metadata = { title: "Booking" };

const NOTIFICATION_LABEL: Record<string, string> = {
  booking_confirmed: "Confirmation",
  booking_rescheduled: "Rescheduled",
  booking_cancelled: "Cancelled",
  reminder: "Reminder",
  team_new_booking: "Team: new booking",
  team_booking_changed: "Team: booking changed",
};

function groupSlots(slots: Slot[], tz: string) {
  const groups = new Map<string, { label: string; slots: { value: string; label: string }[] }>();
  for (const s of slots) {
    const dt = DateTime.fromJSDate(s.start, { zone: tz });
    const key = dt.toISODate()!;
    if (!groups.has(key)) groups.set(key, { label: dt.toFormat("cccc d LLL"), slots: [] });
    groups.get(key)!.slots.push({ value: s.start.toISOString(), label: dt.toFormat("h:mm a") });
  }
  return [...groups.values()];
}

export default async function BookingDetailPage({ params }: PageProps<"/admin/bookings/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const booking = await db.booking.findUnique({
    where: { id },
    include: { lead: true, notifications: { orderBy: { createdAt: "asc" } } },
  });
  if (!booking) notFound();
  const settings = await getSettings();
  const tz = settings.coachTimeZone;
  const lead = booking.lead;
  const active = booking.status === "CONFIRMED";

  let slotGroups: ReturnType<typeof groupSlots> | null = null;
  if (active) {
    try {
      const { slots } = await getAvailableSlots({ excludeBookingId: booking.id });
      slotGroups = groupSlots(slots, tz);
    } catch (err) {
      reportError(err, { where: "admin.booking_detail.slots", bookingId: booking.id });
    }
  }

  const hidden = <input type="hidden" name="bookingId" value={booking.id} />;

  return (
    <>
      <p className="adm-crumbs">
        <Link href="/admin/bookings">← Bookings</Link>
      </p>
      <div className="adm-page-head">
        <h1 className="adm-h1">
          <a href={`tel:${lead.phoneE164}`} className="adm-phone-lg">
            {lead.phoneE164}
          </a>{" "}
          <span className="adm-muted adm-h1-sub">
            {lead.fullName ?? "No name yet"} · <span className="adm-mono">{booking.reference}</span>
          </span>
        </h1>
        <StatusBadge status={booking.status} />
      </div>

      <div className="adm-grid-2">
        <section className="adm-panel" aria-labelledby="call-h">
          <h2 id="call-h" className="adm-h2">
            Call
          </h2>
          <dl className="adm-dl">
            <dt>Starts ({tz})</dt>
            <dd>{fmtDateTime(booking.startsAt, tz)}</dd>
            <dt>Ends</dt>
            <dd>{fmtDateTime(booking.endsAt, tz)}</dd>
            <dt>Customer time</dt>
            <dd>
              {fmtDateTime(booking.startsAt, booking.customerTimeZone)} ({booking.customerTimeZone})
            </dd>
            <dt>Meeting link</dt>
            <dd>{booking.meetingUrl ? "Yes" : settings.meetingUrl ? "No (default link in Settings)" : "No"}</dd>
            <dt>Booked</dt>
            <dd>{fmtDateTime(booking.createdAt, tz)}</dd>
            {booking.rescheduledAt && (
              <>
                <dt>Rescheduled</dt>
                <dd>{fmtDateTime(booking.rescheduledAt, tz)}</dd>
              </>
            )}
            {booking.cancelledAt && (
              <>
                <dt>Cancelled</dt>
                <dd>
                  {fmtDateTime(booking.cancelledAt, tz)}
                  {booking.cancelReason ? ` — ${booking.cancelReason}` : ""}
                </dd>
              </>
            )}
            <dt>Source / campaign</dt>
            <dd>{[booking.source, booking.campaign].filter(Boolean).join(" / ") || "—"}</dd>
          </dl>
        </section>

        <section className="adm-panel" aria-labelledby="lead-h">
          <h2 id="lead-h" className="adm-h2">
            Lead
          </h2>
          <dl className="adm-dl">
            <dt>Phone</dt>
            <dd className="adm-links">
              <a href={`tel:${lead.phoneE164}`} className="adm-phone">
                {lead.phoneE164}
              </a>
              <a href={whatsappUrl(lead.phoneE164)} target="_blank" rel="noopener noreferrer">
                WhatsApp
              </a>
            </dd>
            <dt>Name</dt>
            <dd>{lead.fullName ?? <span className="adm-muted">No name yet</span>}</dd>
            <dt>Phone verified</dt>
            <dd>{fmtDateTime(lead.phoneVerifiedAt, tz)}</dd>
            <dt>Email</dt>
            <dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : <span className="adm-muted">—</span>}</dd>
            <dt>Lead source</dt>
            <dd>{[lead.source, lead.campaign].filter(Boolean).join(" / ") || "—"}</dd>
            <dt>ManyChat ID</dt>
            <dd className="adm-mono">{lead.manychatSubscriberId ?? "—"}</dd>
            <dt>Marketing opt-in</dt>
            <dd>{lead.marketingConsentAt ? fmtDateTime(lead.marketingConsentAt, tz) : "No"}</dd>
          </dl>
          <h3 className="adm-h3">Edit name &amp; email</h3>
          <ActionForm action={saveLeadAction} submitLabel="Save lead details" className="adm-inline-form">
            {hidden}
            <label className="adm-field">
              <span>Full name</span>
              <input name="fullName" maxLength={80} autoComplete="off" defaultValue={lead.fullName ?? ""} />
            </label>
            <label className="adm-field">
              <span>Email</span>
              <input name="email" type="email" maxLength={254} autoComplete="off" defaultValue={lead.email ?? ""} />
            </label>
          </ActionForm>
        </section>
      </div>

      {booking.status !== "CANCELLED" && (
        <section className="adm-panel adm-outcome" aria-labelledby="outcome-h">
          <h2 id="outcome-h" className="adm-h2">
            Sales outcome
          </h2>
          <p className="adm-outcome-now">
            {booking.convertedAt ? (
              <>
                <span className="adm-badge adm-badge-client">Client</span> {fmtInr(booking.dealValueInr ?? 0)} · converted{" "}
                {fmtDateTime(booking.convertedAt, tz)}
              </>
            ) : booking.status === "COMPLETED" ? (
              <span className="adm-badge adm-badge-cancelled">Not converted</span>
            ) : booking.status === "NO_SHOW" ? (
              <span className="adm-badge adm-badge-no_show">No-show</span>
            ) : (
              <span className="adm-muted">Not recorded yet — update after the call.</span>
            )}
          </p>
          <div className="adm-actions-grid">
            <ActionForm
              action={markClientAction}
              submitLabel={booking.convertedAt ? "Update deal" : "Mark as client"}
              className="adm-inline-form"
            >
              {hidden}
              <label className="adm-field">
                <span>Deal value (₹, whole rupees)</span>
                <input
                  name="dealValueInr"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  required
                  defaultValue={booking.dealValueInr ?? undefined}
                  placeholder="25000"
                />
              </label>
            </ActionForm>
            {!(booking.status === "COMPLETED" && !booking.convertedAt) && (
              <ActionForm action={markNotConvertedAction} submitLabel="Not converted" variant="secondary">
                {hidden}
              </ActionForm>
            )}
          </div>
        </section>
      )}

      <section className="adm-panel" aria-labelledby="actions-h">
        <h2 id="actions-h" className="adm-h2">
          Actions
        </h2>
        <div className="adm-actions-grid">
          {active && (
            <>
              <ActionForm action={setStatusAction} submitLabel="Mark completed" variant="secondary">
                {hidden}
                <input type="hidden" name="status" value="COMPLETED" />
              </ActionForm>
              <ActionForm action={setStatusAction} submitLabel="Mark no-show" variant="secondary">
                {hidden}
                <input type="hidden" name="status" value="NO_SHOW" />
              </ActionForm>
            </>
          )}
          {(booking.status === "COMPLETED" || booking.status === "NO_SHOW") && (
            <ActionForm action={setStatusAction} submitLabel="Revert to confirmed" variant="secondary">
              {hidden}
              <input type="hidden" name="status" value="CONFIRMED" />
            </ActionForm>
          )}
        </div>

        {active && (
          <div className="adm-grid-2">
            <div>
              <h3 className="adm-h3">Reschedule</h3>
              {slotGroups === null ? (
                <p className="adm-msg adm-msg-error">Couldn&apos;t load available times. Try again shortly.</p>
              ) : slotGroups.length === 0 ? (
                <p className="adm-empty">No open slots in the booking window.</p>
              ) : (
                <ActionForm action={rescheduleAction} submitLabel="Move booking" pendingLabel="Moving…">
                  {hidden}
                  <label className="adm-field">
                    <span>New start ({tz})</span>
                    <select name="start" required defaultValue="">
                      <option value="" disabled>
                        Choose a time
                      </option>
                      {slotGroups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.slots.map((s) => (
                            <option key={s.value} value={s.value}>
                              {g.label}, {s.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </ActionForm>
              )}
            </div>
            <div>
              <h3 className="adm-h3">Cancel</h3>
              <ActionForm action={cancelAction} submitLabel="Cancel booking" pendingLabel="Cancelling…" variant="danger">
                {hidden}
                <label className="adm-field">
                  <span>Reason (shared with the team)</span>
                  <input name="reason" required minLength={2} maxLength={500} />
                </label>
              </ActionForm>
            </div>
          </div>
        )}
      </section>

      <div className="adm-grid-2">
        <section className="adm-panel" aria-labelledby="notes-h">
          <h2 id="notes-h" className="adm-h2">
            Internal notes
          </h2>
          <ActionForm action={saveNotesAction} submitLabel="Save notes">
            {hidden}
            <label className="adm-field">
              <span className="adm-sr">Notes</span>
              <textarea name="notes" rows={6} maxLength={5000} defaultValue={booking.internalNotes ?? ""} />
            </label>
          </ActionForm>
        </section>

        <section className="adm-panel" aria-labelledby="emails-h">
          <h2 id="emails-h" className="adm-h2">
            Emails
          </h2>
          {booking.notifications.length === 0 ? (
            <p className="adm-empty">No emails queued for this booking.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">To</th>
                    <th scope="col">Status</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {booking.notifications.map((n) => (
                    <tr key={n.id}>
                      <td>{NOTIFICATION_LABEL[n.kind] ?? n.kind}</td>
                      <td>{n.recipient}</td>
                      <td>
                        <StatusBadge status={n.status} />
                        {n.status === "FAILED" && n.lastError && (
                          <span className="adm-small adm-muted"> {n.lastError.slice(0, 120)}</span>
                        )}
                      </td>
                      <td className="adm-nowrap">
                        {n.sentAt
                          ? fmtDateTime(n.sentAt, tz)
                          : n.status === "PENDING"
                            ? `Due ${fmtDateTime(n.sendAfter, tz)}`
                            : `${n.attempts} attempt${n.attempts === 1 ? "" : "s"}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
