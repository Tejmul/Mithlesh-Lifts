import { z } from "zod";
import { requireCustomer } from "@/lib/server/customer-auth";
import { apiOk, assertSameOrigin, handler, parseBody } from "@/lib/server/http";
import { listInbox, markInboxRead } from "@/lib/server/inbox";
import type { InboxResponse } from "@/lib/shared/api";

const markReadSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(100).optional() });

/** POST /api/account/inbox/read { ids? } — omit ids to mark everything read → InboxResponse. */
export const POST = handler(async (request: Request) => {
  assertSameOrigin(request);
  const lead = await requireCustomer();
  const { ids } = await parseBody(request, markReadSchema);
  await markInboxRead(lead.id, ids);
  return apiOk<InboxResponse>(await listInbox(lead.id), { headers: { "Cache-Control": "no-store" } });
});
