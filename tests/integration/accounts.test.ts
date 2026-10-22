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
import { CUSTOMER_COOKIE, getCurrentCustomer, logoutCustomer, requireCustomer, updateProfile } from "@/lib/server/customer-auth";
import { db } from "@/lib/server/db";
import { clearOutbox, readOutbox } from "@/lib/server/dev-outbox";
import { ApiException } from "@/lib/server/http";
import { listInbox, markInboxRead } from "@/lib/server/inbox";
import { sendEmailCode, verifyEmailCode } from "@/lib/server/email-verify/flow";
import { getAvailableSlots } from "@/lib/server/scheduling/availability";
import { resetDb, seedSchedule } from "../helpers/db";

const EMAIL = "rahul@example.com";
const IN_E164 = "+919876543210";
const IP = "203.0.113.9";

function codeFor(to: string) {
  const m = readOutbox({ to, channel: "email" }).at(-1)?.subject?.match(/^(\d{6}) /);
  if (!m) throw new Error("no code");
  return m[1]!;
}

const fresh = (s: BookingSession) => db.bookingSession.findUniqueOrThrow({ where: { id: s.id } });
const newSession = async () => (await startSession(undefined, {})).session;

/** Name + email + phone → code by email → verified, account created, logged in. */
async function verifyWith(fullName = "Rahul Sharma") {
  const session = await newSession();
  await sendEmailCode(session, { fullName, email: EMAIL, country: "IN", phone: "98765 43210" }, IP);
  return verifyEmailCode(await fresh(session), codeFor(EMAIL), IP);
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
  jar.clear();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("number → OTP = account + login", () => {
  it("confirming the email creates the account and logs in", async () => {
    const verified = await verifyWith();
    const lead = await db.lead.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(lead).toMatchObject({ fullName: "Rahul Sharma", phoneE164: IN_E164 });
    expect(lead.clientCode).toMatch(/^RAHUL-\d{4}$/);
    expect(lead.emailVerifiedAt).not.toBeNull();
    expect(lead.lastLoginAt).not.toBeNull();

    const token = jar.get(CUSTOMER_COOKIE);
    expect(token).toBeTruthy();
    const row = await db.customerSession.findUniqueOrThrow({ where: { tokenHash: hashToken(token!) } });
    expect(row.leadId).toBe(lead.id);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await toSessionView(verified)).account).toEqual({
      clientCode: lead.clientCode,
      fullName: "Rahul Sharma",
      phoneE164: IN_E164,
      email: EMAIL,
    });
  });

  it("client codes fall back to CLIENT for names without Latin letters and trim long names", async () => {
    await verifyWith("राहुल");
    expect((await db.lead.findUniqueOrThrow({ where: { email: EMAIL } })).clientCode).toMatch(/^CLIENT-\d{4}$/);
    await resetDb();
    clearOutbox();
    jar.clear();
    await verifyWith("Bartholomew-Alexander Smith");
    expect((await db.lead.findUniqueOrThrow({ where: { email: EMAIL } })).clientCode).toMatch(/^BARTHOLOME-\d{4}$/);
  });

  it("the profile endpoint changes the name only: an email can't be claimed without its code", async () => {
    await verifyWith();
    const me = await requireCustomer();
    const updated = await updateProfile(me, { fullName: "Rahul S", email: "victim@example.com" } as { fullName: string });
    expect(updated).toMatchObject({ fullName: "Rahul S", email: EMAIL });
    expect(await db.lead.count({ where: { email: "victim@example.com" } })).toBe(0);
  });

  it("a logged-in customer starting /book skips the code", async () => {
    await verifyWith();
    jar.delete(SESSION_COOKIE); // new device tab / expired booking session, still logged in
    const session = await createOrResumeSession({});
    expect(session).toMatchObject({ email: EMAIL, phoneE164: IN_E164, fullName: "Rahul Sharma" });
    expect(session.emailVerifiedAt).not.toBeNull();
    expect((await toSessionView(session)).account?.fullName).toBe("Rahul Sharma");
  });

  it("logout deletes the session row and cookie", async () => {
    await verifyWith();
    await logoutCustomer();
    expect(jar.has(CUSTOMER_COOKIE)).toBe(false);
    expect(await db.customerSession.count()).toBe(0);
    expect(await getCurrentCustomer()).toBeNull();
    await expectApiError(requireCustomer(), 401, "UNAUTHORIZED");
  });

  it("expired or unknown customer cookies are ignored", async () => {
    jar.set(CUSTOMER_COOKIE, "bogus");
    expect(await getCurrentCustomer()).toBeNull();
    await verifyWith();
    await db.customerSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getCurrentCustomer()).toBeNull();
    expect(await db.customerSession.count()).toBe(0);
  });
});

describe("in-app booking notifications", () => {
  it("adds inbox items when a call is booked, moved and cancelled", async () => {
    await seedSchedule();
    const session = await verifyWith();
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
