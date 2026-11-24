import type { Metadata } from "next";
import Link from "next/link";
import { publicPlatforms, SITE } from "@/config/platforms";
import { A, LEGAL_UPDATED } from "@/components/legal/legal-page";
import { PlatformCard } from "@/components/legal/platform-blocks";
import { COLUMN, PageIntro, PublicShell } from "@/components/public/site-chrome";

export const metadata: Metadata = {
  title: "Connected platforms and permissions · SEO Insights",
  description: "Every platform SEO Insights connects to, the read-only permissions it requests, why, and how to disconnect.",
  alternates: { canonical: "/platforms" },
};

export default function PlatformsPage() {
  const list = publicPlatforms();
  return (
    <PublicShell>
      <PageIntro eyebrow="Permissions" title="Connected platforms and permissions" updated={LEGAL_UPDATED}>
        <p>SEO Insights connects to the platforms below with <strong className="font-semibold text-[#17120E]">read-only</strong> access, only when an authorized person connects a business account. We never post, message or change anything. Each platform&apos;s data is used only to show the account owner their own performance.</p>
      </PageIntro>
      <main className={`${COLUMN} pb-20`}>
        <nav aria-label="Platforms" className="py-10">
          <ul className="flex flex-wrap gap-2 text-[15px]">
            {list.map((p) => <li key={p.id}><a href={`#platform-${p.id.replace(/_/g, "-")}`} className="inline-block rounded-full border border-[#17120E]/15 px-4 py-1.5 text-[#3A332D] outline-none transition hover:border-[#17120E] hover:text-[#17120E] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">{p.name}</a></li>)}
          </ul>
        </nav>
        <div className="border-b border-[#17120E]/12">{list.map((p) => <PlatformCard key={p.id} p={p} />)}</div>
        <p className="mt-10 text-[17px] leading-7 text-[#3A332D]">More: <Link href="/privacy" className={A}>Privacy Policy</Link> · <Link href="/data-deletion" className={A}>Data Deletion</Link> · questions to <a href={`mailto:${SITE.email}`} className={A}>{SITE.email}</a></p>
      </main>
    </PublicShell>
  );
}
