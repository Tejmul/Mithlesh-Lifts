import { DateTime } from "luxon";

/** What a visitor typed, e.g. "tomorrow 6:30 pm", "sat 11am", "25 oct 5", "7pm". */
export type ParsedWhen = { date?: string; minutes?: number };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Parses a free-typed day and/or time relative to `today` (in the visitor's zone).
 * Times without am/pm are read the way people book calls: 1–7 → pm, 8–11 → am, 12 → noon.
 * Returns null when nothing usable was found.
 */
export function parseWhen(input: string, today: DateTime): ParsedWhen | null {
  let text = ` ${input.toLowerCase().replace(/[,]/g, " ").replace(/\s+/g, " ").trim()} `;
  if (!text.trim()) return null;
  const out: ParsedWhen = {};
  const base = today.startOf("day");

  // ---- day
  const take = (re: RegExp) => {
    const m = text.match(re);
    if (m) text = text.replace(m[0], " ");
    return m;
  };
  if (take(/\s(today|tdy)\s/)) out.date = base.toISODate()!;
  else if (take(/\s(day after tomorrow)\s/)) out.date = base.plus({ days: 2 }).toISODate()!;
  else if (take(/\s(tomorrow|tmrw|tmr|tom)\s/)) out.date = base.plus({ days: 1 }).toISODate()!;
  else {
    const wd = take(/\s(next\s)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s/);
    if (wd) {
      const target = WEEKDAYS.indexOf(wd[2]!) + 1;
      let ahead = (target - base.weekday + 7) % 7;
      // "next thu" on a Thursday means a week from today, not today.
      if (wd[1] && ahead === 0) ahead = 7;
      out.date = base.plus({ days: ahead }).toISODate()!;
    } else {
      // "25 oct", "oct 25", "25th october", "25/10"
      const dm =
        take(/\s(\d{1,2})(?:st|nd|rd|th)?\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s/) ??
        take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s(\d{1,2})(?:st|nd|rd|th)?\s/);
      const slash = dm ? null : take(/\s(\d{1,2})\/(\d{1,2})\s/);
      let day: number | undefined;
      let month: number | undefined;
      if (dm) {
        const [a, b] = [dm[1]!, dm[2]!];
        day = Number(/\d/.test(a) ? a : b);
        month = MONTHS.indexOf(/\d/.test(a) ? b : a) + 1;
      } else if (slash) {
        day = Number(slash[1]);
        month = Number(slash[2]);
      }
      if (day && month) {
        let d = DateTime.fromObject({ year: base.year, month, day }, { zone: base.zone });
        if (d.isValid && d < base) d = d.plus({ years: 1 });
        if (d.isValid) out.date = d.toISODate()!;
      }
    }
  }

  // ---- time
  if (/\s(noon|midday)\s/.test(text)) out.minutes = 12 * 60;
  else {
    const t = text.match(/\s(?:at\s)?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm|a\.m\.|p\.m\.)?\s/);
    if (t) {
      let h = Number(t[1]);
      const m = t[2] ? Number(t[2]) : 0;
      const mer = t[3]?.replace(/\./g, "");
      if (h <= 24 && m < 60) {
        if (mer === "pm" && h < 12) h += 12;
        else if (mer === "am" && h === 12) h = 0;
        else if (!mer && h >= 1 && h <= 7) h += 12;
        if (h < 24) out.minutes = h * 60 + m;
      }
    }
  }

  return out.date || out.minutes !== undefined ? out : null;
}
