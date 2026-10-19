import { requireSession } from "@/lib/server/booking-session";
import { apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import { sendPhoneCode } from "@/lib/server/phone-verify/flow";
import type { SendCodeResponse } from "@/lib/shared/api";
import { sendCodeSchema } from "@/lib/shared/validation";

/** POST /api/booking/phone/send — send an OTP to the visitor's mobile. */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  const session = await requireSession();
  const body = await parseBody(request, sendCodeSchema);
  return apiOk<SendCodeResponse>(await sendPhoneCode(session, body, clientIp(request)));
});
