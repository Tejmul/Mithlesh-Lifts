import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { CallCta } from "@/components/site/CallCta";
import { ResultCard } from "@/components/site/ResultCard";
import { SiteShell } from "@/components/site/SiteShell";
import { TransformationScroll } from "@/components/site/TransformationScroll";
import { DEFAULT_CALL_MINUTES, results } from "@/lib/site";

const stats = [
  { value: "150+", label: "Clients transformed" },
  { value: "251K", label: "Instagram followers" },
  { value: "Certified", label: "Fitness & nutrition" },
  { value: "Bigg Boss", label: "Telugu 10 contestant" },
];

const callSteps = [
  { title: "Verify your number", text: "Enter your mobile number and the code we text you. Takes 20 seconds." },
  { title: "Pick a time", text: "Choose any open slot that suits you. Times show in your own time zone." },
  {
    title: "Take the call",
    text: "Our sales team calls you, understands your goal and routine, and sends a plan and quote made for you. You decide after.",
  },
];

/** Hero load-in stagger index. */
const d = (n: number) => ({ "--d": n }) as CSSProperties;

export default function Home() {
  const teaser = results.slice(0, 2);
  return (
    <SiteShell current="home">
      {/* ---------------------------------------------------------------- hero */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-media" aria-hidden="true">
          <Image src="/mithilesh/hero-physique.jpg" alt="" fill preload sizes="(max-width: 819px) 100vw, 58vw" />
        </div>
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="eyebrow hero-in" style={d(0)}>
              mithilesh_lifts · Coach Scale Systems
            </p>
            <h1 id="hero-title" className="hero-title" aria-label="Dream. Discipline. Dominate.">
              <span className="hero-line hero-word" style={d(1)} aria-hidden="true">
                <span>Dream.</span>
              </span>
              <span className="hero-line hero-word" style={d(2)} aria-hidden="true">
                <span>Discipline.</span>
              </span>
              <span className="hero-line hero-word" style={d(3)} aria-hidden="true">
                <span className="grad-text">Dominate.</span>
              </span>
            </h1>
            <p className="hero-lede hero-in" style={d(5)}>
              From obese to muscular with no coach, just science-based lifting. Now Mithilesh and his team build the
              plan for your body. Book a {DEFAULT_CALL_MINUTES}-minute call to start.
            </p>
            <div className="hero-actions hero-in" style={d(6)}>
              <Link className="btn btn-primary btn-lg" href="/book" data-primary-cta>
                Book a call <span className="btn-arrow" aria-hidden="true">→</span>
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/results">
                See client results
              </Link>
            </div>
          </div>

          <dl className="stats hero-in" style={d(7)}>
            {stats.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------------------------------------------------------------- signature */}
      <TransformationScroll />

      {/* ---------------------------------------------------------------- results */}
      <section className="section" aria-labelledby="results-title">
        <div className="container">
          <div className="section-head section-head-row" data-reveal>
            <div>
              <p className="eyebrow">Client results</p>
              <h2 id="results-title">Same system. Their numbers.</h2>
            </div>
            <Link className="text-link" href="/results">
              See all results <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="results-grid results-grid-2">
            {teaser.map((r, i) => (
              <div key={r.name} data-reveal data-reveal-delay={i + 1}>
                <ResultCard r={r} sizes="(max-width: 640px) 100vw, 50vw" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- how it works */}
      <section className="section section-alt" aria-labelledby="how-title">
        <div className="container">
          <div className="section-head" data-reveal>
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">Three steps to your plan.</h2>
          </div>
          <ol className="steps">
            {callSteps.map((s, i) => (
              <li key={s.title} className="step-card" data-reveal data-reveal-delay={i + 1}>
                <span className="step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <CallCta />
    </SiteShell>
  );
}
