import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro } from "@/components/site/PageIntro";
import { SiteShell } from "@/components/site/SiteShell";
import { INSTAGRAM_DM_URL, INSTAGRAM_HANDLE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What we collect when you book a call with Mithilesh Reddy, why, and who helps us process it.",
};

// TODO(legal): this is a plain-language draft. Needs legal review before launch
// (e.g. India DPDP Act, GDPR for EU visitors). Do not claim any compliance certification.
export default function PrivacyPage() {
  return (
    <SiteShell current="none">
      <article className="page prose">
        <PageIntro eyebrow="Privacy" title="Your data, in plain language.">
          <p>Last updated: October 2026</p>
        </PageIntro>

        <h2>What we collect</h2>
        <p>When you book a call, we collect:</p>
        <ul>
          <li>your full name,</li>
          <li>your mobile number (verified with a one-time SMS code),</li>
          <li>your email address,</li>
          <li>the call time you choose and your time zone,</li>
          <li>
            if you came from Instagram, the ManyChat campaign name and subscriber ID from the link you tapped, so we
            know which post or message brought you here,
          </li>
          <li>whether you opted in to marketing messages (off unless you tick the box).</li>
        </ul>

        <h2>Why we collect it</h2>
        <ul>
          <li>To confirm and run your call, and to reach you if something changes.</li>
          <li>To send booking updates: confirmation, reminders, and reschedule or cancellation notices.</li>
          <li>To prevent abuse, such as fake or repeated bookings.</li>
          <li>Only if you opted in: to send you occasional coaching updates. You can opt out at any time.</li>
        </ul>

        <h2>Who helps us</h2>
        <p>We use a few service providers to run bookings. They process your data only to provide their service:</p>
        <ul>
          <li>an SMS verification provider, to send and check your one-time code (we never store the code),</li>
          <li>Resend, to send booking emails,</li>
          <li>our hosting and database providers, to run this website and store your booking.</li>
        </ul>
        <p>We don&apos;t sell your data.</p>

        <h2>How long we keep it</h2>
        <p>
          We keep booking records for as long as we need them to run calls and coaching, and for our own records
          afterwards. Unfinished booking sessions expire automatically. Ask us and we&apos;ll delete your data unless we
          have to keep it by law.
        </p>

        <h2>Your choices</h2>
        <p>
          You can ask to see, correct or delete your data, or to stop marketing messages. Send a DM to{" "}
          <a href={INSTAGRAM_DM_URL} target="_blank" rel="noopener">
            @{INSTAGRAM_HANDLE} on Instagram
            <span className="sr-only"> (opens in new tab)</span>
          </a>
          .
        </p>

        <p>
          <Link className="text-link" href="/terms">
            Read the terms <span aria-hidden="true">→</span>
          </Link>
        </p>
      </article>
    </SiteShell>
  );
}
