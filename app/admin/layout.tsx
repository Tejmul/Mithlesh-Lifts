import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = {
  title: { template: "%s · CSS Admin", default: "CSS Admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return <div className="adm">{children}</div>;
}
