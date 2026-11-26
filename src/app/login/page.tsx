import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BRAND_NAME, BrandMark } from "@/components/brand/brand-mark";
import { publicFonts } from "@/components/public/fonts";
import { GrowthVisual } from "@/components/public/growth-visual";
import { SITE } from "@/config/platforms";
import { LoginFormWithParams } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: `Sign in · ${BRAND_NAME}`,
  description: "Sign in to SEO Insights, the invite-only SEO, analytics and social media reporting platform operated by Waheed Zen LLC for its clients.",
  alternates: { canonical: "/login" },
};

/**
 * A static page served straight from the CDN (no server work per visit): ?next= and ?error= are read in the
 * browser by the form, so nothing here depends on the request.
 */
export default function LoginPage() {
  return (
    <main className={`${styles.page} ${publicFonts} grid min-h-dvh flex-1 bg-[#FBF8F4] font-[family-name:var(--font-public-sans)] text-[#17120E] lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]`}>
      {/* artwork */}
      <aside className="relative hidden overflow-hidden bg-[#17120E] lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-[34rem] rounded-full bg-[#F2701E]/15 blur-3xl" />
        <div className="relative z-10 px-12 pt-12 xl:px-16 xl:pt-14">
          <p className="max-w-[24rem] font-[family-name:var(--font-public-serif)] text-[2.15rem] leading-[1.12] text-white xl:text-[2.5rem]">
            Every search, site and social signal, <em className="text-[#FFB27A]">read clearly.</em>
          </p>
        </div>
        <div className="relative z-10 min-h-0 flex-1 px-6 pb-6 xl:px-10">
          <GrowthVisual className="size-full" />
        </div>
      </aside>

      {/* form */}
      <section className="flex min-h-dvh flex-col px-6 py-6 sm:px-10 lg:min-h-0 lg:px-14 xl:px-20">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-[#F26A1B]/25">
            <BrandMark className="h-7" />
            <span className="text-[19px] font-semibold tracking-[-0.01em]">{BRAND_NAME}</span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-[#6B635C] outline-none hover:text-[#17120E] focus-visible:ring-2 focus-visible:ring-[#F26A1B]">
            <ArrowLeft className="size-4" aria-hidden /> Home
          </Link>
        </header>

        <div className={`${styles.enter} mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10`}>
          <LoginFormWithParams />
        </div>

        <p className="text-center text-xs text-[#8C837B] lg:text-left">© 2026 {SITE.operator}</p>
      </section>
    </main>
  );
}
