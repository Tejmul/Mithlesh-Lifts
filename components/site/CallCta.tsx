import Image from "next/image";
import Link from "next/link";
import { DEFAULT_CALL_MINUTES, quote } from "@/lib/site";

const FACTS = [
  { value: `${DEFAULT_CALL_MINUTES} min`, label: "Phone call with our team" },
  { value: "1:1", label: "Plan built around you" },
  { value: "150+", label: "Clients transformed" },
];

/** Closing "Book a call" band on every content page: copy + facts on one side, Mithilesh full-height on the other. */
export function CallCta({ title = "Ready to start?" }: { title?: string }) {
  return (
    <section className="cta" aria-labelledby="cta-title">
      <div className="container">
        <div className="cta-card" data-reveal>
          <div className="cta-copy">
            <p className="eyebrow">{DEFAULT_CALL_MINUTES}-min call · No obligation</p>
            <h2 id="cta-title">{title}</h2>
            <p className="cta-lede">
              Pick a time that works for you. Our team calls you, understands your goal, and sends a plan and quote
              made for you.
            </p>
            <div className="cta-actions">
              <Link className="btn btn-primary btn-lg" href="/book" data-primary-cta>
                Book a call <span className="btn-arrow" aria-hidden="true">→</span>
              </Link>
              <span className="cta-note">Takes under a minute. You only need your phone number.</span>
            </div>
            <dl className="cta-facts">
              {FACTS.map((f) => (
                <div key={f.label}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <figure className="cta-figure">
            <Image src="/mithilesh/portrait.jpg" alt="Mithilesh Reddy" fill sizes="(max-width: 819px) 100vw, 480px" />
            <blockquote className="cta-quote">
              <p>&ldquo;{quote.short}&rdquo;</p>
              <footer>
                <strong>Mithilesh Reddy</strong>
                <span>Certified fitness &amp; nutrition coach</span>
              </footer>
            </blockquote>
          </figure>
        </div>
      </div>
    </section>
  );
}
