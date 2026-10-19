// Weekly-hours validation for /admin/availability. Pure (no server-only) so it can be unit-tested.
import { z } from "zod";

export type HoursWindowInput = { weekday: number; start: string; end: string };
export type HoursWindow = { weekday: number; startMinute: number; endMinute: number };

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.");
export const windowsSchema = z
  .array(z.object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm }))
  .max(70, "Too many windows.");

function toMinutes(v: string) {
  const [h, m] = v.split(":").map(Number);
  return h! * 60 + m!;
}

/** Converts HH:MM windows to minutes. An end of "00:00" means midnight (end of day). */
export function validateWindows(
  input: HoursWindowInput[],
): { ok: true; windows: HoursWindow[] } | { ok: false; error: string } {
  const windows = input.map((w) => {
    const startMinute = toMinutes(w.start);
    const rawEnd = toMinutes(w.end);
    return { weekday: w.weekday, startMinute, endMinute: rawEnd === 0 ? 1440 : rawEnd };
  });
  for (const w of windows) {
    if (w.endMinute <= w.startMinute) {
      return { ok: false, error: `${WEEKDAY_NAMES[w.weekday - 1]}: end time must be after start time.` };
    }
  }
  for (let day = 1; day <= 7; day++) {
    const list = windows.filter((w) => w.weekday === day).sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.startMinute < list[i - 1]!.endMinute) {
        return { ok: false, error: `${WEEKDAY_NAMES[day - 1]}: time windows overlap.` };
      }
    }
  }
  return { ok: true, windows: windows.sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute) };
}
