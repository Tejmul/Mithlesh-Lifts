import type { Metadata } from "next";
import { CallCta } from "@/components/site/CallCta";
import { PageIntro } from "@/components/site/PageIntro";
import { ResultCard } from "@/components/site/ResultCard";
import { SiteShell } from "@/components/site/SiteShell";
import { results } from "@/lib/site";

export const metadata: Metadata = {
  title: "Client results",
  description: "Before-and-after check-ins from Mithilesh Reddy's coaching clients, with the numbers they reported.",
};

export default function ResultsPage() {
  return (
    <SiteShell current="results">
      <div className="page container">
        <PageIntro eyebrow="Client results" title="Real clients. Their numbers.">
          <p>Before-and-after check-ins from people Mithilesh has coached, with the weights they reported.</p>
        </PageIntro>

        <div className="results-grid">
          {results.map((r, i) => (
            <div key={r.name} data-reveal data-reveal-delay={(i % 4) + 1}>
              <ResultCard r={r} sizes="(max-width: 640px) 100vw, (max-width: 1080px) 50vw, 25vw" />
            </div>
          ))}
        </div>
        {/* TODO: confirm written permission from each client before launch. */}
        <p className="caption">Results vary. Shared with the clients&apos; permission.</p>
      </div>
      <CallCta title="Want to be the next check-in?" />
    </SiteShell>
  );
}
