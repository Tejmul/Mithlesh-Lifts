"use server";

import { DateTime } from "luxon";
import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/app/admin/_components/types";
import { actionFailure, validationFailure } from "@/lib/server/admin/action-utils";
import { requireAdmin } from "@/lib/server/admin/auth";
import { cleanAmountInput, leadDisplayName } from "@/lib/server/admin/quote-summary";
import { db } from "@/lib/server/db";
import { logEvent } from "@/lib/server/observability";
import { recordManualPayment, updateMembership } from "@/lib/server/memberships";
import { cancelQuote, createQuote } from "@/lib/server/quotes";
import { getSettings } from "@/lib/server/settings";
import { quoteSchema } from "@/lib/shared/validation";

const id = z.string().trim().min(1).max(64);

const sendQuoteSchema = quoteSchema.extend({
  leadId: id,
  bookingId: id.optional(),
});

/** Sends a quote to the lead: it lands in their in-app notifications and they can pay online. */
export async function sendQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const note = String(formData.get("note") ?? "").trim();
  const parsed = sendQuoteSchema.safeParse({
    leadId: formData.get("leadId"),
    bookingId: formData.get("bookingId") || undefined,
    planName: formData.get("planName") ?? "",
    amountInr: cleanAmountInput(formData.get("amountInr")),
    durationCount: formData.get("durationCount") ?? "",
    durationUnit: formData.get("durationUnit") ?? "",
    note: note || undefined,
  });
  if (!parsed.success) return validationFailure(parsed.error);
  const { leadId, bookingId, planName, amountInr, durationCount, durationUnit } = parsed.data;
  let message: string;
  try {
    const lead = await db.lead.findUnique({
      where: { id: leadId },
      select: { id: true, fullName: true, clientCode: true, phoneE164: true },
    });
    if (!lead) return { error: "Lead not found." };
    if (bookingId) {
      const booking = await db.booking.findUnique({ where: { id: bookingId }, select: { leadId: true } });
      if (!booking || booking.leadId !== lead.id) return { error: "Booking not found for this lead." };
    }
    const quote = await createQuote({
      leadId: lead.id,
      bookingId,
      planName,
      amountInr,
      durationCount,
      durationUnit,
      note: parsed.data.note,
      adminUserId: admin.id,
    });
    logEvent("admin.quote_sent", { adminUserId: admin.id, leadId: lead.id, quoteId: quote.id });
    message = `Quote ${quote.reference} sent to ${leadDisplayName(lead)}. They'll see it in their notifications.`;
  } catch (err) {
    return actionFailure(err, "admin.send_quote");
  }
  refresh();
  return { ok: message };
}

/** Withdraws a quote that hasn't been paid yet. */
export async function cancelQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ quoteId: id }).safeParse({ quoteId: formData.get("quoteId") });
  if (!parsed.success) return validationFailure(parsed.error);
  let reference: string;
  try {
    const quote = await cancelQuote({ quoteId: parsed.data.quoteId, adminUserId: admin.id });
    reference = quote.reference;
    logEvent("admin.quote_cancelled", { adminUserId: admin.id, quoteId: quote.id });
  } catch (err) {
    return actionFailure(err, "admin.cancel_quote");
  }
  refresh();
  return { ok: `Quote ${reference} cancelled.` };
}

/** The client paid outside the website (UPI, cash, bank transfer): mark paid and start the plan. */
export async function recordPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z.object({ quoteId: id }).safeParse({ quoteId: formData.get("quoteId") });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const membership = await recordManualPayment({ quoteId: parsed.data.quoteId });
    logEvent("admin.payment_recorded", { adminUserId: admin.id, quoteId: parsed.data.quoteId, membershipId: membership.id });
  } catch (err) {
    return actionFailure(err, "admin.record_payment");
  }
  refresh();
  return { ok: "Payment recorded. The plan is now active and listed under Clients." };
}

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

/** Edit a plan's dates (late start, extension) and notes. Dates are whole days in the coach's time zone. */
export async function updateMembershipAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = z
    .object({ membershipId: id, validFrom: dateInput, validUntil: dateInput, notes: z.string().trim().max(1000).optional() })
    .safeParse({
      membershipId: formData.get("membershipId"),
      validFrom: formData.get("validFrom"),
      validUntil: formData.get("validUntil"),
      notes: String(formData.get("notes") ?? ""),
    });
  if (!parsed.success) return validationFailure(parsed.error);
  try {
    const tz = (await getSettings()).coachTimeZone;
    const day = (v: string) => DateTime.fromISO(v, { zone: tz }).startOf("day").toJSDate();
    await updateMembership({
      id: parsed.data.membershipId,
      validFrom: day(parsed.data.validFrom),
      // "Valid until 20 Jan" means the whole of 20 Jan.
      validUntil: DateTime.fromISO(parsed.data.validUntil, { zone: tz }).endOf("day").toJSDate(),
      notes: parsed.data.notes,
    });
    logEvent("admin.membership_updated", { adminUserId: admin.id, membershipId: parsed.data.membershipId });
  } catch (err) {
    return actionFailure(err, "admin.update_membership");
  }
  refresh();
  return { ok: "Plan dates saved." };
}
