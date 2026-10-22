import { requireSession, toSessionView } from "@/lib/server/booking-session";
import { completeDetails } from "@/lib/server/email-verify/flow";
import { apiOk, assertSameOrigin, handler, parseBody } from "@/lib/server/http";
import type { SessionResponse } from "@/lib/shared/api";
import { detailsSchema } from "@/lib/shared/validation";

/** POST /api/booking/details — name + phone after a "Log in" with a new email; creates the account. */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  const session = await requireSession();
  const body = await parseBody(request, detailsSchema);
  const updated = await completeDetails(session, body);
  return apiOk<SessionResponse>({ session: await toSessionView(updated) }, { headers: { "Cache-Control": "no-store" } });
});
