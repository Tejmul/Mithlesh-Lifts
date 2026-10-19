"use client";

import { useEffect, useRef, useState } from "react";

// A yellow competition plate is 15 kg. The Bigg Boss offer was ₹15 lakh.
export function LakhPlate() {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <figure ref={ref} className={`big-plate${inView ? " is-in" : ""}`}>
      <svg viewBox="0 0 400 400" role="img" aria-label="A yellow 15 kg plate, marked 15 lakh rupees">
        <circle cx="200" cy="200" r="196" className="plate-face" />
        <circle cx="200" cy="200" r="168" className="plate-ring" />
        <circle cx="200" cy="200" r="40" className="plate-hub" />
        <circle cx="200" cy="200" r="25" className="plate-hole" />
        <text x="200" y="138" className="plate-num" textAnchor="middle">
          ₹15
        </text>
        <text x="200" y="310" className="plate-unit" textAnchor="middle">
          LAKH
        </text>
      </svg>
      <figcaption>
        A yellow competition plate weighs 15 kg. The offer was ₹15 lakh. He said the equations in the
        house weren&apos;t going to change, so he took it.
      </figcaption>
    </figure>
  );
}
