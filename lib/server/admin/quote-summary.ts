// Quote display helpers for the admin panel. Pure (no server-only) so they can be unit-tested.

export type QuoteStatusValue = "SENT" | "PAID" | "CANCELLED";
export type QuoteLike = { status: QuoteStatusValue; amountInr: number; createdAt: Date; paidAt?: Date | null };

export const QUOTE_STATUS_LABEL: Record<QuoteStatusValue, string> = {
  SENT: "Sent",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
/** ₹1,25,000 */
export function formatInr(rupees: number) {
  return inr.format(rupees);
}

/** Newest quote by createdAt (any status), or null. */
export function latestQuote<Q extends QuoteLike>(quotes: readonly Q[]): Q | null {
  let best: Q | null = null;
  for (const q of quotes) if (!best || q.createdAt.getTime() > best.createdAt.getTime()) best = q;
  return best;
}

export type QuoteSummary = { label: string; tone: "paid" | "sent" | "none" };

/**
 * One-line status for a lead's quotes:
 * a paid quote wins ("Paid ₹12,000", newest paid), else the newest open quote ("Quote sent ₹12,000"), else "—".
 * Cancelled quotes are ignored.
 */
export function summarizeQuotes(quotes: readonly QuoteLike[]): QuoteSummary {
  const paid = latestQuote(quotes.filter((q) => q.status === "PAID"));
  if (paid) return { label: `Paid ${formatInr(paid.amountInr)}`, tone: "paid" };
  const sent = latestQuote(quotes.filter((q) => q.status === "SENT"));
  if (sent) return { label: `Quote sent ${formatInr(sent.amountInr)}`, tone: "sent" };
  return { label: "—", tone: "none" };
}

/** "Rahul Sharma (RAHUL-4821)", falling back to whichever is known, then the phone. */
export function leadDisplayName(lead: { fullName: string | null; clientCode: string | null; phoneE164: string }) {
  const name = lead.fullName?.trim();
  if (name && lead.clientCode) return `${name} (${lead.clientCode})`;
  return name || lead.clientCode || lead.phoneE164;
}

/** Strips thousands separators, spaces and the rupee sign from an amount typed on a phone keyboard. */
export function cleanAmountInput(raw: FormDataEntryValue | null | undefined) {
  return String(raw ?? "").replace(/[,\s₹]/g, "");
}
