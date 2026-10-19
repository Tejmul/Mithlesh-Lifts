import { requireSession, toSessionView } from "@/lib/server/booking-session";
import { apiOk, assertSameOrigin, clientIp, handler, parseBody } from "@/lib/server/http";
import { createAccountForSession } from "@/lib/server/phone-verify/flow";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { hashToken } from "@/lib/server/crypto";
import type { SessionResponse } from "@/lib/shared/api";
import { createAccountSchema } from "@/lib/shared/validation";

/** POST /api/booking/account — finish creating the account (name) after phone verification. */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  await enforceRateLimit(`account-create:ip:${hashToken(clientIp(request))}`, 20, 3600);
  const session = await requireSession();
  const { fullName } = await parseBody(request, createAccountSchema);
  const updated = await createAccountForSession(session, fullName);
  return apiOk<SessionResponse>({ session: await toSessionView(updated) }, { headers: { "Cache-Control": "no-store" } });
});
