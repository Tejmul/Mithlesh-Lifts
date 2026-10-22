import { requireSession, toSessionView } from "@/lib/server/booking-session";
import { verifyEmailCode } from "@/lib/server/email-verify/flow";
import { apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import type { SessionResponse } from "@/lib/shared/api";
import { verifyCodeSchema } from "@/lib/shared/validation";

/** POST /api/booking/email/verify — checks the code; verifies the email and logs in. */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  const session = await requireSession();
  const { code } = await parseBody(request, verifyCodeSchema);
  const updated = await verifyEmailCode(session, code, clientIp(request));
  return apiOk<SessionResponse>({ session: await toSessionView(updated) }, { headers: { "Cache-Control": "no-store" } });
});
