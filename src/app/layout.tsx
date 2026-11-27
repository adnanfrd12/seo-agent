import type { Metadata } from "next";
import { Geist, Geist_Mono, IBM_Plex_Mono, IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import { SITE } from "@/config/platforms";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* Dashboard typefaces (switched on by .dash-fonts in globals.css) */
const plexSans = IBM_Plex_Sans({ variable: "--font-dash-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false });
const plexMono = IBM_Plex_Mono({ variable: "--font-dash-mono", subsets: ["latin"], weight: ["400", "500"], preload: false });
const spaceGrotesk = Space_Grotesk({ variable: "--font-dash-display", subsets: ["latin"], weight: ["500", "600", "700"], preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.appUrl),
  title: "SEO Insights",
  description: "SEO analytics and performance dashboard",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: browser extensions (Grammarly, ColorZilla, password managers…) add attributes to
    // <html>/<body> before React loads; this ignores only those two elements' attributes, never the page content
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${plexSans.variable} ${plexMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
