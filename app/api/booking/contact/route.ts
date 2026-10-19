import { requireSession, toSessionView } from "@/lib/server/booking-session";
import { apiOk, assertSameOrigin, handler, parseBody } from "@/lib/server/http";
import { saveContact } from "@/lib/server/phone-verify/flow";
import type { SessionResponse } from "@/lib/shared/api";
import { contactSchema } from "@/lib/shared/validation";

/** PUT /api/booking/contact — save name + email (requires a verified phone). */
export const PUT = handler(async (request: Request) => {
  assertSameOrigin(request);
  const session = await requireSession();
  const body = await parseBody(request, contactSchema);
  const updated = await saveContact(session, body);
  return apiOk<SessionResponse>({ session: await toSessionView(updated) });
});
