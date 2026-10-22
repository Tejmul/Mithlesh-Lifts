import "server-only";
// What /account shows: the customer, their next call, unread count and paid plan.
import type { Lead } from "@/generated/prisma/client";
import type { AccountResponse } from "@/lib/shared/api";
import { findUpcomingBookingForLead, toBookingView } from "./bookings/service";
import { toAccountSummary } from "./customer-auth";
import { unreadCount } from "./inbox";
import { currentMembershipForLead, toPlanView } from "./memberships";
import { getSettings } from "./settings";

export async function buildAccountResponse(lead: Lead): Promise<AccountResponse> {
  const [upcoming, unread, plan, settings] = await Promise.all([
    findUpcomingBookingForLead(lead.id),
    unreadCount(lead.id),
    currentMembershipForLead(lead.id),
    getSettings(),
  ]);
  return {
    account: toAccountSummary(lead),
    upcomingBooking: upcoming ? await toBookingView(upcoming) : null,
    unreadCount: unread,
    plan: plan ? toPlanView(plan, settings.coachTimeZone) : null,
  };
}
