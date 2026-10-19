import { connection } from "next/server";
import { findUpcomingBookingForPhone, toBookingView } from "@/lib/server/bookings/service";
import { requireCustomer, toAccountSummary } from "@/lib/server/customer-auth";
import { apiOk, handler } from "@/lib/server/http";
import { unreadCount } from "@/lib/server/inbox";
import type { AccountResponse } from "@/lib/shared/api";

/** GET /api/account → AccountResponse (401 when logged out). */
export const GET = handler(async () => {
  await connection();
  const lead = await requireCustomer();
  const [upcoming, unread] = await Promise.all([findUpcomingBookingForPhone(lead.phoneE164), unreadCount(lead.id)]);
  return apiOk<AccountResponse>(
    {
      account: toAccountSummary(lead),
      upcomingBooking: upcoming ? await toBookingView(upcoming) : null,
      unreadCount: unread,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
