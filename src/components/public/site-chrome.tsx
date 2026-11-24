import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BRAND_NAME, BrandMark } from "@/components/brand/brand-mark";
import { FOOTER_LINKS } from "@/components/legal/site-footer";
import { SITE } from "@/config/platforms";
import { publicFonts } from "./fonts";

/** Shared look of the public site (homepage, legal pages, platforms, deletion status). */
export const COLUMN = "mx-auto w-full max-w-[1240px] px-5 sm:px-8";
export const SERIF = "font-[family-name:var(--font-public-serif)] font-normal";
export const EYEBROW = "text-[13px] font-semibold uppercase tracking-[0.18em] text-[#C2410C]";

const SECTIONS = [
  { label: "Platform", hash: "#platform" },
  { label: "AI insights", hash: "#ai" },
  { label: "Integrations", hash: "#integrations" },
  { label: "About", hash: "#about" },
];

/** Sticky header. On the homepage the links scroll; elsewhere they go back to the homepage section. */
export function PublicNav({ home = false, signIn = true }: { home?: boolean; signIn?: boolean }) {
  const href = (h: string) => (home ? h : `/${h}`);
  return (
    <header className="sticky top-0 z-30 border-b border-[#17120E]/[0.07] bg-[#FBF8F4]/85 backdrop-blur-md print:static">
      <nav aria-label="Main" className={`${COLUMN} flex h-[68px] items-center justify-between gap-6`}>
        <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-[#F26A1B]/25">
          <BrandMark className="h-7" />
          <span className="text-[19px] font-semibold tracking-[-0.01em]">{BRAND_NAME}</span>
        </Link>
        <ul className="hidden items-center gap-8 text-[15px] text-[#4A423B] md:flex">
          {SECTIONS.map((l) => <li key={l.hash}><a href={href(l.hash)} className="rounded outline-none hover:text-[#17120E] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">{l.label}</a></li>)}
        </ul>
        {signIn ? <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-[#17120E] px-5 py-2.5 text-[15px] font-semibold text-white outline-none transition hover:bg-[#2A221B] focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30 print:hidden">
          Sign in <ArrowRight className="size-4" aria-hidden />
        </Link> : <span className="w-[104px]" aria-hidden />}
      </nav>
    </header>
  );
}

export function PublicFooter({ home = false }: { home?: boolean }) {
  const href = (h: string) => (home ? h : `/${h}`);
  return (
    <footer className="bg-[#17120E] text-white/60 print:hidden">
      <div className={`${COLUMN} grid gap-10 py-14 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]`}>
        <div>
          <div className="flex items-center gap-2.5 text-white">
            <BrandMark className="h-7" />
            <span className="text-[19px] font-semibold tracking-[-0.01em]">{BRAND_NAME}</span>
          </div>
          <p className="mt-4 max-w-[340px] text-[15px] leading-relaxed">Operated by {SITE.operator}<br />{SITE.address}</p>
        </div>
        <nav aria-label="Product">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Product</p>
          <ul className="mt-4 space-y-2.5 text-[15px]">
            {SECTIONS.map((l) => <li key={l.hash}><a href={href(l.hash)} className="hover:text-white">{l.label}</a></li>)}
            <li><Link href="/login" className="hover:text-white">Sign in</Link></li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">Legal &amp; contact</p>
          <ul className="mt-4 space-y-2.5 text-[15px]">
            {FOOTER_LINKS.map((l) => (
              <li key={l.href}>{l.href.startsWith("mailto:") ? <a href={l.href} className="hover:text-white">{l.label}</a> : <Link href={l.href} className="hover:text-white">{l.label}</Link>}</li>
            ))}
          </ul>
        </nav>
      </div>
      <div className={COLUMN}><p className="border-t border-white/10 py-6 text-[13px] text-white/40">© 2026 {SITE.operator}. All rights reserved.</p></div>
    </footer>
  );
}

/** Page frame: fonts, colours, header and footer. */
export function PublicShell({ home = false, children }: { home?: boolean; children: React.ReactNode }) {
  return (
    <div className={`${publicFonts} flex min-h-dvh flex-1 flex-col bg-[#FBF8F4] font-[family-name:var(--font-public-sans)] text-[17px] text-[#17120E] antialiased [color-scheme:light]`}>
      <PublicNav home={home} />
      <div className="flex-1">{children}</div>
      <PublicFooter home={home} />
    </div>
  );
}

/** Title block for inner public pages. */
export function PageIntro({ eyebrow, title, updated, children }: { eyebrow: string; title: string; updated?: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-[#17120E]/10">
      <div className={`${COLUMN} pb-14 pt-16 sm:pb-16 sm:pt-24`}>
        <p className={EYEBROW}>{eyebrow}</p>
        <h1 className={`${SERIF} mt-4 max-w-[900px] text-[2.8rem] leading-[1.04] tracking-[-0.02em] sm:text-[4rem]`}>{title}</h1>
        {updated && <p className="mt-5 text-[15px] text-[#6B635C]">Last updated: {updated}</p>}
        {children && <div className="mt-6 max-w-[760px] text-[18px] leading-[1.65] text-[#4A423B]">{children}</div>}
      </div>
    </div>
  );
}
