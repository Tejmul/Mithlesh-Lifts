import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { computeSlots, type ComputeSlotsInput } from "@/lib/server/scheduling/availability";

type Settings = ComputeSlotsInput["settings"];
const base: Settings = {
  coachTimeZone: "Asia/Kolkata",
  callMinutes: 30,
  bufferMinutes: 15,
  slotIntervalMinutes: 30,
  minNoticeMinutes: 0,
  maxAdvanceDays: 21,
};

const iso = (d: Date) => d.toISOString();
const at = (s: string, zone: string) => DateTime.fromISO(s, { zone }).toJSDate();
const hours = (weekday: number, from: string, to: string) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return { weekday, startMinute: m(from), endMinute: m(to) };
};

function run(over: Partial<Omit<ComputeSlotsInput, "settings">> & { settings?: Partial<Settings> }) {
  return computeSlots({
    weeklyHours: [],
    daysOff: [],
    busy: [],
    now: new Date("2026-10-18T00:00:00Z"),
    ...over,
    settings: { ...base, ...over.settings },
  });
}

describe("computeSlots — basics (Asia/Kolkata)", () => {
  // 2026-10-19 is a Monday.
  const mon = hours(1, "09:00", "11:00");

  it("builds slots from weekly hours in the coach time zone", () => {
    const { slots } = run({ weeklyHours: [mon], settings: { maxAdvanceDays: 3 } });
    expect(slots.map((s) => iso(s.start))).toEqual([
      "2026-10-19T03:30:00.000Z",
      "2026-10-19T04:00:00.000Z",
      "2026-10-19T04:30:00.000Z",
      "2026-10-19T05:00:00.000Z",
    ]);
    expect(slots.every((s) => s.end.getTime() - s.start.getTime() === 30 * 60_000)).toBe(true);
  });

  it("drops days off", () => {
    const { slots } = run({ weeklyHours: [mon], daysOff: [{ date: "2026-10-19" }], settings: { maxAdvanceDays: 10 } });
    expect(slots.map((s) => iso(s.start)).every((s) => s.startsWith("2026-10-26"))).toBe(true);
    expect(slots).toHaveLength(4);
  });

  it("respects minimum notice", () => {
    const now = at("2026-10-19T08:50", "Asia/Kolkata");
    const r = run({ weeklyHours: [mon], now, settings: { minNoticeMinutes: 60, maxAdvanceDays: 0 } });
    expect(iso(r.windowStart)).toBe(iso(at("2026-10-19T09:50", "Asia/Kolkata")));
    expect(r.slots.map((s) => iso(s.start))).toEqual(["2026-10-19T04:30:00.000Z", "2026-10-19T05:00:00.000Z"]);
  });

  it("stops at the end of the local day maxAdvanceDays ahead", () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map((d) => hours(d, "09:00", "10:00"));
    const now = at("2026-10-19T12:00", "Asia/Kolkata");
    const r = run({ weeklyHours: all, now, settings: { maxAdvanceDays: 2 } });
    expect(iso(r.windowEnd)).toBe(iso(DateTime.fromISO("2026-10-21T23:59:59.999", { zone: "Asia/Kolkata" }).toJSDate()));
    // Today 09:00 has passed; tomorrow + day after → 2 slots each.
    expect(r.slots.map((s) => iso(s.start))).toEqual([
      "2026-10-20T03:30:00.000Z",
      "2026-10-20T04:00:00.000Z",
      "2026-10-21T03:30:00.000Z",
      "2026-10-21T04:00:00.000Z",
    ]);
  });

  it("buffer blocks adjacent slots around a booking", () => {
    // Booking 10:00–10:30 + 15 min buffer → busy [10:00, 10:45).
    const busy = [{ start: at("2026-10-19T10:00", "Asia/Kolkata"), end: at("2026-10-19T10:45", "Asia/Kolkata") }];
    const { slots } = run({ weeklyHours: [hours(1, "09:00", "12:00")], busy, settings: { maxAdvanceDays: 3 } });
    const local = slots.map((s) => DateTime.fromJSDate(s.start, { zone: "Asia/Kolkata" }).toFormat("HH:mm"));
    // 09:30 would run into the booking with its own buffer; 10:30 overlaps the booking's buffer.
    expect(local).toEqual(["09:00", "11:00", "11:30"]);
  });

  it("without buffer only the overlapping slot is blocked", () => {
    const busy = [{ start: at("2026-10-19T10:00", "Asia/Kolkata"), end: at("2026-10-19T10:30", "Asia/Kolkata") }];
    const { slots } = run({
      weeklyHours: [hours(1, "09:00", "11:00")],
      busy,
      settings: { bufferMinutes: 0, maxAdvanceDays: 3 },
    });
    const local = slots.map((s) => DateTime.fromJSDate(s.start, { zone: "Asia/Kolkata" }).toFormat("HH:mm"));
    expect(local).toEqual(["09:00", "09:30", "10:30"]);
  });

  it("slot interval is independent of call length; slots must end within the window", () => {
    const { slots } = run({
      weeklyHours: [hours(1, "09:00", "10:30")],
      settings: { callMinutes: 45, slotIntervalMinutes: 15, maxAdvanceDays: 3 },
    });
    const local = slots.map((s) => DateTime.fromJSDate(s.start, { zone: "Asia/Kolkata" }).toFormat("HH:mm"));
    expect(local).toEqual(["09:00", "09:15", "09:30", "09:45"]);
    expect(slots.every((s) => s.end.getTime() - s.start.getTime() === 45 * 60_000)).toBe(true);
  });

  it("from/to narrow the slots but not the reported window", () => {
    const r = run({
      weeklyHours: [mon],
      settings: { maxAdvanceDays: 10 },
      from: new Date("2026-10-19T04:00:00Z"),
      to: new Date("2026-10-19T05:00:00Z"),
    });
    expect(r.slots.map((s) => iso(s.start))).toEqual(["2026-10-19T04:00:00.000Z", "2026-10-19T04:30:00.000Z"]);
    expect(iso(r.windowStart)).toBe("2026-10-18T00:00:00.000Z");
  });

  it("de-duplicates overlapping weekly-hours rows", () => {
    const { slots } = run({ weeklyHours: [mon, hours(1, "10:00", "11:00")], settings: { maxAdvanceDays: 3 } });
    expect(slots).toHaveLength(4);
  });
});

describe("computeSlots — DST", () => {
  const NY = "America/New_York";
  const weekdays = [1, 2, 3, 4, 5].map((d) => hours(d, "09:00", "10:00"));

  it("America/New_York spring forward: skips the 02:00–03:00 gap only", () => {
    // 2026-03-08 (Sunday) clocks jump 02:00 → 03:00.
    const { slots } = run({
      weeklyHours: [hours(7, "00:00", "05:00")],
      now: new Date("2026-03-07T12:00:00Z"),
      settings: { coachTimeZone: NY, maxAdvanceDays: 2 },
    });
    expect(slots.map((s) => iso(s.start))).toEqual([
      "2026-03-08T05:00:00.000Z", // 00:00 EST
      "2026-03-08T05:30:00.000Z",
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T06:30:00.000Z", // 01:30 EST
      "2026-03-08T07:00:00.000Z", // 03:00 EDT
      "2026-03-08T07:30:00.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-08T08:30:00.000Z", // 04:30 EDT
    ]);
  });

  it("America/New_York fall back: repeated hour produces no duplicates", () => {
    // 2026-11-01 (Sunday) clocks fall back 02:00 → 01:00.
    const { slots } = run({
      weeklyHours: [hours(7, "00:00", "04:00")],
      now: new Date("2026-10-31T12:00:00Z"),
      settings: { coachTimeZone: NY, maxAdvanceDays: 2 },
    });
    const starts = slots.map((s) => iso(s.start));
    expect(new Set(starts).size).toBe(starts.length);
    const local = slots.map((s) => DateTime.fromJSDate(s.start, { zone: NY }).toFormat("HH:mm"));
    expect(local).toEqual(["00:00", "00:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30"]);
    expect(starts[0]).toBe("2026-11-01T04:00:00.000Z"); // 00:00 EDT
    expect(starts[4]).toBe("2026-11-01T07:00:00.000Z"); // 02:00 EST
    expect(starts[7]).toBe("2026-11-01T08:30:00.000Z");
  });

  it("America/New_York: same wall time maps to different UTC across transitions", () => {
    const march = run({
      weeklyHours: weekdays,
      now: new Date("2026-03-05T00:00:00Z"),
      settings: { coachTimeZone: NY, maxAdvanceDays: 6 },
    }).slots.filter((s) => DateTime.fromJSDate(s.start, { zone: NY }).toFormat("HH:mm") === "09:00");
    expect(march.map((s) => iso(s.start))).toEqual([
      "2026-03-05T14:00:00.000Z",
      "2026-03-06T14:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
      "2026-03-10T13:00:00.000Z", // now is 19:00 on Mar 4 in New York → window ends Mar 10
    ]);
    const nov = run({
      weeklyHours: weekdays,
      now: new Date("2026-10-29T00:00:00Z"),
      settings: { coachTimeZone: NY, maxAdvanceDays: 6 },
    }).slots.filter((s) => DateTime.fromJSDate(s.start, { zone: NY }).toFormat("HH:mm") === "09:00");
    expect(nov.map((s) => iso(s.start))).toEqual([
      "2026-10-29T13:00:00.000Z",
      "2026-10-30T13:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-03T14:00:00.000Z",
    ]);
  });

  it.each([
    ["March", "2026-03-01T00:00:00Z"],
    ["November", "2026-10-25T00:00:00Z"],
  ])("Asia/Kolkata is unaffected by the %s DST transitions elsewhere", (_label, nowIso) => {
    const { slots } = run({
      weeklyHours: [1, 2, 3, 4, 5, 6, 7].map((d) => hours(d, "09:00", "10:00")),
      now: new Date(nowIso),
      settings: { maxAdvanceDays: 20 },
    });
    // now is 05:30 IST, so today plus 20 more days, two slots each.
    expect(slots.length).toBe(21 * 2);
    const times = new Set(slots.map((s) => iso(s.start).slice(11)));
    expect([...times].sort()).toEqual(["03:30:00.000Z", "04:00:00.000Z"]);
    const starts = slots.map((s) => s.start.getTime());
    expect(new Set(starts).size).toBe(starts.length);
  });
});
