import type { Metadata } from "next";
import type React from "react";
import Image from "next/image";
import { CallCta } from "@/components/site/CallCta";
import { SiteShell } from "@/components/site/SiteShell";
import { StageStrip } from "@/components/site/StageStrip";
import { backPose, facts, INSTAGRAM_HANDLE, quote, socials } from "@/lib/site";

export const metadata: Metadata = {
  title: "About Mithilesh",
  description:
    "Obese to skinny to muscular with no coach. Mithilesh Reddy figured it out himself, got certified in fitness and nutrition, and has transformed 150+ clients.",
};

export default function AboutPage() {
  return (
    <SiteShell current="about">
      <div className="page container">
        <section className="about-hero" aria-labelledby="about-title">
          <div className="about-copy hero-in" style={{ "--d": 1 } as React.CSSProperties}>
            <p className="eyebrow">About Mithilesh</p>
            <h1 id="about-title">No coach. He figured it out.</h1>
            <p>
              Mithilesh didn&apos;t have a coach for his own transformation. He went from obese to skinny to muscular
              by learning science-based lifting and nutrition himself, then got certified in fitness and nutrition.
            </p>
            <p>Today he coaches others through the same process, and has transformed 150+ clients so far.</p>
          </div>
          <div className="about-photo hero-in" style={{ "--d": 2 } as React.CSSProperties}>
            <Image
              src={backPose.image}
              alt={backPose.alt}
              width={backPose.width}
              height={backPose.height}
              sizes="(max-width: 819px) 100vw, 40vw"
              preload
            />
          </div>
        </section>

        <figure className="pull-quote pull-quote-lg" data-reveal>
          <blockquote>
            <p>&ldquo;{quote.full}&rdquo;</p>
          </blockquote>
          <figcaption>Mithilesh Reddy</figcaption>
        </figure>

        <section className="section-tight" aria-labelledby="stages-title">
          <div className="section-head" data-reveal>
            <p className="eyebrow">The transformation</p>
            <h2 id="stages-title">Obese, then skinny, then muscular.</h2>
          </div>
          <StageStrip headingId="stages-title" />
        </section>

        <section className="section-tight" aria-labelledby="facts-title">
          <h2 id="facts-title" className="sr-only">
            Quick facts
          </h2>
          <dl className="facts" data-reveal>
            {facts.map((f) => (
              <div key={f.label} className="card">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="section-tight" aria-labelledby="follow-title">
          <h2 id="follow-title" className="h3">
            Follow along
          </h2>
          <ul className="socials">
            {socials.map((s) => (
              <li key={s.name}>
                <a href={s.href} target="_blank" rel="noopener">
                  <span className="socials-name">{s.name}</span>@{INSTAGRAM_HANDLE}
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <CallCta />
    </SiteShell>
  );
}
