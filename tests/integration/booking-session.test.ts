import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Verifying an email logs the customer in, which sets a cookie: stand in for next/headers.
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
import { CUSTOMER_COOKIE } from "@/lib/server/customer-auth";
import { completeDetails, sendEmailCode, verifyEmailCode } from "@/lib/server/email-verify/flow";
import { resetDb } from "../helpers/db";

const EMAIL = "asha@example.com";
const EMAIL2 = "ravi@example.com";
const IN_E164 = "+919876543210";
const BOOK = { fullName: "Asha Rao", email: EMAIL, country: "IN", phone: "98765 43210" };
const IP = "203.0.113.7";
const T0 = new Date("2030-01-07T10:00:00.000Z"); // aligned to an hour boundary

function codeFor(to: string) {
  const subject = readOutbox({ to, channel: "email" }).at(-1)?.subject;
  const m = subject?.match(/^(\d{6}) /);
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

async function verify(session: BookingSession, input: Parameters<typeof sendEmailCode>[1] = BOOK) {
  await sendEmailCode(session, input, IP);
  return verifyEmailCode(await fresh(session), codeFor(input.email), IP);
}

beforeEach(async () => {
  jar.clear();
  await resetDb();
  clearOutbox();
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
      pendingEmail: null,
      phoneE164: null,
      verified: false,
      fullName: null,
      email: null,
      callMinutes: 30,
      coachTimeZone: "Asia/Kolkata",
      bookingReference: null,
      upcomingBooking: null,
      account: null,
    });

    const lead = await db.lead.create({
      data: { fullName: "A B", phoneE164: IN_E164, emailVerifiedAt: new Date(), email: "a@b.co" },
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
    // A booked session can still sign in (e.g. the login cookie expired): booking is what's blocked.
    await sendEmailCode(await fresh(session), BOOK, IP);
  });

  it("a cancelled or past call releases the session, so the same browser can book again", async () => {
    const { session, token } = await startSession(undefined, {});
    const lead = await db.lead.create({ data: { phoneE164: IN_E164, email: EMAIL, emailVerifiedAt: new Date() } });
    const start = new Date(T0.getTime() + 2 * 3_600_000);
    const booking = await db.booking.create({
      data: {
        reference: "CSS-REBOOK",
        leadId: lead.id,
        startsAt: start,
        endsAt: new Date(start.getTime() + 30 * 60_000),
        blockedUntil: new Date(start.getTime() + 45 * 60_000),
        customerTimeZone: "Asia/Kolkata",
        idempotencyKey: "rebook-1",
      },
    });
    await db.$transaction((tx) => attachBookingToSession(tx, session.id, booking.id));
    expect((await findLiveSession(token))?.bookingId).toBe(booking.id); // still upcoming → kept

    await db.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
    const released = await findLiveSession(token);
    expect(released?.bookingId).toBeNull();
    expect((await toSessionView(released!)).bookingReference).toBeNull();

    // Same for a confirmed call that is now in the past.
    await db.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } });
    await db.$transaction((tx) => attachBookingToSession(tx, session.id, booking.id));
    advance(3 * 3_600_000); // call time has passed; the session itself is still live
    expect((await findLiveSession(token))?.bookingId).toBeNull();
  });
});

describe("email code flow", () => {
  it("send → verify confirms the email, creates the account and logs in", async () => {
    const session = await newSession({ source: "manychat", campaign: "fit" });
    const res = await sendEmailCode(session, BOOK, IP);
    expect(res.sentTo).toBe("as••@example.com");
    const mail = readOutbox({ to: EMAIL, channel: "email" }).at(-1)!;
    expect(mail.subject).toMatch(/^\d{6} is your mithilesh_lifts code$/);
    expect(mail.body).toContain("Hi Asha");
    const stored = await fresh(session);
    expect(stored.emailCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.emailCodeHash).not.toContain(codeFor(EMAIL));

    const verified = await verifyEmailCode(stored, codeFor(EMAIL), IP);
    expect(verified).toMatchObject({ email: EMAIL, phoneE164: IN_E164, fullName: "Asha Rao", emailCodeHash: null });
    expect(verified.emailVerifiedAt).not.toBeNull();
    const lead = await db.lead.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(lead).toMatchObject({ fullName: "Asha Rao", phoneE164: IN_E164, source: "manychat", campaign: "fit" });
    expect(lead.clientCode).toMatch(/^ASHA-\d{4}$/);
    expect(jar.has(CUSTOMER_COOKIE)).toBe(true);
    const view = await toSessionView(verified);
    expect(view).toMatchObject({ verified: true, email: EMAIL });
  });

  it("book mode needs a valid phone", async () => {
    const err = await expectApiError(sendEmailCode(await newSession(), { ...BOOK, phone: "12345" }, IP), 422, "VALIDATION");
    expect(err.fields?.phone).toBeTruthy();
  });

  it("wrong code → OTP_INVALID; 5 wrong tries burn the code", async () => {
    const session = await newSession();
    await sendEmailCode(session, BOOK, IP);
    const good = codeFor(EMAIL);
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await expectApiError(verifyEmailCode(await fresh(session), bad, IP), 400, "OTP_INVALID");
    await expectApiError(verifyEmailCode(await fresh(session), good, IP), 400, "OTP_INVALID");
    expect((await fresh(session)).emailVerifiedAt).toBeNull();
  });

  it("codes expire after 10 minutes", async () => {
    const session = await newSession();
    await sendEmailCode(session, BOOK, IP);
    advance(10 * 60_000 + 1);
    await expectApiError(verifyEmailCode(await fresh(session), codeFor(EMAIL), IP), 400, "OTP_INVALID");
  });

  it("verify without a sent code → OTP_INVALID", async () => {
    await expectApiError(verifyEmailCode(await newSession(), "123456", IP), 400, "OTP_INVALID");
  });

  it("enforces the resend cooldown", async () => {
    const session = await newSession();
    await sendEmailCode(session, BOOK, IP);
    await expectApiError(sendEmailCode(await fresh(session), BOOK, IP), 429, "OTP_COOLDOWN");
    advance(46_000);
    await sendEmailCode(await fresh(session), BOOK, IP);
    // Only the newest code works.
    expect(readOutbox({ to: EMAIL, channel: "email" })).toHaveLength(2);
  });

  it("rate limits per email (5/hour across sessions)", async () => {
    for (let i = 0; i < 5; i++) await sendEmailCode(await newSession(), BOOK, `198.51.100.${i}`);
    await expectApiError(sendEmailCode(await newSession(), BOOK, "198.51.100.99"), 429, "RATE_LIMITED");
  });

  it("rate limits per IP (100/hour: high, because mobile networks share IPs)", async () => {
    for (let i = 0; i < 100; i++) {
      await sendEmailCode(await newSession(), { ...BOOK, email: `p${i}@example.com` }, IP);
    }
    await expectApiError(sendEmailCode(await newSession(), { ...BOOK, email: "p999@example.com" }, IP), 429, "RATE_LIMITED");
  }, 60_000);

  it("a code sent to one email cannot verify another", async () => {
    const session = await newSession();
    await sendEmailCode(session, BOOK, IP);
    const first = codeFor(EMAIL);
    advance(46_000);
    await sendEmailCode(await fresh(session), { ...BOOK, email: EMAIL2 }, IP);
    await expectApiError(verifyEmailCode(await fresh(session), first, IP), 400, "OTP_INVALID");
    await verifyEmailCode(await fresh(session), codeFor(EMAIL2), IP);
    expect((await fresh(session)).email).toBe(EMAIL2);
  });

  it("a returning email keeps its account; the new number replaces the old one", async () => {
    await db.lead.create({
      data: { email: EMAIL, fullName: "Asha R", clientCode: "ASHA-1234", phoneE164: "+919000000000" },
    });
    const verified = await verify(await newSession(), { ...BOOK, fullName: "Someone Else" });
    const lead = await db.lead.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(lead).toMatchObject({ fullName: "Asha R", clientCode: "ASHA-1234", phoneE164: IN_E164 });
    expect(verified.fullName).toBe("Asha R");
    expect(await db.lead.count()).toBe(1);
  });

  it("log in with a new email: verified but no account until name + phone are given", async () => {
    const session = await newSession();
    const verified = await verify(session, { email: EMAIL });
    expect(jar.has(CUSTOMER_COOKIE)).toBe(false);
    expect(await db.lead.count()).toBe(0);
    expect(await toSessionView(verified)).toMatchObject({ verified: true, account: null });

    const done = await completeDetails(verified, { fullName: "Asha Rao", country: "IN", phone: "98765 43210" });
    expect(done).toMatchObject({ fullName: "Asha Rao", phoneE164: IN_E164 });
    expect(await db.lead.findUniqueOrThrow({ where: { email: EMAIL } })).toMatchObject({ fullName: "Asha Rao" });
    expect(jar.has(CUSTOMER_COOKIE)).toBe(true);
  });

  it("completeDetails requires a confirmed email", async () => {
    await expectApiError(completeDetails(await newSession(), { fullName: "Asha Rao", country: "IN", phone: "98765 43210" }), 403, "NOT_VERIFIED");
  });

  it("email provider failure → OTP_SEND_FAILED and the cooldown is released", async () => {
    const emailModule = await import("@/lib/server/email");
    const spy = vi.spyOn(emailModule, "sendEmail").mockResolvedValueOnce({ ok: false, error: "boom", retryable: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const session = await newSession();
    await expectApiError(sendEmailCode(session, BOOK, IP), 502, "OTP_SEND_FAILED");
    spy.mockRestore();
    await sendEmailCode(await fresh(session), BOOK, IP);
  });
});
