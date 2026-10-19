import "server-only";
import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { env } from "./env";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** URL-safe random token (default 32 bytes ≈ 256 bits). */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** Numeric one-time code, uniformly random. */
export function randomDigits(length = 6) {
  return Array.from({ length }, () => randomInt(0, 10)).join("");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** HMAC-SHA256 keyed with APP_SECRET (or an explicit key). */
export function hmac(value: string, key: string = env().APP_SECRET) {
  return createHmac("sha256", key).update(value).digest("hex");
}

/** Hash used for storing lookup tokens (session ids, lead refs). Keyed so a DB leak can't be replayed. */
export function hashToken(token: string) {
  return hmac(`token:${token}`);
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// --- passwords (scrypt, N=16384 default) ---

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(key, expected);
}

/** Booking reference shown to customers, e.g. "CSS-7K3P9Q". No ambiguous characters. */
export function bookingReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `CSS-${Array.from({ length: 6 }, () => alphabet[randomInt(0, alphabet.length)]).join("")}`;
}
