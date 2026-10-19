import type { NextRequest } from "next/server";
import { DateTime } from "luxon";
import { getCurrentAdmin } from "@/lib/server/admin/auth";
import { bookingWhere, parseBookingFilters } from "@/lib/server/admin/bookings-query";
import { csvRow } from "@/lib/server/admin/csv";
import { latestQuote } from "@/lib/server/admin/quote-summary";
import { db } from "@/lib/server/db";
import { apiError } from "@/lib/server/http";
import { logEvent, reportError } from "@/lib/server/observability";
import { getSettings } from "@/lib/server/settings";

const BATCH = 500;

const HEADER = [
  "reference",
  "status",
  "starts_at_coach_tz",
  "ends_at_coach_tz",
  "coach_time_zone",
  "customer_time_zone",
  "full_name",
  "client_code",
  "phone_e164",
  "email",
  "phone_verified_at",
  "source",
  "campaign",
  "manychat_subscriber_id",
  "marketing_consent_at",
  "cancel_reason",
  "internal_notes",
  "booked_at",
  "converted_at",
  "deal_value_inr",
  "latest_quote_status",
  "latest_quote_amount_inr",
];

/** GET /admin/bookings/export?<same filters as the bookings page> → CSV download. */
export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Sign in to export bookings.");

  const settings = await getSettings();
  const tz = settings.coachTimeZone;
  const where = bookingWhere(parseBookingFilters(request.nextUrl.searchParams), tz);
  const iso = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone: tz }).toISO() : "");
  logEvent("admin.bookings_export", { adminUserId: admin.id });

  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let started = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          // BOM so Excel opens UTF-8 names correctly.
          controller.enqueue(encoder.encode("﻿" + csvRow(HEADER)));
        }
        const rows = await db.booking.findMany({
          where,
          include: {
            lead: {
              include: {
                quotes: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, amountInr: true, createdAt: true } },
              },
            },
          },
          orderBy: [{ startsAt: "desc" }, { id: "asc" }],
          take: BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (rows.length === 0) {
          controller.close();
          return;
        }
        cursor = rows[rows.length - 1]!.id;
        const chunk = rows
          .map((b) => {
            const quote = latestQuote(b.lead.quotes);
            return csvRow([
              b.reference,
              b.status,
              iso(b.startsAt),
              iso(b.endsAt),
              tz,
              b.customerTimeZone,
              b.lead.fullName,
              b.lead.clientCode,
              b.lead.phoneE164,
              b.lead.email,
              iso(b.lead.phoneVerifiedAt),
              b.source,
              b.campaign,
              b.lead.manychatSubscriberId,
              iso(b.lead.marketingConsentAt),
              b.cancelReason,
              b.internalNotes,
              iso(b.createdAt),
              iso(b.convertedAt),
              b.dealValueInr,
              quote?.status,
              quote?.amountInr,
            ]);
          })
          .join("");
        controller.enqueue(encoder.encode(chunk));
        if (rows.length < BATCH) controller.close();
      } catch (err) {
        reportError(err, { where: "admin.bookings_export" });
        controller.error(err);
      }
    },
  });

  const stamp = DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bookings-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
