import Image from "next/image";
import Link from "next/link";
import { DEFAULT_CALL_MINUTES, quote } from "@/lib/site";

/** Closing "Book a call" band on every content page. Server component. */
export function CallCta({ title = "Ready to start?" }: { title?: string }) {
  return (
    <section className="cta" aria-labelledby="cta-title">
      <div className="container">
        <div className="cta-card" data-reveal>
          <div className="cta-copy">
            <p className="eyebrow">{DEFAULT_CALL_MINUTES}-minute call · no obligation</p>
            <h2 id="cta-title">{title}</h2>
            <p>
              Pick a time that works for you. Our sales team calls you, understands your goal, and sends a plan and
              quote made for you.
            </p>
            <Link className="btn btn-primary btn-lg" href="/book" data-primary-cta>
              Book a call <span className="btn-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
          <figure className="cta-quote">
            <div className="cta-photo">
              <Image src="/mithilesh/portrait.jpg" alt="" fill sizes="(max-width: 819px) 40vw, 260px" />
            </div>
            <blockquote>
              <p>&ldquo;{quote.short}&rdquo;</p>
              <footer>Mithilesh Reddy</footer>
            </blockquote>
          </figure>
        </div>
      </div>
    </section>
  );
}
