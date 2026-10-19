import "server-only";
import type { Booking, Lead, Settings } from "@/generated/prisma/client";

export type NotificationKind =
  | "booking_confirmed"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "reminder"
  | "team_new_booking"
  | "team_booking_changed";

export const CUSTOMER_KINDS: readonly string[] = ["booking_confirmed", "booking_rescheduled", "booking_cancelled", "reminder"];

/**
 * Snapshot stored with each row (audit + fallback). The worker re-reads the booking at send time
 * for current times/links; secrets such as manage tokens are never stored. Phone is only kept
 * on team rows.
 */
export type NotificationPayload = {
  version: number;
  event: "confirmed" | "rescheduled" | "cancelled";
  offsetMinutes?: number;
  name: string;
  reference: string;
  startsAt: string;
  callMinutes: number;
  customerTimeZone: string;
  coachTimeZone: string;
  meetingUrl: string | null;
  email: string | null;
  phone?: string;
  source: string | null;
  campaign: string | null;
};

export function buildPayload(input: {
  booking: Booking & { lead: Lead };
  settings: Settings;
  event: NotificationPayload["event"];
  kind: NotificationKind;
  offsetMinutes?: number;
}): NotificationPayload {
  const { booking, settings, event, kind, offsetMinutes } = input;
  const isTeam = kind === "team_new_booking" || kind === "team_booking_changed";
  return {
    version: booking.version,
    event,
    ...(offsetMinutes !== undefined ? { offsetMinutes } : {}),
    name: booking.lead.fullName ?? "",
    reference: booking.reference,
    startsAt: booking.startsAt.toISOString(),
    callMinutes: Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000) || settings.callMinutes,
    customerTimeZone: booking.customerTimeZone,
    coachTimeZone: settings.coachTimeZone,
    meetingUrl: booking.meetingUrl ?? settings.meetingUrl ?? null,
    email: booking.lead.email,
    ...(isTeam ? { phone: booking.lead.phoneE164 } : {}),
    source: booking.source ?? booking.lead.source ?? null,
    campaign: booking.campaign ?? booking.lead.campaign ?? null,
  };
}

export function readPayload(value: unknown): Partial<NotificationPayload> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<NotificationPayload>) : {};
}
