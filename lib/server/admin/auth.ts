import "server-only";
// OWNER: Agent D. Admin password login + DB-backed sessions.
// The httpOnly cookie holds only a random token; the DB stores hashToken(token).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { AdminUser } from "@/generated/prisma/client";
import { db } from "../db";
import { hashPassword, hashToken, randomToken, verifyPassword } from "../crypto";
import { ApiException } from "../http";
import { enforceRateLimit } from "../rate-limit";
import { logEvent } from "../observability";

export const ADMIN_COOKIE = "css_admin";

export const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_FAILED_MESSAGE = "Email or password is incorrect.";
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_LIMIT_PER_IP = 10;
const LOGIN_LIMIT_PER_EMAIL = 5;

// Compared against when the email doesn't exist, so response time doesn't reveal valid accounts.
let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hashPassword(`dummy-${randomToken(16)}`);
  return dummyHash;
}

export function normalizeAdminEmail(email: string) {
  return email.trim().toLowerCase();
}

/**
 * Cookie-independent login: rate limits, checks the password and creates a session.
 * Throws ApiException 429 RATE_LIMITED or 401 UNAUTHORIZED (generic message).
 */
export async function authenticate(
  email: string,
  password: string,
  ip: string,
  now: Date = new Date(),
): Promise<{ token: string; admin: AdminUser; expiresAt: Date }> {
  const normalized = normalizeAdminEmail(email);
  const tooMany = "Too many sign-in attempts. Please wait 15 minutes and try again.";
  // Keys are hashed so the RateLimit table never holds raw emails or IPs.
  await enforceRateLimit(`admin-login:ip:${hashToken(ip)}`, LOGIN_LIMIT_PER_IP, LOGIN_WINDOW_SECONDS, tooMany);
  await enforceRateLimit(
    `admin-login:email:${hashToken(normalized)}`,
    LOGIN_LIMIT_PER_EMAIL,
    LOGIN_WINDOW_SECONDS,
    tooMany,
  );

  const admin = await db.adminUser.findUnique({ where: { email: normalized } });
  const ok = await verifyPassword(password, admin?.passwordHash ?? (await getDummyHash()));
  if (!admin || !ok) {
    logEvent("admin.login_failed");
    throw new ApiException(401, "UNAUTHORIZED", LOGIN_FAILED_MESSAGE);
  }

  const token = randomToken();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_TTL_MS);
  await db.$transaction([
    db.adminSession.deleteMany({ where: { adminUserId: admin.id, expiresAt: { lte: now } } }),
    db.adminSession.create({ data: { tokenHash: hashToken(token), adminUserId: admin.id, expiresAt } }),
    db.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: now } }),
  ]);
  logEvent("admin.login", { adminUserId: admin.id });
  return { token, admin, expiresAt };
}

/** Admin for a raw session token, or null if unknown/expired (expired rows are deleted). */
export async function resolveSession(token: string | undefined | null, now: Date = new Date()): Promise<AdminUser | null> {
  if (!token || token.length > 200) return null;
  const session = await db.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { adminUser: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime()) {
    await db.adminSession.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session.adminUser;
}

/** Deletes the session for a raw token (no-op when unknown). */
export async function revokeSession(token: string | undefined | null) {
  if (!token) return;
  await db.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Server Action helper: authenticate and set the session cookie. Throws ApiException on failure. */
export async function login(email: string, password: string, ip: string): Promise<AdminUser> {
  const { token, admin, expiresAt } = await authenticate(email, password, ip);
  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // "/" (not "/admin") so the cookie also reaches server-action POSTs and the CSV route.
    path: "/",
    expires: expiresAt,
  });
  return admin;
}

/** Server Action helper: revoke the DB session and clear the cookie. */
export async function logout(): Promise<void> {
  const store = await cookies();
  await revokeSession(store.get(ADMIN_COOKIE)?.value);
  store.delete({ name: ADMIN_COOKIE, path: "/" });
}

/** Current admin from the session cookie, or null. */
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  // Session checks compare against the current time: always run at request time, never during prerender.
  await connection();
  const store = await cookies();
  return resolveSession(store.get(ADMIN_COOKIE)?.value);
}

/** For admin pages/actions: redirects to /admin/login when signed out. */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
