import Link from "next/link";
import type { NavKey } from "@/lib/site";
import { AccountNav } from "./AccountNav";

/** Minimal header: brand, account (bell / log in), and the one action — book a call. */
export function SiteHeader({ current }: { current: NavKey }) {
  return (
    <header className="site-header">
      <div className="site-header-bar">
        <Link className="wordmark" href="/">
          <span className="wordmark-name">mithilesh_lifts</span>
          <span className="wordmark-sub">Coach Scale Systems</span>
        </Link>
        <div className="site-header-actions">
          <AccountNav />
          <Link
            className="btn btn-primary btn-sm"
            href="/book"
            aria-current={current === "book" ? "page" : undefined}
          >
            Book a call
          </Link>
        </div>
      </div>
    </header>
  );
}
