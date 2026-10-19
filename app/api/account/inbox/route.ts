import { connection } from "next/server";
import { requireCustomer } from "@/lib/server/customer-auth";
import { apiOk, handler } from "@/lib/server/http";
import { listInbox } from "@/lib/server/inbox";
import type { InboxResponse } from "@/lib/shared/api";

/** GET /api/account/inbox → InboxResponse (newest first, up to 50). */
export const GET = handler(async () => {
  await connection();
  const lead = await requireCustomer();
  return apiOk<InboxResponse>(await listInbox(lead.id), { headers: { "Cache-Control": "no-store" } });
});
