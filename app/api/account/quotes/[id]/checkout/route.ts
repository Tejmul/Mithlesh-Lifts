import { requireCustomer } from "@/lib/server/customer-auth";
import { apiOk, assertSameOrigin, handler } from "@/lib/server/http";
import { createCheckout } from "@/lib/server/payments";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import type { CheckoutResponse } from "@/lib/shared/api";

/** POST /api/account/quotes/[id]/checkout → CheckoutResponse (opens Razorpay Checkout on the client). */
export const POST = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const lead = await requireCustomer();
  await enforceRateLimit(`checkout:lead:${lead.id}`, 10, 3600, "Too many payment attempts. Please wait a while and try again.");
  const { id } = await ctx.params;
  return apiOk<CheckoutResponse>(await createCheckout({ quoteId: id, leadId: lead.id }), {
    headers: { "Cache-Control": "no-store" },
  });
});
