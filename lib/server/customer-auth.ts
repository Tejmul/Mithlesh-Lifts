import "server-only";
// Customer accounts (account = Lead, identified by a verified phone).
// The httpOnly cookie holds only a random token; the DB stores hashToken(token) in CustomerSession.
import { randomInt } from "crypto";
import { cookies } from "next/headers";
import type { Lead } from "@/generated/prisma/client";
import type { AccountSummary } from "@/lib/shared/api";
import { hashToken, randomToken } from "./crypto";
import { db, TX_OPTIONS, type Tx } from "./db";
import { env } from "./env";
import { ApiException } from "./http";
import { enqueueBookingEvent, kickNotifications } from "./notifications";
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

async function freeClientCode(tx: Tx, fullName: string | null | undefined): Promise<string> {
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

/** Find-or-create the account for a verified phone; assigns clientCode (e.g. "RAHUL-4821"). */
export async function upsertAccount(
  tx: Tx,
  input: {
    phoneE164: string;
    fullName?: string | null;
    source?: string | null;
    campaign?: string | null;
    manychatSubscriberId?: string | null;
  },
): Promise<Lead> {
  const now = new Date();
  const fullName = input.fullName?.trim() || null;
  const existing = await tx.lead.findUnique({ where: { phoneE164: input.phoneE164 } });

  if (!existing) {
    return tx.lead.create({
      data: {
        phoneE164: input.phoneE164,
        phoneVerifiedAt: now,
        fullName,
        source: input.source ?? null,
        campaign: input.campaign ?? null,
        manychatSubscriberId: input.manychatSubscriberId ?? null,
        clientCode: await freeClientCode(tx, fullName),
      },
    });
  }

  const nameToSet = !existing.fullName?.trim() && fullName ? fullName : null;
  return tx.lead.update({
    where: { id: existing.id },
    data: {
      phoneVerifiedAt: now,
      ...(nameToSet ? { fullName: nameToSet } : {}),
      // First touch wins for tracking labels.
      ...(!existing.source && input.source ? { source: input.source } : {}),
      ...(!existing.campaign && input.campaign ? { campaign: input.campaign } : {}),
      ...(!existing.manychatSubscriberId && input.manychatSubscriberId
        ? { manychatSubscriberId: input.manychatSubscriberId }
        : {}),
      // Accounts start nameless ("CLIENT-1234"); the first real name gives them a proper code.
      ...(!existing.clientCode || (nameToSet && existing.clientCode.startsWith("CLIENT-") && clientCodePrefix(nameToSet) !== "CLIENT")
        ? { clientCode: await freeClientCode(tx, existing.fullName?.trim() || fullName) }
        : {}),
    },
  });
}

/**
 * Optional name + email, asked on /account after booking. A new email also gets the booking
 * confirmation + reminders for the upcoming call (they were skipped while we had no address).
 */
export async function updateProfile(lead: Lead, input: { fullName?: string; email?: string }): Promise<Lead> {
  const fullName = input.fullName?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;
  const emailChanged = email !== null && email !== lead.email;
  const updated = await db.$transaction(async (tx) => {
    let next = lead;
    if (fullName && fullName !== lead.fullName) {
      const renameCode = !lead.clientCode || (lead.clientCode.startsWith("CLIENT-") && clientCodePrefix(fullName) !== "CLIENT");
      next = await tx.lead.update({
        where: { id: lead.id },
        data: { fullName, ...(renameCode ? { clientCode: await freeClientCode(tx, fullName) } : {}) },
      });
    }
    if (emailChanged) {
      next = await tx.lead.update({ where: { id: lead.id }, data: { email } });
      const upcoming = await tx.booking.findFirst({
        where: { leadId: lead.id, status: "CONFIRMED", startsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
        select: { id: true },
      });
      if (upcoming) await enqueueBookingEvent(tx, upcoming.id, "confirmed");
    }
    return next;
  }, TX_OPTIONS);
  if (emailChanged) kickNotifications();
  logEvent("customer.profile_updated", { leadId: lead.id, name: Boolean(fullName), email: emailChanged });
  return updated;
}

export function toAccountSummary(lead: Lead): AccountSummary {
  return { clientCode: lead.clientCode ?? "", fullName: lead.fullName, phoneE164: lead.phoneE164, email: lead.email };
}
