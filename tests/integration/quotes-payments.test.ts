import { createHmac } from "crypto";
import { DateTime } from "luxon";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/generated/prisma/client";
import { db } from "@/lib/server/db";
import { resetEnvCache } from "@/lib/server/env";
import { ApiException } from "@/lib/server/http";
import { listInbox } from "@/lib/server/inbox";
import { createCheckout, handleRazorpayWebhook, paymentsEnabled, verifyRazorpayPayment } from "@/lib/server/payments";
import { membershipStatus, recordManualPayment, updateMembership } from "@/lib/server/memberships";
import { cancelQuote, createQuote, getQuoteForLead, listQuotesForLead, toQuoteView } from "@/lib/server/quotes";
import { resetDb } from "../helpers/db";

const KEY_ID = "rzp_test_key";
const KEY_SECRET = "rzp_test_secret_value";
const WEBHOOK_SECRET = "rzp_webhook_secret_value";

let leadA: Lead;
let leadB: Lead;
let orderSeq = 0;
const fetchMock = vi.fn(async () => Response.json({ id: `order_${++orderSeq}`, status: "created" }));

const sign = (value: string, key: string) => createHmac("sha256", key).update(value).digest("hex");

async function expectApiError(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiException);
  expect((err as ApiException).status).toBe(status);
  expect((err as ApiException).code).toBe(code);
  return err as ApiException;
}

function enablePayments() {
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  resetEnvCache();
}

const newQuote = (leadId = leadA.id, amountInr = 14999) =>
  createQuote({
    leadId,
    planName: "Strength coaching",
    amountInr,
    durationCount: 12,
    durationUnit: "WEEK",
    note: " Includes diet plan ",
    adminUserId: "admin_1",
  });

beforeEach(async () => {
  await resetDb();
  leadA = await db.lead.create({
    data: { phoneE164: "+919876543210", fullName: "Rahul Sharma", clientCode: "RAHUL-1111", phoneVerifiedAt: new Date() },
  });
  leadB = await db.lead.create({
    data: { phoneE164: "+919123456789", fullName: "Asha Rao", clientCode: "ASHA-2222", phoneVerifiedAt: new Date() },
  });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  resetEnvCache();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("quotes", () => {
  it("createQuote stores the quote and notifies the customer", async () => {
    const quote = await newQuote();
    expect(quote).toMatchObject({ leadId: leadA.id, status: "SENT", amountInr: 14999, note: "Includes diet plan", createdByAdminId: "admin_1" });
    expect(quote.reference).toMatch(/^Q-[A-HJ-NP-Z2-9]{6}$/);

    const inbox = await listInbox(leadA.id);
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.items[0]).toMatchObject({
      kind: "quote_sent",
      title: "Your plan quote is ready",
      body: "Strength coaching · 12 weeks · ₹14,999",
      href: `/account/quotes/${quote.id}`,
      read: false,
    });
    expect((await listInbox(leadB.id)).items).toHaveLength(0);
  });

  it("formats lakh amounts in Indian style", async () => {
    await newQuote(leadA.id, 125000);
    expect((await listInbox(leadA.id)).items[0]!.body).toBe("Strength coaching · 12 weeks · ₹1,25,000");
  });

  it("rejects quotes for unknown leads", async () => {
    await expectApiError(newQuote("missing-lead"), 404, "NOT_FOUND");
    expect(await db.quote.count()).toBe(0);
  });

  it("quotes are only visible to their owner", async () => {
    const quote = await newQuote();
    expect(await getQuoteForLead(leadB.id, quote.id)).toBeNull();
    expect((await getQuoteForLead(leadA.id, quote.id))?.id).toBe(quote.id);
    expect(await listQuotesForLead(leadB.id)).toHaveLength(0);
    expect(await listQuotesForLead(leadA.id)).toHaveLength(1);
  });

  it("canPay is false until payments are configured", async () => {
    const quote = await newQuote();
    expect(paymentsEnabled()).toBe(false);
    expect(toQuoteView(quote).canPay).toBe(false);
    await expectApiError(createCheckout({ quoteId: quote.id, leadId: leadA.id }), 503, "INTERNAL");
    enablePayments();
    expect(toQuoteView(quote)).toMatchObject({ canPay: true, status: "SENT", paidAt: null });
  });

  it("cancelQuote only from SENT; a cancelled quote can't be paid", async () => {
    enablePayments();
    const quote = await newQuote();
    const cancelled = await cancelQuote({ quoteId: quote.id, adminUserId: "admin_1" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(toQuoteView(cancelled).canPay).toBe(false);
    await expectApiError(cancelQuote({ quoteId: quote.id, adminUserId: "admin_1" }), 409, "BAD_REQUEST");
    await expectApiError(createCheckout({ quoteId: quote.id, leadId: leadA.id }), 409, "BAD_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("razorpay checkout + verification", () => {
  it("creates an order from the DB amount and reuses it for 30 minutes", async () => {
    enablePayments();
    const quote = await newQuote();
    const checkout = await createCheckout({ quoteId: quote.id, leadId: leadA.id });
    expect(checkout).toEqual({
      provider: "razorpay",
      keyId: KEY_ID,
      orderId: "order_1",
      amountPaise: 1_499_900,
      currency: "INR",
      name: "mithilesh_lifts",
      description: "Strength coaching",
      prefill: { name: "Rahul Sharma", contact: "+919876543210" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 1_499_900,
      currency: "INR",
      receipt: quote.reference,
      notes: { quoteId: quote.id },
    });
    expect(await db.payment.findUniqueOrThrow({ where: { providerOrderId: "order_1" } })).toMatchObject({
      quoteId: quote.id,
      provider: "razorpay",
      status: "CREATED",
      amountInr: 14999,
    });

    const again = await createCheckout({ quoteId: quote.id, leadId: leadA.id });
    expect(again.orderId).toBe("order_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await db.payment.updateMany({ data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await createCheckout({ quoteId: quote.id, leadId: leadA.id })).orderId).toBe("order_2");
  });

  it("provider failure → 502 and no payment row", async () => {
    enablePayments();
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => new Response("nope", { status: 401 }));
    const quote = await newQuote();
    await expectApiError(createCheckout({ quoteId: quote.id, leadId: leadA.id }), 502, "INTERNAL");
    expect(await db.payment.count()).toBe(0);
    vi.mocked(console.error).mockRestore();
  });

  it("another customer can't check out or verify someone else's quote", async () => {
    enablePayments();
    const quote = await newQuote();
    await expectApiError(createCheckout({ quoteId: quote.id, leadId: leadB.id }), 404, "NOT_FOUND");
    const { orderId } = await createCheckout({ quoteId: quote.id, leadId: leadA.id });
    await expectApiError(
      verifyRazorpayPayment({
        leadId: leadB.id,
        quoteId: quote.id,
        orderId,
        paymentId: "pay_1",
        signature: sign(`${orderId}|pay_1`, KEY_SECRET),
      }),
      404,
      "NOT_FOUND",
    );
    // An order for quote A can't be used to "pay" quote B.
    const quoteB = await newQuote(leadB.id);
    await expectApiError(
      verifyRazorpayPayment({
        leadId: leadB.id,
        quoteId: quoteB.id,
        orderId,
        paymentId: "pay_1",
        signature: sign(`${orderId}|pay_1`, KEY_SECRET),
      }),
      404,
      "NOT_FOUND",
    );
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SENT");
  });

  it("verifies the signature, marks the quote PAID once, and is idempotent", async () => {
    enablePayments();
    const quote = await newQuote();
    const { orderId } = await createCheckout({ quoteId: quote.id, leadId: leadA.id });

    await expectApiError(
      verifyRazorpayPayment({ leadId: leadA.id, quoteId: quote.id, orderId, paymentId: "pay_1", signature: "0".repeat(64) }),
      400,
      "BAD_REQUEST",
    );
    await expectApiError(
      verifyRazorpayPayment({
        leadId: leadA.id,
        quoteId: quote.id,
        orderId,
        paymentId: "pay_1",
        signature: sign(`${orderId}|pay_1`, "wrong-secret"),
      }),
      400,
      "BAD_REQUEST",
    );
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SENT");

    const input = { leadId: leadA.id, quoteId: quote.id, orderId, paymentId: "pay_1", signature: sign(`${orderId}|pay_1`, KEY_SECRET) };
    const view = await verifyRazorpayPayment(input);
    expect(view).toMatchObject({ status: "PAID", canPay: false });
    expect(view.paidAt).not.toBeNull();
    expect(await db.payment.findUniqueOrThrow({ where: { providerOrderId: orderId } })).toMatchObject({
      status: "PAID",
      providerPaymentId: "pay_1",
    });

    const second = await verifyRazorpayPayment(input);
    expect(second.status).toBe("PAID");
    const paidItems = (await listInbox(leadA.id)).items.filter((i) => i.kind === "payment_received");
    expect(paidItems).toHaveLength(1);
    expect(paidItems[0]).toMatchObject({
      title: "Payment received",
      body: expect.stringMatching(/^₹14,999 for Strength coaching\. Your plan runs until \d{1,2} [A-Z][a-z]{2} \d{4}\. Welcome aboard!$/),
      href: `/account/quotes/${quote.id}`,
    });

    await expectApiError(createCheckout({ quoteId: quote.id, leadId: leadA.id }), 409, "BAD_REQUEST");
    await expectApiError(cancelQuote({ quoteId: quote.id, adminUserId: "admin_1" }), 409, "BAD_REQUEST");
  });
});

describe("razorpay webhook", () => {
  async function capturedEvent() {
    enablePayments();
    const quote = await newQuote();
    const { orderId } = await createCheckout({ quoteId: quote.id, leadId: leadA.id });
    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_w1", order_id: orderId, amount: 1_499_900, status: "captured" } } },
    });
    return { quote, orderId, body };
  }

  it("rejects missing or bad signatures", async () => {
    const { quote, body } = await capturedEvent();
    await expectApiError(handleRazorpayWebhook(body, null), 400, "BAD_REQUEST");
    await expectApiError(handleRazorpayWebhook(body, sign(body, "not-the-secret")), 400, "BAD_REQUEST");
    await expectApiError(handleRazorpayWebhook(`${body} `, sign(body, WEBHOOK_SECRET)), 400, "BAD_REQUEST");
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SENT");
  });

  it("marks the quote PAID idempotently (webhook twice, then checkout verify)", async () => {
    const { quote, orderId, body } = await capturedEvent();
    await handleRazorpayWebhook(body, sign(body, WEBHOOK_SECRET));
    await handleRazorpayWebhook(body, sign(body, WEBHOOK_SECRET));
    const paid = await db.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(paid.status).toBe("PAID");
    expect(paid.paidAt).not.toBeNull();

    const view = await verifyRazorpayPayment({
      leadId: leadA.id,
      quoteId: quote.id,
      orderId,
      paymentId: "pay_w1",
      signature: sign(`${orderId}|pay_w1`, KEY_SECRET),
    });
    expect(view.status).toBe("PAID");
    expect((await listInbox(leadA.id)).items.filter((i) => i.kind === "payment_received")).toHaveLength(1);
  });

  it("ignores unrelated events, unknown orders and amount mismatches", async () => {
    const { quote, orderId } = await capturedEvent();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bodies = [
      JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_x", order_id: orderId } } } }),
      JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_unknown" } } } }),
      JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: orderId, amount: 100 } } } }),
    ];
    for (const b of bodies) await handleRazorpayWebhook(b, sign(b, WEBHOOK_SECRET));
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("SENT");
    vi.mocked(console.error).mockRestore();
  });

  it("order.paid events are handled too", async () => {
    const { quote, orderId } = await capturedEvent();
    const body = JSON.stringify({
      event: "order.paid",
      payload: {
        order: { entity: { id: orderId, amount: 1_499_900 } },
        payment: { entity: { id: "pay_o1", order_id: orderId, amount: 1_499_900 } },
      },
    });
    await handleRazorpayWebhook(body, sign(body, WEBHOOK_SECRET));
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("PAID");
  });

  it("a payment captured for a cancelled quote is recorded but the quote stays cancelled", async () => {
    const { quote, body } = await capturedEvent();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await cancelQuote({ quoteId: quote.id, adminUserId: "admin_1" });
    await handleRazorpayWebhook(body, sign(body, WEBHOOK_SECRET));
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("CANCELLED");
    expect((await db.payment.findFirstOrThrow({ where: { quoteId: quote.id } })).status).toBe("PAID");
    expect((await listInbox(leadA.id)).items.filter((i) => i.kind === "payment_received")).toHaveLength(0);
    vi.mocked(console.error).mockRestore();
  });
});

describe("memberships (paid plans)", () => {
  const DAY = 86_400_000;

  it("an online payment starts the plan for the quoted length", async () => {
    enablePayments();
    const quote = await newQuote();
    const { orderId } = await createCheckout({ quoteId: quote.id, leadId: leadA.id });
    await verifyRazorpayPayment({
      leadId: leadA.id,
      quoteId: quote.id,
      orderId,
      paymentId: "pay_m1",
      signature: sign(`${orderId}|pay_m1`, KEY_SECRET),
    });
    const m = await db.membership.findUniqueOrThrow({ where: { quoteId: quote.id } });
    expect(m).toMatchObject({ leadId: leadA.id, planName: "Strength coaching", amountInr: 14999, paidVia: "razorpay" });
    // 12 weeks, through the end of the last day (coach's time zone).
    const expected = DateTime.fromJSDate(m.validFrom, { zone: "Asia/Kolkata" }).plus({ weeks: 12 }).minus({ days: 1 }).endOf("day");
    expect(m.validUntil.getTime()).toBe(expected.toMillis());
    expect(membershipStatus(m)).toBe("active");
  });

  it("money for a quote the admin already marked paid is flagged and the customer is told", async () => {
    enablePayments();
    const quote = await newQuote();
    const { orderId } = await createCheckout({ quoteId: quote.id, leadId: leadA.id });
    await recordManualPayment({ quoteId: quote.id }); // UPI recorded while checkout was open
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await expectApiError(
      verifyRazorpayPayment({
        leadId: leadA.id,
        quoteId: quote.id,
        orderId,
        paymentId: "pay_dup",
        signature: sign(`${orderId}|pay_dup`, KEY_SECRET),
      }),
      409,
      "BAD_REQUEST",
    );
    expect(err.message).toContain("already paid");
    expect(await db.payment.count({ where: { status: "PAID" } })).toBe(1); // recorded for the refund
    expect(await db.membership.count()).toBe(1); // no second plan
  });

  it("two renewals paid at the same moment stack instead of overlapping", async () => {
    const [q1, q2] = [await newQuote(), await newQuote()];
    const [m1, m2] = await Promise.all([recordManualPayment({ quoteId: q1.id }), recordManualPayment({ quoteId: q2.id })]);
    const [first, second] = [m1, m2].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
    expect(second.validFrom.getTime()).toBe(first.validUntil.getTime());
  });

  it("admin can record a UPI/cash payment once; a renewal starts when the current plan ends", async () => {
    const first = await recordManualPayment({ quoteId: (await newQuote()).id });
    expect(first.paidVia).toBe("manual");
    expect((await listInbox(leadA.id)).items[0]).toMatchObject({ kind: "payment_received" });
    expect((await db.quote.findUniqueOrThrow({ where: { id: first.quoteId } })).status).toBe("PAID");
    await expectApiError(recordManualPayment({ quoteId: first.quoteId }), 409, "BAD_REQUEST");

    const renewal = await recordManualPayment({ quoteId: (await newQuote()).id });
    expect(renewal.validFrom.getTime()).toBe(first.validUntil.getTime());
    expect(membershipStatus(renewal)).toBe("upcoming");

    const cancelled = await newQuote();
    await cancelQuote({ quoteId: cancelled.id, adminUserId: "admin_1" });
    await expectApiError(recordManualPayment({ quoteId: cancelled.id }), 409, "BAD_REQUEST");
    expect(await db.membership.count()).toBe(2);
  });

  it("editing a plan that no longer exists, or impossible dates, gives a clear error", async () => {
    await expectApiError(updateMembership({ id: "missing", validFrom: new Date(), validUntil: new Date(Date.now() + DAY) }), 404, "NOT_FOUND");
    await expectApiError(updateMembership({ id: "missing", validFrom: new Date(NaN), validUntil: new Date() }), 422, "VALIDATION");
  });

  it("admin can move the dates; the end must be after the start", async () => {
    const m = await recordManualPayment({ quoteId: (await newQuote()).id });
    const from = new Date(Date.now() - 30 * DAY);
    const soon = new Date(Date.now() + 3 * DAY);
    const moved = await updateMembership({ id: m.id, validFrom: from, validUntil: soon, notes: " Extended: travel " });
    expect(moved).toMatchObject({ validFrom: from, validUntil: soon, notes: "Extended: travel" });
    expect(membershipStatus(moved)).toBe("expiring");
    expect(membershipStatus({ validFrom: from, validUntil: new Date(Date.now() - 1000) })).toBe("expired");
    await expectApiError(updateMembership({ id: m.id, validFrom: soon, validUntil: from }), 422, "VALIDATION");
  });
});
