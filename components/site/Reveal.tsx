"use client";

import { useEffect } from "react";

/**
 * Slide-up-on-scroll for any element with [data-reveal]. One observer for the whole page.
 * Hidden state lives in CSS behind `@media (scripting: enabled) and (prefers-reduced-motion: no-preference)`,
 * so content is always visible without JS or with reduced motion.
 * Optional stagger: data-reveal-delay="1".."4".
 */
export function Reveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          obs.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);
  return null;
}
