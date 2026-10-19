"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Slim mobile "Book a call" bar (CSS shows it below 820px only).
 * Appears once the visitor has scrolled past the hero, and hides while an in-page
 * primary CTA ([data-primary-cta]) is on screen, so there's one CTA per screen.
 */
export function StickyCta() {
  const [ctaVisible, setCtaVisible] = useState(false);
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    const onScroll = () => setPastHero(window.scrollY > window.innerHeight * 0.8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const targets = document.querySelectorAll("[data-primary-cta]");
    let obs: IntersectionObserver | undefined;
    if (targets.length && "IntersectionObserver" in window) {
      const visible = new Set<Element>();
      obs = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        setCtaVisible(visible.size > 0);
      });
      targets.forEach((t) => obs!.observe(t));
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      obs?.disconnect();
    };
  }, []);

  const hidden = ctaVisible || !pastHero;
  return (
    <div className={`sticky-cta${hidden ? " is-hidden" : ""}`} aria-hidden={hidden || undefined}>
      <p>Get your coaching plan</p>
      <Link className="btn btn-primary" href="/book" tabIndex={hidden ? -1 : undefined}>
        Book a call
      </Link>
    </div>
  );
}
