import { buildAccountResponse } from "@/lib/server/account";
import { requireCustomer, updateProfile } from "@/lib/server/customer-auth";
import { apiOk, assertSameOrigin, handler, parseBody } from "@/lib/server/http";
import type { AccountResponse } from "@/lib/shared/api";
import { profileSchema } from "@/lib/shared/validation";

/** PUT /api/account/profile — optional name + email, asked after booking → AccountResponse. */
export const PUT = handler(async (request: Request) => {
  assertSameOrigin(request);
  const lead = await requireCustomer();
  const body = await parseBody(request, profileSchema);
  const updated = await updateProfile(lead, body);
  return apiOk<AccountResponse>(await buildAccountResponse(updated), { headers: { "Cache-Control": "no-store" } });
});
