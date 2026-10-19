"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/app/admin/_components/types";
import { actionFailure, validationFailure } from "@/lib/server/admin/action-utils";
import { requireAdmin } from "@/lib/server/admin/auth";
import { cleanAmountInput, leadDisplayName } from "@/lib/server/admin/quote-summary";
import { db } from "@/lib/server/db";
import { logEvent } from "@/lib/server/observability";
import { cancelQuote, createQuote } from "@/lib/server/quotes";
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
    note: note || undefined,
  });
  if (!parsed.success) return validationFailure(parsed.error);
  const { leadId, bookingId, planName, amountInr } = parsed.data;
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
