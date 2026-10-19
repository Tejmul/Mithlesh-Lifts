import { z } from "zod";
import type { BookingResponse } from "@/lib/shared/api";
import { cancelBooking, getBookingByManageToken, toBookingView } from "@/lib/server/bookings/service";
import { ApiException, apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const cancelSchema = z.object({
  token: z.string().min(1).max(200),
  reason: z.string().trim().max(500, "Keep the reason under 500 characters.").optional(),
});

/** POST /api/booking/manage/cancel — token-authenticated → BookingResponse */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  await enforceRateLimit(`booking-manage:ip:${clientIp(request)}`, 20, 3600);
  const body = await parseBody(request, cancelSchema);

  const booking = await getBookingByManageToken(body.token);
  if (!booking) throw new ApiException(404, "NOT_FOUND", "This link is no longer valid.");

  const updated = await cancelBooking({ bookingId: booking.id, actor: { by: "customer" }, reason: body.reason });
  const res: BookingResponse = { booking: await toBookingView(updated) };
  return apiOk(res, { headers: { "Cache-Control": "no-store" } });
});
