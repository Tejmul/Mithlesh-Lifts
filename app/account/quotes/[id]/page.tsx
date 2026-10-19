import type { Metadata } from "next";
import { QuoteDetail } from "@/components/account/QuoteDetail";
import { SiteShell } from "@/components/site/SiteShell";

export const metadata: Metadata = { title: "Your plan quote", robots: { index: false } };

export default async function QuotePage({ params }: PageProps<"/account/quotes/[id]">) {
  const { id } = await params;
  return (
    <SiteShell current="none" stickyCta={false}>
      <div className="narrow-page page">
        <QuoteDetail id={id} />
      </div>
    </SiteShell>
  );
}
