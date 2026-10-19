const LABEL: Record<string, string> = {
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
  PENDING: "Pending",
  SENDING: "Sending",
  SENT: "Sent",
  FAILED: "Failed",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`adm-badge adm-badge-${status.toLowerCase()}`}>{LABEL[status] ?? status}</span>;
}
