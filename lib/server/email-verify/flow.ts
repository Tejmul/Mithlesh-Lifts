import "server-only";
// Step ① of docs/FLOW.md: name + email + phone → 6-digit code by email → verified → logged in.
// The verified email is the account. The phone is where the sales team calls (not verified).
// We generate the code ourselves and store only hmac(code); it expires and allows few attempts.
import { timingSafeEqual } from "crypto";
import type { BookingSession } from "@/generated/prisma/client";
import type { SendCodeResponse } from "@/lib/shared/api";
import { maskEmail, normalizePhone } from "@/lib/shared/validation";
import { hmac, randomDigits } from "../crypto";
import { freeClientCode, startCustomerSession } from "../customer-auth";
import { db, isConstraintViolation, TX_OPTIONS, type Tx } from "../db";
import { sendEmail } from "../email";
import { verificationCode } from "../email/templates";
import { env } from "../env";
import { ApiException } from "../http";
import { logEvent, reportError } from "../observability";
import { enforceRateLimit } from "../rate-limit";

const HOUR = 3600;
export const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

/** Rate-limit keys never contain raw emails or IPs. */
const keyPart = (value: string) => hmac(`rl:${value}`).slice(0, 32);
const codeHash = (sessionId: string, email: string, code: string) => hmac(`email-code:${sessionId}:${email}:${code}`);

/** Atomically claims the per-session resend cooldown. Null if claimed, else when it frees up. */
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
  return new Date((last?.windowStart.getTime() ?? now.getTime()) + cooldownSeconds * 1000);
}

async function releaseCooldown(sessionId: string) {
  await db.rateLimit.deleteMany({
    where: { key: `otp-cooldown:${sessionId}`, windowStart: { gt: new Date(Date.now() - 600_000) } },
  });
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

// ---------------------------------------------------------------- send

/**
 * Sends a code to `email`. Name and phone are stored on the session (used if this email has no account yet).
 * "Log in" sends only the email.
 */
export async function sendEmailCode(
  session: BookingSession,
  input: { email: string; fullName?: string; country?: string; phone?: string },
  ip: string,
): Promise<SendCodeResponse> {
  const email = input.email.trim().toLowerCase();
  const phoneE164 = input.phone ? normalizePhone(input.country ?? "IN", input.phone) : null;
  if (input.phone && !phoneE164) {
    throw new ApiException(422, "VALIDATION", "Some details need fixing.", {
      phone: "Enter a valid mobile number for the selected country.",
    });
  }

  const cooldown = env().OTP_RESEND_COOLDOWN_SECONDS;
  const recent = await db.rateLimit.findFirst({
    where: { key: `otp-cooldown:${session.id}`, windowStart: { gt: new Date(Date.now() - cooldown * 1000) } },
    orderBy: { windowStart: "desc" },
  });
  if (recent) throw cooldownError(new Date(recent.windowStart.getTime() + cooldown * 1000));

  const tooMany = "Too many codes requested. Please wait a while and try again.";
  await enforceRateLimit(`otp-send:session:${session.id}`, 8, HOUR, tooMany);
  await enforceRateLimit(`otp-send:email:${keyPart(email)}`, 5, HOUR, tooMany);
  // High per-IP cap: one Jio/Airtel IP can carry hundreds of real visitors. Abuse is held back by
  // the per-email and per-session limits above.
  await enforceRateLimit(`otp-send:ip:${keyPart(ip)}`, 100, HOUR, tooMany);

  const blockedUntil = await claimCooldown(session.id, cooldown);
  if (blockedUntil) throw cooldownError(blockedUntil);

  const code = randomDigits(6);
  const changedEmail = session.email !== null && session.email !== email;
  await db.bookingSession.update({
    where: { id: session.id },
    data: {
      pendingEmail: email,
      emailCodeHash: codeHash(session.id, email, code),
      emailCodeExpiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      emailCodeAttempts: 0,
      ...(changedEmail ? { email: null, emailVerifiedAt: null } : {}),
      // "Log in" sends only the email: drop any name/phone left on this browser's session by someone
      // else (shared device), so a new account is never created with another person's details.
      ...(input.fullName?.trim() || phoneE164
        ? {
            ...(input.fullName?.trim() ? { fullName: input.fullName.trim() } : {}),
            ...(phoneE164 ? { phoneE164 } : {}),
          }
        : { fullName: null, phoneE164: null }),
    },
  });

  const rendered = verificationCode({ name: input.fullName?.trim() || null, code, minutes: CODE_TTL_MINUTES });
  const sent = await sendEmail({ to: email, ...rendered, idempotencyKey: `email-code:${session.id}:${Date.now()}` });
  if (!sent.ok) {
    await releaseCooldown(session.id);
    reportError(new Error(sent.error), { where: "email-code-send", sessionId: session.id });
    throw new ApiException(502, "OTP_SEND_FAILED", "We couldn't send the code right now. Please try again in a few minutes.");
  }
  logEvent("email_code_sent", { sessionId: session.id, provider: env().EMAIL_PROVIDER });
  return { sentTo: maskEmail(email), resendAvailableAt: new Date(Date.now() + cooldown * 1000).toISOString() };
}

// ---------------------------------------------------------------- verify

/**
 * Checks the code. On success the session's email is verified and, when the account exists or
 * name + phone are known, the account is created/loaded and the customer is logged in.
 * A "Log in" with a brand-new email stays verified but account-less → completeDetails().
 */
export async function verifyEmailCode(session: BookingSession, code: string, ip: string): Promise<BookingSession> {
  const email = session.pendingEmail;
  if (!email || !session.emailCodeHash || !session.emailCodeExpiresAt) {
    throw new ApiException(400, "OTP_INVALID", "Request a code first.");
  }
  const tooMany = "Too many attempts. Please wait a few minutes and request a new code.";
  await enforceRateLimit(`otp-check:session:${session.id}`, 10, 15 * 60, tooMany);
  await enforceRateLimit(`otp-check:ip:${keyPart(ip)}`, 300, HOUR, tooMany);
  // Per address, across sessions and resends: stops guessing by requesting new codes over and over.
  await enforceRateLimit(`otp-check:email:${keyPart(email)}`, 20, 24 * HOUR, tooMany);

  // Count the attempt first so parallel guesses can't skip the limit.
  const counted = await db.bookingSession.update({
    where: { id: session.id },
    data: { emailCodeAttempts: { increment: 1 } },
    select: { emailCodeAttempts: true },
  });
  const expired = session.emailCodeExpiresAt.getTime() <= Date.now();
  const expected = Buffer.from(session.emailCodeHash);
  const given = Buffer.from(codeHash(session.id, email, code.trim()));
  const matches = expected.length === given.length && timingSafeEqual(expected, given);
  if (expired || counted.emailCodeAttempts > MAX_ATTEMPTS || !matches) {
    throw new ApiException(400, "OTP_INVALID", "That code is incorrect or has expired.");
  }

  logEvent("email_verified", { sessionId: session.id });
  const now = new Date();
  const usedHash = session.emailCodeHash;
  const run = () =>
    db.$transaction(async (tx) => {
      // Use the code exactly once: a double click or a second tab submitting it gets OTP_INVALID.
      const consumed = await tx.bookingSession.updateMany({
        where: { id: session.id, emailCodeHash: usedHash },
        data: { emailCodeHash: null, emailCodeExpiresAt: null },
      });
      if (consumed.count !== 1) throw new ApiException(400, "OTP_INVALID", "That code is incorrect or has expired.");

      const existing = await tx.lead.findUnique({ where: { email } });
      let leadId: string | null = existing?.id ?? null;
      if (existing) {
        await tx.lead.update({
          where: { id: existing.id },
          data: {
            emailVerifiedAt: now,
            // Name: fill the gap only. Phone: the number they just typed is where they want the call.
            ...(!existing.fullName?.trim() && session.fullName ? { fullName: session.fullName } : {}),
            ...(session.phoneE164 && session.phoneE164 !== existing.phoneE164 ? { phoneE164: session.phoneE164 } : {}),
            ...trackingGaps(existing, session),
          },
        });
      } else if (session.fullName && session.phoneE164) {
        leadId = (await createAccount(tx, session, email, now)).id;
      }
      const updated = await tx.bookingSession.update({
        where: { id: session.id },
        data: {
          email,
          emailVerifiedAt: now,
          ...(existing ? { fullName: existing.fullName ?? session.fullName, phoneE164: session.phoneE164 ?? existing.phoneE164 } : {}),
        },
      });
      return { updated, leadId };
    }, TX_OPTIONS);
  // Two sessions confirming the same new email at the same moment: one creates the account, the
  // other hits the unique email and simply retries (and then finds the account).
  const { updated, leadId } = await retryOnUniqueEmail(run);
  if (leadId) await startCustomerSession(leadId);
  return updated;
}

// ---------------------------------------------------------------- details for a new "Log in" email

/** Name + phone after a "Log in" email turned out to be new. Creates the account and logs in. */
export async function completeDetails(
  session: BookingSession,
  input: { fullName: string; country: string; phone: string },
): Promise<BookingSession> {
  if (!session.emailVerifiedAt || !session.email) {
    throw new ApiException(403, "NOT_VERIFIED", "Confirm your email first.");
  }
  const phoneE164 = normalizePhone(input.country, input.phone);
  if (!phoneE164) {
    throw new ApiException(422, "VALIDATION", "Some details need fixing.", {
      phone: "Enter a valid mobile number for the selected country.",
    });
  }
  const email = session.email;
  const { updated, leadId } = await retryOnUniqueEmail(() => db.$transaction(async (tx) => {
    const next = { ...session, fullName: input.fullName.trim(), phoneE164 };
    const existing = await tx.lead.findUnique({ where: { email } });
    const lead = existing ?? (await createAccount(tx, next, email, session.emailVerifiedAt!));
    const updated = await tx.bookingSession.update({
      where: { id: session.id },
      data: { fullName: lead.fullName ?? next.fullName, phoneE164: lead.phoneE164 },
    });
    return { updated, leadId: lead.id };
  }, TX_OPTIONS));
  await startCustomerSession(leadId);
  logEvent("account_created", { sessionId: session.id, leadId });
  return updated;
}

// ---------------------------------------------------------------- helpers

async function retryOnUniqueEmail<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isConstraintViolation(err, "P2002")) throw err;
    return fn();
  }
}

async function createAccount(tx: Tx, session: BookingSession, email: string, verifiedAt: Date) {
  return tx.lead.create({
    data: {
      email,
      emailVerifiedAt: verifiedAt,
      fullName: session.fullName,
      phoneE164: session.phoneE164!,
      source: session.source,
      campaign: session.campaign,
      manychatSubscriberId: session.manychatSubscriberId,
      clientCode: await freeClientCode(tx, session.fullName),
    },
  });
}

function trackingGaps(
  lead: { source: string | null; campaign: string | null; manychatSubscriberId: string | null },
  session: BookingSession,
) {
  // First touch wins for tracking labels.
  return {
    ...(!lead.source && session.source ? { source: session.source } : {}),
    ...(!lead.campaign && session.campaign ? { campaign: session.campaign } : {}),
    ...(!lead.manychatSubscriberId && session.manychatSubscriberId
      ? { manychatSubscriberId: session.manychatSubscriberId }
      : {}),
  };
}
