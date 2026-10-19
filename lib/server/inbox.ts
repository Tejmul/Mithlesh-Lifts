import "server-only";
// In-app notifications (bell / inbox) for logged-in customers.
import type { InboxItem } from "@/generated/prisma/client";
import type { InboxItemView } from "@/lib/shared/api";
import { db, type Tx } from "./db";

export type InboxKind = InboxItemView["kind"];

const INBOX_LIMIT = 50;

/** Adds a notification for a customer (call inside the caller's transaction). */
export async function addInboxItem(
  tx: Tx,
  item: { leadId: string; kind: InboxKind; title: string; body: string; bookingId?: string; quoteId?: string },
): Promise<void> {
  await tx.inboxItem.create({
    data: {
      leadId: item.leadId,
      kind: item.kind,
      title: item.title,
      body: item.body,
      bookingId: item.bookingId ?? null,
      quoteId: item.quoteId ?? null,
    },
  });
}

function hrefFor(item: InboxItem): string | null {
  switch (item.kind) {
    case "quote_sent":
    case "payment_received":
      return item.quoteId ? `/account/quotes/${item.quoteId}` : "/account";
    default:
      return "/account";
  }
}

function toView(item: InboxItem): InboxItemView {
  return {
    id: item.id,
    kind: item.kind as InboxKind,
    title: item.title,
    body: item.body,
    createdAt: item.createdAt.toISOString(),
    read: item.readAt !== null,
    href: hrefFor(item),
  };
}

export async function listInbox(leadId: string): Promise<{ items: InboxItemView[]; unreadCount: number }> {
  const [items, count] = await Promise.all([
    db.inboxItem.findMany({
      where: { leadId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: INBOX_LIMIT,
    }),
    unreadCount(leadId),
  ]);
  return { items: items.map(toView), unreadCount: count };
}

/** Marks the given items (or all, when ids is omitted) as read. Only touches this lead's items. */
export async function markInboxRead(leadId: string, ids?: string[]): Promise<void> {
  await db.inboxItem.updateMany({
    where: { leadId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

export async function unreadCount(leadId: string): Promise<number> {
  return db.inboxItem.count({ where: { leadId, readAt: null } });
}
