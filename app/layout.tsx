import type { Metadata, Viewport } from "next";
import { Archivo, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Archivo's width axis carries the display system: wide for headlines, condensed for labels
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "mithilesh_lifts · Coach Scale Systems",
    template: "%s · mithilesh_lifts",
  },
  description:
    "Obese to skinny to muscular, with no coach. Certified fitness and nutrition coach Mithilesh Reddy has transformed 150+ clients. Book a call to find the right approach for you.",
  openGraph: {
    title: "mithilesh_lifts · Coach Scale Systems",
    description: "Science-based lifting coaching. Book a call with Mithilesh.",
    images: ["/mithilesh/hero-physique.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0E0F11",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${hanken.variable}`}>
      <body>{children}</body>
    </html>
  );
}
