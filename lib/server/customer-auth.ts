import "server-only";
// Customer accounts (account = Lead, identified by a verified email; see docs/FLOW.md).
// The httpOnly cookie holds only a random token; the DB stores hashToken(token) in CustomerSession.
import { randomInt } from "crypto";
import { cookies } from "next/headers";
import type { Lead } from "@/generated/prisma/client";
import type { AccountSummary } from "@/lib/shared/api";
import { hashToken, randomToken } from "./crypto";
import { db, TX_OPTIONS, type Tx } from "./db";
import { env } from "./env";
import { ApiException } from "./http";
import { logEvent } from "./observability";

export const CUSTOMER_COOKIE = "css_customer";
export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_SESSION_TTL_MS / 1000,
  };
}

// ---------------------------------------------------------------- cookie-independent helpers

/** Lead for a raw customer token, or null if unknown/expired (expired rows are deleted). */
export async function resolveCustomerToken(token: string | undefined | null, now: Date = new Date()): Promise<Lead | null> {
  if (!token || token.length > 200) return null;
  const session = await db.customerSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { lead: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime()) {
    await db.customerSession.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session.lead;
}

/** Creates a CustomerSession row for the lead and returns the raw token. */
export async function createCustomerSessionToken(leadId: string, now: Date = new Date()): Promise<string> {
  const token = randomToken();
  await db.$transaction([
    db.customerSession.deleteMany({ where: { leadId, expiresAt: { lte: now } } }),
    db.customerSession.create({
      data: { tokenHash: hashToken(token), leadId, expiresAt: new Date(now.getTime() + CUSTOMER_SESSION_TTL_MS) },
    }),
    db.lead.update({ where: { id: leadId }, data: { lastLoginAt: now } }),
  ]);
  logEvent("customer.login", { leadId });
  return token;
}

// ---------------------------------------------------------------- cookie-bound API

/** Logged-in customer (Lead) from the cookie, or null. */
export async function getCurrentCustomer(): Promise<Lead | null> {
  const store = await cookies();
  return resolveCustomerToken(store.get(CUSTOMER_COOKIE)?.value);
}

/** Like getCurrentCustomer but throws ApiException(401, "UNAUTHORIZED"). */
export async function requireCustomer(): Promise<Lead> {
  const lead = await getCurrentCustomer();
  if (!lead) throw new ApiException(401, "UNAUTHORIZED", "Please log in.");
  return lead;
}

/** Issues the customer cookie (30 days) for a verified lead. Route-handler context only. */
export async function startCustomerSession(leadId: string): Promise<void> {
  const store = await cookies();
  // Replace any previous login on this device.
  const previous = store.get(CUSTOMER_COOKIE)?.value;
  if (previous) await db.customerSession.deleteMany({ where: { tokenHash: hashToken(previous) } });
  const token = await createCustomerSessionToken(leadId);
  store.set(CUSTOMER_COOKIE, token, cookieOptions());
}

export async function logoutCustomer(): Promise<void> {
  const store = await cookies();
  const token = store.get(CUSTOMER_COOKIE)?.value;
  if (token) await db.customerSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  store.delete({ name: CUSTOMER_COOKIE, path: "/" });
}

// ---------------------------------------------------------------- accounts

/** "Rahul Sharma" → "RAHUL"; non-Latin or empty names → "CLIENT". */
export function clientCodePrefix(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const letters = first
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 10);
  return letters || "CLIENT";
}

export async function freeClientCode(tx: Tx, fullName: string | null | undefined): Promise<string> {
  const prefix = clientCodePrefix(fullName);
  for (let attempt = 0; attempt < 30; attempt++) {
    // Four digits normally; widen only if a very common name has filled up.
    const digits = attempt < 20 ? 4 : 6;
    const code = `${prefix}-${String(randomInt(0, 10 ** digits)).padStart(digits, "0")}`;
    const taken = await tx.lead.findUnique({ where: { clientCode: code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new Error("Could not allocate a client code");
}

/**
 * Name change from /account. The email is the account and is never changed here: an address can
 * only be attached by confirming a code sent to it (docs/FLOW.md), otherwise a logged-in user could
 * claim someone else's email and later see their bookings.
 */
export async function updateProfile(lead: Lead, input: { fullName?: string }): Promise<Lead> {
  const fullName = input.fullName?.trim() || null;
  if (!fullName || fullName === lead.fullName) return lead;
  const updated = await db.$transaction(async (tx) => {
    const renameCode = !lead.clientCode || (lead.clientCode.startsWith("CLIENT-") && clientCodePrefix(fullName) !== "CLIENT");
    return tx.lead.update({
      where: { id: lead.id },
      data: { fullName, ...(renameCode ? { clientCode: await freeClientCode(tx, fullName) } : {}) },
    });
  }, TX_OPTIONS);
  logEvent("customer.profile_updated", { leadId: lead.id });
  return updated;
}

export function toAccountSummary(lead: Lead): AccountSummary {
  return { clientCode: lead.clientCode ?? "", fullName: lead.fullName, phoneE164: lead.phoneE164, email: lead.email };
}
