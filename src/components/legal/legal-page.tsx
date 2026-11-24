import { BRAND_NAME } from "@/components/brand/brand-mark";
import { SITE } from "@/config/platforms";
import { COLUMN, PageIntro, PublicNav, PublicShell, SERIF } from "@/components/public/site-chrome";

export const LEGAL_UPDATED = SITE.legalUpdated;
export const contactEmail = () => SITE.email;

/** The operator's contact address as a mail link. */
export function ContactLine({ subject }: { subject: string }) {
  return <a href={`mailto:${SITE.email}?subject=${encodeURIComponent(`${BRAND_NAME}: ${subject}`)}`} className={A}>{SITE.email}</a>;
}

/** Link style used inside legal text. */
export const A = "font-medium text-[#C2410C] underline underline-offset-2 hover:text-[#E8452C]";

export interface LegalSection { id: string; title: string; body: React.ReactNode }

/** Public header used by every public page except the homepage (same as the homepage's). */
export function PublicHeader() {
  return <PublicNav />;
}

/** Body text styles shared by legal sections. */
export const PROSE = "space-y-4 text-[17px] leading-[1.75] text-[#3A332D] [&_h3]:mt-8 [&_h3]:text-[19px] [&_h3]:font-semibold [&_h3]:text-[#17120E] [&_h4]:mt-4 [&_h4]:text-[16px] [&_h4]:font-semibold [&_h4]:text-[#17120E] [&_li]:mt-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-[#17120E] [&_ul]:list-disc [&_ul]:pl-5";

/**
 * Public, printable legal document with a table of contents, light like the sign-in page. Text is server-rendered,
 * headings are anchored, and the reading column is about 70 characters wide.
 */
export function LegalPage({ title, intro, sections, numbered = true, eyebrow = "Legal" }: {
  title: string; intro: React.ReactNode; sections: LegalSection[]; numbered?: boolean; eyebrow?: string;
  /** kept for older callers */ other?: { href: string; label: string };
}) {
  return (
    <PublicShell>
      <PageIntro eyebrow={eyebrow} title={title} updated={LEGAL_UPDATED} />
      <main className={`${COLUMN} grid gap-12 py-14 sm:py-20 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-20`}>
        <aside className="lg:sticky lg:top-28 lg:self-start print:hidden">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8C837B]">On this page</p>
          <ol className="mt-4 space-y-2.5 border-l border-[#17120E]/12 text-[15px]">
            {sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="-ml-px block border-l border-transparent pl-4 text-[#5A524B] outline-none hover:border-[#E8452C] hover:text-[#17120E] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">{numbered ? `${i + 1}. ` : ""}{s.title}</a></li>)}
          </ol>
        </aside>
        <article className="min-w-0">
          <div className="max-w-[760px]">
            <div className={PROSE}>{intro}</div>
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-14 scroll-mt-28 border-t border-[#17120E]/10 pt-10">
                <h2 id={`${s.id}-h`} className={`group ${SERIF} text-[2rem] leading-tight tracking-[-0.01em] text-[#17120E]`}>
                  {numbered && <span className="mr-3 align-middle font-[family-name:var(--font-public-sans)] text-sm font-semibold tabular-nums text-[#C2410C]">{String(i + 1).padStart(2, "0")}</span>}
                  {s.title}
                  <a href={`#${s.id}`} aria-label={`Link to ${s.title}`} className="ml-2 text-[#c9c3bd] opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100">#</a>
                </h2>
                <div className={`mt-5 ${PROSE}`}>{s.body}</div>
              </section>
            ))}
          </div>
        </article>
      </main>
    </PublicShell>
  );
}
