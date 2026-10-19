"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { AccountResponse, InboxItemView, InboxResponse, QuoteView, QuotesResponse } from "@/lib/shared/api";
import { maskPhone } from "@/lib/shared/validation";
import { ApiError, apiFetch } from "@/components/booking/api-client";
import { fmtDate, fmtTime, fmtZoneShort } from "@/components/booking/format";

type Data = { account: AccountResponse; inbox: InboxResponse; quotes: QuoteView[] };

export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(iso));
}

const ICON: Record<InboxItemView["kind"], string> = {
  booking_confirmed: "📅",
  booking_rescheduled: "🔁",
  booking_cancelled: "✕",
  quote_sent: "₹",
  payment_received: "✓",
};

export function AccountHome() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    const [account, inbox, quotes] = await Promise.all([
      apiFetch<AccountResponse>("/api/account"),
      apiFetch<InboxResponse>("/api/account/inbox"),
      apiFetch<QuotesResponse>("/api/account/quotes"),
    ]);
    return { account, inbox, quotes: quotes.quotes };
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return router.replace("/book?login=1&next=/account");
        setError("We couldn't load your account. Check your connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [load, router, attempt]);

  async function open(item: InboxItemView) {
    if (!item.read) {
      void apiFetch<InboxResponse>("/api/account/inbox/read", { method: "POST", body: { ids: [item.id] } }).catch(() => {});
    }
    if (item.href) router.push(item.href);
    else setData((d) => d && { ...d, inbox: { ...d.inbox, items: d.inbox.items.map((i) => (i.id === item.id ? { ...i, read: true } : i)) } });
  }

  async function markAll() {
    try {
      const inbox = await apiFetch<InboxResponse>("/api/account/inbox/read", { method: "POST", body: {} });
      setData((d) => d && { ...d, inbox });
    } catch {
      /* non-critical */
    }
  }

  async function logout() {
    await fetch("/api/account/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    router.replace("/");
    router.refresh();
  }

  if (error) {
    return (
      <div className="notice notice-error" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(null); setAttempt((a) => a + 1); }}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="acct-grid" aria-busy="true">
        <span className="skeleton" style={{ height: 180 }} />
        <span className="skeleton" style={{ height: 320 }} />
      </div>
    );
  }

  const { account, upcomingBooking: call } = data.account;
  const first = account.fullName?.trim().split(/\s+/)[0];
  const openQuotes = data.quotes.filter((q) => q.status === "SENT");

  return (
    <>
      <header className="acct-head">
        <div>
          <p className="eyebrow">My account</p>
          <h1>{first ? `Hi ${first}.` : "Welcome back."}</h1>
          <p className="acct-meta">
            <span className="client-id">ID {account.clientCode}</span>
            <span>{maskPhone(account.phoneE164)}</span>
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      {openQuotes.map((q) => (
        <Link key={q.id} href={`/account/quotes/${q.id}`} className="quote-banner">
          <span>
            <span className="quote-banner-label">Your plan quote is ready</span>
            <strong>
              {q.planName} · {inr(q.amountInr)}
            </strong>
          </span>
          <span className="btn btn-primary btn-sm" aria-hidden="true">
            View & pay →
          </span>
        </Link>
      ))}

      <div className="acct-grid">
        <section className="panel" aria-labelledby="call-title">
          <h2 id="call-title" className="panel-title">
            Your call
          </h2>
          {call ? (
            <div className="call-card">
              <p className="call-when">
                {fmtDate(call.start, call.customerTimeZone)}
                <strong>
                  {fmtTime(call.start, call.customerTimeZone)} {fmtZoneShort(call.start, call.customerTimeZone)}
                </strong>
              </p>
              <p className="muted">Our sales team will call you on {maskPhone(call.phoneE164)}.</p>
              {call.manageUrl ? (
                <div className="state-actions">
                  <a className="btn btn-ghost" href={call.manageUrl}>
                    Reschedule
                  </a>
                  <a className="btn btn-danger" href={call.manageUrl}>
                    Cancel
                  </a>
                </div>
              ) : (
                <p className="field-hint">It&apos;s too close to the call to change it online. DM us on Instagram if something comes up.</p>
              )}
            </div>
          ) : (
            <div className="call-card">
              <p className="muted">You don&apos;t have a call booked.</p>
              <Link className="btn btn-primary" href="/book">
                Book a call
              </Link>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="inbox-title">
          <div className="panel-head">
            <h2 id="inbox-title" className="panel-title">
              Notifications {data.inbox.unreadCount > 0 && <span className="pill">{data.inbox.unreadCount} new</span>}
            </h2>
            {data.inbox.unreadCount > 0 && (
              <button type="button" className="link-btn" onClick={() => void markAll()}>
                Mark all read
              </button>
            )}
          </div>
          {data.inbox.items.length === 0 ? (
            <p className="muted">Nothing yet. Updates about your call and your plan quote will show up here.</p>
          ) : (
            <ul className="inbox">
              {data.inbox.items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`inbox-item${item.read ? "" : " is-unread"}`} onClick={() => void open(item)}>
                    <span className={`inbox-icon kind-${item.kind}`} aria-hidden="true">
                      {ICON[item.kind]}
                    </span>
                    <span className="inbox-text">
                      <span className="inbox-title">{item.title}</span>
                      <span className="inbox-body">{item.body}</span>
                    </span>
                    <span className="inbox-time">{ago(item.createdAt)}</span>
                    {!item.read && <span className="sr-only">(new)</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
