import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/bookings/service", () => ({
  manageUrlFor: () => "http://localhost:3000/booking/manage/test",
}));
vi.mock("@/lib/server/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

import { db } from "@/lib/server/db";
import { clearOutbox, readOutbox } from "@/lib/server/dev-outbox";
import { sendEmail } from "@/lib/server/email";
import { enqueueBookingEvent, kickNotifications, processDueNotifications } from "@/lib/server/notifications";
import { resetDb } from "../helpers/db";

const sendMock = vi.mocked(sendEmail);
const HOUR = 3_600_000;
let seq = 0;

async function createBooking(opts: { startsInHours?: number; email?: string } = {}) {
  seq++;
  const startsAt = new Date(Date.now() + (opts.startsInHours ?? 48) * HOUR + seq * 2 * HOUR);
  const lead = await db.lead.create({
    data: {
      fullName: "Asha Rao",
      phoneE164: `+91987654${String(1000 + seq).slice(-4)}`,
      phoneVerifiedAt: new Date(),
      email: opts.email ?? "asha@example.com",
      source: "manychat",
      campaign: "fit_reel",
    },
  });
  return db.booking.create({
    data: {
      reference: `CSS-T${String(seq).padStart(5, "0")}`,
      leadId: lead.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      blockedUntil: new Date(startsAt.getTime() + 45 * 60_000),
      customerTimeZone: "Asia/Kolkata",
      idempotencyKey: `idem-${seq}-${Math.random()}`,
      source: "manychat",
      campaign: "fit_reel",
    },
  });
}

const enqueue = (bookingId: string, event: "confirmed" | "rescheduled" | "cancelled") =>
  db.$transaction((tx) => enqueueBookingEvent(tx, bookingId, event));

const rowsFor = (bookingId: string) => db.notification.findMany({ where: { bookingId }, orderBy: { sendAfter: "asc" } });

beforeEach(async () => {
  await resetDb();
  await db.settings.create({
    data: { id: 1, coachTimeZone: "Asia/Kolkata", teamNotificationEmails: ["team@example.com", "TEAM@example.com", "sales@example.com"] },
  });
  clearOutbox();
  sendMock.mockClear();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("enqueueBookingEvent", () => {
  it("writes customer, team and reminder rows, idempotently", async () => {
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    await enqueue(b.id, "confirmed");
    const rows = await rowsFor(b.id);
    const kinds = rows.map((r) => r.kind).sort();
    expect(kinds).toEqual(["booking_confirmed", "reminder", "reminder", "team_new_booking", "team_new_booking"]);
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);

    const reminders = rows.filter((r) => r.kind === "reminder");
    expect(reminders.map((r) => b.startsAt.getTime() - r.sendAfter.getTime()).sort((x, y) => x - y)).toEqual([60 * 60_000, 1440 * 60_000]);
    expect(reminders.map((r) => (r.payload as { offsetMinutes: number }).offsetMinutes).sort()).toEqual([1440, 60]);
    expect(rows.find((r) => r.kind === "booking_confirmed")!.idempotencyKey).toBe(`${b.id}:v1:booking_confirmed:asha@example.com`);
    // phone only stored on team rows
    expect((rows.find((r) => r.kind === "booking_confirmed")!.payload as Record<string, unknown>).phone).toBeUndefined();
    expect((rows.find((r) => r.kind === "team_new_booking")!.payload as Record<string, unknown>).phone).toBeDefined();
  });

  it("skips reminders whose time has passed", async () => {
    const b = await createBooking({ startsInHours: 3 });
    await enqueue(b.id, "confirmed");
    const reminders = (await rowsFor(b.id)).filter((r) => r.kind === "reminder");
    expect(reminders).toHaveLength(1);
    expect((reminders[0]!.payload as { offsetMinutes: number }).offsetMinutes).toBe(60);
  });

  it("reschedule cancels old reminders and creates new ones; cancel cancels all", async () => {
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    const newStart = new Date(b.startsAt.getTime() + 24 * HOUR);
    await db.booking.update({
      where: { id: b.id },
      data: { version: 2, startsAt: newStart, endsAt: new Date(newStart.getTime() + 30 * 60_000), blockedUntil: new Date(newStart.getTime() + 45 * 60_000) },
    });
    await enqueue(b.id, "rescheduled");
    await enqueue(b.id, "rescheduled"); // re-run must not cancel the v2 reminders
    let rows = await rowsFor(b.id);
    const v1Reminders = rows.filter((r) => r.kind === "reminder" && r.idempotencyKey.includes(":v1:"));
    const v2Reminders = rows.filter((r) => r.kind === "reminder" && r.idempotencyKey.includes(":v2:"));
    expect(v1Reminders.map((r) => r.status)).toEqual(["CANCELLED", "CANCELLED"]);
    expect(v2Reminders.map((r) => r.status)).toEqual(["PENDING", "PENDING"]);
    expect(rows.filter((r) => r.kind === "booking_rescheduled")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "team_booking_changed")).toHaveLength(2);

    await db.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await enqueue(b.id, "cancelled");
    rows = await rowsFor(b.id);
    expect(rows.filter((r) => r.kind === "reminder").every((r) => r.status === "CANCELLED")).toBe(true);
    expect(rows.filter((r) => r.kind === "booking_cancelled")).toHaveLength(1);
  });
});

describe("processDueNotifications", () => {
  it("sends due rows through the mock outbox, not future reminders", async () => {
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    const result = await processDueNotifications();
    expect(result).toEqual({ sent: 3, failed: 0, retried: 0 });

    const customer = readOutbox({ to: "asha@example.com" });
    expect(customer).toHaveLength(1);
    expect(customer[0]!.subject).toContain(b.reference);
    expect(customer[0]!.body).toContain("http://localhost:3000/booking/manage/test");
    expect(readOutbox({ to: "team@example.com" })).toHaveLength(1);
    expect(readOutbox({ to: "sales@example.com" })).toHaveLength(1);

    const rows = await rowsFor(b.id);
    expect(rows.filter((r) => r.status === "SENT").every((r) => r.sentAt && r.providerMessageId)).toBe(true);
    expect(rows.filter((r) => r.kind === "reminder").every((r) => r.status === "PENDING")).toBe(true);

    // Second run: nothing due.
    expect(await processDueNotifications()).toEqual({ sent: 0, failed: 0, retried: 0 });

    // 24h reminder becomes due.
    const at24 = new Date(b.startsAt.getTime() - 1440 * 60_000 + 1000);
    expect(await processDueNotifications({ now: at24 })).toEqual({ sent: 1, failed: 0, retried: 0 });
    const reminderMail = readOutbox({ to: "asha@example.com" }).at(-1)!;
    expect(reminderMail.subject).toContain("in 24 hours");

    const at1 = new Date(b.startsAt.getTime() - 60 * 60_000 + 1000);
    expect(await processDueNotifications({ now: at1 })).toEqual({ sent: 1, failed: 0, retried: 0 });
    expect(readOutbox({ to: "asha@example.com" }).at(-1)!.subject).toContain("in 1 hour");
  });

  it("does not send reminders or confirmations for a cancelled booking", async () => {
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    // Cancel at the DB level only (simulates a race before enqueue of the cancel event).
    await db.booking.update({ where: { id: b.id }, data: { status: "CANCELLED" } });
    const far = new Date(b.startsAt.getTime() - 30 * 60_000);
    const result = await processDueNotifications({ now: far });
    expect(result.sent).toBe(2); // team emails only
    expect(readOutbox({ to: "asha@example.com" })).toHaveLength(0);
    const rows = await rowsFor(b.id);
    expect(rows.filter((r) => r.kind === "reminder" || r.kind === "booking_confirmed").every((r) => r.status === "CANCELLED")).toBe(true);
  });

  it("skips stale-version customer rows", async () => {
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    await db.booking.update({ where: { id: b.id }, data: { version: 2 } });
    await enqueue(b.id, "rescheduled");
    await processDueNotifications();
    const subjects = readOutbox({ to: "asha@example.com" }).map((m) => m.subject);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatch(/moved/);
    const confirmed = (await rowsFor(b.id)).find((r) => r.kind === "booking_confirmed")!;
    expect(confirmed.status).toBe("CANCELLED");
  });

  it("retries retryable failures with backoff, then succeeds", async () => {
    await db.settings.update({ where: { id: 1 }, data: { teamNotificationEmails: [] } });
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    sendMock.mockResolvedValueOnce({ ok: false, retryable: true, error: "Resend HTTP 503 to asha@example.com" });

    const t0 = new Date();
    expect(await processDueNotifications({ now: t0 })).toEqual({ sent: 0, failed: 0, retried: 1 });
    let row = (await rowsFor(b.id)).find((r) => r.kind === "booking_confirmed")!;
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.sendAfter.getTime()).toBe(t0.getTime() + 60_000);
    expect(row.lastError).not.toContain("asha@example.com");

    // Not due yet.
    expect(await processDueNotifications({ now: new Date(t0.getTime() + 30_000) })).toEqual({ sent: 0, failed: 0, retried: 0 });

    expect(await processDueNotifications({ now: new Date(t0.getTime() + 61_000) })).toEqual({ sent: 1, failed: 0, retried: 0 });
    row = (await rowsFor(b.id)).find((r) => r.kind === "booking_confirmed")!;
    expect(row.status).toBe("SENT");
    expect(row.attempts).toBe(2);
    // Same idempotency key used on both attempts.
    const keys = sendMock.mock.calls.filter((c) => c[0].to === "asha@example.com").map((c) => c[0].idempotencyKey);
    expect(new Set(keys)).toEqual(new Set([row.idempotencyKey]));
  });

  it("marks FAILED on a permanent failure", async () => {
    await db.settings.update({ where: { id: 1 }, data: { teamNotificationEmails: [] } });
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    sendMock.mockResolvedValueOnce({ ok: false, retryable: false, error: "Resend HTTP 422 validation_error" });
    expect(await processDueNotifications()).toEqual({ sent: 0, failed: 1, retried: 0 });
    const row = (await rowsFor(b.id)).find((r) => r.kind === "booking_confirmed")!;
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toContain("422");
  });

  it("marks FAILED after the attempt limit", async () => {
    await db.settings.update({ where: { id: 1 }, data: { teamNotificationEmails: [] } });
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    sendMock.mockResolvedValue({ ok: false, retryable: true, error: "Resend HTTP 500" });
    try {
      let now = Date.now();
      const results = [];
      for (let i = 0; i < 6; i++) {
        results.push(await processDueNotifications({ now: new Date(now) }));
        now += 4 * HOUR;
      }
      expect(results.slice(0, 5).every((r) => r.retried === 1)).toBe(true);
      expect(results[5]).toEqual({ sent: 0, failed: 1, retried: 0 });
      const row = (await rowsFor(b.id)).find((r) => r.kind === "booking_confirmed")!;
      expect(row.status).toBe("FAILED");
      expect(row.attempts).toBe(6);
    } finally {
      sendMock.mockReset();
      const actual = await vi.importActual<typeof import("@/lib/server/email")>("@/lib/server/email");
      sendMock.mockImplementation(actual.sendEmail);
    }
  });

  it("concurrent workers never double-send", async () => {
    for (let i = 0; i < 6; i++) {
      const b = await createBooking();
      await enqueue(b.id, "confirmed");
    }
    const due = await db.notification.count({ where: { status: "PENDING", sendAfter: { lte: new Date() } } });
    const results = await Promise.all(Array.from({ length: 5 }, () => processDueNotifications({ limit: 4 })));
    let total = results.reduce((n, r) => n + r.sent, 0);
    // Drain anything left over.
    for (let r = await processDueNotifications(); r.sent > 0; r = await processDueNotifications()) total += r.sent;
    expect(total).toBe(due);
    expect(readOutbox()).toHaveLength(due);
    expect(new Set(sendMock.mock.calls.map((c) => c[0].idempotencyKey)).size).toBe(sendMock.mock.calls.length);
  });

  it("reclaims rows stuck in SENDING after the lock expires", async () => {
    await db.settings.update({ where: { id: 1 }, data: { teamNotificationEmails: [] } });
    const b = await createBooking();
    await enqueue(b.id, "confirmed");
    await db.notification.updateMany({
      where: { bookingId: b.id, kind: "booking_confirmed" },
      data: { status: "SENDING", lockedUntil: new Date(Date.now() + 60_000), attempts: 1 },
    });
    expect((await processDueNotifications()).sent).toBe(0);
    expect((await processDueNotifications({ now: new Date(Date.now() + 3 * 60_000) })).sent).toBe(1);
  });
});

describe("kickNotifications", () => {
  it("does not throw outside a request context", () => {
    expect(() => kickNotifications()).not.toThrow();
  });
});
