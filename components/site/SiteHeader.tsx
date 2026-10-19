"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { navLinks, type NavKey } from "@/lib/site";

/** Shared header. `current` comes from the page (no usePathname, so dynamic routes can prerender). */
export function SiteHeader({ current }: { current: NavKey }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onResize = () => {
      if (window.matchMedia("(min-width: 820px)").matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header className={`site-header${open ? " is-open" : ""}`}>
      <div className="site-header-bar">
        <Link className="wordmark" href="/" onClick={() => setOpen(false)}>
          <span className="wordmark-name">mithilesh_lifts</span>
          <span className="wordmark-sub">Coach Scale Systems</span>
        </Link>

        <nav className="site-nav" aria-label="Main">
          <ul>
            {navLinks.map((l) => (
              <li key={l.key}>
                <Link href={l.href} aria-current={current === l.key ? "page" : undefined}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-header-actions">
          <Link
            className="btn btn-primary btn-sm"
            href="/book"
            aria-current={current === "book" ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            Book a call
          </Link>
          <button
            ref={buttonRef}
            type="button"
            className="menu-toggle"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="menu-icon" aria-hidden="true" />
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
      </div>

      <nav id={menuId} className="mobile-nav" aria-label="Main (mobile)" hidden={!open}>
        <ul>
          {navLinks.map((l) => (
            <li key={l.key}>
              <Link
                href={l.href}
                aria-current={current === l.key ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li className="mobile-nav-cta">
            <Link className="btn btn-primary btn-block" href="/book" onClick={() => setOpen(false)}>
              Book a call
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
