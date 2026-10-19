// Date/time formatting shared by the booking UI (client) and server pages.
import { DateTime } from "luxon";

export function fmtDate(iso: string, tz: string) {
  return DateTime.fromISO(iso, { zone: tz }).toFormat("cccc, d LLLL yyyy");
}

export function fmtTime(iso: string, tz: string) {
  return DateTime.fromISO(iso, { zone: tz }).toFormat("h:mm a");
}

/** e.g. "IST" or "GMT+5:30" */
export function fmtZoneShort(iso: string, tz: string) {
  return DateTime.fromISO(iso, { zone: tz, locale: "en-IN" }).toFormat("ZZZZ");
}

/** "Asia/Kolkata" → "India Standard Time" (falls back to the city name). */
export function zoneLabel(tz: string, at?: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-IN", { timeZone: tz, timeZoneName: "long" }).formatToParts(
      at ? new Date(at) : undefined,
    );
    const name = parts.find((p) => p.type === "timeZoneName")?.value;
    if (name && !/^GMT/.test(name)) return name;
  } catch {
    // fall through
  }
  const bits = tz.split("/");
  return bits[bits.length - 1].replace(/_/g, " ");
}

/** Legacy IANA aliases some browsers still report. */
const ALIASES: Record<string, string> = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Saigon": "Asia/Ho_Chi_Minh" };
export function canonicalZone(tz: string) {
  return ALIASES[tz] ?? tz;
}

export function minutesBetween(startIso: string, endIso: string) {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000);
}

/** Google Calendar "add event" template link. */
export function googleCalendarUrl(input: { title: string; start: string; end: string; details: string }) {
  const g = (iso: string) => DateTime.fromISO(iso).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${g(input.start)}/${g(input.end)}`,
    details: input.details,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
