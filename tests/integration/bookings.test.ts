import { randomUUID } from "crypto";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/server/db";

// Other modules are owned by other agents; keep these tests independent of their progress.
vi.mock("@/lib/server/notifications", () => ({
  enqueueBookingEvent: vi.fn(async () => {}),
  kickNotifications: vi.fn(() => {}),
}));
vi.mock("@/lib/server/booking-session", () => ({
  attachBookingToSession: vi.fn(async (tx: Tx, sessionId: string, bookingId: string) => {
    await tx.bookingSession.update({ where: { id: sessionId }, data: { bookingId } });
  }),
}));

import { db } from "@/lib/server/db";
import { ApiException } from "@/lib/server/http";
import { enqueueBookingEvent } from "@/lib/server/notifications";
import {
  cancelBooking,
  createBookingFromSession,
  getBookingByManageToken,
  manageTokenFor,
  rescheduleBooking,
  toBookingView,
} from "@/lib/server/bookings/service";
import { getAvailableSlots } from "@/lib/server/scheduling/availability";
import { resetDb, seedSchedule } from "../helpers/db";

let phoneCounter = 0;
async function makeSession(over: Record<string, unknown> = {}) {
  phoneCounter++;
  return db.bookingSession.create({
    data: {
      tokenHash: randomUUID(),
      phoneE164: `+9198765${String(43210 + phoneCounter).padStart(5, "0")}`,
      fullName: "Test Person",
      email: `person${phoneCounter}@example.com`,
      pendingEmail: `person${phoneCounter}@example.com`,
      emailVerifiedAt: new Date(),
      source: "manychat",
      campaign: "fit_reel",
      expiresAt: new Date(Date.now() + 3_600_000),
      ...over,
    },
  });
}

async function pickSlot(index = 3) {
  const { slots } = await getAvailableSlots();
  expect(slots.length).toBeGreaterThan(index);
  return slots[index]!.start;
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return "OK";
  } catch (err) {
    if (err instanceof ApiException) return err.code;
    throw err;
  }
}

beforeEach(async () => {
  await resetDb();
  await seedSchedule();
  vi.mocked(enqueueBookingEvent).mockClear();
});

describe("createBookingFromSession", () => {
  it("creates a booking, lead and attaches it to the session", async () => {
    const session = await makeSession();
    const start = await pickSlot();
    const b = await createBookingFromSession({
      session,
      start,
      customerTimeZone: "Asia/Kolkata",
      idempotencyKey: randomUUID(),
    });
    expect(b.reference).toMatch(/^CSS-[A-Z2-9]{6}$/);
    expect(b.startsAt.getTime()).toBe(start.getTime());
    expect(b.endsAt.getTime() - start.getTime()).toBe(30 * 60_000);
    expect(b.blockedUntil.getTime() - b.endsAt.getTime()).toBe(15 * 60_000);
    expect(b.status).toBe("CONFIRMED");
    expect(b.lead.phoneE164).toBe(session.phoneE164);
    expect(b.source).toBe("manychat");
    const s = await db.bookingSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.bookingId).toBe(b.id);
    expect(enqueueBookingEvent).toHaveBeenCalledWith(expect.anything(), b.id, "confirmed");
    const view = await toBookingView(b);
    expect(view.manageUrl).toMatch(/^http:\/\/localhost:3000\/booking\/manage\//);
  });

  it("is idempotent on idempotencyKey", async () => {
    const session = await makeSession();
    const start = await pickSlot();
    const key = randomUUID();
    const a = await createBookingFromSession({ session, start, customerTimeZone: "Asia/Kolkata", idempotencyKey: key });
    // Stale session object (bookingId not yet set) and refreshed one both return the same booking.
    const b = await createBookingFromSession({ session, start, customerTimeZone: "Asia/Kolkata", idempotencyKey: key });
    const fresh = await db.bookingSession.findUniqueOrThrow({ where: { id: session.id } });
    const c = await createBookingFromSession({ session: fresh, start, customerTimeZone: "Asia/Kolkata", idempotencyKey: key });
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(await db.booking.count()).toBe(1);
    expect(await db.lead.count()).toBe(1);
    expect(enqueueBookingEvent).toHaveBeenCalledTimes(1);
    // Same session, new key → ALREADY_BOOKED.
    expect(
      await codeOf(createBookingFromSession({ session: fresh, start, customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() })),
    ).toBe("ALREADY_BOOKED");
  });

  it("rejects a second session booking the same slot", async () => {
    const start = await pickSlot();
    await createBookingFromSession({ session: await makeSession(), start, customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() });
    const code = await codeOf(
      createBookingFromSession({ session: await makeSession(), start, customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() }),
    );
    // Sequentially the slot has already left availability; under a race the DB constraint answers SLOT_TAKEN.
    expect(["SLOT_TAKEN", "SLOT_UNAVAILABLE"]).toContain(code);
    // The neighbouring slot (start + 30 min) is blocked by the 15-minute buffer too.
    const next = new Date(start.getTime() + 30 * 60_000);
    expect(
      await codeOf(createBookingFromSession({ session: await makeSession(), start: next, customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() })),
    ).toBe("SLOT_UNAVAILABLE");
    expect(await db.booking.count()).toBe(1);
  });

  it("10 concurrent sessions for one slot → exactly one booking", async () => {
    const start = await pickSlot();
    const sessions = await Promise.all(Array.from({ length: 10 }, () => makeSession()));
    const results = await Promise.allSettled(
      sessions.map((session) =>
        createBookingFromSession({ session, start, customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(ApiException);
      expect(["SLOT_TAKEN", "SLOT_UNAVAILABLE"]).toContain((f.reason as ApiException).code);
    }
    // Losers see SLOT_TAKEN (raced at the database) or SLOT_UNAVAILABLE (checked after the winner
    // committed); both are correct. What must never happen: a 500, or a second booking.
    expect(await db.booking.count()).toBe(1);
  }, 30_000);

  it("two devices of one account pressing Book at once get one call, not two", async () => {
    const email = "twodevices@example.com";
    const [a, b] = await Promise.all([makeSession({ email }), makeSession({ email })]);
    const results = await Promise.allSettled([
      createBookingFromSession({ session: a, start: await pickSlot(2), customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() }),
      createBookingFromSession({ session: b, start: await pickSlot(8), customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect((failed.reason as ApiException).code).toBe("ALREADY_BOOKED");
    expect(await db.booking.count()).toBe(1);
  }); // ten racing transactions: slow when the whole suite runs in parallel

  it("requires a confirmed email and a phone number", async () => {
    const start = await pickSlot();
    const unverified = await makeSession({ emailVerifiedAt: null });
    expect(
      await codeOf(createBookingFromSession({ session: unverified, start, customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() })),
    ).toBe("NOT_VERIFIED");
    const noPhone = await makeSession({ phoneE164: null });
    expect(
      await codeOf(createBookingFromSession({ session: noPhone, start, customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() })),
    ).toBe("VALIDATION");
    expect(await db.booking.count()).toBe(0);
  });

  it("allows one upcoming call per account; a returning visitor must reschedule instead", async () => {
    const email = "same@example.com";
    const first = await makeSession({ email });
    await createBookingFromSession({ session: first, start: await pickSlot(2), customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() });
    const second = await makeSession({ email }); // same person, new browser session
    expect(
      await codeOf(createBookingFromSession({ session: second, start: await pickSlot(6), customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() })),
    ).toBe("ALREADY_BOOKED");
    expect(await db.booking.count()).toBe(1);
  });

  it("does not wipe a name the team entered when the lead books again later", async () => {
    const email = "again@example.com";
    const s1 = await makeSession({ email, fullName: null });
    const b1 = await createBookingFromSession({ session: s1, start: await pickSlot(2), customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() });
    await db.lead.update({ where: { id: b1.leadId }, data: { fullName: "Named By Sales" } });
    await cancelBooking({ bookingId: b1.id, actor: { by: "customer" } });
    const s2 = await makeSession({ email, fullName: null });
    const b2 = await createBookingFromSession({ session: s2, start: await pickSlot(8), customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() });
    expect(b2.lead.fullName).toBe("Named By Sales");
  });

  it("rejects a start that isn't an offered slot", async () => {
    const start = new Date((await pickSlot()).getTime() + 7 * 60_000);
    expect(
      await codeOf(createBookingFromSession({ session: await makeSession(), start, customerTimeZone: "Asia/Kolkata", idempotencyKey: randomUUID() })),
    ).toBe("SLOT_UNAVAILABLE");
  });

  it("round-trips time zones: stores customerTimeZone, UTC instants exact", async () => {
    const slot = await pickSlot(5);
    // The browser sends the chosen slot with its local offset.
    const laIso = DateTime.fromJSDate(slot, { zone: "America/Los_Angeles" }).toISO()!;
    const b = await createBookingFromSession({
      session: await makeSession(),
      start: new Date(laIso),
      customerTimeZone: "America/Los_Angeles",
      idempotencyKey: randomUUID(),
    });
    const stored = await db.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(stored.customerTimeZone).toBe("America/Los_Angeles");
    expect(stored.startsAt.toISOString()).toBe(slot.toISOString());
    const view = await toBookingView(b);
    expect(view.start).toBe(slot.toISOString());
    expect(view.customerTimeZone).toBe("America/Los_Angeles");
  });
});

describe("cancel / reschedule", () => {
  async function book(index = 3) {
    const start = await pickSlot(index);
    const b = await createBookingFromSession({
      session: await makeSession(),
      start,
      customerTimeZone: "Asia/Kolkata",
      idempotencyKey: randomUUID(),
    });
    return { b, start };
  }

  it("cancel frees the slot", async () => {
    const { b, start } = await book();
    const before = await getAvailableSlots();
    expect(before.slots.some((s) => s.start.getTime() === start.getTime())).toBe(false);

    const c = await cancelBooking({ bookingId: b.id, actor: { by: "customer" }, reason: "Clash" });
    expect(c.status).toBe("CANCELLED");
    expect(c.cancelledAt).toBeInstanceOf(Date);
    expect(c.cancelReason).toBe("Clash");
    expect(enqueueBookingEvent).toHaveBeenLastCalledWith(expect.anything(), b.id, "cancelled");
    expect((await toBookingView(c)).manageUrl).toBeNull();

    const after = await getAvailableSlots();
    expect(after.slots.some((s) => s.start.getTime() === start.getTime())).toBe(true);
    const again = await createBookingFromSession({
      session: await makeSession(),
      start,
      customerTimeZone: "Asia/Kolkata",
      idempotencyKey: randomUUID(),
    });
    expect(again.id).not.toBe(b.id);
    // Cancelling twice is refused.
    expect(await codeOf(cancelBooking({ bookingId: b.id, actor: { by: "customer" } }))).toBe("TOO_LATE_TO_CHANGE");
  });

  it("reschedule bumps version, invalidates the old manage token and frees the old slot", async () => {
    const { b, start } = await book();
    const oldToken = manageTokenFor(b);
    expect((await getBookingByManageToken(oldToken))?.id).toBe(b.id);

    // Moving by 30 min overlaps the booking's own block — allowed because it's excluded.
    const newStart = new Date(start.getTime() + 30 * 60_000);
    const r = await rescheduleBooking({
      bookingId: b.id,
      start: newStart,
      customerTimeZone: "Europe/London",
      actor: { by: "customer" },
    });
    expect(r.version).toBe(2);
    expect(r.startsAt.getTime()).toBe(newStart.getTime());
    expect(r.endsAt.getTime()).toBe(newStart.getTime() + 30 * 60_000);
    expect(r.blockedUntil.getTime()).toBe(newStart.getTime() + 45 * 60_000);
    expect(r.customerTimeZone).toBe("Europe/London");
    expect(r.rescheduledAt).toBeInstanceOf(Date);
    expect(enqueueBookingEvent).toHaveBeenLastCalledWith(expect.anything(), b.id, "rescheduled");

    expect(await getBookingByManageToken(oldToken)).toBeNull();
    expect((await getBookingByManageToken(manageTokenFor(r)))?.id).toBe(b.id);
    expect((await getAvailableSlots()).slots.map((s) => s.start.getTime())).not.toContain(newStart.getTime());

    // Move again, far away: the original time becomes bookable again.
    const far = await pickSlot(12);
    const r2 = await rescheduleBooking({ bookingId: b.id, start: far, actor: { by: "customer" } });
    expect(r2.version).toBe(3);
    expect(await getBookingByManageToken(manageTokenFor(r))).toBeNull();
    const slots = (await getAvailableSlots()).slots.map((s) => s.start.getTime());
    expect(slots).toContain(start.getTime());
    expect(slots).toContain(newStart.getTime());
    expect(slots).not.toContain(far.getTime());
  });

  it("reschedule into a taken slot is refused", async () => {
    const { b } = await book(3);
    const { b: other } = await book(10);
    expect(
      await codeOf(rescheduleBooking({ bookingId: b.id, start: other.startsAt, actor: { by: "customer" } })),
    ).toBe("SLOT_UNAVAILABLE");
  });

  it("enforces the customer cutoff; admins can still change", async () => {
    const { b } = await book();
    await db.settings.update({ where: { id: 1 }, data: { manageCutoffMinutes: 60 * 24 * 60 } });
    expect(await codeOf(cancelBooking({ bookingId: b.id, actor: { by: "customer" } }))).toBe("TOO_LATE_TO_CHANGE");
    const target = await pickSlot(12);
    expect(await codeOf(rescheduleBooking({ bookingId: b.id, start: target, actor: { by: "customer" } }))).toBe(
      "TOO_LATE_TO_CHANGE",
    );
    expect((await toBookingView(b)).manageUrl).toBeNull();
    const moved = await rescheduleBooking({ bookingId: b.id, start: target, actor: { by: "admin", adminUserId: "a1" } });
    expect(moved.version).toBe(2);
  });

  it("rejects tampered manage tokens", async () => {
    const { b } = await book();
    const token = manageTokenFor(b);
    const forged = Buffer.from(`${b.id}.1`).toString("base64url") + "." + "0".repeat(32);
    expect(await getBookingByManageToken(forged)).toBeNull();
    expect(await getBookingByManageToken(token.slice(0, -1) + (token.endsWith("a") ? "b" : "a"))).toBeNull();
    expect(await getBookingByManageToken("garbage")).toBeNull();
  });
});
