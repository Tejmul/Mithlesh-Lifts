import "server-only";
// Mock OTP provider — development and tests ONLY. Codes are delivered to the in-memory dev outbox
// (read via /api/dev/outbox), never logged. Only an HMAC of the code is kept in memory.
import { hmac, randomDigits, safeEqual } from "../crypto";
import { pushOutbox } from "../dev-outbox";
import type { CheckResult, StartResult } from "./index";

export const MOCK_CODE_TTL_MS = 5 * 60_000;
export const MOCK_MAX_ATTEMPTS = 5;

type Pending = { hash: string; expiresAt: number; attempts: number };
const store = globalThis as unknown as { __cssMockOtp?: Map<string, Pending> };
const pending = () => (store.__cssMockOtp ??= new Map());

function assertNotProduction() {
  if (process.env.NODE_ENV === "production") throw new Error("Mock phone verification is disabled in production");
}

const codeHash = (phoneE164: string, code: string) => hmac(`mock-otp:${phoneE164}:${code}`);

export async function start(phoneE164: string): Promise<StartResult> {
  assertNotProduction();
  const code = randomDigits(6);
  pending().set(phoneE164, { hash: codeHash(phoneE164, code), expiresAt: Date.now() + MOCK_CODE_TTL_MS, attempts: 0 });
  pushOutbox({ channel: "sms", to: phoneE164, body: `Your Mithilesh Reddy verification code is ${code}` });
  return { ok: true };
}

export async function check(phoneE164: string, code: string): Promise<CheckResult> {
  assertNotProduction();
  const map = pending();
  const entry = map.get(phoneE164);
  if (!entry) return { ok: true, approved: false };
  if (Date.now() > entry.expiresAt) {
    map.delete(phoneE164);
    return { ok: true, approved: false };
  }
  entry.attempts += 1;
  if (safeEqual(entry.hash, codeHash(phoneE164, code.trim()))) {
    map.delete(phoneE164); // single use
    return { ok: true, approved: true };
  }
  if (entry.attempts >= MOCK_MAX_ATTEMPTS) map.delete(phoneE164);
  return { ok: true, approved: false };
}

/** Tests only. */
export function resetMockPhoneVerify() {
  pending().clear();
}
