import Link from "next/link";
import { BRAND_NAME } from "@/components/brand/brand-mark";

export const LEGAL_UPDATED = "November 15, 2026";
export const contactEmail = () => process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

/** Contact line used in both documents: the configured address, else the sign-in page's contact link. */
export function ContactLine({ subject }: { subject: string }) {
  const email = contactEmail();
  return email
    ? <a href={`mailto:${email}?subject=${encodeURIComponent(`${BRAND_NAME}: ${subject}`)}`} className="font-medium text-[#E8552A] underline-offset-2 hover:underline">{email}</a>
    : <Link href="/login#contact" className="font-medium text-[#E8552A] underline-offset-2 hover:underline">the contact link on the sign-in page</Link>;
}

export interface LegalSection { id: string; title: string; body: React.ReactNode }

/** Public, printable legal document with a table of contents. Light, matching the sign-in page. */
export function LegalPage({ title, intro, sections, other }: { title: string; intro: React.ReactNode; sections: LegalSection[]; other: { href: string; label: string } }) {
  return (
    <div className="min-h-dvh bg-[#FBF8F5] text-[#1f1f25]">
      <header className="border-b border-[#F1ECE7] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/login" className="text-[17px] font-bold tracking-tight">{BRAND_NAME}</Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href={other.href} className="text-[#5a5a63] hover:text-[#1f1f25]">{other.label}</Link>
            <Link href="/login" className="rounded-lg bg-gradient-to-r from-[#F26A1B] to-[#E8452C] px-3.5 py-1.5 font-semibold text-white">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:py-14">
        <aside className="lg:sticky lg:top-8 lg:self-start print:hidden">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8a8a94]">On this page</p>
          <ol className="space-y-1.5 text-sm">
            {sections.map((s, i) => <li key={s.id}><a href={`#${s.id}`} className="text-[#5a5a63] hover:text-[#E8552A]">{i + 1}. {s.title}</a></li>)}
          </ol>
        </aside>
        <article className="min-w-0 rounded-2xl border border-[#F1ECE7] bg-white px-5 py-8 shadow-sm sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#E8552A]">Legal</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-[#8a8a94]">Last updated: {LEGAL_UPDATED}</p>
          <div className="mt-6 space-y-4 text-[15px] leading-7 text-[#3a3a42]">{intro}</div>
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="mt-10 scroll-mt-8">
              <h2 className="text-xl font-semibold tracking-tight text-[#1f1f25]">{i + 1}. {s.title}</h2>
              <div className="mt-3 space-y-3 text-[15px] leading-7 text-[#3a3a42] [&_li]:mt-1.5 [&_strong]:text-[#1f1f25] [&_ul]:list-disc [&_ul]:pl-5">{s.body}</div>
            </section>
          ))}
        </article>
      </main>
      <footer className="border-t border-[#F1ECE7] bg-white py-6 text-center text-xs text-[#8a8a94]">
        © {new Date().getFullYear()} {BRAND_NAME} · <Link href="/privacy" className="hover:underline">Privacy Policy</Link> · <Link href="/terms" className="hover:underline">Terms and Conditions</Link>
      </footer>
    </div>
  );
}
