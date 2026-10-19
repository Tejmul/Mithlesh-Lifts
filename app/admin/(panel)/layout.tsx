import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/server/admin/auth";
import { NavLinks } from "../_components/NavLinks";
import { signOutAction } from "./actions";

// Every admin page reads the session cookie, so navigations block on the server by design.
export const instant = false;

async function SignedInAs() {
  const admin = await requireAdmin();
  return <span className="adm-who">{admin.name}</span>;
}

export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="adm-shell">
      <a href="#adm-main" className="adm-skip">
        Skip to content
      </a>
      <header className="adm-side">
        <Link href="/admin" className="adm-brand">
          CSS <span>Admin</span>
        </Link>
        <nav aria-label="Admin" className="adm-nav">
          <NavLinks />
        </nav>
        <div className="adm-side-foot">
          <Suspense fallback={null}>
            <SignedInAs />
          </Suspense>
          <form action={signOutAction}>
            <button type="submit" className="adm-btn adm-btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main id="adm-main" className="adm-main">
        <Suspense fallback={<p className="adm-loading">Loading…</p>}>{children}</Suspense>
      </main>
    </div>
  );
}
