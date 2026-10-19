import { z } from "zod";
import { requireCustomer } from "@/lib/server/customer-auth";
import { apiOk, assertSameOrigin, handler, parseBody } from "@/lib/server/http";
import { verifyRazorpayPayment } from "@/lib/server/payments";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import type { QuoteResponse } from "@/lib/shared/api";

const verifyPaymentSchema = z.object({
  quoteId: z.string().min(1).max(64),
  razorpay_order_id: z.string().min(1).max(100),
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(256),
});

/** POST /api/payments/razorpay/verify → QuoteResponse (status PAID once the signature checks out). */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  const lead = await requireCustomer();
  await enforceRateLimit(`payment-verify:lead:${lead.id}`, 30, 3600);
  const body = await parseBody(request, verifyPaymentSchema);
  const quote = await verifyRazorpayPayment({
    leadId: lead.id,
    quoteId: body.quoteId,
    orderId: body.razorpay_order_id,
    paymentId: body.razorpay_payment_id,
    signature: body.razorpay_signature,
  });
  return apiOk<QuoteResponse>({ quote }, { headers: { "Cache-Control": "no-store" } });
});
