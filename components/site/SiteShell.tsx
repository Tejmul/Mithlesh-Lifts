import type { ReactNode } from "react";
import type { NavKey } from "@/lib/site";
import { Reveal } from "./Reveal";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { StickyCta } from "./StickyCta";

/** Header + main + footer for every public page. Mobile gets a slim sticky "Book a call" bar. */
export function SiteShell({
  current,
  children,
  stickyCta = true,
}: {
  current: NavKey;
  children: ReactNode;
  stickyCta?: boolean;
}) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader current={current} />
      <main id="main" tabIndex={-1} className={stickyCta ? "has-sticky-cta" : undefined}>
        {children}
      </main>
      <SiteFooter />
      {stickyCta && <StickyCta />}
      <Reveal />
    </>
  );
}
