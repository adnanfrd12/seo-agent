import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { BRAND_NAME } from "@/components/brand/brand-mark";
import { AnalyticsIcon, BusinessProfileIcon } from "@/components/brand/google-icons";
import { BingIcon, ClarityIcon, SearchConsoleIcon } from "@/components/login/login-icons";
import { LoginPreview } from "@/components/login/login-preview";
import { accessMailto, SITE } from "@/config/platforms";
import { publicFonts } from "./fonts";
import styles from "./landing.module.css";
import { COLUMN, PublicFooter, PublicNav, SERIF } from "./site-chrome";


const CAPABILITIES = [
  { n: "01", title: "SEO analytics", text: "Search Console queries, pages, positions and indexing, Google Analytics traffic and leads, Bing and Clarity — joined up, with history, alerts and cannibalisation checks." },
  { n: "02", title: "Social media analytics", text: "Followers, reach and engagement for Facebook, Instagram, YouTube, LinkedIn, TikTok, X, Pinterest and Threads, side by side and over time." },
  { n: "03", title: "Competitor research", text: "Keyword gaps, ranking competitors, backlinks, local map pack and live search results for the city you actually serve." },
  { n: "04", title: "AI intelligence", text: "Claude reads every source and returns ranked quick wins with the page, the change, the reason and the expected gain — never invented numbers." },
  { n: "05", title: "Automated reporting", text: "Nightly syncs, client-ready PDF reports and alerts when clicks, rankings or reviews move, so nobody has to assemble a spreadsheet again." },
];

const SOURCES = [
  { icon: <SearchConsoleIcon />, name: "Search Console" },
  { icon: <AnalyticsIcon className="size-8" />, name: "Google Analytics 4" },
  { icon: <BusinessProfileIcon className="size-8" />, name: "Business Profile" },
  { icon: <BingIcon />, name: "Bing Webmaster" },
  { icon: <ClarityIcon />, name: "Microsoft Clarity" },
];
const SOCIAL = ["Facebook", "Instagram", "YouTube", "LinkedIn", "TikTok", "X", "Pinterest", "Threads"];

const WINS = [
  { impact: "+410", page: "/channel-letters", text: "Rewrite the title to lead with “channel letters Houston”", src: "Search Console · position 8.4" },
  { impact: "+260", page: "/led-signs", text: "Add the missing FAQ that three ranking competitors answer", src: "Competitor research" },
  { impact: "+120", page: "Business Profile", text: "Reply to 6 unanswered reviews from the last 30 days", src: "Reviews" },
];

export function LandingPage() {
  return (
    <div className={`${styles.page} ${publicFonts} flex-1 bg-[#FBF8F4] font-[family-name:var(--font-public-sans)] text-[17px] text-[#17120E]`}>
      <PublicNav home />

      <main>
        {/* hero */}
        <section className={`${COLUMN} pt-16 sm:pt-24`} aria-labelledby="hero-title">
          <div className="mx-auto max-w-[860px] text-center">
            <p className={`${styles.rise} text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]`}>SEO, analytics &amp; social reporting</p>
            <h1 id="hero-title" className={`${styles.rise} ${SERIF} mt-5 text-[3rem] leading-[1.02] tracking-[-0.02em] sm:text-[4.5rem] lg:text-[5.4rem]`} style={{ animationDelay: "60ms" }}>
              Know what moves your traffic, <em className="text-[#E8452C]">and what to do next.</em>
            </h1>
            <p className={`${styles.rise} mx-auto mt-6 max-w-[620px] text-[18px] leading-[1.6] text-[#5A524B] sm:text-[19px]`} style={{ animationDelay: "120ms" }}>
              {BRAND_NAME} brings search, website, business-listing and social data into one calm dashboard, then uses AI to turn it into a short list of changes worth making.
            </p>
            <div className={`${styles.rise} mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-3`} style={{ animationDelay: "180ms" }}>
              <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-[#E8452C] px-6 py-3.5 text-[16px] font-semibold text-white outline-none transition hover:bg-[#D23A22] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30">
                Sign in to your dashboard <ArrowRight className="size-[18px]" aria-hidden />
              </Link>
              <a href={accessMailto} className="rounded text-[16px] font-semibold text-[#17120E] underline decoration-[#17120E]/25 underline-offset-[6px] outline-none hover:decoration-[#17120E] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">
                Request access
              </a>
            </div>
          </div>

          <figure className={`${styles.rise} relative mx-auto mt-16 max-w-[1120px] sm:mt-20`} style={{ animationDelay: "260ms" }}>
            <div className="overflow-hidden rounded-xl border border-[#17120E]/10 bg-white shadow-[0_50px_100px_-40px_rgba(60,30,10,0.35)]">
              <LoginPreview className="block h-auto w-full" />
            </div>
            <figcaption className="sr-only">The {BRAND_NAME} overview dashboard</figcaption>
          </figure>
        </section>

        {/* platform */}
        <section id="platform" aria-labelledby="platform-title" className={`${COLUMN} scroll-mt-20 py-24 sm:py-32`}>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">The platform</p>
              <h2 id="platform-title" className={`${SERIF} mt-4 text-[2.6rem] leading-[1.05] tracking-[-0.015em] sm:text-[3.4rem]`}>
                Five jobs, one place to do them.
              </h2>
              <p className="mt-5 max-w-[420px] leading-[1.65] text-[#5A524B]">
                Everything an agency or business owner checks each week, connected read-only and kept up to date automatically.
              </p>
            </div>
            <ol className="border-t border-[#17120E]/15">
              {CAPABILITIES.map((c) => (
                <li key={c.n} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 border-b border-[#17120E]/15 py-8 sm:grid-cols-[4rem_minmax(0,1fr)]">
                  <span className="pt-1 text-sm font-semibold tabular-nums text-[#C2410C]">{c.n}</span>
                  <div>
                    <h3 className="text-[22px] font-semibold tracking-[-0.01em]">{c.title}</h3>
                    <p className="mt-2 max-w-[560px] leading-[1.65] text-[#5A524B]">{c.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* AI */}
        <section id="ai" aria-labelledby="ai-title" className="scroll-mt-20 bg-[#17120E] py-24 text-white sm:py-32">
          <div className={`${COLUMN} grid items-center gap-14 lg:grid-cols-2 lg:gap-20`}>
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#FFB27A]">AI quick wins</p>
              <h2 id="ai-title" className={`${SERIF} mt-4 text-[2.6rem] leading-[1.05] tracking-[-0.015em] sm:text-[3.4rem]`}>
                Not another chart. <em className="text-[#FFB27A]">A to-do list.</em>
              </h2>
              <p className="mt-5 max-w-[480px] leading-[1.65] text-white/65">
                Claude reviews your search, analytics, listing, social and competitor data together, checks every number against the source, and ranks the changes by the clicks they are likely to add.
              </p>
              <ul className="mt-8 space-y-3 text-[16px] text-white/80">
                {["Grounded in your own data, with the source shown", "Estimated monthly gain for each change", "Weekly refresh, or ask a question any time"].map((t) => (
                  <li key={t} className="flex gap-3"><Check className="mt-1 size-4 shrink-0 text-[#FFB27A]" aria-hidden />{t}</li>
                ))}
              </ul>
            </div>

            <div aria-label="Example quick wins" role="img" className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
              <div className="flex items-center justify-between px-4 py-3 text-xs uppercase tracking-[0.14em] text-white/45">
                <span>This week</span><span>Est. clicks / mo</span>
              </div>
              <ul>
                {WINS.map((w, i) => (
                  <li key={w.page} className={`flex items-start gap-4 rounded-lg px-4 py-4 ${i === 0 ? "bg-white/[0.06]" : ""}`}>
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-white/20 text-xs tabular-nums text-white/70">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] leading-snug text-white">{w.text}</p>
                      <p className="mt-1.5 text-[13px] text-white/45">{w.page} · {w.src}</p>
                    </div>
                    <span className="text-[17px] font-semibold tabular-nums text-[#FFB27A]">{w.impact}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* integrations */}
        <section id="integrations" aria-labelledby="int-title" className={`${COLUMN} scroll-mt-20 py-24 sm:py-32`}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <h2 id="int-title" className={`${SERIF} max-w-[640px] text-[2.6rem] leading-[1.05] tracking-[-0.015em] sm:text-[3.4rem]`}>
              Connects to the tools you already use.
            </h2>
            <p className="max-w-[400px] leading-[1.65] text-[#5A524B]">
              Every connection is <strong className="font-semibold text-[#17120E]">read-only</strong>. {BRAND_NAME} never posts, messages or changes anything on a connected account.
            </p>
          </div>
          <ul className="mt-14 grid grid-cols-2 border-l border-t border-[#17120E]/12 sm:grid-cols-3 lg:grid-cols-5">
            {SOURCES.map((s) => (
              <li key={s.name} className="flex items-center gap-3 border-b border-r border-[#17120E]/12 px-5 py-7">
                <span className="shrink-0">{s.icon}</span>
                <span className="text-[15px] font-semibold">{s.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[15px] text-[#5A524B]">
            Plus social accounts — {SOCIAL.join(", ")} — and keyword, backlink and search-result data from DataForSEO.
          </p>
        </section>

        {/* about + CTA */}
        <section id="about" aria-labelledby="about-title" className="scroll-mt-20 border-t border-[#17120E]/10">
          <div className={`${COLUMN} grid gap-14 py-24 lg:grid-cols-2 lg:gap-20`}>
            <div>
              <h2 id="about-title" className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]">About {BRAND_NAME}</h2>
              <p className="mt-5 max-w-[560px] text-[18px] leading-[1.7] text-[#3A332D]">
                {BRAND_NAME} is an invite-only SEO, analytics and social media reporting platform operated by {SITE.operator}, {SITE.operatorKind} in {SITE.city}, for its client businesses. Authorized people connect a business&apos;s Google Search Console, Google Analytics, Google Business Profile, Bing Webmaster Tools, Microsoft Clarity and social media accounts with read-only access, and {BRAND_NAME} turns that data into dashboards, reports, alerts and AI-assisted recommendations.
              </p>
              <p className="mt-4 max-w-[560px] leading-[1.7] text-[#5A524B]">
                Accounts are created by invitation; there is no public sign-up. To request access, email <a href={accessMailto} className="font-semibold text-[#C2410C] underline underline-offset-4">{SITE.email}</a>.
              </p>
            </div>
            <div className="flex flex-col justify-between gap-10 rounded-xl bg-[#F2EBE3] p-8 sm:p-10">
              <p className={`${SERIF} text-[2.2rem] leading-[1.1] tracking-[-0.01em] sm:text-[2.6rem]`}>Already have an account?</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-[#17120E] px-6 py-3.5 text-[16px] font-semibold text-white outline-none transition hover:bg-[#2A221B] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30">
                  Sign in <ArrowRight className="size-[18px]" aria-hidden />
                </Link>
                <a href={accessMailto} className="inline-flex items-center gap-1 text-[16px] font-semibold text-[#17120E] hover:underline">Request access <ArrowUpRight className="size-4" aria-hidden /></a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter home />
    </div>
  );
}
