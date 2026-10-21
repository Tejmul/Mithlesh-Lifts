import type { Metadata } from "next";
import { Suspense } from "react";
import { QuoteDetail } from "@/components/account/QuoteDetail";
import { SiteShell } from "@/components/site/SiteShell";

export const metadata: Metadata = { title: "Your plan quote", robots: { index: false } };

async function Quote({ params }: { params: PageProps<"/account/quotes/[id]">["params"] }) {
  const { id } = await params;
  return <QuoteDetail id={id} />;
}

export default function QuotePage({ params }: PageProps<"/account/quotes/[id]">) {
  return (
    <SiteShell current="none" stickyCta={false}>
      <div className="narrow-page page">
        <Suspense fallback={<div className="wizard-card" aria-busy="true" />}>
          <Quote params={params} />
        </Suspense>
      </div>
    </SiteShell>
  );
}
