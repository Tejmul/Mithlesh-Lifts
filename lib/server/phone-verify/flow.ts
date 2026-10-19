import "server-only";
// OWNER: Agent A. Phone-OTP + contact steps of the booking session, independent of the
// Next request context so they can be tested directly. Route handlers are thin wrappers.
import type { BookingSession } from "@/generated/prisma/client";
import type { SendCodeResponse } from "@/lib/shared/api";
import { maskPhone, normalizePhone } from "@/lib/shared/validation";
import { hmac } from "../crypto";
import { db } from "../db";
import { env } from "../env";
import { ApiException } from "../http";
import { logEvent, reportError } from "../observability";
import { enforceRateLimit } from "../rate-limit";
import { checkPhoneVerification, startPhoneVerification } from "./index";

const HOUR = 3600;

/** Rate-limit keys never contain raw phone numbers or IPs. */
const keyPart = (value: string) => hmac(`rl:${value}`).slice(0, 32);

function assertNotBooked(session: BookingSession) {
  if (session.bookingId) {
    throw new ApiException(409, "ALREADY_BOOKED", "You've already booked a call. Check your email for the details.");
  }
}

// ---------------------------------------------------------------- resend cooldown

/**
 * Atomically claims the per-session resend cooldown. Stored as a RateLimit row whose windowStart is
 * the send time (pruned with the other windows). Returns null if claimed, else when it frees up.
 */
async function claimCooldown(sessionId: string, cooldownSeconds: number): Promise<Date | null> {
  const key = `otp-cooldown:${sessionId}`;
  const now = new Date();
  const since = new Date(now.getTime() - cooldownSeconds * 1000);
  const inserted = await db.$queryRaw<{ windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    SELECT ${key}, ${now}, 1
    WHERE NOT EXISTS (SELECT 1 FROM "RateLimit" WHERE "key" = ${key} AND "windowStart" > ${since})
    ON CONFLICT DO NOTHING
    RETURNING "windowStart"`;
  if (inserted.length) return null;
  const last = await db.rateLimit.findFirst({ where: { key }, orderBy: { windowStart: "desc" } });
  const lastAt = last?.windowStart.getTime() ?? now.getTime();
  return new Date(lastAt + cooldownSeconds * 1000);
}

async function releaseCooldown(sessionId: string) {
  await db.rateLimit.deleteMany({
    where: { key: `otp-cooldown:${sessionId}`, windowStart: { gt: new Date(Date.now() - 600_000) } },
  });
}

// ---------------------------------------------------------------- step 1: send code

export async function sendPhoneCode(
  session: BookingSession,
  input: { country: string; phone: string },
  ip: string,
): Promise<SendCodeResponse> {
  assertNotBooked(session);
  const e164 = normalizePhone(input.country, input.phone);
  if (!e164) {
    throw new ApiException(422, "VALIDATION", "Some details need fixing.", {
      phone: "Enter a valid mobile number for the selected country.",
    });
  }

  const cooldown = env().OTP_RESEND_COOLDOWN_SECONDS;
  // Check cooldown first (read-only) so a blocked resend doesn't burn the hourly allowances.
  const recent = await db.rateLimit.findFirst({
    where: { key: `otp-cooldown:${session.id}`, windowStart: { gt: new Date(Date.now() - cooldown * 1000) } },
    orderBy: { windowStart: "desc" },
  });
  if (recent) throw cooldownError(new Date(recent.windowStart.getTime() + cooldown * 1000));

  const tooMany = "Too many codes requested. Please wait a while and try again.";
  await enforceRateLimit(`otp-send:session:${session.id}`, 8, HOUR, tooMany);
  await enforceRateLimit(`otp-send:phone:${keyPart(e164)}`, 5, HOUR, tooMany);
  await enforceRateLimit(`otp-send:ip:${keyPart(ip)}`, 15, HOUR, tooMany);

  const blockedUntil = await claimCooldown(session.id, cooldown);
  if (blockedUntil) throw cooldownError(blockedUntil);
  const resendAvailableAt = new Date(Date.now() + cooldown * 1000);

  const changedNumber = session.phoneE164 !== null && session.phoneE164 !== e164;
  await db.bookingSession.update({
    where: { id: session.id },
    data: {
      pendingPhoneE164: e164,
      ...(changedNumber ? { phoneE164: null, phoneVerifiedAt: null } : {}),
    },
  });

  const result = await startPhoneVerification(e164);
  if (!result.ok) {
    await releaseCooldown(session.id);
    reportError(new Error(result.error), { where: "otp-send", sessionId: session.id });
    throw new ApiException(502, "OTP_SEND_FAILED", "We couldn't send the code. Check the number and try again.");
  }
  logEvent("otp_sent", { sessionId: session.id, provider: env().PHONE_VERIFY_PROVIDER });
  return { sentTo: maskPhone(e164), resendAvailableAt: resendAvailableAt.toISOString() };
}

function cooldownError(availableAt: Date) {
  const seconds = Math.max(1, Math.ceil((availableAt.getTime() - Date.now()) / 1000));
  return new ApiException(
    429,
    "OTP_COOLDOWN",
    `Please wait ${seconds} seconds before requesting another code.`,
    { resendAvailableAt: availableAt.toISOString() },
    { "Retry-After": String(seconds) },
  );
}

// ---------------------------------------------------------------- step 1b: verify code

export async function verifyPhoneCode(session: BookingSession, code: string, ip: string): Promise<BookingSession> {
  assertNotBooked(session);
  const pending = session.pendingPhoneE164;
  if (!pending) throw new ApiException(400, "OTP_INVALID", "Request a code first.");

  const tooMany = "Too many attempts. Please wait a few minutes and request a new code.";
  await enforceRateLimit(`otp-check:session:${session.id}`, 10, 15 * 60, tooMany);
  await enforceRateLimit(`otp-check:ip:${keyPart(ip)}`, 30, HOUR, tooMany);

  const result = await checkPhoneVerification(pending, code.trim());
  if (!result.ok) {
    reportError(new Error(result.error), { where: "otp-check", sessionId: session.id });
    throw new ApiException(502, "INTERNAL", "We couldn't check the code right now. Please try again in a moment.");
  }
  if (!result.approved) throw new ApiException(400, "OTP_INVALID", "That code is incorrect or has expired.");

  logEvent("phone_verified", { sessionId: session.id });
  return db.bookingSession.update({
    where: { id: session.id },
    data: { phoneE164: pending, phoneVerifiedAt: new Date() },
  });
}

// ---------------------------------------------------------------- step 2: contact

export async function saveContact(
  session: BookingSession,
  input: { fullName: string; email: string; marketingConsent?: boolean },
): Promise<BookingSession> {
  assertNotBooked(session);
  if (!session.phoneVerifiedAt || !session.phoneE164) {
    throw new ApiException(403, "PHONE_NOT_VERIFIED", "Verify your phone number first.");
  }
  return db.bookingSession.update({
    where: { id: session.id },
    data: { fullName: input.fullName, email: input.email, marketingConsent: input.marketingConsent ?? false },
  });
}
