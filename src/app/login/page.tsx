import type { Metadata } from "next";
import { BRAND_NAME } from "@/components/brand/brand-mark";
import { publicFonts } from "@/components/public/fonts";
import { GrowthVisual } from "@/components/public/growth-visual";
import { EYEBROW, PublicNav, SERIF } from "@/components/public/site-chrome";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: `Sign in · ${BRAND_NAME}`,
  description: "Sign in to SEO Insights, the invite-only SEO, analytics and social media reporting platform operated by Waheed Zen LLC for its clients.",
  alternates: { canonical: "/login" },
};

const ERRORS: Record<string, string> = {
  callback: "That sign-in link didn't work. It may have expired or already been used. Please try again.",
};

/** Same-site paths only, so ?next= can't send people to another site after signing in. */
function safeNext(raw: string | string[] | undefined): string {
  return typeof raw === "string" && /^\/(?![/\\])/.test(raw) ? raw : "/overview";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const errorKey = typeof sp.error === "string" ? sp.error : null;
  const initialError = errorKey ? ERRORS[errorKey] ?? ERRORS.callback : null;

  return (
    <div className={`${styles.page} ${publicFonts} flex min-h-dvh flex-1 flex-col bg-[#FBF8F4] font-[family-name:var(--font-public-sans)] text-[17px] text-[#17120E] antialiased`}>
      <PublicNav signIn={false} />
      <main className="grid flex-1 lg:h-[calc(100dvh-68px)] lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* form */}
        <section className="flex flex-col px-5 py-12 sm:px-8 lg:order-1 lg:py-8">
          <div className={`${styles.enter} mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center lg:ml-[max(2rem,calc((100vw-1240px)/2))] lg:mr-auto`}>
            <p className={EYEBROW}>Your account</p>
            <LoginForm next={next} initialError={initialError} />
          </div>
        </section>

        {/* artwork */}
        <aside className="relative hidden overflow-hidden bg-[#17120E] lg:order-2 lg:flex lg:flex-col">
          <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 size-[34rem] rounded-full bg-[#F2701E]/15 blur-3xl" />
          <div className="relative z-10 px-12 pt-12 xl:px-16">
            <p className={`${SERIF} max-w-[26rem] text-[2.15rem] leading-[1.12] text-white xl:text-[2.5rem]`}>
              Every search, site and social signal, <em className="text-[#FFB27A]">read clearly.</em>
            </p>
          </div>
          <div className="relative z-10 min-h-0 flex-1 px-6 pb-6 xl:px-10">
            <GrowthVisual className="size-full" />
          </div>
        </aside>
      </main>
    </div>
  );
}
