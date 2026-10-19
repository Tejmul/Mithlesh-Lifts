import { connection } from "next/server";
import { requireCustomer } from "@/lib/server/customer-auth";
import { ApiException, apiOk, handler } from "@/lib/server/http";
import { getQuoteForLead, toQuoteView } from "@/lib/server/quotes";
import type { QuoteResponse } from "@/lib/shared/api";

/** GET /api/account/quotes/[id] → QuoteResponse (404 unless it's the customer's quote). */
export const GET = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  await connection();
  const lead = await requireCustomer();
  const { id } = await ctx.params;
  const quote = await getQuoteForLead(lead.id, id);
  if (!quote) throw new ApiException(404, "NOT_FOUND", "Quote not found.");
  return apiOk<QuoteResponse>({ quote: toQuoteView(quote) }, { headers: { "Cache-Control": "no-store" } });
});
