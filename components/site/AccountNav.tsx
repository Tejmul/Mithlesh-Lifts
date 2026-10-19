"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AccountResponse } from "@/lib/shared/api";

type State = { status: "loading" } | { status: "out" } | { status: "in"; unread: number; name: string | null };

/** Bell with unread count when logged in, "Log in" otherwise. */
export function AccountNav() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setState({ status: "out" });
        const data = (await res.json()) as AccountResponse;
        setState({ status: "in", unread: data.unreadCount, name: data.account.fullName });
      })
      .catch(() => !cancelled && setState({ status: "out" }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <span className="acct-slot" aria-hidden="true" />;

  if (state.status === "out") {
    return (
      <Link className="nav-login" href="/book?login=1">
        Log in
      </Link>
    );
  }

  const label = state.unread
    ? `My account, ${state.unread} new notification${state.unread === 1 ? "" : "s"}`
    : "My account and notifications";
  return (
    <Link className="bell" href="/account" aria-label={label}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 3.5a2 2 0 0 0 4 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {state.unread > 0 && <span className="bell-count">{state.unread > 9 ? "9+" : state.unread}</span>}
    </Link>
  );
}
