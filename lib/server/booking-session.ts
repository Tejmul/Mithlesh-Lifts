import "server-only";
// OWNER: Agent A. Server-side state for one visitor on /book.
// The httpOnly cookie holds only a random token; the DB stores hashToken(token).
import { cookies } from "next/headers";
import type { BookingSession } from "@/generated/prisma/client";
import type { BookingSessionView } from "@/lib/shared/api";
import { hashToken, randomToken } from "./crypto";
import { db, type Tx } from "./db";
import { env } from "./env";
import { ApiException } from "./http";
import { getSettings } from "./settings";

export const SESSION_COOKIE = "css_bs";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Only re-extend expiresAt when it has drifted this far, so reads don't write on every request. */
const SLIDE_THRESHOLD_MS = 5 * 60 * 1000;

export type Tracking = { source?: string; campaign?: string; mc?: string };

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

// ---------------------------------------------------------------- request-independent service functions

/** Loads the live session for a raw cookie token and slides its expiry. Null if missing/expired. */
export async function findLiveSession(token: string | undefined | null): Promise<BookingSession | null> {
  if (!token || token.length > 200) return null;
  const session = await db.bookingSession.findUnique({ where: { tokenHash: hashToken(token) } });
  const now = Date.now();
  if (!session || session.expiresAt.getTime() <= now) return null;
  if (session.expiresAt.getTime() < now + SESSION_TTL_MS - SLIDE_THRESHOLD_MS) {
    return db.bookingSession.update({ where: { id: session.id }, data: { expiresAt: new Date(now + SESSION_TTL_MS) } });
  }
  return session;
}

/**
 * Resumes the session for `token` (if live) or creates a new one. Tracking labels are only stored
 * when not already set, so the first ManyChat link that brought the visitor wins.
 * Returns the token the cookie should hold (new token when a session was created).
 */
export async function startSession(
  token: string | undefined | null,
  tracking: Tracking,
): Promise<{ session: BookingSession; token: string; created: boolean }> {
  const source = tracking.source || undefined;
  const campaign = tracking.campaign || undefined;
  const mc = tracking.mc || undefined;

  const existing = await findLiveSession(token);
  if (existing && token) {
    const data: { source?: string; campaign?: string; manychatSubscriberId?: string } = {};
    if (!existing.source && source) data.source = source;
    if (!existing.campaign && campaign) data.campaign = campaign;
    if (!existing.manychatSubscriberId && mc) data.manychatSubscriberId = mc;
    const session = Object.keys(data).length
      ? await db.bookingSession.update({ where: { id: existing.id }, data })
      : existing;
    return { session, token, created: false };
  }

  const newToken = randomToken();
  const session = await db.bookingSession.create({
    data: {
      tokenHash: hashToken(newToken),
      source: source ?? null,
      campaign: campaign ?? null,
      manychatSubscriberId: mc ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return { session, token: newToken, created: true };
}

// ---------------------------------------------------------------- cookie-bound API (route handlers / server components)

/** Loads the live (unexpired) session from the httpOnly cookie, or null. */
export async function getSessionFromCookies(): Promise<BookingSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const session = await findLiveSession(token);
  if (session && token) {
    // Slide the cookie too. Setting cookies is only allowed in route handlers / server functions;
    // in a server component this throws and we simply keep the existing cookie.
    try {
      store.set(SESSION_COOKIE, token, cookieOptions());
    } catch {
      /* read-only context */
    }
  }
  return session;
}

/** Like getSessionFromCookies but throws ApiException(401, "SESSION_EXPIRED"). */
export async function requireSession(): Promise<BookingSession> {
  const session = await getSessionFromCookies();
  if (!session) {
    throw new ApiException(401, "SESSION_EXPIRED", "Your session has expired. Please refresh the page to start again.");
  }
  return session;
}

/** Used by POST /api/booking/start: resumes the cookie's session or creates one, and sets the cookie. */
export async function createOrResumeSession(tracking: Tracking): Promise<BookingSession> {
  const store = await cookies();
  const { session, token } = await startSession(store.get(SESSION_COOKIE)?.value, tracking);
  store.set(SESSION_COOKIE, token, cookieOptions());
  return session;
}

export async function toSessionView(session: BookingSession): Promise<BookingSessionView> {
  const [settings, booking] = await Promise.all([
    getSettings(),
    session.bookingId
      ? db.booking.findUnique({ where: { id: session.bookingId }, select: { reference: true } })
      : Promise.resolve(null),
  ]);
  return {
    pendingPhoneE164: session.pendingPhoneE164,
    phoneE164: session.phoneE164,
    phoneVerified: Boolean(session.phoneVerifiedAt && session.phoneE164),
    fullName: session.fullName,
    email: session.email,
    callMinutes: settings.callMinutes,
    coachTimeZone: settings.coachTimeZone,
    bookingReference: booking?.reference ?? null,
    upcomingBooking: await upcomingFor(session),
  };
}

async function upcomingFor(session: BookingSession) {
  if (!session.phoneVerifiedAt || !session.phoneE164) return null;
  const { findUpcomingBookingForPhone, toBookingView } = await import("./bookings/service");
  const upcoming = await findUpcomingBookingForPhone(session.phoneE164);
  return upcoming ? toBookingView(upcoming) : null;
}

/** Called by the booking service inside its transaction once the booking exists. */
export async function attachBookingToSession(tx: Tx, sessionId: string, bookingId: string): Promise<void> {
  await tx.bookingSession.update({ where: { id: sessionId }, data: { bookingId } });
}
