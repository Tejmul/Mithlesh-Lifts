import "server-only";
import { DateTime } from "luxon";
import { db } from "../db";

export const FUNNEL_PERIODS = [
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "365", label: "Last 12 months", days: 365 },
] as const;
export type FunnelPeriod = (typeof FUNNEL_PERIODS)[number]["value"];

export function parsePeriod(raw: string | string[] | undefined): FunnelPeriod {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return FUNNEL_PERIODS.find((p) => p.value === v)?.value ?? "30";
}

export type AttributionRow = {
  source: string | null;
  campaign: string | null;
  verified: number;
  booked: number;
  completed: number;
  clients: number;
  revenue: number;
};

export type Funnel = {
  from: Date;
  to: Date;
  verified: number;
  booked: number;
  completed: number;
  noShows: number;
  clients: number;
  /** Manually recorded deal values (Sales outcome → Mark as client). */
  revenue: number;
  /** Quotes created in the period (any status). */
  quotesSent: number;
  /** Quotes paid online in the period (by paidAt). */
  quotesPaid: number;
  /** Sum of paid quote amounts in the period, whole rupees. */
  quoteRevenue: number;
  rows: AttributionRow[];
};

/**
 * Sales funnel for a period in the coach's time zone (whole days, ending today).
 * Verified = distinct phones verified in the period (from BookingSession rows still retained).
 * Booked/completed/clients = cohort of bookings *created* in the period, so the steps are comparable.
 */
export async function getFunnel(period: FunnelPeriod, coachTimeZone: string, now = new Date()): Promise<Funnel> {
  const days = FUNNEL_PERIODS.find((p) => p.value === period)!.days;
  const from = DateTime.fromJSDate(now, { zone: coachTimeZone })
    .startOf("day")
    .minus({ days: days - 1 })
    .toJSDate();
  const range = { gte: from, lte: now };

  const [verifiedGroups, bookingGroups, quotesSent, paidQuotes] = await Promise.all([
    db.bookingSession.groupBy({
      by: ["source", "campaign", "phoneE164"],
      where: { emailVerifiedAt: range, phoneE164: { not: null } },
    }),
    db.booking.groupBy({
      by: ["source", "campaign", "status"],
      where: { createdAt: range },
      _count: { _all: true },
      _sum: { dealValueInr: true },
    }),
    db.quote.count({ where: { createdAt: range } }),
    db.quote.aggregate({
      where: { status: "PAID", paidAt: range },
      _count: { _all: true },
      _sum: { amountInr: true },
    }),
  ]);
  const convertedGroups = await db.booking.groupBy({
    by: ["source", "campaign"],
    where: { createdAt: range, convertedAt: { not: null } },
    _count: { _all: true },
    _sum: { dealValueInr: true },
  });

  const rows = new Map<string, AttributionRow>();
  const row = (source: string | null, campaign: string | null) => {
    const key = `${source ?? ""}\u0000${campaign ?? ""}`;
    let r = rows.get(key);
    if (!r) {
      r = { source, campaign, verified: 0, booked: 0, completed: 0, clients: 0, revenue: 0 };
      rows.set(key, r);
    }
    return r;
  };

  const verifiedPhones = new Set<string>();
  const seenPerRow = new Map<AttributionRow, Set<string>>();
  for (const g of verifiedGroups) {
    if (!g.phoneE164) continue;
    verifiedPhones.add(g.phoneE164);
    const r = row(g.source, g.campaign);
    const seen = seenPerRow.get(r) ?? new Set<string>();
    if (!seen.has(g.phoneE164)) {
      seen.add(g.phoneE164);
      r.verified++;
    }
    seenPerRow.set(r, seen);
  }

  let noShows = 0;
  for (const g of bookingGroups) {
    const r = row(g.source, g.campaign);
    r.booked += g._count._all;
    if (g.status === "COMPLETED") r.completed += g._count._all;
    if (g.status === "NO_SHOW") noShows += g._count._all;
  }
  for (const g of convertedGroups) {
    const r = row(g.source, g.campaign);
    r.clients += g._count._all;
    r.revenue += g._sum.dealValueInr ?? 0;
  }

  const list = [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.booked - a.booked || b.verified - a.verified);
  const sum = (k: keyof Pick<AttributionRow, "booked" | "completed" | "clients" | "revenue">) =>
    list.reduce((n, r) => n + r[k], 0);

  return {
    from,
    to: now,
    verified: verifiedPhones.size,
    booked: sum("booked"),
    completed: sum("completed"),
    noShows,
    clients: sum("clients"),
    revenue: sum("revenue"),
    quotesSent,
    quotesPaid: paidQuotes._count._all,
    quoteRevenue: paidQuotes._sum.amountInr ?? 0,
    rows: list,
  };
}
