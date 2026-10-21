import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifying a number logs the customer in, which sets a cookie: stand in for next/headers.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (opts: string | { name: string }) => void jar.delete(typeof opts === "string" ? opts : opts.name),
  }),
}));
import type { BookingSession } from "@/generated/prisma/client";
import { attachBookingToSession, findLiveSession, startSession, toSessionView } from "@/lib/server/booking-session";
import { hashToken } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { clearOutbox, readOutbox } from "@/lib/server/dev-outbox";
import { resetEnvCache } from "@/lib/server/env";
import { ApiException } from "@/lib/server/http";
import { saveContact, sendPhoneCode, verifyPhoneCode } from "@/lib/server/phone-verify/flow";
import { resetMockPhoneVerify } from "@/lib/server/phone-verify/mock";
import { resetDb } from "../helpers/db";

const IN = { country: "IN", phone: "98765 43210" };
const IN_E164 = "+919876543210";
const IN2 = { country: "IN", phone: "91234 56789" };
const IN2_E164 = "+919123456789";
const IP = "203.0.113.7";
const T0 = new Date("2030-01-07T10:00:00.000Z"); // aligned to an hour boundary

function codeFor(to: string) {
  const body = readOutbox({ to, channel: "sms" }).at(-1)?.body;
  const m = body?.match(/(\d{6})$/);
  if (!m) throw new Error("no code");
  return m[1]!;
}

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

const fresh = async (s: BookingSession) => (await db.bookingSession.findUniqueOrThrow({ where: { id: s.id } }));
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

async function newSession(tracking = {}) {
  return (await startSession(undefined, tracking)).session;
}

async function verify(session: BookingSession, phone = IN, e164 = IN_E164) {
  await sendPhoneCode(session, phone, IP);
  return verifyPhoneCode(await fresh(session), codeFor(e164), IP);
}

beforeEach(async () => {
  jar.clear();
  await resetDb();
  clearOutbox();
  resetMockPhoneVerify();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.PHONE_VERIFY_PROVIDER;
  process.env.PHONE_VERIFY_PROVIDER = "mock";
  resetEnvCache();
});
afterAll(async () => {
  await db.$disconnect();
});

describe("session lifecycle", () => {
  it("creates a session storing only the token hash, and resumes it", async () => {
    const a = await startSession(undefined, { source: "manychat", campaign: "fit_reel", mc: "123" });
    expect(a.created).toBe(true);
    expect(a.session.tokenHash).toBe(hashToken(a.token));
    expect(a.session.tokenHash).not.toContain(a.token);
    expect(a.session).toMatchObject({ source: "manychat", campaign: "fit_reel", manychatSubscriberId: "123" });

    const b = await startSession(a.token, { source: "other", campaign: "x", mc: "999" });
    expect(b.created).toBe(false);
    expect(b.session.id).toBe(a.session.id);
    // first-touch tracking wins
    expect(b.session).toMatchObject({ source: "manychat", campaign: "fit_reel", manychatSubscriberId: "123" });
  });

  it("fills tracking that was missing on resume", async () => {
    const a = await startSession(undefined, {});
    const b = await startSession(a.token, { source: "manychat", mc: "42" });
    expect(b.session).toMatchObject({ source: "manychat", campaign: null, manychatSubscriberId: "42" });
  });

  it("unknown or expired token creates a new session", async () => {
    const a = await startSession(undefined, {});
    expect((await startSession("bogus", {})).created).toBe(true);
    advance(24 * 3600_000 + 1);
    expect(await findLiveSession(a.token)).toBeNull();
    const c = await startSession(a.token, {});
    expect(c.created).toBe(true);
    expect(c.token).not.toBe(a.token);
  });

  it("slides expiry on activity", async () => {
    const a = await startSession(undefined, {});
    advance(20 * 3600_000);
    const s = await findLiveSession(a.token);
    expect(s!.expiresAt.getTime()).toBe(Date.now() + 24 * 3600_000);
    advance(20 * 3600_000); // 40h after creation, still alive thanks to the slide
    expect(await findLiveSession(a.token)).not.toBeNull();
  });

  it("toSessionView reflects settings and booking reference", async () => {
    const session = await newSession();
    const view = await toSessionView(session);
    expect(view).toEqual({
      pendingPhoneE164: null,
      phoneE164: null,
      phoneVerified: false,
      fullName: null,
      email: null,
      callMinutes: 30,
      coachTimeZone: "Asia/Kolkata",
      bookingReference: null,
      upcomingBooking: null,
      account: null,
    });

    const lead = await db.lead.create({
      data: { fullName: "A B", phoneE164: IN_E164, phoneVerifiedAt: new Date(), email: "a@b.co" },
    });
    const start = new Date(T0.getTime() + 86_400_000);
    const booking = await db.booking.create({
      data: {
        reference: "CSS-TEST22",
        leadId: lead.id,
        startsAt: start,
        endsAt: new Date(start.getTime() + 30 * 60_000),
        blockedUntil: new Date(start.getTime() + 45 * 60_000),
        customerTimeZone: "Asia/Kolkata",
        idempotencyKey: "k1",
      },
    });
    await db.$transaction((tx) => attachBookingToSession(tx, session.id, booking.id));
    expect((await toSessionView(await fresh(session))).bookingReference).toBe("CSS-TEST22");
    await expectApiError(sendPhoneCode(await fresh(session), IN, IP), 409, "ALREADY_BOOKED");
  });
});

describe("phone OTP flow", () => {
  it("send → verify marks the phone verified", async () => {
    const session = await newSession();
    const res = await sendPhoneCode(session, IN, IP);
    expect(res.sentTo).toBe("+9198••••210");
    expect(new Date(res.resendAvailableAt).getTime()).toBe(T0.getTime() + 45_000);

    const pending = await fresh(session);
    expect(pending.pendingPhoneE164).toBe(IN_E164);
    expect(pending.phoneVerifiedAt).toBeNull();

    const verified = await verifyPhoneCode(pending, codeFor(IN_E164), IP);
    expect(verified.phoneE164).toBe(IN_E164);
    expect(verified.phoneVerifiedAt).not.toBeNull();
    expect((await toSessionView(verified)).phoneVerified).toBe(true);
  });

  it("wrong code → OTP_INVALID and nothing verified", async () => {
    const session = await newSession();
    await sendPhoneCode(session, IN, IP);
    const code = codeFor(IN_E164);
    const bad = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    await expectApiError(verifyPhoneCode(await fresh(session), bad, IP), 400, "OTP_INVALID");
    expect((await fresh(session)).phoneVerifiedAt).toBeNull();
  });

  it("verify without a sent code → OTP_INVALID", async () => {
    await expectApiError(verifyPhoneCode(await newSession(), "123456", IP), 400, "OTP_INVALID");
  });

  it("enforces the resend cooldown", async () => {
    const session = await newSession();
    await sendPhoneCode(session, IN, IP);
    advance(10_000);
    const err = await expectApiError(sendPhoneCode(await fresh(session), IN, IP), 429, "OTP_COOLDOWN");
    expect(err.fields?.resendAvailableAt).toBe(new Date(T0.getTime() + 45_000).toISOString());
    advance(36_000);
    await expect(sendPhoneCode(await fresh(session), IN, IP)).resolves.toBeTruthy();
  });

  it("rate limits per phone (5/hour across sessions)", async () => {
    for (let i = 0; i < 5; i++) {
      await sendPhoneCode(await newSession(), IN, `198.51.100.${i}`);
    }
    await expectApiError(sendPhoneCode(await newSession(), IN, "198.51.100.99"), 429, "RATE_LIMITED");
  });

  it("rate limits per session (8/hour)", async () => {
    const session = await newSession();
    for (let i = 0; i < 8; i++) {
      await sendPhoneCode(await fresh(session), i % 2 ? IN : IN2, IP);
      advance(46_000);
    }
    await expectApiError(sendPhoneCode(await fresh(session), IN2, IP), 429, "RATE_LIMITED");
  });

  it("rate limits per IP (15/hour)", async () => {
    const phones = ["98765 43210", "91234 56789", "99887 76655", "90000 11111"];
    for (let i = 0; i < 15; i++) {
      await sendPhoneCode(await newSession(), { country: "IN", phone: phones[i % 4]! }, IP);
    }
    await expectApiError(sendPhoneCode(await newSession(), { country: "IN", phone: "93333 22222" }, IP), 429, "RATE_LIMITED");
  });

  it("rate limits verify attempts per session (10/15min)", async () => {
    const session = await newSession();
    await sendPhoneCode(session, IN, IP);
    const s = await fresh(session);
    const code = codeFor(IN_E164);
    const bad = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 10; i++) await expectApiError(verifyPhoneCode(s, bad, IP), 400, "OTP_INVALID");
    await expectApiError(verifyPhoneCode(s, code, IP), 429, "RATE_LIMITED");
  });

  it("changing the number resets verification", async () => {
    const session = await newSession();
    await verify(session);
    advance(46_000);
    await sendPhoneCode(await fresh(session), IN2, IP);
    const s = await fresh(session);
    expect(s).toMatchObject({ pendingPhoneE164: IN2_E164, phoneE164: null, phoneVerifiedAt: null });
    await expectApiError(saveContact(s, { fullName: "Asha Rao", email: "asha@example.com" }), 403, "PHONE_NOT_VERIFIED");
    const v = await verifyPhoneCode(s, codeFor(IN2_E164), IP);
    expect(v.phoneE164).toBe(IN2_E164);
  });

  it("resending to the same verified number keeps it verified", async () => {
    const session = await newSession();
    await verify(session);
    advance(46_000);
    await sendPhoneCode(await fresh(session), IN, IP);
    expect((await fresh(session)).phoneVerifiedAt).not.toBeNull();
  });

  it("a code sent to one number cannot verify another", async () => {
    const session = await newSession();
    await sendPhoneCode(session, IN, IP);
    const codeA = codeFor(IN_E164);
    advance(46_000);
    await sendPhoneCode(await fresh(session), IN2, IP);
    await expectApiError(verifyPhoneCode(await fresh(session), codeA, IP), 400, "OTP_INVALID");
  });

  it("provider failure → OTP_SEND_FAILED and the cooldown is released", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.PHONE_VERIFY_PROVIDER = "twilio_verify"; // no credentials configured
    resetEnvCache();
    const session = await newSession();
    const err = await expectApiError(sendPhoneCode(session, IN, IP), 502, "OTP_SEND_FAILED");
    expect(err.message).toBe("We couldn't send the code. Check the number and try again.");
    process.env.PHONE_VERIFY_PROVIDER = "mock";
    resetEnvCache();
    await expect(sendPhoneCode(await fresh(session), IN, IP)).resolves.toBeTruthy();
    vi.mocked(console.error).mockRestore();
  });
});

describe("contact step", () => {
  it("requires a verified phone", async () => {
    await expectApiError(
      saveContact(await newSession(), { fullName: "Asha Rao", email: "asha@example.com" }),
      403,
      "PHONE_NOT_VERIFIED",
    );
  });

  it("saves name, email and consent once verified", async () => {
    const session = await verify(await newSession());
    const s = await saveContact(session, { fullName: "Asha Rao", email: "asha@example.com", marketingConsent: true });
    expect(s).toMatchObject({ fullName: "Asha Rao", email: "asha@example.com", marketingConsent: true });
    const view = await toSessionView(s);
    expect(view).toMatchObject({ phoneVerified: true, fullName: "Asha Rao", email: "asha@example.com" });
  });
});
