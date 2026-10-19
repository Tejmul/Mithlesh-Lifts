import Link from "next/link";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <p className="wordmark-name">mithilesh_lifts</p>
          <p className="muted">Coach Scale Systems · Dream. Discipline. Dominate.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="footer-links">
            <li>
              <Link href="/book">Book a call</Link>
            </li>
            <li>
              <Link href="/privacy">Privacy</Link>
            </li>
            <li>
              <Link href="/terms">Terms</Link>
            </li>
            <li>
              <a href={INSTAGRAM_URL} target="_blank" rel="noopener">
                Instagram @{INSTAGRAM_HANDLE}
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            </li>
          </ul>
        </nav>
        <p className="footer-small">© 2026 mithilesh_lifts · Mithilesh Reddy. Results vary from person to person.</p>
      </div>
    </footer>
  );
}
