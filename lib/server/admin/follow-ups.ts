import "server-only";
import type { BookingStatus } from "@/generated/prisma/client";
import { db } from "../db";

const DAY = 86_400_000;

export type UnbookedLead = {
  phoneE164: string;
  fullName: string | null;
  email: string | null;
  source: string | null;
  campaign: string | null;
  verifiedAt: Date;
  attempts: number;
};

/**
 * People who verified their phone but never booked: BookingSession rows with phoneVerifiedAt and no booking,
 * de-duplicated by phone, excluding anyone with a booking made after their latest verification.
 */
export async function getVerifiedUnbooked(days: number, now = new Date()): Promise<UnbookedLead[]> {
  const sessions = await db.bookingSession.findMany({
    where: { phoneVerifiedAt: { gte: new Date(now.getTime() - days * DAY) }, bookingId: null, phoneE164: { not: null } },
    orderBy: { phoneVerifiedAt: "desc" },
    take: 1000,
  });
  const byPhone = new Map<string, UnbookedLead>();
  for (const s of sessions) {
    const phone = s.phoneE164!;
    const existing = byPhone.get(phone);
    if (!existing) {
      byPhone.set(phone, {
        phoneE164: phone,
        fullName: s.fullName,
        email: s.email,
        source: s.source,
        campaign: s.campaign,
        verifiedAt: s.phoneVerifiedAt!,
        attempts: 1,
      });
    } else {
      existing.attempts++;
      existing.fullName ??= s.fullName;
      existing.email ??= s.email;
      existing.source ??= s.source;
      existing.campaign ??= s.campaign;
    }
  }
  if (byPhone.size === 0) return [];

  const leads = await db.lead.findMany({
    where: { phoneE164: { in: [...byPhone.keys()] } },
    select: { phoneE164: true, bookings: { select: { createdAt: true, status: true, startsAt: true } } },
  });
  for (const lead of leads) {
    const entry = byPhone.get(lead.phoneE164);
    if (!entry) continue;
    const bookedLater = lead.bookings.some((b) => b.createdAt >= entry.verifiedAt);
    const hasUpcoming = lead.bookings.some((b) => b.status === "CONFIRMED" && b.startsAt > now);
    if (bookedLater || hasUpcoming) byPhone.delete(lead.phoneE164);
  }
  return [...byPhone.values()];
}

export type RebookCandidate = {
  bookingId: string;
  reference: string;
  status: BookingStatus;
  startsAt: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  source: string | null;
  campaign: string | null;
  lead: { fullName: string | null; phoneE164: string; email: string | null };
};

/** No-shows (call in the last N days) and cancellations (cancelled in the last N days) not yet re-booked. */
export async function getRebookCandidates(days = 14, now = new Date()): Promise<RebookCandidate[]> {
  const since = new Date(now.getTime() - days * DAY);
  const bookings = await db.booking.findMany({
    where: {
      OR: [
        { status: "NO_SHOW", startsAt: { gte: since, lte: now } },
        { status: "CANCELLED", cancelledAt: { gte: since } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: {
      lead: {
        select: {
          fullName: true,
          phoneE164: true,
          email: true,
          bookings: { select: { id: true, createdAt: true, status: true } },
        },
      },
    },
  });
  const seenLeads = new Set<string>();
  const out: RebookCandidate[] = [];
  for (const b of bookings) {
    if (seenLeads.has(b.leadId)) continue;
    seenLeads.add(b.leadId);
    const rebooked = b.lead.bookings.some((o) => o.id !== b.id && o.createdAt > b.createdAt && o.status !== "CANCELLED");
    if (rebooked) continue;
    out.push({
      bookingId: b.id,
      reference: b.reference,
      status: b.status,
      startsAt: b.startsAt,
      cancelledAt: b.cancelledAt,
      cancelReason: b.cancelReason,
      source: b.source,
      campaign: b.campaign,
      lead: { fullName: b.lead.fullName, phoneE164: b.lead.phoneE164, email: b.lead.email },
    });
  }
  return out;
}
