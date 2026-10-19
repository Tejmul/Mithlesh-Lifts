import { randomUUID } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory cookie jar standing in for next/headers in a route-handler context.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (opts: string | { name: string }) => void jar.delete(typeof opts === "string" ? opts : opts.name),
  }),
}));

import type { BookingSession } from "@/generated/prisma/client";
import { createOrResumeSession, SESSION_COOKIE, startSession, toSessionView } from "@/lib/server/booking-session";
import { cancelBooking, createBookingFromSession, rescheduleBooking } from "@/lib/server/bookings/service";
import { hashToken } from "@/lib/server/crypto";
import { CUSTOMER_COOKIE, getCurrentCustomer, logoutCustomer, requireCustomer } from "@/lib/server/customer-auth";
import { db } from "@/lib/server/db";
import { clearOutbox, readOutbox } from "@/lib/server/dev-outbox";
import { ApiException } from "@/lib/server/http";
import { listInbox, markInboxRead } from "@/lib/server/inbox";
import { createAccountForSession, sendPhoneCode, verifyPhoneCode } from "@/lib/server/phone-verify/flow";
import { resetMockPhoneVerify } from "@/lib/server/phone-verify/mock";
import { getAvailableSlots } from "@/lib/server/scheduling/availability";
import { resetDb, seedSchedule } from "../helpers/db";

const IN = { country: "IN", phone: "98765 43210" };
const IN_E164 = "+919876543210";
const IP = "203.0.113.9";

function codeFor(to: string) {
  const body = readOutbox({ to, channel: "sms" }).at(-1)?.body;
  const m = body?.match(/(\d{6})$/);
  if (!m) throw new Error("no code");
  return m[1]!;
}

const fresh = (s: BookingSession) => db.bookingSession.findUniqueOrThrow({ where: { id: s.id } });
const newSession = async () => (await startSession(undefined, {})).session;

async function verifyWith(input: { fullName?: string; mode?: "signup" | "login" }) {
  const session = await newSession();
  await sendPhoneCode(session, { ...IN, ...input }, IP);
  return verifyPhoneCode(await fresh(session), codeFor(IN_E164), IP);
}

async function expectApiError(p: Promise<unknown>, status: number, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiException);
  expect((err as ApiException).status).toBe(status);
  expect((err as ApiException).code).toBe(code);
}

beforeEach(async () => {
  await resetDb();
  clearOutbox();
  resetMockPhoneVerify();
  jar.clear();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("signup / login", () => {
  it("signup creates an account with a client code and logs the customer in", async () => {
    const verified = await verifyWith({ fullName: "Rahul Sharma", mode: "signup" });
    const lead = await db.lead.findUniqueOrThrow({ where: { phoneE164: IN_E164 } });
    expect(lead.fullName).toBe("Rahul Sharma");
    expect(lead.clientCode).toMatch(/^RAHUL-\d{4}$/);
    expect(lead.lastLoginAt).not.toBeNull();

    const token = jar.get(CUSTOMER_COOKIE);
    expect(token).toBeTruthy();
    const row = await db.customerSession.findUniqueOrThrow({ where: { tokenHash: hashToken(token!) } });
    expect(row.leadId).toBe(lead.id);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const view = await toSessionView(verified);
    expect(view.phoneVerified).toBe(true);
    expect(view.account).toEqual({ clientCode: lead.clientCode, fullName: "Rahul Sharma", phoneE164: IN_E164 });
    expect((await requireCustomer()).id).toBe(lead.id);
  });

  it("client codes fall back to CLIENT for names without Latin letters and trim long names", async () => {
    await verifyWith({ fullName: "राहुल", mode: "signup" });
    expect((await db.lead.findUniqueOrThrow({ where: { phoneE164: IN_E164 } })).clientCode).toMatch(/^CLIENT-\d{4}$/);

    await resetDb();
    clearOutbox();
    await verifyWith({ fullName: "Bartholomew-Alexander Smith", mode: "signup" });
    expect((await db.lead.findUniqueOrThrow({ where: { phoneE164: IN_E164 } })).clientCode).toMatch(/^BARTHOLOME-\d{4}$/);
  });

  it("login keeps the existing name and client code", async () => {
    await db.lead.create({
      data: { phoneE164: IN_E164, fullName: "Asha Rao", clientCode: "ASHA-1234", phoneVerifiedAt: new Date(0) },
    });
    const verified = await verifyWith({ mode: "login" });
    expect((await toSessionView(verified)).account).toEqual({ clientCode: "ASHA-1234", fullName: "Asha Rao", phoneE164: IN_E164 });
    expect(verified.fullName).toBe("Asha Rao");

    // A signup with another name for the same number does not overwrite the account.
    jar.clear();
    await verifyWith({ fullName: "Someone Else", mode: "signup" });
    const lead = await db.lead.findUniqueOrThrow({ where: { phoneE164: IN_E164 } });
    expect(lead).toMatchObject({ fullName: "Asha Rao", clientCode: "ASHA-1234" });
    expect(lead.phoneVerifiedAt.getTime()).toBeGreaterThan(0);
  });

  it("login for an unknown number verifies the phone but needs a name → createAccountForSession", async () => {
    const verified = await verifyWith({ mode: "login" });
    expect(jar.has(CUSTOMER_COOKIE)).toBe(false);
    const view = await toSessionView(verified);
    expect(view).toMatchObject({ phoneVerified: true, account: null });
    expect(await db.lead.count()).toBe(0);

    const done = await createAccountForSession(verified, "Priya Nair");
    const lead = await db.lead.findUniqueOrThrow({ where: { phoneE164: IN_E164 } });
    expect(lead).toMatchObject({ fullName: "Priya Nair" });
    expect(lead.clientCode).toMatch(/^PRIYA-\d{4}$/);
    expect(jar.has(CUSTOMER_COOKIE)).toBe(true);
    expect((await toSessionView(done)).account?.clientCode).toBe(lead.clientCode);
  });

  it("createAccountForSession requires a verified phone", async () => {
    await expectApiError(createAccountForSession(await newSession(), "Priya Nair"), 403, "PHONE_NOT_VERIFIED");
  });

  it("a nameless legacy lead gets a proper code once the name is known", async () => {
    await db.lead.create({ data: { phoneE164: IN_E164, phoneVerifiedAt: new Date() } });
    const verified = await verifyWith({ mode: "login" });
    expect(jar.has(CUSTOMER_COOKIE)).toBe(false);
    expect((await db.lead.findUniqueOrThrow({ where: { phoneE164: IN_E164 } })).clientCode).toMatch(/^CLIENT-\d{4}$/);
    await createAccountForSession(verified, "Kiran Das");
    expect((await db.lead.findUniqueOrThrow({ where: { phoneE164: IN_E164 } })).clientCode).toMatch(/^KIRAN-\d{4}$/);
  });

  it("a logged-in customer starting /book skips the OTP", async () => {
    await verifyWith({ fullName: "Rahul Sharma", mode: "signup" });
    jar.delete(SESSION_COOKIE); // new device tab / expired booking session, still logged in
    const session = await createOrResumeSession({});
    expect(session).toMatchObject({ phoneE164: IN_E164, fullName: "Rahul Sharma" });
    expect(session.phoneVerifiedAt).not.toBeNull();
    expect((await toSessionView(session)).account?.fullName).toBe("Rahul Sharma");
  });

  it("logout deletes the session row and cookie", async () => {
    await verifyWith({ fullName: "Rahul Sharma", mode: "signup" });
    await logoutCustomer();
    expect(jar.has(CUSTOMER_COOKIE)).toBe(false);
    expect(await db.customerSession.count()).toBe(0);
    expect(await getCurrentCustomer()).toBeNull();
    await expectApiError(requireCustomer(), 401, "UNAUTHORIZED");
  });

  it("expired or unknown customer cookies are ignored", async () => {
    jar.set(CUSTOMER_COOKIE, "bogus");
    expect(await getCurrentCustomer()).toBeNull();
    await verifyWith({ fullName: "Rahul Sharma", mode: "signup" });
    await db.customerSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getCurrentCustomer()).toBeNull();
    expect(await db.customerSession.count()).toBe(0);
  });
});

describe("in-app booking notifications", () => {
  it("adds inbox items when a call is booked, moved and cancelled", async () => {
    await seedSchedule();
    const session = await verifyWith({ fullName: "Rahul Sharma", mode: "signup" });
    const lead = await requireCustomer();
    const { slots } = await getAvailableSlots();
    const booking = await createBookingFromSession({
      session: await fresh(session),
      start: slots[3]!.start,
      customerTimeZone: "Asia/Kolkata",
      idempotencyKey: randomUUID(),
    });

    let inbox = await listInbox(lead.id);
    expect(inbox.unreadCount).toBe(1);
    expect(inbox.items[0]).toMatchObject({ kind: "booking_confirmed", title: "Your call is booked", read: false, href: "/account" });
    expect(inbox.items[0]!.body).toMatch(
      /^Our sales team will call you on (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2} at \d{1,2}:\d{2} (AM|PM) \(IST\)\.$/,
    );

    await rescheduleBooking({ bookingId: booking.id, start: slots[6]!.start, actor: { by: "customer" } });
    await cancelBooking({ bookingId: booking.id, actor: { by: "customer" } });
    inbox = await listInbox(lead.id);
    expect(inbox.items.map((i) => i.kind)).toEqual(["booking_cancelled", "booking_rescheduled", "booking_confirmed"]);
    expect(inbox.items.map((i) => i.title)).toEqual(["Your call was cancelled", "Your call was moved", "Your call is booked"]);
    expect(inbox.unreadCount).toBe(3);

    await markInboxRead(lead.id, [inbox.items[2]!.id]);
    expect((await listInbox(lead.id)).unreadCount).toBe(2);
    await markInboxRead(lead.id);
    expect((await listInbox(lead.id)).unreadCount).toBe(0);
  });
});
