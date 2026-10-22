import { z } from "zod";
import type { BookingResponse } from "@/lib/shared/api";
import { isoDateTimeSchema, timeZoneSchema } from "@/lib/shared/validation";
import { requireSession } from "@/lib/server/booking-session";
import { createBookingFromSession, toBookingView } from "@/lib/server/bookings/service";
import { apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import { hashToken } from "@/lib/server/crypto";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const confirmSchema = z.object({
  start: isoDateTimeSchema,
  timeZone: timeZoneSchema,
  idempotencyKey: z.uuid("Refresh the page and try again."),
});

/** POST /api/booking/confirm → BookingResponse */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  // Indian mobile networks put many people behind one IP: the IP cap is high, the tight one is per visitor.
  await enforceRateLimit(`booking-confirm:ip:${hashToken(clientIp(request))}`, 300, 3600);
  const session = await requireSession();
  await enforceRateLimit(`booking-confirm:session:${session.id}`, 15, 3600);
  const body = await parseBody(request, confirmSchema);

  const booking = await createBookingFromSession({
    session,
    start: new Date(body.start),
    customerTimeZone: body.timeZone,
    idempotencyKey: body.idempotencyKey,
  });
  const res: BookingResponse = { booking: await toBookingView(booking) };
  return apiOk(res, { headers: { "Cache-Control": "no-store" } });
});
