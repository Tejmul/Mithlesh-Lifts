import type { Metadata } from "next";
import { CallCta } from "@/components/site/CallCta";
import { LakhPlate } from "@/components/site/LakhPlate";
import { PageIntro } from "@/components/site/PageIntro";
import { SiteShell } from "@/components/site/SiteShell";

export const metadata: Metadata = {
  title: "Bigg Boss Telugu 10",
  description: "Mithilesh Reddy's two days in the Bigg Boss Telugu 10 house, and the ₹15 lakh walk-out.",
};

const timeline = [
  { when: "Agnipariksha 2", what: "Picked directly by the judges in the selection round for the show." },
  {
    when: "Day 18",
    what: "Back as a contender for a wildcard spot. The housemates' vote ends in a tie with Ramakrishna.",
  },
  { when: "Day 19", what: "Wins the tie-break task and walks in as a wildcard." },
  {
    when: "Day 20",
    what: "Bigg Boss offers ₹15 lakh from the prize pot to anyone who leaves now. Mithilesh steps forward and takes it. Reported as a first for the show.",
    key: true,
  },
];

export default function BiggBossPage() {
  return (
    <SiteShell current="bigg-boss">
      <div className="page container">
        <PageIntro eyebrow="Bigg Boss Telugu 10 · Star Maa · September 2026" title="Two days in the house.">
          <p>From the Agnipariksha selection round to a wildcard entry, and a walk-out nobody had made before.</p>
        </PageIntro>

        <div className="bb-body">
          <ol className="timeline">
            {timeline.map((t) => (
              <li key={t.when} className={t.key ? "is-key" : undefined} data-reveal>
                <span className="timeline-when">{t.when}</span>
                <p>{t.what}</p>
              </li>
            ))}
          </ol>
          <div data-reveal data-reveal-delay="2">
            <LakhPlate />
          </div>
        </div>
      </div>
      <CallCta />
    </SiteShell>
  );
}
