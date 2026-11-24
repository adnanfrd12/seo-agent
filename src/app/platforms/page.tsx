import type { Metadata } from "next";
import Link from "next/link";
import { publicPlatforms, SITE } from "@/config/platforms";
import { A, LEGAL_UPDATED, PublicHeader } from "@/components/legal/legal-page";
import { PlatformCard } from "@/components/legal/platform-blocks";
import { SiteFooter } from "@/components/legal/site-footer";

export const metadata: Metadata = {
  title: "Connected platforms and permissions · SEO Insights",
  description: "Every platform SEO Insights connects to, the read-only permissions it requests, why, and how to disconnect.",
  alternates: { canonical: "/platforms" },
};

export default function PlatformsPage() {
  const list = publicPlatforms();
  return (
    <div className="flex min-h-dvh flex-col bg-[#FBF8F5] text-[#1f1f25]">
      <PublicHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 lg:py-14">
        <div className="max-w-[70ch]">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">Permissions</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Connected platforms and permissions</h1>
          <p className="mt-2 text-sm text-[#6b6b76]">Last updated: {LEGAL_UPDATED}</p>
          <p className="mt-6 text-[15px] leading-7 text-[#3a3a42]">SEO Insights connects to the platforms below with <strong className="text-[#1f1f25]">read-only</strong> access, only when an authorized person connects a business account. We never post, message or change anything. Each platform&apos;s data is used only to show the account owner their own performance.</p>
          <nav aria-label="Platforms" className="mt-5">
            <ul className="flex flex-wrap gap-2 text-sm">
              {list.map((p) => <li key={p.id}><a href={`#platform-${p.id.replace(/_/g, "-")}`} className="inline-block rounded-full border border-[#EEE9E4] bg-white px-3 py-1 text-[#3a3a42] outline-none hover:border-[#F26A1B] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">{p.name}</a></li>)}
            </ul>
          </nav>
        </div>
        <div className="mt-8 space-y-5">{list.map((p) => <PlatformCard key={p.id} p={p} />)}</div>
        <p className="mt-8 text-[15px] leading-7 text-[#3a3a42]">More: <Link href="/privacy" className={A}>Privacy Policy</Link> · <Link href="/data-deletion" className={A}>Data Deletion</Link> · questions to <a href={`mailto:${SITE.email}`} className={A}>{SITE.email}</a></p>
      </main>
      <SiteFooter />
    </div>
  );
}
