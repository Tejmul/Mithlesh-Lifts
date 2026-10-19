import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/site/PageIntro";
import { SiteShell } from "@/components/site/SiteShell";
import { INSTAGRAM_DM_URL, INSTAGRAM_HANDLE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for booking a call with Mithilesh Reddy.",
};

// TODO(legal): plain-language draft. Needs legal review before launch.
export default function TermsPage() {
  return (
    <SiteShell current="none">
      <article className="page prose">
        <PageIntro eyebrow="Terms" title="The short version.">
          <p>Last updated: October 2026</p>
        </PageIntro>

        <h2>The call</h2>
        <p>
          The call is a conversation about your goals, where Mithilesh recommends the approach he
          thinks fits you. Booking doesn&apos;t sign you up for anything.
        </p>

        <h2>Booking, rescheduling and cancelling</h2>
        <ul>
          <li>Please give accurate details. We verify your number so we can reach you.</li>
          <li>
            Use the link in your confirmation email to reschedule or cancel. Changes close a short while before the
            call. After that, DM us on Instagram.
          </li>
          <li>We may cancel or move a call if something comes up on our side, and we&apos;ll let you know.</li>
          <li>Please don&apos;t make repeated or fake bookings. We may block them.</li>
        </ul>

        <h2>Not medical advice</h2>
        <p>
          Fitness and nutrition guidance isn&apos;t a substitute for a doctor. Check with a medical professional before
          starting a new training or nutrition plan, especially if you have a health condition. Results vary from person
          to person.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? DM{" "}
          <a href={INSTAGRAM_DM_URL} target="_blank" rel="noopener">
            @{INSTAGRAM_HANDLE} on Instagram
            <span className="sr-only"> (opens in new tab)</span>
          </a>
          .
        </p>

        <p>
          <Link className="text-link" href="/privacy">
            Read the privacy notice <span aria-hidden="true">→</span>
          </Link>
        </p>
      </article>
    </SiteShell>
  );
}
