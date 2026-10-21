import { connection } from "next/server";
import { db } from "@/lib/server/db";
import { safeEqual } from "@/lib/server/crypto";
import { env } from "@/lib/server/env";
import { apiError, apiOk, handler } from "@/lib/server/http";
import { processDueNotifications } from "@/lib/server/notifications";
import { pruneRateLimits } from "@/lib/server/rate-limit";

export const maxDuration = 60;

/** Scheduler (GET, Authorization: Bearer CRON_SECRET), e.g. cron-job.org every 5 min: send due emails + housekeeping. */
export const GET = handler(async (request: Request) => {
  await connection(); // always request-time, never prerendered
  const secret = env().CRON_SECRET;
  if (!secret) return apiError(503, "INTERNAL", "Cron is not configured.");
  const auth = request.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${secret}`)) return apiError(401, "UNAUTHORIZED", "Not authorized.");

  const notifications = await processDueNotifications({ limit: 100 });
  await pruneRateLimits();
  const now = new Date();
  // Expired sessions that never verified a phone carry nothing useful.
  const unverified = await db.bookingSession.deleteMany({
    where: { expiresAt: { lt: now }, bookingId: null, phoneVerifiedAt: null },
  });
  // Verified-but-unbooked sessions are sales follow-up leads (admin); keep them 180 days, then minimise.
  const staleLeads = await db.bookingSession.deleteMany({
    where: {
      expiresAt: { lt: now },
      bookingId: null,
      phoneVerifiedAt: { not: null },
      createdAt: { lt: new Date(now.getTime() - 180 * 86_400_000) },
    },
  });

  return apiOk(
    {
      notifications,
      expiredSessionsDeleted: unverified.count,
      staleVerifiedSessionsDeleted: staleLeads.count,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
