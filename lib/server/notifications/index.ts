import "server-only";
// OWNER: Agent C.
import { after } from "next/server";
import type { Tx } from "../db";
import { reportError } from "../observability";
import { buildPayload, type NotificationKind } from "./payload";
import { processDueNotifications as runWorker } from "./worker";

export type BookingEvent = "confirmed" | "rescheduled" | "cancelled";

export const REMINDER_OFFSETS_MINUTES = [1440, 60] as const;

const CUSTOMER_KIND: Record<BookingEvent, NotificationKind> = {
  confirmed: "booking_confirmed",
  rescheduled: "booking_rescheduled",
  cancelled: "booking_cancelled",
};

/**
 * Called INSIDE the booking transaction; writes Notification rows only (no network):
 * customer email, team email(s), and reminder rows (24h + 1h before) for confirmed/rescheduled.
 * On rescheduled/cancelled, cancels still-pending reminders from older versions.
 * Idempotency keys include booking id + version + kind.
 */
export async function enqueueBookingEvent(tx: Tx, bookingId: string, event: BookingEvent): Promise<void> {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { lead: true } });
  const settings = await tx.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const version = booking.version;
  const prefix = `${bookingId}:v${version}:`;
  const now = new Date();

  if (event !== "confirmed") {
    // Reminders from older versions (or all of them, on cancel) must never go out.
    await tx.notification.updateMany({
      where: {
        bookingId,
        kind: "reminder",
        status: "PENDING",
        ...(event === "rescheduled" ? { NOT: { idempotencyKey: { startsWith: prefix } } } : {}),
      },
      data: { status: "CANCELLED", lockedUntil: null },
    });
  }

  const rows: { kind: NotificationKind; recipient: string; payload: object; idempotencyKey: string; sendAfter: Date }[] = [];
  const add = (kind: NotificationKind, recipient: string, sendAfter: Date, offsetMinutes?: number) => {
    const key = `${prefix}${kind}:${recipient.trim().toLowerCase()}${offsetMinutes !== undefined ? `:${offsetMinutes}` : ""}`;
    rows.push({
      kind,
      recipient: recipient.trim(),
      payload: buildPayload({ booking, settings, event, kind, offsetMinutes }),
      idempotencyKey: key,
      sendAfter,
    });
  };

  // Customer emails only when we have an address (the booking flow collects just the phone).
  const customerEmail = booking.lead.email;
  if (customerEmail) add(CUSTOMER_KIND[event], customerEmail, now);

  const teamKind: NotificationKind = event === "confirmed" ? "team_new_booking" : "team_booking_changed";
  const team = new Map<string, string>();
  for (const addr of settings.teamNotificationEmails) {
    const trimmed = addr.trim();
    if (trimmed && !team.has(trimmed.toLowerCase())) team.set(trimmed.toLowerCase(), trimmed);
  }
  for (const addr of team.values()) add(teamKind, addr, now);

  if (event !== "cancelled") {
    for (const offset of REMINDER_OFFSETS_MINUTES) {
      const at = new Date(booking.startsAt.getTime() - offset * 60_000);
      if (customerEmail && at.getTime() > now.getTime()) add("reminder", customerEmail, at, offset);
    }
  }

  await tx.notification.createMany({
    data: rows.map((r) => ({ ...r, bookingId, status: "PENDING" as const })),
    skipDuplicates: true,
  });
}

/** Claims due rows (FOR UPDATE SKIP LOCKED), sends, retries with backoff. Safe to run concurrently. */
export async function processDueNotifications(opts?: { limit?: number; now?: Date; budgetMs?: number }): Promise<{ sent: number; failed: number; retried: number }> {
  return runWorker(opts);
}

/** Run processDueNotifications after the current response (next/server `after`). */
export function kickNotifications(): void {
  try {
    after(() => processDueNotifications().catch((err) => reportError(err, { where: "kickNotifications" })));
  } catch {
    // No request context (tests, scripts): the cron job will pick the rows up.
  }
}
