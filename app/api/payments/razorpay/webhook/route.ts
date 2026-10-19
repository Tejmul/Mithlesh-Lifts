import { handler } from "@/lib/server/http";
import { handleRazorpayWebhook } from "@/lib/server/payments";

/** POST /api/payments/razorpay/webhook — server-to-server from Razorpay; authenticated by signature only. */
export const POST = handler(async (request: Request) => {
  const rawBody = await request.text();
  await handleRazorpayWebhook(rawBody, request.headers.get("x-razorpay-signature"));
  return Response.json({ ok: true });
});
