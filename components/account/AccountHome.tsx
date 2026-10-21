"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountResponse, BookingView, InboxItemView, InboxResponse, PlanView, QuoteView, QuotesResponse } from "@/lib/shared/api";
import { maskPhone, profileSchema } from "@/lib/shared/validation";
import { ApiError, apiFetch } from "@/components/booking/api-client";
import { fmtDate, fmtTime, fmtZoneShort, googleCalendarUrl } from "@/components/booking/format";

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

const SKIP_EMAIL_KEY = "css_skip_email";

function readSkip() {
  try {
    return window.localStorage.getItem(SKIP_EMAIL_KEY) === "1";
  } catch {
    return false;
  }
}

/** docs/FLOW.md ③ + ⑥: confirmation after booking, quote to pay, plan, optional email, call, notifications. */
export function AccountHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justBooked = searchParams.get("booked") === "1";
  const [emailSkipped, setEmailSkipped] = useState(true);
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
      .then((d) => {
        if (cancelled) return;
        // Read with the data (client-only) so the server render never touches storage.
        setEmailSkipped(readSkip());
        setData(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return router.replace("/book?next=/account");
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

  const { account, upcomingBooking: call, plan } = data.account;
  const first = account.fullName?.trim().split(/\s+/)[0];
  const openQuotes = data.quotes.filter((q) => q.status === "SENT");
  const askEmail = !account.email && (justBooked || !emailSkipped);
  // Right after booking the hero already shows the call: don't repeat it.
  const showCallPanel = !(justBooked && call);

  return (
    <>
      <header className="acct-head">
        <div>
          <p className="eyebrow">My account</p>
          <h1>{first ? `Hi ${first}.` : justBooked ? "You're in." : "Welcome back."}</h1>
          <p className="acct-meta">
            <span className="client-id">ID {account.clientCode}</span>
            <span>{maskPhone(account.phoneE164)}</span>
          </p>
        </div>
        <button type="button" className="link-btn acct-logout" onClick={() => void logout()}>
          Log out
        </button>
      </header>

      {justBooked && call && <BookedHero call={call} />}

      {openQuotes.map((q) => (
        <Link key={q.id} href={`/account/quotes/${q.id}`} className="quote-banner">
          <span>
            <span className="quote-banner-label">Your plan quote is ready</span>
            <strong>
              {[q.planName, q.duration, inr(q.amountInr)].filter(Boolean).join(" · ")}
            </strong>
          </span>
          <span className="btn btn-primary btn-sm" aria-hidden="true">
            View & pay →
          </span>
        </Link>
      ))}

      {plan && <PlanCard plan={plan} />}

      {askEmail && (
        <ProfileCard
          initialName={account.fullName ?? ""}
          askName={!account.fullName}
          onSaved={(next) => setData((d) => d && { ...d, account: next })}
          onSkip={() => {
            try {
              window.localStorage.setItem(SKIP_EMAIL_KEY, "1");
            } catch {
              /* private mode: skipping just won't be remembered */
            }
            setEmailSkipped(true);
            if (justBooked) router.replace("/account");
          }}
        />
      )}

      <div className={`acct-grid${showCallPanel ? "" : " is-single"}`}>
        {showCallPanel && (
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
              <CallActions call={call} />
            </div>
          ) : (
            <div className="call-card">
              <p className="muted">{plan ? "No call booked. Need to talk to the team?" : "You don't have a call booked."}</p>
              <Link className="btn btn-primary" href="/book">
                Book a call
              </Link>
            </div>
          )}
        </section>
        )}

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

function BookedHero({ call }: { call: BookingView }) {
  const tz = call.customerTimeZone;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const calUrl = googleCalendarUrl({
    title: "Coaching call · mithilesh_lifts",
    start: call.start,
    end: call.end,
    details: `Our team will call you on ${call.phoneE164}. Booking reference ${call.reference}.`,
  });
  return (
    <section className="booked-hero" aria-labelledby="booked-title">
      <span className="confirm-badge" aria-hidden="true" />
      <div>
        <h2 id="booked-title" ref={headingRef} tabIndex={-1}>
          You&apos;re booked.
        </h2>
        <p>
          Our team will call you on <strong>{maskPhone(call.phoneE164)}</strong> at{" "}
          <strong>
            {fmtTime(call.start, tz)} {fmtZoneShort(call.start, tz)}
          </strong>
          , {fmtDate(call.start, tz)}. After the call, your personalised plan quote shows up right here.
        </p>
        <a className="text-link" href={calUrl} target="_blank" rel="noopener">
          Add to Google Calendar<span className="sr-only"> (opens in new tab)</span>
        </a>
        <CallActions call={call} />
      </div>
    </section>
  );
}

const PLAN_LABEL: Record<PlanView["status"], string> = {
  upcoming: "Starts",
  active: "Active until",
  expiring: "Ends soon:",
  expired: "Ended",
};

function PlanCard({ plan }: { plan: PlanView }) {
  const day = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  return (
    <section className={`plan-card plan-${plan.status}`} aria-labelledby="plan-title">
      <p className="quote-banner-label">Your plan</p>
      <h2 id="plan-title">{plan.planName}</h2>
      <p className="muted">
        {PLAN_LABEL[plan.status]} <strong>{day(plan.status === "upcoming" ? plan.validFrom : plan.validUntil)}</strong>
        {plan.status === "expired" ? ". Talk to the team to renew." : ""}
      </p>
    </section>
  );
}

function ProfileCard({
  initialName,
  askName,
  onSaved,
  onSkip,
}: {
  initialName: string;
  askName: boolean;
  onSaved: (res: AccountResponse) => void;
  onSkip: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState(initialName);
  const [errors, setErrors] = useState<{ email?: string; fullName?: string; form?: string }>({});
  const [pending, setPending] = useState(false);

  async function save() {
    const parsed = profileSchema.safeParse({ email, ...(askName ? { fullName: name } : {}) });
    if (!parsed.success || !parsed.data.email) {
      const byField = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
      setErrors({ email: byField.email ?? (email.trim() ? undefined : "Enter your email, or tap Skip."), fullName: byField.fullName });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const res = await apiFetch<AccountResponse>("/api/account/profile", { method: "PUT", body: parsed.data });
      onSaved(res);
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.fields) return setErrors({ email: err.fields.email, fullName: err.fields.fullName });
      setErrors({ form: err instanceof ApiError ? err.message : "Couldn't save. Check your connection and try again." });
    }
  }

  return (
    <section className="panel profile-card" aria-labelledby="profile-title">
      <div>
        <h2 id="profile-title" className="panel-title">
          Get updates by email <span className="muted profile-optional">(optional)</span>
        </h2>
        <p className="muted">Call reminders, your plan quote and payment receipt. Everything also shows up here.</p>
      </div>
      <form
        noValidate
        className="profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {askName && (
          <div className={`field${errors.fullName ? " has-error" : ""}`}>
            <label htmlFor="profile-name">Your name</label>
            <input
              id="profile-name"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              placeholder="Rahul Sharma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.fullName ? true : undefined}
              aria-describedby={errors.fullName ? "profile-name-error" : undefined}
              maxLength={80}
            />
            {errors.fullName && (
              <p id="profile-name-error" className="field-error">
                {errors.fullName}
              </p>
            )}
          </div>
        )}
        <div className={`field${errors.email ? " has-error" : ""}`}>
          <label htmlFor="profile-email">Email</label>
          <input
            id="profile-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "profile-email-error" : undefined}
            maxLength={254}
          />
          {errors.email && (
            <p id="profile-email-error" className="field-error">
              {errors.email}
            </p>
          )}
        </div>
        {errors.form && (
          <p className="notice notice-error" role="alert">
            {errors.form}
          </p>
        )}
        <div className="state-actions">
          <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onSkip} disabled={pending}>
            Skip
          </button>
        </div>
      </form>
    </section>
  );
}

/** Reschedule is the main action; cancelling stays available but quiet. */
function CallActions({ call }: { call: BookingView }) {
  if (!call.manageUrl) {
    return <p className="field-hint">It&apos;s too close to the call to change it online. DM us on Instagram if something comes up.</p>;
  }
  return (
    <p className="call-actions">
      <a className="btn btn-ghost btn-sm" href={call.manageUrl}>
        Reschedule
      </a>
      <a className="call-cancel" href={call.manageUrl}>
        Can&apos;t make it? Cancel
      </a>
    </p>
  );
}
