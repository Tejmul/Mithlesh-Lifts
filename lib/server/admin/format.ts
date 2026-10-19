import "server-only";
import { DateTime } from "luxon";

/** "Mon 20 Oct 2026, 10:30 AM" in the given zone. */
export function fmtDateTime(date: Date | null | undefined, zone: string) {
  if (!date) return "—";
  return DateTime.fromJSDate(date, { zone }).toFormat("ccc d LLL yyyy, h:mm a");
}

export function fmtTime(date: Date, zone: string) {
  return DateTime.fromJSDate(date, { zone }).toFormat("h:mm a");
}

export function fmtDay(date: Date, zone: string) {
  return DateTime.fromJSDate(date, { zone }).toFormat("cccc d LLLL yyyy");
}

/** Minutes after midnight → "HH:MM". */
export function minutesToHHMM(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "HH:MM" → minutes after midnight, or null. */
export function hhmmToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/** wa.me link: digits only. */
export function whatsappUrl(e164: string) {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}

export const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
};

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
/** ₹1,25,000 */
export function fmtInr(rupees: number) {
  return inr.format(rupees);
}

/** Percentage string, or "—" when the denominator is 0. */
export function pct(numerator: number, denominator: number) {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 1000) / 10}%`;
}
