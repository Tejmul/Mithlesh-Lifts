import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { BookingWizard } from "@/components/booking/BookingWizard";
import { SiteShell } from "@/components/site/SiteShell";
import { portrait } from "@/lib/site";

export const metadata: Metadata = {
  title: "Book a call",
  description: "Book a short call with the Coach Scale Systems team to talk through your goals and the right coaching plan for you.",
};

function WizardFallback() {
  return (
    <div className="wizard-card" aria-busy="true">
      <div className="wizard-skeleton" aria-hidden="true">
        <span className="skeleton" style={{ width: "40%", height: 14 }} />
        <span className="skeleton" style={{ height: 6 }} />
        <span className="skeleton" style={{ width: "60%", height: 28, marginTop: 20 }} />
        <span className="skeleton" style={{ height: 52 }} />
        <span className="skeleton" style={{ height: 52 }} />
      </div>
    </div>
  );
}

export default function BookPage() {
  return (
    <SiteShell current="book" stickyCta={false}>
      <div className="page book-page">
        <div className="book-main">
          <header className="book-intro">
            <p className="eyebrow">30-minute call with our team</p>
            <h1>Let&apos;s build your fitness plan.</h1>
            <p className="muted">A short call to understand your goals and work out the right approach.</p>
          </header>
          <Suspense fallback={<WizardFallback />}>
            <BookingWizard />
          </Suspense>
        </div>

        <aside className="book-aside" aria-labelledby="expect-title">
          <div className="book-aside-photo">
            <Image src={portrait.image} alt={portrait.alt} width={portrait.width} height={portrait.height} sizes="320px" />
          </div>
          <h2 id="expect-title" className="h3">
            What happens on the call
          </h2>
          <ul className="tick-list">
            <li>Our team calls you on your verified number at the time you pick.</li>
            <li>They ask about your goal, current routine and what&apos;s been getting in the way.</li>
            <li>They recommend the right coaching plan and send you a personalised quote afterwards.</li>
            <li>You decide after. No obligation.</li>
          </ul>
        </aside>
      </div>
    </SiteShell>
  );
}
