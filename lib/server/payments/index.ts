import "server-only";
// Online payment for quotes (Razorpay). The amount always comes from the DB, never the client.
// A quote is only marked PAID after a server-side signature check (checkout handler or webhook).
import type { CheckoutResponse, QuoteView } from "@/lib/shared/api";
import { db, TX_OPTIONS } from "../db";
import { env } from "../env";
import { ApiException } from "../http";
import { completeQuotePayment } from "../memberships";
import { logEvent, reportError } from "../observability";
import { formatInr, getQuoteForLead, toQuoteView } from "../quotes";
import { createRazorpayOrder, verifyCheckoutSignature, verifyWebhookSignature } from "./razorpay";

const BRAND = "mithilesh_lifts";
/** Reuse an unpaid order for the same quote within this window instead of creating a new one. */
const ORDER_REUSE_MS = 30 * 60 * 1000;

function credentials() {
  const e = env();
  if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET) return null;
  return { keyId: e.RAZORPAY_KEY_ID, keySecret: e.RAZORPAY_KEY_SECRET };
}

function notConfigured() {
  return new ApiException(503, "INTERNAL", "Online payment isn't set up yet.");
}

/** True when a payment provider's credentials are configured. */
export function paymentsEnabled(): boolean {
  return credentials() !== null;
}

/** Creates a provider order for a SENT quote owned by the lead; amount always from the DB. */
export async function createCheckout(input: { quoteId: string; leadId: string }): Promise<CheckoutResponse> {
  const creds = credentials();
  if (!creds) throw notConfigured();

  const quote = await getQuoteForLead(input.leadId, input.quoteId);
  if (!quote) throw new ApiException(404, "NOT_FOUND", "Quote not found.");
  if (quote.status === "PAID") throw new ApiException(409, "BAD_REQUEST", "This quote is already paid.");
  if (quote.status !== "SENT") throw new ApiException(409, "BAD_REQUEST", "This quote is no longer available.");
  const lead = await db.lead.findUniqueOrThrow({ where: { id: quote.leadId } });

  const amountPaise = quote.amountInr * 100;
  let orderId: string;
  const reusable = await db.payment.findFirst({
    where: {
      quoteId: quote.id,
      provider: "razorpay",
      status: "CREATED",
      amountInr: quote.amountInr,
      createdAt: { gt: new Date(Date.now() - ORDER_REUSE_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (reusable) {
    orderId = reusable.providerOrderId;
  } else {
    try {
      const order = await createRazorpayOrder(creds, {
        amountPaise,
        receipt: quote.reference,
        notes: { quoteId: quote.id },
      });
      orderId = order.id;
    } catch (err) {
      reportError(err, { where: "payments.createOrder", quoteId: quote.id });
      throw new ApiException(502, "INTERNAL", "We couldn't start the payment. Please try again in a moment.");
    }
    await db.payment.create({
      data: { quoteId: quote.id, provider: "razorpay", providerOrderId: orderId, amountInr: quote.amountInr },
    });
    logEvent("payment.order_created", { quoteId: quote.id });
  }

  return {
    provider: "razorpay",
    keyId: creds.keyId,
    orderId,
    amountPaise,
    currency: "INR",
    name: BRAND,
    description: quote.planName,
    prefill: { ...(lead.fullName ? { name: lead.fullName } : {}), contact: lead.phoneE164 },
  };
}

type PaidOutcome = "paid" | "already_paid" | "duplicate" | "inactive_quote";

/**
 * Idempotent: marks the Payment PAID and its Quote PAID (only from SENT), starts the membership and
 * adds the "payment_received" inbox item exactly once, even if checkout verify and webhook race.
 * Money that arrives for a quote that is already paid (a second order, or the admin marked it paid
 * by UPI meanwhile) or no longer open (cancelled) is flagged: reported, shown on the admin quote,
 * and the customer is told it will be refunded or activated.
 */
async function markPaymentPaid(paymentId: string, providerPaymentId: string): Promise<PaidOutcome> {
  const outcome = await db.$transaction(async (tx) => {
    const now = new Date();
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { quote: true } });
    if (payment.status === "PAID" && payment.providerPaymentId && payment.providerPaymentId !== providerPaymentId) {
      // A second capture on the same order (paid twice in one checkout).
      return "duplicate" as const;
    }
    const flipped =
      payment.status !== "PAID" &&
      (
        await tx.payment.updateMany({
          where: { id: payment.id, status: { not: "PAID" } },
          data: { status: "PAID", providerPaymentId, paidAt: now },
        })
      ).count === 1;
    const started = await completeQuotePayment(tx, payment.quote, {
      amountInr: payment.amountInr,
      paidVia: "razorpay",
      paidAt: now,
    });
    if (started) return "paid" as const;
    const current = await tx.quote.findUniqueOrThrow({ where: { id: payment.quoteId }, select: { status: true } });
    if (current.status !== "PAID") return "inactive_quote" as const;
    // Quote already paid: by this same payment earlier (fine) or by another payment (money taken twice).
    return flipped ? ("duplicate" as const) : ("already_paid" as const);
  }, TX_OPTIONS);

  if (outcome === "paid") logEvent("payment.paid", { paymentId });
  if (outcome === "inactive_quote") {
    reportError(new Error("Payment captured for a quote that is not open: refund or activate"), {
      where: "payments.markPaid",
      paymentId,
    });
  }
  if (outcome === "duplicate") {
    reportError(new Error("Second payment captured for an already-paid quote: refund the extra"), {
      where: "payments.markPaid",
      paymentId,
      providerPaymentId,
    });
  }
  return outcome;
}

/** Verifies the checkout signature, marks Payment + Quote PAID idempotently, adds a "payment_received" inbox item. */
export async function verifyRazorpayPayment(input: {
  leadId: string;
  quoteId: string;
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<QuoteView> {
  const creds = credentials();
  if (!creds) throw notConfigured();
  if (!verifyCheckoutSignature(creds.keySecret, input.orderId, input.paymentId, input.signature)) {
    logEvent("payment.signature_invalid", { quoteId: input.quoteId });
    throw new ApiException(400, "BAD_REQUEST", "We couldn't verify this payment. If money was deducted, contact us.");
  }

  const quote = await getQuoteForLead(input.leadId, input.quoteId);
  const payment = await db.payment.findUnique({ where: { providerOrderId: input.orderId } });
  if (!quote || !payment || payment.quoteId !== quote.id) {
    throw new ApiException(404, "NOT_FOUND", "Quote not found.");
  }

  const outcome = await markPaymentPaid(payment.id, input.paymentId);
  if (outcome === "inactive_quote" || outcome === "duplicate") {
    throw new ApiException(
      409,
      "BAD_REQUEST",
      outcome === "duplicate"
        ? `We received your payment of ${formatInr(payment.amountInr)}, but this plan was already paid. Our team will refund the extra payment. You don't need to do anything. Payment ID: ${input.paymentId}`
        : `We received your payment of ${formatInr(payment.amountInr)}, but this quote is no longer active. Our team will contact you to refund it or activate your plan. Payment ID: ${input.paymentId}`,
    );
  }
  const fresh = await db.quote.findUniqueOrThrow({ where: { id: quote.id } });
  return toQuoteView(fresh);
}

type WebhookEvent = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
    order?: { entity?: { id?: string; amount?: number } };
  };
};

/** Razorpay webhook (payment.captured / order.paid): signature-checked, idempotent. */
export async function handleRazorpayWebhook(rawBody: string, signature: string | null): Promise<void> {
  const secret = env().RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new ApiException(503, "INTERNAL", "Webhooks are not configured.");
  if (!verifyWebhookSignature(secret, rawBody, signature)) {
    logEvent("payment.webhook_signature_invalid");
    throw new ApiException(400, "BAD_REQUEST", "Invalid signature.");
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    throw new ApiException(400, "BAD_REQUEST", "Invalid payload.");
  }
  if (event.event !== "payment.captured" && event.event !== "order.paid") return;

  const paymentEntity = event.payload?.payment?.entity;
  const orderId = paymentEntity?.order_id ?? event.payload?.order?.entity?.id;
  const providerPaymentId = paymentEntity?.id;
  if (!orderId || !providerPaymentId) return;

  const payment = await db.payment.findUnique({ where: { providerOrderId: orderId } });
  if (!payment) {
    logEvent("payment.webhook_unknown_order");
    return;
  }
  const amountPaise = paymentEntity?.amount ?? event.payload?.order?.entity?.amount;
  if (typeof amountPaise === "number" && amountPaise !== payment.amountInr * 100) {
    reportError(new Error("Webhook amount mismatch"), { where: "payments.webhook", paymentId: payment.id });
    return;
  }
  await markPaymentPaid(payment.id, providerPaymentId);
}
