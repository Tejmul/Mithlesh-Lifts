import { z } from "zod";
import type { BookingResponse } from "@/lib/shared/api";
import { isoDateTimeSchema, timeZoneSchema } from "@/lib/shared/validation";
import { getBookingByManageToken, rescheduleBooking, toBookingView } from "@/lib/server/bookings/service";
import { ApiException, apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import { hashToken } from "@/lib/server/crypto";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const rescheduleSchema = z.object({
  token: z.string().min(1).max(200),
  start: isoDateTimeSchema,
  timeZone: timeZoneSchema,
});

/** POST /api/booking/manage/reschedule — token-authenticated → BookingResponse (fresh manageUrl). */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  await enforceRateLimit(`booking-manage:ip:${hashToken(clientIp(request))}`, 200, 3600);
  const body = await parseBody(request, rescheduleSchema);

  const booking = await getBookingByManageToken(body.token);
  if (!booking) throw new ApiException(404, "NOT_FOUND", "This link is no longer valid.");

  const updated = await rescheduleBooking({
    bookingId: booking.id,
    start: new Date(body.start),
    customerTimeZone: body.timeZone,
    actor: { by: "customer" },
  });
  const res: BookingResponse = { booking: await toBookingView(updated) };
  return apiOk(res, { headers: { "Cache-Control": "no-store" } });
});
