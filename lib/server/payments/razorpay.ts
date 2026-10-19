import "server-only";
// Minimal Razorpay REST client (no SDK). Never log keys, secrets or signatures.
import { hmac, safeEqual } from "../crypto";

const API = "https://api.razorpay.com/v1";

export type RazorpayCredentials = { keyId: string; keySecret: string };

export class RazorpayError extends Error {}

/** POST /v1/orders. Returns the provider order id. */
export async function createRazorpayOrder(
  creds: RazorpayCredentials,
  order: { amountPaise: number; receipt: string; notes: Record<string, string> },
): Promise<{ id: string }> {
  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`${API}/orders`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: order.amountPaise, currency: "INR", receipt: order.receipt, notes: order.notes }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new RazorpayError(`Razorpay order request failed: ${(err as Error)?.name ?? "error"}`);
  }
  if (!res.ok) throw new RazorpayError(`Razorpay order request failed with HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id) throw new RazorpayError("Razorpay returned no order id");
  return { id: body.id };
}

/** Checkout handler signature: HMAC-SHA256("order_id|payment_id", key secret), hex. */
export function verifyCheckoutSignature(keySecret: string, orderId: string, paymentId: string, signature: string) {
  if (typeof signature !== "string" || signature.length > 256) return false;
  return safeEqual(hmac(`${orderId}|${paymentId}`, keySecret), signature);
}

/** Webhook signature: HMAC-SHA256(raw body, webhook secret), hex. */
export function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string | null) {
  if (!signature || signature.length > 256) return false;
  return safeEqual(hmac(rawBody, webhookSecret), signature);
}
