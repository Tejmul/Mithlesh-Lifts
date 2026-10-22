import "server-only";
// Paid plan periods (docs/FLOW.md step ⑦). A membership is created the moment a quote is paid,
// online (Razorpay) or recorded by an admin, and its dates can be edited from the admin panel.
import { DateTime } from "luxon";
import type { Membership, PlanUnit, Quote } from "@/generated/prisma/client";
import type { PlanView } from "@/lib/shared/api";
import { db, TX_OPTIONS, type Tx } from "./db";
import { ApiException } from "./http";
import { addInboxItem } from "./inbox";
import { formatInr } from "./quotes";

const DAY_MS = 86_400_000;
/** Plans ending within this many days show as "Expiring soon". */
export const EXPIRING_SOON_DAYS = 7;

const UNIT_KEY = { DAY: "days", WEEK: "weeks", MONTH: "months" } as const;
const UNIT_LABEL = { DAY: ["day", "days"], WEEK: ["week", "weeks"], MONTH: ["month", "months"] } as const;

export function durationLabel(count: number | null, unit: PlanUnit | null): string | null {
  if (!count || !unit) return null;
  return `${count} ${UNIT_LABEL[unit][count === 1 ? 0 : 1]}`;
}

/** Calendar arithmetic in the coach's time zone (1 month from 31 Jan = 28/29 Feb). */
export function addDuration(from: Date, count: number, unit: PlanUnit, timeZone: string): Date {
  return DateTime.fromJSDate(from, { zone: timeZone }).plus({ [UNIT_KEY[unit]]: count }).toJSDate();
}

export type MembershipStatus = "upcoming" | "active" | "expiring" | "expired";

export function membershipStatus(m: Pick<Membership, "validFrom" | "validUntil">, now: Date = new Date()): MembershipStatus {
  if (m.validUntil.getTime() <= now.getTime()) return "expired";
  if (m.validFrom.getTime() > now.getTime()) return "upcoming";
  return m.validUntil.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS ? "expiring" : "active";
}

/**
 * Marks a SENT quote PAID and starts its membership, inside the caller's transaction.
 * A renewal starts when the client's current plan ends. Returns false if the quote wasn't SENT
 * (already paid, or cancelled) so callers stay idempotent.
 */
export async function completeQuotePayment(
  tx: Tx,
  quote: Quote,
  input: { amountInr: number; paidVia: "razorpay" | "manual"; paidAt: Date },
): Promise<boolean> {
  const res = await tx.quote.updateMany({
    where: { id: quote.id, status: "SENT" },
    data: { status: "PAID", paidAt: input.paidAt },
  });
  if (res.count !== 1) return false;

  // One payment at a time per client, so two renewals paid together stack instead of overlapping.
  await tx.$queryRaw`SELECT "id" FROM "Lead" WHERE "id" = ${quote.leadId} FOR UPDATE`;
  const settings = await tx.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const current = await tx.membership.findFirst({
    where: { leadId: quote.leadId, validUntil: { gt: input.paidAt } },
    orderBy: { validUntil: "desc" },
  });
  const validFrom = current ? current.validUntil : input.paidAt;
  // Quotes sent before plan lengths existed default to one month; the admin can edit the dates.
  // "Valid until 22 Jan" means the whole of 22 Jan (coach's time zone), same as an admin date edit.
  // A stacked renewal starts right after the previous plan ends, so its first day isn't lost.
  const validUntil = DateTime.fromJSDate(
    addDuration(validFrom, quote.durationCount ?? 1, quote.durationUnit ?? "MONTH", settings.coachTimeZone),
    { zone: settings.coachTimeZone },
  )
    .minus({ days: current ? 0 : 1 })
    .endOf("day")
    .toJSDate();

  await tx.membership.create({
    data: {
      leadId: quote.leadId,
      quoteId: quote.id,
      planName: quote.planName,
      amountInr: input.amountInr,
      paidVia: input.paidVia,
      paidAt: input.paidAt,
      validFrom,
      validUntil,
    },
  });
  const until = DateTime.fromJSDate(validUntil, { zone: settings.coachTimeZone }).toFormat("d LLL yyyy");
  await addInboxItem(tx, {
    leadId: quote.leadId,
    kind: "payment_received",
    title: "Payment received",
    body: `${formatInr(input.amountInr)} for ${quote.planName}. Your plan runs until ${until}. Welcome aboard!`,
    quoteId: quote.id,
  });
  return true;
}

/** Admin: the client paid outside the website (UPI, cash, bank transfer). */
export async function recordManualPayment(input: { quoteId: string; paidAt?: Date }): Promise<Membership> {
  return db.$transaction(async (tx) => {
    const quote = await tx.quote.findUnique({ where: { id: input.quoteId } });
    if (!quote) throw new ApiException(404, "NOT_FOUND", "Quote not found.");
    const done = await completeQuotePayment(tx, quote, {
      amountInr: quote.amountInr,
      paidVia: "manual",
      paidAt: input.paidAt ?? new Date(),
    });
    if (!done) {
      throw new ApiException(
        409,
        "BAD_REQUEST",
        quote.status === "PAID" ? "This quote is already paid." : "This quote was cancelled.",
      );
    }
    return tx.membership.findUniqueOrThrow({ where: { quoteId: quote.id } });
  }, TX_OPTIONS);
}

/** Admin: change a plan's dates (late start, extension) and notes. */
export async function updateMembership(input: {
  id: string;
  validFrom: Date;
  validUntil: Date;
  notes?: string;
}): Promise<Membership> {
  if (Number.isNaN(input.validFrom.getTime()) || Number.isNaN(input.validUntil.getTime())) {
    throw new ApiException(422, "VALIDATION", "Some details need fixing.", { validFrom: "Pick valid dates." });
  }
  if (input.validUntil.getTime() <= input.validFrom.getTime()) {
    throw new ApiException(422, "VALIDATION", "Some details need fixing.", { validUntil: "End date must be after the start date." });
  }
  const exists = await db.membership.findUnique({ where: { id: input.id }, select: { id: true } });
  if (!exists) throw new ApiException(404, "NOT_FOUND", "This plan no longer exists. Refresh the page.");
  return db.membership.update({
    where: { id: input.id },
    data: { validFrom: input.validFrom, validUntil: input.validUntil, notes: input.notes?.trim() || null },
  });
}

/** The plan to show a customer: the current one, else the next upcoming one, else the latest. */
export async function currentMembershipForLead(leadId: string, now: Date = new Date()): Promise<Membership | null> {
  const live = await db.membership.findFirst({
    where: { leadId, validUntil: { gt: now } },
    orderBy: { validFrom: "asc" },
  });
  return live ?? db.membership.findFirst({ where: { leadId }, orderBy: { validUntil: "desc" } });
}

/** Dates are formatted on the server in the coach's time zone, so every viewer sees the same day. */
export function toPlanView(m: Membership, timeZone: string, now: Date = new Date()): PlanView {
  const day = (d: Date) => DateTime.fromJSDate(d, { zone: timeZone }).toFormat("d LLL yyyy");
  return {
    planName: m.planName,
    amountInr: m.amountInr,
    validFrom: m.validFrom.toISOString(),
    validUntil: m.validUntil.toISOString(),
    validFromLabel: day(m.validFrom),
    validUntilLabel: day(m.validUntil),
    status: membershipStatus(m, now),
  };
}
