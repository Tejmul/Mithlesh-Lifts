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

  const settings = await tx.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const current = await tx.membership.findFirst({
    where: { leadId: quote.leadId, validUntil: { gt: input.paidAt } },
    orderBy: { validUntil: "desc" },
  });
  const validFrom = current ? current.validUntil : input.paidAt;
  // Quotes sent before plan lengths existed default to one month; the admin can edit the dates.
  const validUntil = addDuration(validFrom, quote.durationCount ?? 1, quote.durationUnit ?? "MONTH", settings.coachTimeZone);

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
  if (input.validUntil.getTime() <= input.validFrom.getTime()) {
    throw new ApiException(422, "VALIDATION", "Some details need fixing.", { validUntil: "End date must be after the start date." });
  }
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

export function toPlanView(m: Membership, now: Date = new Date()): PlanView {
  return {
    planName: m.planName,
    amountInr: m.amountInr,
    validFrom: m.validFrom.toISOString(),
    validUntil: m.validUntil.toISOString(),
    status: membershipStatus(m, now),
  };
}
