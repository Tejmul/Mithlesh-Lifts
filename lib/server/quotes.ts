import "server-only";
// Quotes the sales team sends a client after the call. Customers see them in their inbox and pay online.
import { randomInt } from "crypto";
import type { Quote } from "@/generated/prisma/client";
import type { QuoteView } from "@/lib/shared/api";
import { db, TX_OPTIONS, type Tx } from "./db";
import { ApiException } from "./http";
import { addInboxItem } from "./inbox";
import { paymentsEnabled } from "./payments";

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function quoteReference() {
  return `Q-${Array.from({ length: 6 }, () => REFERENCE_ALPHABET[randomInt(0, REFERENCE_ALPHABET.length)]).join("")}`;
}

async function freeReference(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const reference = quoteReference();
    const taken = await tx.quote.findUnique({ where: { reference }, select: { id: true } });
    if (!taken) return reference;
  }
  throw new Error("Could not allocate a quote reference");
}

/** Admin sends a quote: creates Quote (reference "Q-XXXXXX") + inbox item "quote_sent" in one transaction. */
export async function createQuote(input: {
  leadId: string;
  bookingId?: string;
  planName: string;
  amountInr: number;
  note?: string;
  adminUserId: string;
}): Promise<Quote> {
  if (!Number.isInteger(input.amountInr) || input.amountInr < 1) {
    throw new ApiException(422, "VALIDATION", "Some details need fixing.", { amountInr: "Enter an amount." });
  }
  const planName = input.planName.trim();
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: input.leadId }, select: { id: true } });
    if (!lead) throw new ApiException(404, "NOT_FOUND", "Client not found.");
    const quote = await tx.quote.create({
      data: {
        reference: await freeReference(tx),
        leadId: lead.id,
        bookingId: input.bookingId ?? null,
        planName,
        amountInr: input.amountInr,
        note: input.note?.trim() || null,
        createdByAdminId: input.adminUserId,
      },
    });
    await addInboxItem(tx, {
      leadId: lead.id,
      kind: "quote_sent",
      title: "Your plan quote is ready",
      body: `${planName} · ${formatInr(input.amountInr)}`,
      quoteId: quote.id,
    });
    return quote;
  }, TX_OPTIONS);
}

/** Only SENT quotes can be cancelled. */
export async function cancelQuote(input: { quoteId: string; adminUserId: string }): Promise<Quote> {
  const res = await db.quote.updateMany({
    where: { id: input.quoteId, status: "SENT" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  const quote = await db.quote.findUnique({ where: { id: input.quoteId } });
  if (!quote) throw new ApiException(404, "NOT_FOUND", "Quote not found.");
  if (res.count !== 1) {
    throw new ApiException(
      409,
      "BAD_REQUEST",
      quote.status === "PAID" ? "This quote has already been paid." : "This quote is already cancelled.",
    );
  }
  return quote;
}

export async function listQuotesForLead(leadId: string): Promise<Quote[]> {
  return db.quote.findMany({ where: { leadId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

/** Null unless the quote belongs to this lead. */
export async function getQuoteForLead(leadId: string, quoteId: string): Promise<Quote | null> {
  if (!quoteId || quoteId.length > 64) return null;
  const quote = await db.quote.findUnique({ where: { id: quoteId } });
  return quote && quote.leadId === leadId ? quote : null;
}

export function toQuoteView(q: Quote): QuoteView {
  return {
    id: q.id,
    reference: q.reference,
    planName: q.planName,
    amountInr: q.amountInr,
    note: q.note,
    status: q.status,
    createdAt: q.createdAt.toISOString(),
    paidAt: q.paidAt?.toISOString() ?? null,
    canPay: paymentsEnabled() && q.status === "SENT",
  };
}
