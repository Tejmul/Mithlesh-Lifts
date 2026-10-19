import { createOrResumeSession, toSessionView } from "@/lib/server/booking-session";
import { apiOk, assertSameOrigin, handler, parseBody } from "@/lib/server/http";
import type { SessionResponse } from "@/lib/shared/api";
import { trackingSchema } from "@/lib/shared/validation";

/** POST /api/booking/start — create or resume the visitor's booking session (httpOnly cookie). */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  const tracking = await parseBody(request, trackingSchema);
  const session = await createOrResumeSession(tracking);
  return apiOk<SessionResponse>({ session: await toSessionView(session) });
});
