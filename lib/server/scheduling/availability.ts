import "server-only";
// OWNER: Agent B.
import { DateTime } from "luxon";
import type { DayOff, Settings, WeeklyHours } from "@/generated/prisma/client";
import { db } from "../db";
import { getDaysOff, getSettings, getWeeklyHours } from "../settings";

export type Slot = { start: Date; end: Date };
export type BusyInterval = { start: Date; end: Date };

/** Booking statuses that occupy calendar time (mirrors the Booking_no_overlap constraint). */
export const ACTIVE_BOOKING_STATUSES = ["CONFIRMED", "COMPLETED", "NO_SHOW"] as const;

export type ComputeSlotsInput = {
  settings: Pick<
    Settings,
    "coachTimeZone" | "callMinutes" | "bufferMinutes" | "slotIntervalMinutes" | "minNoticeMinutes" | "maxAdvanceDays"
  >;
  weeklyHours: Pick<WeeklyHours, "weekday" | "startMinute" | "endMinute">[];
  daysOff: Pick<DayOff, "date">[];
  /** Occupied [start, end) intervals — for bookings, [startsAt, blockedUntil). */
  busy: BusyInterval[];
  now: Date;
  /** Optional narrowing of the returned slots (start ≥ from, start < to). */
  from?: Date;
  to?: Date;
};

/**
 * Pure slot math. Works day by day in the coach's time zone, building every slot from local
 * wall-clock time so DST transitions are handled: wall times that don't exist (spring-forward gap)
 * are skipped, and repeated wall times (fall-back) are produced once.
 *
 * windowStart = now + minNotice; windowEnd = end of the local day `maxAdvanceDays` after today.
 * A slot is unavailable when [start, start + call + buffer) overlaps any busy interval.
 */
export function computeSlots(input: ComputeSlotsInput): { slots: Slot[]; windowStart: Date; windowEnd: Date } {
  const { settings, weeklyHours, daysOff, busy, now } = input;
  const zone = settings.coachTimeZone;
  const callMs = settings.callMinutes * 60_000;
  const blockMs = (settings.callMinutes + settings.bufferMinutes) * 60_000;
  const interval = Math.max(1, settings.slotIntervalMinutes);

  const windowStart = new Date(now.getTime() + settings.minNoticeMinutes * 60_000);
  const localNow = DateTime.fromJSDate(now, { zone });
  const windowEndDt = localNow.plus({ days: settings.maxAdvanceDays }).endOf("day");
  const windowEnd = windowEndDt.toJSDate();

  const lower = Math.max(windowStart.getTime(), input.from?.getTime() ?? -Infinity);
  const upper = Math.min(windowEnd.getTime(), input.to?.getTime() ?? Infinity);

  const offDates = new Set(daysOff.map((d) => d.date));
  const byWeekday = new Map<number, { startMinute: number; endMinute: number }[]>();
  for (const w of weeklyHours) {
    const list = byWeekday.get(w.weekday) ?? [];
    list.push({ startMinute: w.startMinute, endMinute: w.endMinute });
    byWeekday.set(w.weekday, list);
  }
  const busyMs = busy.map((b) => [b.start.getTime(), b.end.getTime()] as const);

  const seen = new Set<number>();
  const slots: Slot[] = [];
  if (lower >= upper) return { slots, windowStart, windowEnd };

  let day = DateTime.fromMillis(lower, { zone }).startOf("day");
  const lastDay = DateTime.fromMillis(upper, { zone }).startOf("day");
  while (day.toMillis() <= lastDay.toMillis()) {
    const windows = byWeekday.get(day.weekday);
    if (windows && !offDates.has(day.toISODate()!)) {
      for (const w of windows) {
        for (let m = w.startMinute; m + settings.callMinutes <= w.endMinute; m += interval) {
          const hour = Math.floor(m / 60);
          const minute = m % 60;
          if (hour >= 24) break;
          const local = DateTime.fromObject(
            { year: day.year, month: day.month, day: day.day, hour, minute },
            { zone },
          );
          // Nonexistent wall time (spring-forward gap): luxon shifts it forward — skip it.
          if (!local.isValid || local.hour !== hour || local.minute !== minute || local.day !== day.day) continue;
          const start = local.toMillis();
          if (start < lower || start >= upper || seen.has(start)) continue;
          const blockEnd = start + blockMs;
          if (busyMs.some(([bs, be]) => start < be && bs < blockEnd)) continue;
          seen.add(start);
          slots.push({ start: new Date(start), end: new Date(start + callMs) });
        }
      }
    }
    day = day.plus({ days: 1 }).startOf("day");
  }

  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { slots, windowStart, windowEnd };
}

/**
 * Bookable slots from Settings + WeeklyHours + DayOff minus active bookings (with buffer),
 * honouring min notice and max advance days. Computed in the coach's time zone (DST-safe).
 * excludeBookingId lets a reschedule ignore the booking being moved.
 */
export async function getAvailableSlots(opts: { from?: Date; to?: Date; excludeBookingId?: string; now?: Date } = {}): Promise<{
  slots: Slot[];
  windowStart: Date;
  windowEnd: Date;
}> {
  const now = opts.now ?? new Date();
  const [settings, weeklyHours, daysOff] = await Promise.all([getSettings(), getWeeklyHours(), getDaysOff()]);
  // Generous horizon: anything ending after now and starting before the max window (+2 days slack).
  const horizon = new Date(now.getTime() + (settings.maxAdvanceDays + 2) * 86_400_000);
  const bookings = await db.booking.findMany({
    where: {
      status: { in: [...ACTIVE_BOOKING_STATUSES] },
      blockedUntil: { gt: now },
      startsAt: { lt: horizon },
      ...(opts.excludeBookingId ? { id: { not: opts.excludeBookingId } } : {}),
    },
    select: { startsAt: true, blockedUntil: true },
  });
  return computeSlots({
    settings,
    weeklyHours,
    daysOff,
    busy: bookings.map((b) => ({ start: b.startsAt, end: b.blockedUntil })),
    now,
    from: opts.from,
    to: opts.to,
  });
}
