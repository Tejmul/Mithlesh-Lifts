import { connection } from "next/server";
import { buildAccountResponse } from "@/lib/server/account";
import { requireCustomer } from "@/lib/server/customer-auth";
import { apiOk, handler } from "@/lib/server/http";
import type { AccountResponse } from "@/lib/shared/api";

/** GET /api/account → AccountResponse (401 when logged out). */
export const GET = handler(async () => {
  await connection();
  const lead = await requireCustomer();
  return apiOk<AccountResponse>(await buildAccountResponse(lead), { headers: { "Cache-Control": "no-store" } });
});
