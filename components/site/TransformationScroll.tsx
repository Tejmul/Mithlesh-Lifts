"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { stages } from "@/lib/site";

/**
 * Signature moment. A tall section with a pinned frame: as the visitor scrolls, Mithilesh's photo
 * wipes from obese → skinny → muscular while a giant word behind him swaps to match.
 *
 * Scroll progress is written to CSS variables on the section (no re-render per frame):
 *   --w2, --w3  0→1 reveal of the 2nd / 3rd photo   --p  overall 0→1
 * React state only changes when the active stage changes (3 times per pass).
 * Reduced motion → the CSS renders a static three-up grid instead.
 */
export function TransformationScroll() {
  const sectionRef = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = clamp(-rect.top / Math.max(1, travel));
      // Hold each stage, then wipe: stage 1 [0, .22] · wipe → 2 [.22, .42] · hold · wipe → 3 [.6, .8] · hold.
      const w2 = clamp((p - 0.22) / 0.2);
      const w3 = clamp((p - 0.6) / 0.2);
      el.style.setProperty("--p", p.toFixed(4));
      el.style.setProperty("--w2", w2.toFixed(4));
      el.style.setProperty("--w3", w3.toFixed(4));
      setStage(w3 > 0.5 ? 2 : w2 > 0.5 ? 1 : 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    el.classList.add("is-live");
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section ref={sectionRef} className="tx" data-stage={stage} aria-labelledby="tx-title">
      <div className="tx-pin">
        <div className="tx-words" aria-hidden="true">
          {stages.map((s, i) => (
            <span key={s.key} className={`tx-word${i === stage ? " is-active" : ""}${i < stage ? " is-past" : ""}`}>
              {s.label}
            </span>
          ))}
        </div>

        <div className="tx-head">
          <p className="eyebrow">His own transformation</p>
          <h2 id="tx-title">
            No coach.
            <br />
            Just the work.
          </h2>
          <p className="tx-lede">
            Mithilesh went from obese to skinny to muscular on his own, with science-based lifting. Scroll to watch it
            happen.
          </p>
        </div>

        <div className="tx-frame">
          {stages.map((s, i) => (
            <div key={s.key} className={`tx-photo tx-photo-${i + 1}`}>
              <Image src={s.image} alt={s.alt} fill sizes="(max-width: 819px) 80vw, 420px" />
            </div>
          ))}
          <div className="tx-tag" aria-live="polite">
            <span className="tx-tag-step">0{stage + 1} / 03</span>
            <span className="tx-tag-label">{stages[stage]?.label}</span>
          </div>
        </div>

        <ol className="tx-rail" aria-label="Stages">
          {stages.map((s, i) => (
            <li key={s.key} className={i <= stage ? "is-on" : undefined}>
              {s.label}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
