import "server-only";
import type { Booking, Lead, Settings } from "@/generated/prisma/client";
import { manageUrlFor } from "../bookings/service";
import { db } from "../db";
import { sendEmail } from "../email";
import {
  bookingCancelled,
  bookingConfirmed,
  bookingRescheduled,
  reminder,
  teamBookingChanged,
  teamNewBooking,
  type CustomerEmailInput,
  type RenderedEmail,
  type TeamEmailInput,
} from "../email/templates";
import { logEvent, reportError } from "../observability";
import { getSettings } from "../settings";
import { CUSTOMER_KINDS, readPayload } from "./payload";

/** Total send attempts before a row is marked FAILED. */
export const MAX_ATTEMPTS = 6;
/** Delay before retry n (after attempt n failed). */
export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
const LOCK_MS = 2 * 60_000;

type ClaimedRow = {
  id: string;
  bookingId: string | null;
  kind: string;
  recipient: string;
  payload: unknown;
  idempotencyKey: string;
  attempts: number;
};

type BookingWithLead = Booking & { lead: Lead };

/** Claims due rows atomically. Concurrent callers never get the same row. */
async function claim(limit: number, now: Date): Promise<ClaimedRow[]> {
  const lockedUntil = new Date(now.getTime() + LOCK_MS);
  return db.$queryRaw<ClaimedRow[]>`
    UPDATE "Notification"
    SET status = 'SENDING', "lockedUntil" = ${lockedUntil}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "Notification"
      WHERE (status = 'PENDING' AND "sendAfter" <= ${now})
         OR (status = 'SENDING' AND "lockedUntil" < ${now})
      ORDER BY "sendAfter"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "bookingId", kind, recipient, payload, "idempotencyKey", attempts`;
}

/**
 * Wording uses the time actually left: a 24h reminder delayed (outage, backlog) to 3h before the
 * call says "in 3 hours", not "in 24 hours". On-time reminders keep their planned wording.
 */
export function reminderOffsetNow(plannedMinutes: number, startsAt: Date, now: Date = new Date()): number {
  const left = Math.max(1, Math.round((startsAt.getTime() - now.getTime()) / 60_000));
  if (left >= plannedMinutes - 10) return plannedMinutes;
  if (left >= 120) return Math.round(left / 60) * 60;
  return left >= 55 ? 60 : Math.max(5, Math.round(left / 5) * 5);
}

/** Error text stored on the row: short, and with anything that looks like an address removed. */
function scrub(message: string) {
  return message
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[redacted]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[redacted]")
    .slice(0, 300);
}

function safeManageUrl(booking: Booking, cutoffMinutes: number): string | null {
  try {
    return manageUrlFor(booking, cutoffMinutes);
  } catch (err) {
    reportError(err, { where: "notifications.manageUrl", bookingId: booking.id });
    return null;
  }
}

/** Why a row should be dropped instead of sent, or null to send it. */
function skipReason(row: ClaimedRow, booking: BookingWithLead | null, now: Date): string | null {
  if (!booking) return "booking deleted";
  const payload = readPayload(row.payload);
  if (booking.status === "CANCELLED" && ["reminder", "booking_confirmed", "booking_rescheduled"].includes(row.kind)) {
    return "booking cancelled";
  }
  if (CUSTOMER_KINDS.includes(row.kind) && typeof payload.version === "number" && payload.version < booking.version) {
    return "stale version";
  }
  if (row.kind === "reminder") {
    if (booking.status !== "CONFIRMED") return "booking not active";
    const untilStart = booking.startsAt.getTime() - now.getTime();
    if (untilStart <= 5 * 60_000) return "call already started";
    // A badly delayed 24h reminder is redundant once the 1h reminder is close.
    if ((payload.offsetMinutes ?? 0) > 60 && untilStart < 2 * 60 * 60_000) return "superseded by later reminder";
  }
  return null;
}

function renderRow(row: ClaimedRow, booking: BookingWithLead, settings: Settings): RenderedEmail {
  const payload = readPayload(row.payload);
  const meetingUrl = booking.meetingUrl ?? settings.meetingUrl ?? null;
  const callMinutes = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000) || settings.callMinutes;
  const customer = (): CustomerEmailInput => ({
    name: booking.lead.fullName ?? "",
    reference: booking.reference,
    start: booking.startsAt,
    callMinutes,
    customerTimeZone: booking.customerTimeZone,
    meetingUrl,
    manageUrl: safeManageUrl(booking, settings.manageCutoffMinutes),
  });
  const team = (): TeamEmailInput => ({
    name: booking.lead.fullName ?? "",
    reference: booking.reference,
    start: booking.startsAt,
    callMinutes,
    customerTimeZone: booking.customerTimeZone,
    coachTimeZone: settings.coachTimeZone,
    meetingUrl,
    email: booking.lead.email,
    phone: booking.lead.phoneE164,
    source: booking.source ?? booking.lead.source ?? null,
    campaign: booking.campaign ?? booking.lead.campaign ?? null,
  });

  switch (row.kind) {
    case "booking_confirmed":
      return bookingConfirmed(customer());
    case "booking_rescheduled":
      return bookingRescheduled(customer());
    case "booking_cancelled":
      return bookingCancelled({ ...customer(), manageUrl: null });
    case "reminder":
      return reminder({ ...customer(), offsetMinutes: reminderOffsetNow(payload.offsetMinutes ?? 60, booking.startsAt) });
    case "team_new_booking":
      return teamNewBooking(team());
    case "team_booking_changed":
      return teamBookingChanged({
        ...team(),
        change: payload.event === "cancelled" || booking.status === "CANCELLED" ? "cancelled" : "rescheduled",
      });
    default:
      throw new Error(`Unknown notification kind: ${row.kind}`);
  }
}

export async function processDueNotifications(
  opts: { limit?: number; now?: Date; budgetMs?: number } = {},
): Promise<{ sent: number; failed: number; retried: number }> {
  const startedAt = Date.now();
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 200));
  const counts = { sent: 0, failed: 0, retried: 0 };

  const rows = await claim(limit, now);
  if (rows.length === 0) return counts;

  const settings = await getSettings();
  const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((id): id is string => !!id))];
  const bookings = new Map(
    (await db.booking.findMany({ where: { id: { in: bookingIds } }, include: { lead: true } })).map((b) => [b.id, b]),
  );

  for (const [index, row] of rows.entries()) {
    // Stop before the platform kills the function mid-send; unsent rows go back to the queue
    // untouched (attempt not counted) for the next run.
    if (opts.budgetMs && Date.now() - startedAt > opts.budgetMs) {
      await db.notification.updateMany({
        where: { id: { in: rows.slice(index).map((r) => r.id) }, status: "SENDING" },
        data: { status: "PENDING", lockedUntil: null, attempts: { decrement: 1 } },
      });
      break;
    }
    const booking = row.bookingId ? (bookings.get(row.bookingId) ?? null) : null;
    const reason = skipReason(row, booking, now);
    if (reason) {
      await db.notification.update({
        where: { id: row.id },
        data: { status: "CANCELLED", lockedUntil: null, lastError: `skipped: ${reason}` },
      });
      continue;
    }

    if (row.attempts > MAX_ATTEMPTS) {
      // Reclaimed after a crash mid-send too many times.
      counts.failed++;
      await db.notification.update({
        where: { id: row.id },
        data: { status: "FAILED", lockedUntil: null, lastError: "attempt limit reached" },
      });
      continue;
    }

    let result: Awaited<ReturnType<typeof sendEmail>>;
    try {
      const email = renderRow(row, booking!, settings);
      result = await sendEmail({ to: row.recipient, ...email, idempotencyKey: row.idempotencyKey });
    } catch (err) {
      reportError(err, { where: "notifications.process", notificationId: row.id });
      result = { ok: false, retryable: true, error: err instanceof Error ? err.message : String(err) };
    }

    if (result.ok) {
      counts.sent++;
      await db.notification.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          lockedUntil: null,
          lastError: null,
          providerMessageId: result.providerMessageId ?? null,
        },
      });
      logEvent("notification.sent", { notificationId: row.id, kind: row.kind });
      continue;
    }

    const lastError = scrub(result.error);
    if (result.retryable && row.attempts < MAX_ATTEMPTS) {
      counts.retried++;
      const delay = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)]!;
      await db.notification.update({
        where: { id: row.id },
        data: { status: "PENDING", lockedUntil: null, sendAfter: new Date(now.getTime() + delay), lastError },
      });
      logEvent("notification.retry", { notificationId: row.id, kind: row.kind, attempts: row.attempts });
    } else {
      counts.failed++;
      await db.notification.update({
        where: { id: row.id },
        data: { status: "FAILED", lockedUntil: null, lastError },
      });
      reportError(new Error(`Notification failed: ${lastError}`), {
        where: "notifications.process",
        notificationId: row.id,
        kind: row.kind,
        attempts: row.attempts,
      });
    }
  }

  return counts;
}
