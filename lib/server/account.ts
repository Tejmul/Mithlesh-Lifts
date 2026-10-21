import "server-only";
// What /account shows: the customer, their next call, unread count and paid plan.
import type { Lead } from "@/generated/prisma/client";
import type { AccountResponse } from "@/lib/shared/api";
import { findUpcomingBookingForPhone, toBookingView } from "./bookings/service";
import { toAccountSummary } from "./customer-auth";
import { unreadCount } from "./inbox";
import { currentMembershipForLead, toPlanView } from "./memberships";

export async function buildAccountResponse(lead: Lead): Promise<AccountResponse> {
  const [upcoming, unread, plan] = await Promise.all([
    findUpcomingBookingForPhone(lead.phoneE164),
    unreadCount(lead.id),
    currentMembershipForLead(lead.id),
  ]);
  return {
    account: toAccountSummary(lead),
    upcomingBooking: upcoming ? await toBookingView(upcoming) : null,
    unreadCount: unread,
    plan: plan ? toPlanView(plan) : null,
  };
}
