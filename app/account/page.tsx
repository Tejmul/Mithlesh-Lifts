import type { Metadata } from "next";
import { AccountHome } from "@/components/account/AccountHome";
import { SiteShell } from "@/components/site/SiteShell";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

export default function AccountPage() {
  return (
    <SiteShell current="none" stickyCta={false}>
      <div className="page container acct-page">
        <AccountHome />
      </div>
    </SiteShell>
  );
}
