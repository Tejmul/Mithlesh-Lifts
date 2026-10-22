import { requireSession } from "@/lib/server/booking-session";
import { sendEmailCode } from "@/lib/server/email-verify/flow";
import { apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import type { SendCodeResponse } from "@/lib/shared/api";
import { sendEmailCodeSchema } from "@/lib/shared/validation";

/** POST /api/booking/email/send — name + email + phone; emails a 6-digit code. */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  const session = await requireSession();
  const body = await parseBody(request, sendEmailCodeSchema);
  return apiOk<SendCodeResponse>(await sendEmailCode(session, body, clientIp(request)));
});
