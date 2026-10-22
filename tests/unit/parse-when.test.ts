import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { parseWhen } from "@/components/booking/parse-when";

// Thursday 22 Oct 2026, India.
const today = DateTime.fromISO("2026-10-22T09:15", { zone: "Asia/Kolkata" });

describe("parseWhen", () => {
  it.each([
    ["6pm", { minutes: 18 * 60 }],
    ["6:30 pm", { minutes: 18 * 60 + 30 }],
    ["6.30", { minutes: 18 * 60 + 30 }],
    ["18:45", { minutes: 18 * 60 + 45 }],
    ["10", { minutes: 10 * 60 }],
    ["10 am", { minutes: 10 * 60 }],
    ["12", { minutes: 12 * 60 }],
    ["noon", { minutes: 12 * 60 }],
    ["12 am", { minutes: 0 }],
  ])("time %s", (input, expected) => {
    expect(parseWhen(input, today)).toEqual(expected);
  });

  it.each([
    ["today 7pm", { date: "2026-10-22", minutes: 19 * 60 }],
    ["tomorrow 6:30 pm", { date: "2026-10-23", minutes: 18 * 60 + 30 }],
    ["Tmrw at 11am", { date: "2026-10-23", minutes: 11 * 60 }],
    ["sat 11am", { date: "2026-10-24", minutes: 11 * 60 }],
    ["Saturday", { date: "2026-10-24" }],
    ["thursday 5", { date: "2026-10-22", minutes: 17 * 60 }],
    ["wed", { date: "2026-10-28" }],
    ["next thu 6pm", { date: "2026-10-29", minutes: 18 * 60 }],
    ["next sat", { date: "2026-10-24" }],
    ["25 oct 5pm", { date: "2026-10-25", minutes: 17 * 60 }],
    ["Oct 30, 9:30", { date: "2026-10-30", minutes: 9 * 60 + 30 }],
    ["2nd november", { date: "2026-11-02" }],
    ["3/11 4pm", { date: "2026-11-03", minutes: 16 * 60 }],
    ["1 jan", { date: "2027-01-01" }],
    ["day after tomorrow 8am", { date: "2026-10-24", minutes: 8 * 60 }],
  ])("day + time %s", (input, expected) => {
    expect(parseWhen(input, today)).toEqual(expected);
  });

  it("returns null for nothing usable", () => {
    expect(parseWhen("", today)).toBeNull();
    expect(parseWhen("whenever", today)).toBeNull();
    expect(parseWhen("99:99", today)).toBeNull();
  });
});
