import Link from "next/link";
import { SiteShell } from "@/components/site/SiteShell";

export default function NotFound() {
  return (
    <SiteShell current="none">
      <div className="page state-page">
        <p className="eyebrow">404</p>
        <h1>That page isn&apos;t here.</h1>
        <p className="muted">The link may be old, or the address may have a typo.</p>
        <div className="state-actions">
          <Link className="btn btn-primary" href="/">
            Go home
          </Link>
          <Link className="btn btn-ghost" href="/book">
            Book a call
          </Link>
        </div>
      </div>
    </SiteShell>
  );
}
