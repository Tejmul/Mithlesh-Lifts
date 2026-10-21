import type { MembershipStatus } from "@/lib/server/memberships";

const LABEL: Record<MembershipStatus, string> = {
  upcoming: "Starts later",
  active: "Active",
  expiring: "Expiring soon",
  expired: "Expired",
};

export function PlanBadge({ status }: { status: MembershipStatus }) {
  return <span className={`adm-badge adm-badge-${status}`}>{LABEL[status]}</span>;
}
