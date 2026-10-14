import { Check } from "lucide-react";
import { BrandLockup } from "@/components/brand/brand-mark";
import { DashboardPreview } from "@/components/brand/dashboard-preview";
import { AnalyticsIcon, BusinessProfileIcon, GoogleG } from "@/components/brand/google-icons";
import { LoginForm } from "./login-form";

const SOURCES = [
  { icon: <AnalyticsIcon />, title: "Google Analytics 4", short: "Analytics 4", sub: "Website traffic & conversions", pos: "left-[4%] top-[2%]", delay: "0s" },
  { icon: <GoogleG className="size-9" />, title: "Google Search Console", short: "Search Console", sub: "Search visibility & keywords", pos: "left-[12%] top-[34%]", delay: "-2s" },
  { icon: <BusinessProfileIcon />, title: "Google Business Profile", short: "Business Profile", sub: "Local views, calls & directions", pos: "left-[18%] top-[66%]", delay: "-4s" },
];
const BENEFITS = ["Real Google data", "Automated reporting", "Actionable insights"];
const delay = (s: number) => ({ animationDelay: `${s}s` });

function Headline({ className }: { className?: string }) {
  return (
    <h2 className={className}>
      All Your SEO{" "}
      <span className="bg-gradient-to-r from-[#F2701E] via-[#EF5A24] to-[#E8452C] bg-clip-text text-transparent lg:block">
        Performance
      </span>{" "}
      in One Place
    </h2>
  );
}

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen overflow-hidden bg-background lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1.4fr_1fr]">
      {/* ambient glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-[#F2701E]/15 blur-3xl" />
        <div className="absolute left-[30%] top-[40%] size-[28rem] rounded-full bg-[#8B5CF6]/10 blur-3xl" />
        <div className="absolute -bottom-48 left-[10%] size-[30rem] rounded-full bg-[#E8452C]/10 blur-3xl" />
        <div className="absolute -right-32 top-10 size-[24rem] rounded-full bg-[#4F7CF7]/10 blur-3xl lg:hidden" />
      </div>

      {/* hero: desktop */}
      <section className="relative hidden overflow-hidden px-10 pt-8 lg:flex lg:flex-col xl:px-16" aria-label="About SEO Insights">
        <div className="flex items-start justify-between animate-fade-up">
          <BrandLockup tagline="Analytics Dashboard" />
          <p className="hidden pt-2 text-sm text-muted xl:block">
            Google Data <span className="mx-2 text-accent">•</span> Clear Insights <span className="mx-2 text-accent">•</span> Real Growth
          </p>
        </div>

        <div className="mt-10 flex items-start justify-between gap-6">
          <div className="max-w-[27rem] shrink-0">
            <Headline className="animate-fade-up text-5xl font-extrabold leading-[1.04] tracking-tight 2xl:text-6xl" />
            <p className="mt-6 animate-fade-up text-lg leading-relaxed text-muted" style={delay(0.1)}>
              Connect Google Analytics, Search Console and Google Business Profile to track performance, find
              opportunities and grow your business.
            </p>
          </div>

          {/* floating integration cards: their own column so they never cover the headline */}
          <div className="pointer-events-none relative hidden h-[17rem] w-[21rem] shrink-0 xl:block 2xl:w-[24rem]" aria-hidden>
            <svg className="absolute inset-0 size-full" viewBox="0 0 336 272" fill="none">
              <path d="M22 40 C 0 110, 30 175, 70 186" stroke="#4F7CF7" strokeWidth="1.2" strokeDasharray="3 4" opacity=".55" />
              <circle cx="22" cy="40" r="4" fill="#F2A81E" /><circle cx="44" cy="124" r="4" fill="#4F7CF7" />
              <circle cx="74" cy="187" r="4" fill="#8B5CF6" />
            </svg>
            {SOURCES.map((s, i) => (
              <div key={s.title} className={`absolute ${s.pos} animate-fade-up`} style={delay(0.15 + i * 0.1)}>
                <div className="animate-float -rotate-[4deg]" style={{ animationDelay: s.delay }}>
                  <div className="flex w-[17rem] items-center gap-3 rounded-2xl border border-white/60 bg-surface/90 px-4 py-3 shadow-xl shadow-black/[0.06] backdrop-blur">
                    {s.icon}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{s.title}</p>
                      <p className="truncate text-xs text-muted">{s.sub}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <ul className="mt-6 flex animate-fade-up flex-wrap gap-x-7 gap-y-2 text-sm font-medium" style={delay(0.2)}>
          {BENEFITS.map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="grid size-5 place-items-center rounded-full bg-accent text-white shadow-sm shadow-accent/30">
                <Check className="size-3" strokeWidth={3} aria-hidden />
              </span>
              {t}
            </li>
          ))}
        </ul>

        <div className="relative -mb-10 mt-8 w-[92%] animate-fade-up xl:w-[88%]" style={delay(0.3)}>
          <div aria-hidden className="absolute inset-x-10 bottom-0 top-1/3 rounded-full bg-[#F2701E]/20 blur-3xl" />
          <DashboardPreview className="relative" />
        </div>
      </section>

      {/* sign-in (plus a compact intro on phones and tablets, where the hero is hidden) */}
      <section className="relative flex flex-col items-center justify-center gap-6 px-4 py-8 sm:px-8 sm:py-12 lg:px-8 lg:py-10 xl:p-10" aria-label="Sign in">
        <div className="w-full max-w-[480px] animate-fade-up text-center lg:hidden">
          <Headline className="text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl" />
          <p className="mx-auto mt-3 hidden max-w-md text-[15px] leading-relaxed text-muted sm:block">
            Connect Google Analytics, Search Console and Google Business Profile to track performance and grow
            your business.
          </p>
          <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Supported data sources">
            {SOURCES.map((s) => (
              <li key={s.title}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface/80 py-1 pl-1.5 pr-3 text-xs font-medium shadow-sm backdrop-blur">
                <span className="grid size-5 place-items-center [&>svg]:size-4">{s.icon}</span>
                {s.short}
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full max-w-[480px] animate-fade-up" style={delay(0.1)}>
          <LoginForm />
        </div>

        <div className="hidden w-full max-w-[560px] animate-fade-up md:block lg:hidden" style={delay(0.2)}>
          <DashboardPreview tilt={false} />
        </div>
      </section>
    </main>
  );
}
