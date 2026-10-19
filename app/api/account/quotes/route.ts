import { connection } from "next/server";
import { requireCustomer } from "@/lib/server/customer-auth";
import { apiOk, handler } from "@/lib/server/http";
import { listQuotesForLead, toQuoteView } from "@/lib/server/quotes";
import type { QuotesResponse } from "@/lib/shared/api";

/** GET /api/account/quotes → QuotesResponse (newest first). */
export const GET = handler(async () => {
  await connection();
  const lead = await requireCustomer();
  const quotes = await listQuotesForLead(lead.id);
  return apiOk<QuotesResponse>({ quotes: quotes.map(toQuoteView) }, { headers: { "Cache-Control": "no-store" } });
});
