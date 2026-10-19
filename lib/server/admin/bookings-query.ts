import "server-only";
import { DateTime } from "luxon";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";

export const BOOKING_STATUSES = ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const;
export const BOOKINGS_PAGE_SIZE = 25;

export type BookingFilters = {
  q?: string;
  status?: (typeof BOOKING_STATUSES)[number];
  from?: string;
  to?: string;
  source?: string;
  campaign?: string;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fields = {
  q: z.string().trim().min(1).max(100),
  status: z.enum(BOOKING_STATUSES),
  from: dateSchema,
  to: dateSchema,
  source: z.string().trim().min(1).max(80),
  campaign: z.string().trim().min(1).max(80),
  page: z.coerce.number().int().min(1).max(10_000),
};

function pick(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Lenient: invalid values are ignored rather than erroring. */
export function parseBookingFilters(raw: RawParams): BookingFilters {
  const get = <K extends keyof typeof fields>(key: K) => {
    const r = fields[key].safeParse(pick(raw, key));
    return r.success ? (r.data as z.infer<(typeof fields)[K]>) : undefined;
  };
  return {
    q: get("q"),
    status: get("status"),
    from: get("from"),
    to: get("to"),
    source: get("source"),
    campaign: get("campaign"),
    page: get("page") ?? 1,
  };
}

/** Query string for the given filters (page omitted unless > 1). */
export function filtersToQuery(f: BookingFilters, overrides: Partial<BookingFilters> = {}) {
  const merged = { ...f, ...overrides };
  const params = new URLSearchParams();
  for (const key of ["q", "status", "from", "to", "source", "campaign"] as const) {
    const v = merged[key];
    if (v) params.set(key, v);
  }
  if (merged.page > 1) params.set("page", String(merged.page));
  return params.toString();
}

/** Prisma where-clause. Date range is whole days in the coach's time zone (inclusive). */
export function bookingWhere(f: BookingFilters, coachTimeZone: string): Prisma.BookingWhereInput {
  const and: Prisma.BookingWhereInput[] = [];
  if (f.status) and.push({ status: f.status });
  if (f.source) and.push({ source: { equals: f.source, mode: "insensitive" } });
  if (f.campaign) and.push({ campaign: { equals: f.campaign, mode: "insensitive" } });
  if (f.from) {
    const start = DateTime.fromISO(f.from, { zone: coachTimeZone }).startOf("day");
    if (start.isValid) and.push({ startsAt: { gte: start.toJSDate() } });
  }
  if (f.to) {
    const end = DateTime.fromISO(f.to, { zone: coachTimeZone }).startOf("day").plus({ days: 1 });
    if (end.isValid) and.push({ startsAt: { lt: end.toJSDate() } });
  }
  if (f.q) {
    const or: Prisma.BookingWhereInput[] = [
      { reference: { contains: f.q, mode: "insensitive" } },
      { lead: { fullName: { contains: f.q, mode: "insensitive" } } },
      { lead: { email: { contains: f.q, mode: "insensitive" } } },
    ];
    const digits = f.q.replace(/[^\d]/g, "");
    if (digits.length >= 3) or.push({ lead: { phoneE164: { contains: digits } } });
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}
