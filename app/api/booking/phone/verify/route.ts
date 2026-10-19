import { requireSession, toSessionView } from "@/lib/server/booking-session";
import { apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import { verifyPhoneCode } from "@/lib/server/phone-verify/flow";
import type { SessionResponse } from "@/lib/shared/api";
import { verifyCodeSchema } from "@/lib/shared/validation";

/** POST /api/booking/phone/verify — check the OTP; marks the phone as verified. */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  const session = await requireSession();
  const { code } = await parseBody(request, verifyCodeSchema);
  const updated = await verifyPhoneCode(session, code, clientIp(request));
  return apiOk<SessionResponse>({ session: await toSessionView(updated) });
});
