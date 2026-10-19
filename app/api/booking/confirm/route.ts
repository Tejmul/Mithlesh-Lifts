import { z } from "zod";
import type { BookingResponse } from "@/lib/shared/api";
import { isoDateTimeSchema, timeZoneSchema } from "@/lib/shared/validation";
import { requireSession } from "@/lib/server/booking-session";
import { createBookingFromSession, toBookingView } from "@/lib/server/bookings/service";
import { apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const confirmSchema = z.object({
  start: isoDateTimeSchema,
  timeZone: timeZoneSchema,
  idempotencyKey: z.uuid("Refresh the page and try again."),
});

/** POST /api/booking/confirm → BookingResponse */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  await enforceRateLimit(`booking-confirm:ip:${clientIp(request)}`, 20, 3600);
  const session = await requireSession();
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
