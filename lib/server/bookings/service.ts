import "server-only";
// OWNER: Agent B.
import { DateTime } from "luxon";
import type { Booking, BookingSession, Lead, Prisma } from "@/generated/prisma/client";
import type { BookingView } from "@/lib/shared/api";
import { attachBookingToSession } from "../booking-session";
import { bookingReference, hmac, safeEqual } from "../crypto";
import { db, TX_OPTIONS, isConstraintViolation, isTransactionConflict, isTransactionTimeout } from "../db";
import { freeClientCode } from "../customer-auth";
import { env } from "../env";
import { ApiException } from "../http";
import { addInboxItem } from "../inbox";
import { enqueueBookingEvent, kickNotifications } from "../notifications";
import { logEvent, reportError } from "../observability";
import { getAvailableSlots } from "../scheduling/availability";
import { getSettings } from "../settings";

export type BookingWithLead = Booking & { lead: Lead };
export type Actor = { by: "customer" } | { by: "admin"; adminUserId: string };

const SLOT_UNAVAILABLE_MSG = "That time is no longer available. Pick another.";
const SLOT_TAKEN_MSG = "Someone just booked that time. Pick another slot.";
const MAX_REFERENCE_ATTEMPTS = 5;

function slotTaken() {
  return new ApiException(409, "SLOT_TAKEN", SLOT_TAKEN_MSG);
}

function safeKick() {
  try {
    kickNotifications();
  } catch (err) {
    reportError(err, { where: "bookings.kickNotifications" });
  }
}

async function isOfferedSlot(start: Date, excludeBookingId?: string) {
  const { slots } = await getAvailableSlots({
    from: start,
    to: new Date(start.getTime() + 1),
    excludeBookingId,
  });
  return slots.some((s) => s.start.getTime() === start.getTime());
}

function p2002Targets(err: unknown): string {
  const meta = (err as { meta?: unknown })?.meta;
  try {
    return JSON.stringify(meta ?? "") + String((err as { message?: string })?.message ?? "");
  } catch {
    return "";
  }
}

/**
 * One transaction: re-check session (email verified, not already booked, no other upcoming call
 * for this account),
 * re-check the slot against live availability, upsert Lead by email, insert Booking (the DB
 * exclusion constraint is the final guard → SLOT_TAKEN), attach to session, enqueue emails.
 * Idempotent on idempotencyKey (same key → same booking, no duplicate emails).
 * Throws ApiException: NOT_VERIFIED, SLOT_TAKEN, SLOT_UNAVAILABLE, ALREADY_BOOKED.
 */
export async function createBookingFromSession(input: {
  session: BookingSession;
  start: Date;
  customerTimeZone: string;
  idempotencyKey: string;
}): Promise<BookingWithLead> {
  const { session, start, customerTimeZone, idempotencyKey } = input;

  const existingForKey = () => db.booking.findUnique({ where: { idempotencyKey }, include: { lead: true } });
  const ownedBySession = (b: BookingWithLead) => b.id === session.bookingId || (session.email !== null && b.lead.email === session.email);

  if (session.bookingId) {
    const b = await existingForKey();
    if (b && b.id === session.bookingId) return b;
    throw new ApiException(409, "ALREADY_BOOKED", "You've already booked a call.");
  }

  const prior = await existingForKey();
  if (prior) {
    if (ownedBySession(prior)) return prior;
    throw new ApiException(409, "ALREADY_BOOKED", "You've already booked a call.");
  }

  if (!session.emailVerifiedAt || !session.email) {
    throw new ApiException(403, "NOT_VERIFIED", "Confirm your email first.");
  }
  if (!session.phoneE164) {
    throw new ApiException(422, "VALIDATION", "Add your mobile number so our team can call you.", {
      phone: "Enter your mobile number.",
    });
  }
  const email = session.email;
  const phoneE164 = session.phoneE164;
  const emailVerifiedAt = session.emailVerifiedAt;

  if (Number.isNaN(start.getTime()) || !(await isOfferedSlot(start))) {
    throw new ApiException(409, "SLOT_UNAVAILABLE", SLOT_UNAVAILABLE_MSG);
  }

  const settings = await getSettings();
  const endsAt = new Date(start.getTime() + settings.callMinutes * 60_000);
  const blockedUntil = new Date(endsAt.getTime() + settings.bufferMinutes * 60_000);

  let booking: BookingWithLead | undefined;
  for (let attempt = 1; !booking; attempt++) {
    try {
      booking = await db.$transaction(async (tx) => {
        // Lock the session row so two confirms from one session can't both book.
        const locked = await tx.$queryRaw<{ bookingId: string | null }[]>`
          SELECT "bookingId" FROM "BookingSession" WHERE "id" = ${session.id} FOR UPDATE`;
        if (!locked[0]) throw new ApiException(401, "SESSION_EXPIRED", "Your session expired. Please start again.");
        if (locked[0].bookingId) {
          const already = await tx.booking.findUnique({ where: { id: locked[0].bookingId }, include: { lead: true } });
          if (already && already.idempotencyKey === idempotencyKey) return already;
          throw new ApiException(409, "ALREADY_BOOKED", "You've already booked a call.");
        }

        // Queue concurrent attempts instead of letting them collide: per account (two devices pressing
        // Book at once can't both pass the one-call check) and per start time (racers for the same
        // slot wait for the winner, then get SLOT_TAKEN from the overlap guard, never a deadlock).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:email:${email}`}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:slot:${start.toISOString()}`}))`;

        // One upcoming call per account: a returning visitor reschedules instead of double-booking.
        const upcoming = await tx.booking.findFirst({
          where: { lead: { email }, status: "CONFIRMED", startsAt: { gt: new Date() } },
          select: { id: true },
        });
        if (upcoming) throw new ApiException(409, "ALREADY_BOOKED", "You already have a call booked. Reschedule it instead.");

        // The account exists already (created when the email was confirmed). Only fill gaps: never drop
        // a name the team entered, and the first ManyChat campaign / consent stay as recorded.
        const existing = await tx.lead.findUnique({ where: { email } });
        const lead = existing
          ? await tx.lead.update({
              where: { id: existing.id },
              data: {
                phoneE164,
                emailVerifiedAt,
                ...(!existing.fullName?.trim() && session.fullName ? { fullName: session.fullName } : {}),
                ...(!existing.source && session.source ? { source: session.source } : {}),
                ...(!existing.campaign && session.campaign ? { campaign: session.campaign } : {}),
                ...(!existing.manychatSubscriberId && session.manychatSubscriberId
                  ? { manychatSubscriberId: session.manychatSubscriberId }
                  : {}),
                ...(session.marketingConsent && !existing.marketingConsentAt ? { marketingConsentAt: new Date() } : {}),
              },
            })
          : await tx.lead.create({
              data: {
                email,
                phoneE164,
                emailVerifiedAt,
                fullName: session.fullName,
                source: session.source,
                campaign: session.campaign,
                manychatSubscriberId: session.manychatSubscriberId,
                marketingConsentAt: session.marketingConsent ? new Date() : null,
                clientCode: await freeClientCode(tx, session.fullName),
              },
            });

        const created = await tx.booking.create({
          data: {
            reference: bookingReference(),
            leadId: lead.id,
            startsAt: start,
            endsAt,
            blockedUntil,
            customerTimeZone,
            meetingUrl: settings.meetingUrl,
            idempotencyKey,
            source: session.source,
            campaign: session.campaign,
          },
          include: { lead: true },
        });
        await attachBookingToSession(tx, session.id, created.id);
        await enqueueBookingEvent(tx, created.id, "confirmed");
        await addInboxItem(tx, {
          leadId: lead.id,
          kind: "booking_confirmed",
          title: "Your call is booked",
          body: `Our sales team will call you on ${formatCallTime(created)}.`,
          bookingId: created.id,
        });
        return created;
      }, TX_OPTIONS);
    } catch (err) {
      if (err instanceof ApiException) throw err;
      if (isConstraintViolation(err, "23P01")) throw slotTaken();
      // Deadlock / serialization failure between racers for overlapping slots: someone else won.
      if (isTransactionConflict(err)) throw slotTaken();
      // Couldn't get a transaction in time (very busy): ask to retry instead of a bare 500.
      if (isTransactionTimeout(err)) {
        throw new ApiException(503, "INTERNAL", "We're very busy right now. Please tap Book again in a moment.");
      }
      if (isConstraintViolation(err, "P2002")) {
        const again = await existingForKey();
        if (again) {
          if (ownedBySession(again)) return again;
          throw new ApiException(409, "ALREADY_BOOKED", "You've already booked a call.");
        }
        // Booking reference collision: retry with a fresh reference.
        if (p2002Targets(err).includes("reference") && attempt < MAX_REFERENCE_ATTEMPTS) continue;
      }
      throw err;
    }
  }

  logEvent("booking.created", { bookingId: booking.id });
  safeKick();
  return booking;
}

/** "Tue 21 Oct at 10:00 AM (IST)" in the customer's time zone. */
export function formatCallTime(booking: Pick<Booking, "startsAt" | "customerTimeZone">): string {
  let dt = DateTime.fromJSDate(booking.startsAt).setZone(booking.customerTimeZone);
  if (!dt.isValid) dt = DateTime.fromJSDate(booking.startsAt).setZone("Asia/Kolkata");
  const names = [dt.setLocale("en-IN").offsetNameShort, dt.setLocale("en-US").offsetNameShort].filter(
    (n): n is string => Boolean(n),
  );
  const zone = names.find((n) => !n.startsWith("GMT") && !n.startsWith("UTC")) ?? names[0] ?? "";
  const when = `${dt.setLocale("en-GB").toFormat("ccc d LLL")} at ${dt.setLocale("en-US").toFormat("h:mm a")}`;
  return zone ? `${when} (${zone})` : when;
}

/** The account's next confirmed call, if any — shown to returning visitors after they verify. */
export async function findUpcomingBookingForEmail(email: string): Promise<BookingWithLead | null> {
  return findUpcomingBooking({ lead: { email } });
}

export async function findUpcomingBookingForLead(leadId: string): Promise<BookingWithLead | null> {
  return findUpcomingBooking({ leadId });
}

async function findUpcomingBooking(where: Prisma.BookingWhereInput): Promise<BookingWithLead | null> {
  return db.booking.findFirst({
    where: { ...where, status: "CONFIRMED", startsAt: { gt: new Date() } },
    orderBy: { startsAt: "asc" },
    include: { lead: true },
  });
}

function assertCustomerCanChange(booking: Booking, actor: Actor, cutoffMinutes: number, now = new Date()) {
  if (booking.status !== "CONFIRMED") {
    throw new ApiException(409, "TOO_LATE_TO_CHANGE", "This booking can no longer be changed.");
  }
  if (actor.by === "customer" && now.getTime() > booking.startsAt.getTime() - cutoffMinutes * 60_000) {
    throw new ApiException(
      409,
      "TOO_LATE_TO_CHANGE",
      "It's too close to the call to change it online. Message us on Instagram and our team will help.",
    );
  }
}

async function loadBooking(bookingId: string): Promise<BookingWithLead> {
  const booking = await db.booking.findUnique({ where: { id: bookingId }, include: { lead: true } });
  if (!booking) throw new ApiException(404, "NOT_FOUND", "Booking not found.");
  return booking;
}

const staleLink = () => new ApiException(404, "NOT_FOUND", "This link is no longer valid.");

export async function cancelBooking(input: { bookingId: string; actor: Actor; reason?: string }): Promise<BookingWithLead> {
  const booking = await loadBooking(input.bookingId);
  const settings = await getSettings();
  assertCustomerCanChange(booking, input.actor, settings.manageCutoffMinutes);

  const updated = await db.$transaction(async (tx) => {
    const res = await tx.booking.updateMany({
      where: { id: booking.id, version: booking.version, status: "CONFIRMED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason?.trim() || null },
    });
    if (res.count !== 1) throw staleLink();
    await enqueueBookingEvent(tx, booking.id, "cancelled");
    await addInboxItem(tx, {
      leadId: booking.leadId,
      kind: "booking_cancelled",
      title: "Your call was cancelled",
      body: `Your call on ${formatCallTime(booking)} was cancelled. Book a new time whenever you're ready.`,
      bookingId: booking.id,
    });
    return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { lead: true } });
  }, TX_OPTIONS);

  logEvent("booking.cancelled", { bookingId: booking.id, by: input.actor.by });
  safeKick();
  return updated;
}

export async function rescheduleBooking(input: {
  bookingId: string;
  start: Date;
  customerTimeZone?: string;
  actor: Actor;
}): Promise<BookingWithLead> {
  const booking = await loadBooking(input.bookingId);
  const settings = await getSettings();
  assertCustomerCanChange(booking, input.actor, settings.manageCutoffMinutes);

  if (Number.isNaN(input.start.getTime()) || !(await isOfferedSlot(input.start, booking.id))) {
    throw new ApiException(409, "SLOT_UNAVAILABLE", SLOT_UNAVAILABLE_MSG);
  }
  const endsAt = new Date(input.start.getTime() + settings.callMinutes * 60_000);
  const blockedUntil = new Date(endsAt.getTime() + settings.bufferMinutes * 60_000);

  let updated: BookingWithLead;
  try {
    updated = await db.$transaction(async (tx) => {
      const res = await tx.booking.updateMany({
        where: { id: booking.id, version: booking.version, status: "CONFIRMED" },
        data: {
          startsAt: input.start,
          endsAt,
          blockedUntil,
          ...(input.customerTimeZone ? { customerTimeZone: input.customerTimeZone } : {}),
          version: { increment: 1 },
          rescheduledAt: new Date(),
        },
      });
      if (res.count !== 1) throw staleLink();
      await enqueueBookingEvent(tx, booking.id, "rescheduled");
      const moved = await tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { lead: true } });
      await addInboxItem(tx, {
        leadId: moved.leadId,
        kind: "booking_rescheduled",
        title: "Your call was moved",
        body: `Our sales team will now call you on ${formatCallTime(moved)}.`,
        bookingId: moved.id,
      });
      return moved;
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof ApiException) throw err;
    if (isConstraintViolation(err, "23P01")) throw slotTaken();
    throw err;
  }

  logEvent("booking.rescheduled", { bookingId: booking.id, by: input.actor.by });
  safeKick();
  return updated;
}

/** Admin-only status changes after the call. */
export async function setBookingStatus(input: {
  bookingId: string;
  status: "CONFIRMED" | "COMPLETED" | "NO_SHOW";
}): Promise<BookingWithLead> {
  // A cancelled call stays cancelled: reviving it would skip reminders and the one-call rule and
  // re-enable old manage links. Book a new call for the client instead.
  const current = await db.booking.findUnique({ where: { id: input.bookingId }, select: { status: true } });
  if (!current) throw new ApiException(404, "NOT_FOUND", "Booking not found.");
  if (current.status === "CANCELLED") {
    throw new ApiException(409, "BAD_REQUEST", "This call was cancelled and can't be changed. Book a new call for the client instead.");
  }
  try {
    return await db.booking.update({
      where: { id: input.bookingId, status: { not: "CANCELLED" } },
      data: { status: input.status },
      include: { lead: true },
    });
  } catch (err) {
    if (isConstraintViolation(err, "23P01")) throw slotTaken();
    if ((err as { code?: string })?.code === "P2025") throw new ApiException(404, "NOT_FOUND", "Booking not found.");
    throw err;
  }
}

// ---------------------------------------------------------------- manage links

function manageSignature(id: string, version: number) {
  return hmac(`manage:${id}:${version}`).slice(0, 32);
}

/** HMAC-signed, version-bound token for /booking/manage/[token]. Not stored. */
export function manageTokenFor(booking: Pick<Booking, "id" | "version">): string {
  const payload = Buffer.from(`${booking.id}.${booking.version}`).toString("base64url");
  return `${payload}.${manageSignature(booking.id, booking.version)}`;
}

function parseManageToken(token: string): { id: string; version: number } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{32}$/.test(sig)) return null;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const m = /^([A-Za-z0-9_-]+)\.(\d{1,9})$/.exec(decoded);
  if (!m) return null;
  const id = m[1]!;
  const version = Number(m[2]);
  if (!safeEqual(sig, manageSignature(id, version))) return null;
  return { id, version };
}

/** Absolute manage URL, or null when cutoff passed / booking not CONFIRMED. */
export function manageUrlFor(booking: Booking, cutoffMinutes: number): string | null {
  if (booking.status !== "CONFIRMED") return null;
  if (Date.now() > booking.startsAt.getTime() - cutoffMinutes * 60_000) return null;
  return `${env().APP_URL}/booking/manage/${manageTokenFor(booking)}`;
}

/** Resolves a manage token, or null if invalid or stale (older version). */
export async function getBookingByManageToken(token: string): Promise<BookingWithLead | null> {
  const parsed = parseManageToken(token);
  if (!parsed) return null;
  const booking = await db.booking.findUnique({ where: { id: parsed.id }, include: { lead: true } });
  if (!booking || booking.version !== parsed.version) return null;
  return booking;
}

export async function toBookingView(booking: BookingWithLead): Promise<BookingView> {
  const settings = await getSettings();
  return {
    reference: booking.reference,
    start: booking.startsAt.toISOString(),
    end: booking.endsAt.toISOString(),
    customerTimeZone: booking.customerTimeZone,
    status: booking.status,
    meetingUrl: booking.meetingUrl,
    fullName: booking.lead.fullName,
    email: booking.lead.email,
    phoneE164: booking.lead.phoneE164,
    manageUrl: manageUrlFor(booking, settings.manageCutoffMinutes),
  };
}
