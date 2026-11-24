import Link from "next/link";
import { BRAND_NAME, BrandMark } from "@/components/brand/brand-mark";
import { SITE } from "@/config/platforms";
import { SiteFooter } from "./site-footer";

export const LEGAL_UPDATED = SITE.legalUpdated;
export const contactEmail = () => SITE.email;

/** The operator's contact address as a mail link. */
export function ContactLine({ subject }: { subject: string }) {
  return <a href={`mailto:${SITE.email}?subject=${encodeURIComponent(`${BRAND_NAME}: ${subject}`)}`} className={A}>{SITE.email}</a>;
}

/** Link style used inside legal text. */
export const A = "font-medium text-[#C2410C] underline underline-offset-2 hover:text-[#E8452C]";

export interface LegalSection { id: string; title: string; body: React.ReactNode }

const NAV = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/data-deletion", label: "Data Deletion" },
  { href: "/platforms", label: "Platforms" },
];

/** Public header used by every public page except the homepage. */
export function PublicHeader() {
  return (
    <header className="border-b border-[#F1ECE7] bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded text-[17px] font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-[#F26A1B]">
          <BrandMark className="h-6" /> {BRAND_NAME}
        </Link>
        <nav aria-label="Public" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="rounded text-[#5a5a63] outline-none hover:text-[#1f1f25] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">{n.label}</Link>)}
          <Link href="/login" className="rounded-lg bg-gradient-to-r from-[#F26A1B] to-[#E8452C] px-3.5 py-1.5 font-semibold text-white outline-none focus-visible:ring-4 focus-visible:ring-[#F26A1B]/30">Sign in</Link>
        </nav>
      </div>
    </header>
  );
}

/** Body text styles shared by legal sections. */
export const PROSE = "space-y-3 text-[15px] leading-7 text-[#3a3a42] [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[#1f1f25] [&_h4]:mt-3 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-[#1f1f25] [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-[#1f1f25] [&_ul]:list-disc [&_ul]:pl-5";

/**
 * Public, printable legal document with a table of contents, light like the sign-in page. Text is server-rendered,
 * headings are anchored, and the reading column is about 70 characters wide.
 */
export function LegalPage({ title, intro, sections, numbered = true, eyebrow = "Legal" }: {
  title: string; intro: React.ReactNode; sections: LegalSection[]; numbered?: boolean; eyebrow?: string;
  /** kept for older callers */ other?: { href: string; label: string };
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#FBF8F5] text-[#1f1f25]">
      <PublicHeader />
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:py-14">
        <aside className="lg:sticky lg:top-8 lg:self-start print:hidden">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#6b6b76]">On this page</p>
          <ol className="space-y-1.5 text-sm">
            {sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="rounded text-[#5a5a63] outline-none hover:text-[#C2410C] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">{numbered ? `${i + 1}. ` : ""}{s.title}</a></li>)}
          </ol>
        </aside>
        <article className="min-w-0 rounded-2xl border border-[#F1ECE7] bg-white px-5 py-8 shadow-sm sm:px-10">
          <div className="max-w-[70ch]">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">{eyebrow}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-2 text-sm text-[#6b6b76]">Last updated: {LEGAL_UPDATED}</p>
            <div className={`mt-6 ${PROSE}`}>{intro}</div>
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-10 scroll-mt-8">
                <h2 id={`${s.id}-h`} className="group text-xl font-semibold tracking-tight text-[#1f1f25]">
                  {numbered ? `${i + 1}. ` : ""}{s.title}
                  <a href={`#${s.id}`} aria-label={`Link to ${s.title}`} className="ml-2 text-[#c9c3bd] opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100">#</a>
                </h2>
                <div className={`mt-3 ${PROSE}`}>{s.body}</div>
              </section>
            ))}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
