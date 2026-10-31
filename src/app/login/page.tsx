import type { Metadata } from "next";
import { Caveat } from "next/font/google";
import { BarChart3, ChartColumnIncreasing, Cpu, Menu, Sparkles, TrendingUp, Zap } from "lucide-react";
import { BRAND_NAME, BrandMark } from "@/components/brand/brand-mark";
import { AnalyticsIcon, BusinessProfileIcon, GoogleG } from "@/components/brand/google-icons";
import { BingIcon, ClarityIcon, SearchConsoleIcon } from "@/components/login/login-icons";
import { LoginPreview } from "@/components/login/login-preview";
import { SignInLink } from "@/components/login/sign-in-link";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

const caveat = Caveat({ subsets: ["latin"], weight: ["600"], display: "swap" });

export const metadata: Metadata = { title: `Sign in · ${BRAND_NAME}` };

const NAV = [
  { label: "Product", href: "#product" },
  { label: "Integrations", href: "#integrations" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#contact" },
  { label: "Resources", href: "#preview" },
];

const FEATURES = [
  { icon: ChartColumnIncreasing, text: "All your data in one dashboard" },
  { icon: Zap, text: "Automated reporting and AI insights" },
  { icon: BarChart3, text: "Actionable opportunities to grow your business" },
];

const INTEGRATIONS = [
  { icon: <AnalyticsIcon className="size-8" />, title: "Google Analytics", sub: "Traffic & Conversions" },
  { icon: <SearchConsoleIcon />, title: "Search Console", sub: "Search Performance" },
  { icon: <BusinessProfileIcon className="size-8" />, title: "Business Profile", sub: "Local Search Growth" },
  { icon: <BingIcon />, title: "Bing Webmaster", sub: "Indexing & Visibility" },
  { icon: <ClarityIcon />, title: "Microsoft Clarity", sub: "User Behavior" },
  {
    icon: (
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-[#FFE6D6] to-[#FFD0BC]">
        <Sparkles className="size-[18px] text-[#E8452C]" aria-hidden />
      </span>
    ),
    title: "AI Insights", sub: "Opportunities",
  },
];

const ERRORS: Record<string, string> = {
  callback: "That sign-in link didn't work. It may have expired or already been used. Please try again.",
};

/** Same-site paths only, so ?next= can't send people to another site after signing in. */
function safeNext(raw: string | string[] | undefined): string {
  return typeof raw === "string" && /^\/(?![/\\])/.test(raw) ? raw : "/overview";
}

/** Fluid page column: spreads across wide screens, side padding grows with the viewport. */
const COLUMN = "mx-auto w-full max-w-[1800px] px-[clamp(1rem,4vw,5rem)]";

const delay = (s: number) => ({ animationDelay: `${s}s` });
const contactHref = () =>
  `mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? ""}?subject=${encodeURIComponent(`${BRAND_NAME} sales enquiry`)}`;

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const errorKey = typeof sp.error === "string" ? sp.error : null;
  const initialError = errorKey ? ERRORS[errorKey] ?? ERRORS.callback : null;

  return (
    <main className={`${styles.page} relative flex-1 bg-[#FFFCF9] text-[#16161a]`}>
      {/* soft peach shapes */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-48 -top-48 size-[40rem] rounded-full bg-[#FFDCC4]/55 blur-3xl" />
        <div className="absolute right-[-12rem] top-24 size-[36rem] rounded-full bg-[#FFE1CF]/70 blur-3xl" />
        <div className="absolute left-[38%] top-[58%] size-[26rem] rounded-full bg-[#FFE9DB]/60 blur-3xl" />
        <div className="absolute left-[46%] top-28 hidden size-3 rounded-full bg-gradient-to-br from-[#F26A1B] to-[#E8452C] lg:block" />
      </div>

      {/* nav */}
      <header className={`${styles.enter} relative z-20`}>
        <nav aria-label="Main" className={`${COLUMN} flex h-[76px] items-center justify-between gap-4`}>
          <a href="#product" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-[#F26A1B]/20">
            <BrandMark className="h-8" />
            <span className="text-xl font-bold tracking-tight">{BRAND_NAME}</span>
          </a>
          <ul className="hidden items-center gap-8 text-[15px] font-medium text-[#3a3a42] lg:flex">
            {NAV.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="rounded outline-none transition hover:text-[#E8452C] focus-visible:text-[#E8452C]">{l.label}</a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 sm:gap-3">
            <a href={contactHref()}
              className="hidden rounded-xl border border-[#E2DCD6] bg-white px-5 py-2.5 text-sm font-semibold transition hover:border-[#F26A1B] hover:text-[#E8452C] sm:inline-flex">
              Contact Sales
            </a>
            <SignInLink className="inline-flex rounded-xl bg-gradient-to-r from-[#F26A1B] to-[#E8452C] px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#E8452C]/25 outline-none transition hover:brightness-105 focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30 sm:px-6">
              Sign In
            </SignInLink>
            <details className="group relative lg:hidden">
              <summary aria-label="Menu" className="grid size-10 cursor-pointer list-none place-items-center rounded-xl border border-[#E2DCD6] bg-white [&::-webkit-details-marker]:hidden">
                <Menu className="size-5" aria-hidden />
              </summary>
              <ul className="absolute right-0 top-12 w-52 rounded-2xl border border-[#F0EBE6] bg-white p-2 text-[15px] font-medium shadow-xl shadow-black/10">
                {NAV.map((l) => (
                  <li key={l.label}><a href={l.href} className="block rounded-lg px-3 py-2 hover:bg-[#FFF3EB]">{l.label}</a></li>
                ))}
                <li className="sm:hidden"><a href={contactHref()} className="block rounded-lg px-3 py-2 hover:bg-[#FFF3EB]">Contact Sales</a></li>
              </ul>
            </details>
          </div>
        </nav>
      </header>

      <div className={`${COLUMN} relative z-10 grid gap-x-10 gap-y-10 pb-14 pt-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:pt-10 xl:grid-cols-[minmax(0,1fr)_440px] xl:gap-x-16 2xl:grid-cols-[minmax(0,1fr)_480px] 2xl:gap-x-24`}>
        {/* hero copy */}
        <section id="product" aria-labelledby="hero-title" className="min-w-0 scroll-mt-6 text-center lg:col-start-1 lg:row-start-1 lg:text-left">
          <p className={`${styles.enter} inline-flex rounded-full bg-[#FFEDE2] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#E8552A] sm:text-xs`}>
            All-in-one SEO analytics platform
          </p>
          <h2 id="hero-title" className={`${styles.enter} mt-5 text-[2.35rem] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-6xl xl:text-[4.25rem] 2xl:text-[4.75rem]`} style={delay(0.05)}>
            Turn SEO Data Into
            <span className="block bg-gradient-to-r from-[#F26A1B] to-[#E8452C] bg-clip-text pb-1 text-transparent">Real Business Growth</span>
          </h2>
          <p className={`${styles.enter} mx-auto mt-5 max-w-[36rem] text-[15px] leading-relaxed text-[#5f5f6a] sm:text-lg lg:mx-0 2xl:max-w-[42rem] 2xl:text-xl`} style={delay(0.1)}>
            Connect Google Analytics, Search Console, Google Business Profile and more — get clear insights, track
            competitors, find opportunities and grow your online presence, all in one place.
          </p>
          <ul id="features" className={`${styles.enter} mx-auto mt-8 grid max-w-[40rem] scroll-mt-6 gap-4 text-left sm:grid-cols-3 lg:mx-0 2xl:max-w-[48rem] 2xl:gap-6`} style={delay(0.15)}>
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#F2ECE6] bg-white shadow-sm shadow-[#C0703A]/10">
                  <Icon className="size-5 text-[#F26A1B]" aria-hidden />
                </span>
                <span className="text-sm font-semibold leading-snug text-[#2a2a31]">{text}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* sign-in card */}
        <section id="signin" aria-label="Sign in" className={`${styles.enter} mx-auto w-full max-w-[460px] scroll-mt-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-w-none lg:self-start`} style={delay(0.12)}>
          <LoginForm next={next} initialError={initialError} />
        </section>

        {/* dashboard preview */}
        <section id="preview" aria-label="Product preview" className={`${styles.enter} relative min-w-0 scroll-mt-6 lg:col-start-1 lg:row-start-2`} style={delay(0.2)}>
          {/* handwritten note + arrow */}
          <div aria-hidden className="pointer-events-none absolute -top-6 right-[4%] z-20 hidden items-start gap-1 md:flex">
            <p className={`${caveat.className} ${styles.script} max-w-[12rem] text-right text-[22px] leading-tight text-[#3a3a42]`}>
              Everything you need to grow, in one place
            </p>
            <svg viewBox="0 0 60 70" className="mt-6 h-16 w-12 text-[#F26A1B]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M8 6c26 2 40 20 30 52" />
              <path d="M30 50l8 10 8-11" />
            </svg>
          </div>

          <div className="relative pt-4 md:pt-16">
            <div aria-hidden className="absolute inset-x-[8%] bottom-0 top-1/4 rounded-full bg-[#F26A1B]/20 blur-3xl" />
            <div className={`${styles.tilt} relative rounded-[20px] shadow-[0_40px_80px_-30px_rgba(120,60,20,0.35),0_12px_30px_-12px_rgba(0,0,0,0.12)]`}>
              <LoginPreview className="block h-auto w-full" />
            </div>

            {/* floating chips over the preview's left edge */}
            <div aria-hidden className="mt-4 flex flex-wrap justify-center gap-3 md:absolute md:-left-3 md:top-[64%] md:mt-0 md:flex-col md:items-start lg:-left-6">
              <span className="flex items-center gap-2.5 rounded-2xl border border-[#F0EBE6] bg-white/95 py-2 pl-2 pr-3.5 text-[13px] font-semibold shadow-lg shadow-black/[0.07] backdrop-blur">
                <span className="grid size-8 place-items-center rounded-xl bg-[#F4F7FF]"><GoogleG className="size-[18px]" /></span>
                Real data from Google tools
                <TrendingUp className="size-4 text-[#16A34A]" />
              </span>
              <span className="flex items-center gap-2.5 rounded-2xl border border-[#F0EBE6] bg-white/95 py-2 pl-2 pr-3.5 text-[13px] font-semibold shadow-lg shadow-black/[0.07] backdrop-blur md:ml-8">
                <span className="grid size-8 place-items-center rounded-xl bg-[#F3EEFF]"><Cpu className="size-[18px] text-[#7B61FF]" /></span>
                AI-powered SEO insights
                <Sparkles className="size-4 text-[#7B61FF]" />
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* trust strip */}
      <section id="integrations" aria-labelledby="trust-title" className="relative z-10 scroll-mt-6 border-t border-[#F1ECE7] bg-white">
        <div className={`${COLUMN} flex flex-col gap-8 py-9 lg:flex-row lg:items-center lg:gap-10 2xl:gap-16`}>
          <h2 id="trust-title" className="shrink-0 text-center text-[15px] font-semibold leading-snug text-[#3a3a42] lg:text-left">
            Trusted by businesses<br className="hidden lg:block" /> <span className="text-[#8a8a94] lg:text-[#3a3a42]">to grow their online presence</span>
          </h2>
          <span aria-hidden className="hidden h-12 w-px bg-[#EEE9E4] lg:block" />
          <ul className="grid flex-1 grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 xl:grid-cols-6">
            {INTEGRATIONS.map((it) => (
              <li key={it.title} className="flex min-w-0 items-center gap-3">
                <span className="shrink-0">{it.icon}</span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-sm font-semibold text-[#1f1f25]">{it.title}</span>
                  <span className="block text-xs text-[#8a8a94]">{it.sub}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p id="contact" className="border-t border-[#F5F1ED] px-4 py-4 text-center text-xs text-[#8a8a94]">
          Questions about plans or pricing?{" "}
          <a href={contactHref()} className="font-semibold text-[#EA5A22] hover:underline">Contact sales</a>
        </p>
      </section>
    </main>
  );
}
