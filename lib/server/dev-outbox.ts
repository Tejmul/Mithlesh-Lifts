import "server-only";

/**
 * In-memory outbox used by the mock SMS and email providers (development + tests only).
 * Lets developers and the E2E test read OTPs/emails without logging them or sending real messages.
 * Exposed over HTTP only by /api/dev/outbox, which returns 404 in production.
 */
export type OutboxMessage = {
  id: string;
  channel: "sms" | "email";
  to: string;
  subject?: string;
  body: string;
  html?: string;
  createdAt: string;
};

const store = globalThis as unknown as { __cssOutbox?: OutboxMessage[] };

export function pushOutbox(msg: Omit<OutboxMessage, "id" | "createdAt">) {
  if (process.env.NODE_ENV === "production") throw new Error("Dev outbox is disabled in production");
  const list = (store.__cssOutbox ??= []);
  const entry = { ...msg, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  list.push(entry);
  if (list.length > 200) list.shift();
  return entry;
}

export function readOutbox(filter?: { to?: string; channel?: OutboxMessage["channel"] }) {
  return (store.__cssOutbox ?? []).filter(
    (m) => (!filter?.to || m.to === filter.to) && (!filter?.channel || m.channel === filter.channel),
  );
}

export function clearOutbox() {
  store.__cssOutbox = [];
}
