"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, Building2, ChevronsUpDown, LayoutDashboard, Lock, Mail, Moon, PanelLeftClose, Search, Sun } from "lucide-react";
import { BrandMark, BRAND_NAME } from "@/components/brand/brand-mark";
import { ReportBrandHeader, ReportCompany, reportFooterText } from "@/components/report/report-brand";
import { SITE } from "@/config/platforms";
import {
  brandName, brandTheme, isWideLogo, loginTheme, logoSet, monogram, type Branding, type CssVars,
} from "@/lib/org/branding-theme";
import { cn } from "@/lib/utils";
import { BrandLogo, BrandSquare } from "./brand-logo";

/** The app's own tokens (globals.css), so the preview shows either theme whatever the viewer's system setting is. */
const PALETTE: Record<"light" | "dark", CssVars> = {
  light: {
    "--background": "#f7f7f5", "--surface": "#ffffff", "--surface-muted": "#f2f1ee", "--surface-sunken": "#fafaf8", "--border": "#e6e5e1",
    "--border-strong": "#d9d8d3", "--hairline": "#efeeea", "--foreground": "#17171a", "--secondary": "#5d5d66", "--muted": "#6e6e77",
    "--faint": "#8a8a93", "--accent": "#e0482e", "--accent-soft": "#fcede9", "--accent-foreground": "#ffffff", "--series": "#2f55d4", "--series-soft": "#e9eefc",
  },
  dark: {
    "--background": "#0f0f11", "--surface": "#17171a", "--surface-muted": "#1f1f23", "--surface-sunken": "#141417", "--border": "#2a2a2f",
    "--border-strong": "#3a3a41", "--hairline": "#232328", "--foreground": "#ededef", "--secondary": "#b4b4bd", "--muted": "#9a9aa5",
    "--faint": "#7c7c86", "--accent": "#ff6a4f", "--accent-soft": "#2e1a17", "--accent-foreground": "#ffffff", "--series": "#7c95f2", "--series-soft": "#1c2340",
  },
};

function themed(brand: Branding, mode: "light" | "dark"): React.CSSProperties {
  const t = brandTheme(brand.colors);
  return { ...PALETTE[mode], ...(t ? t[mode] : {}), colorScheme: mode } as React.CSSProperties;
}

const TABS = [["sidebar", "Dashboard"], ["report", "Report"], ["login", "Sign-in page"]] as const;
type Tab = (typeof TABS)[number][0];

/** Live preview of unsaved branding: the dashboard sidebar (light or dark), a report cover and the sign-in card. */
export function BrandingPreview({ brand }: { brand: Branding }) {
  const [tab, setTab] = useState<Tab>("sidebar");
  const [mode, setMode] = useState<"light" | "dark">("light");
  return (
    <section aria-label="Preview" className="rounded-[10px] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Preview" className="inline-flex rounded-lg bg-surface-muted p-0.5 text-[12.5px]">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
              className={cn("rounded-md px-2.5 py-1 font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent",
                tab === id ? "bg-surface text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-muted hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        {tab === "sidebar" && (
          <button type="button" onClick={() => setMode((m) => (m === "light" ? "dark" : "light"))} aria-label={`Show ${mode === "light" ? "dark" : "light"} mode`}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium text-muted outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
            {mode === "light" ? <Moon className="size-3.5" aria-hidden /> : <Sun className="size-3.5" aria-hidden />} {mode === "light" ? "Dark" : "Light"} mode
          </button>
        )}
      </div>
      <div className="mt-3" role="tabpanel">
        {tab === "sidebar" && <SidebarPreview brand={brand} mode={mode} />}
        {tab === "report" && <ReportPreview brand={brand} />}
        {tab === "login" && <LoginPreview brand={brand} />}
      </div>
      <p className="mt-3 text-xs text-muted">Preview of your unsaved changes. Others see them after you save.</p>
    </section>
  );
}

export function SidebarPreview({ brand, mode }: { brand: Branding; mode: "light" | "dark" }) {
  const logo = logoSet(brand);
  const custom = Boolean(brand.displayName || logo || brand.favicon);
  const wide = isWideLogo(logo);
  const name = brandName(brand);
  const nav = [{ icon: LayoutDashboard, label: "Overview", active: true }, { icon: Search, label: "Search Console" }, { icon: BarChart3, label: "Google Analytics" }];
  return (
    <div aria-hidden style={themed(brand, mode)} className="flex overflow-hidden rounded-lg border border-border bg-background text-foreground">
      <div className="w-[min(208px,62%)] shrink-0 border-r border-border bg-surface">
        <div className="flex h-12 items-center justify-between gap-2 px-3">
          <span className="flex min-w-0 items-center gap-2">
            {!custom ? <><BrandMark className="h-5" /><span className="truncate text-[14px] font-semibold tracking-tight">{BRAND_NAME}</span></> : (
              <>
                {logo ? <BrandLogo logo={logo} alt="" mode={mode} className={wide ? "h-6 max-w-[150px]" : "h-6 max-w-[40px]"} />
                  : <BrandSquare src={brand.favicon?.url ?? null} monogram={monogram(name)} />}
                {!wide && <span className="truncate text-[14px] font-semibold tracking-tight">{name}</span>}
              </>
            )}
          </span>
          <PanelLeftClose className="size-3.5 shrink-0 text-muted" />
        </div>
        <div className="px-2.5 pb-1">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-2 py-1.5">
            <span className="grid size-6 place-items-center rounded-md bg-surface-muted text-secondary"><Building2 className="size-3" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium">Example client</span><span className="block text-[10px] text-muted">Owner</span></span>
            <ChevronsUpDown className="size-3 text-muted" />
          </div>
        </div>
        <p className="mt-3 px-4 text-[10px] font-medium text-faint">Analytics</p>
        <ul className="space-y-px px-2.5 pb-3 pt-1">
          {nav.map(({ icon: Icon, label, active }) => (
            <li key={label} className={cn("relative flex h-7 items-center gap-2 rounded-md px-2 text-[12px]", active ? "bg-surface-muted font-medium" : "text-secondary")}>
              {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--highlight,var(--accent))]" />}
              <Icon className={cn("size-3.5", active ? "text-foreground" : "text-muted")} /> {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold">Overview</span>
          <span className="rounded-md bg-accent px-2 py-1 text-[10.5px] font-medium text-accent-foreground">Export</span>
        </div>
        <div className="mt-2.5 rounded-md border border-border bg-surface p-2">
          <p className="text-[10px] text-muted">Organic clicks</p>
          <svg viewBox="0 0 100 34" className="mt-1 h-10 w-full" preserveAspectRatio="none">
            <path d="M0 30 L12 26 24 27 36 20 48 22 60 14 72 16 84 8 100 5 V34 H0Z" fill="var(--series-soft)" />
            <path d="M0 30 L12 26 24 27 36 20 48 22 60 14 72 16 84 8 100 5" fill="none" stroke="var(--series)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <p className="mt-2 text-[10.5px]"><span className="font-medium text-accent">View report →</span></p>
      </div>
    </div>
  );
}

/** Width of an element (for scaling the A4 report preview to the panel). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const A4 = 794; // 210 mm at 96 dpi
export function ReportPreview({ brand }: { brand: Branding }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [inner, setInner] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const scale = width ? Math.min(1, width / A4) : 0.4;
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setInner(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const footer = reportFooterText(brand);
  return (
    <div ref={ref} aria-hidden className="mx-auto max-w-[480px] overflow-hidden rounded-lg border border-border" style={{ height: inner ? inner * scale : undefined }}>
      <div ref={content} style={{ ...themed(brand, "light"), width: A4, transform: `scale(${scale})`, transformOrigin: "top left" }} className="bg-surface px-14 py-12 text-foreground">
        <ReportBrandHeader brand={brand} alwaysLight />
        <div className="mt-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--highlight,var(--accent))]">Monthly performance report</p>
          <p className="mt-3 text-5xl font-extrabold leading-tight tracking-tight">Example client</p>
          <p className="mt-4 text-2xl font-semibold text-foreground/80">November 2026</p>
        </div>
        <div className="mt-20 flex items-end justify-between text-sm text-muted">
          <p>Generated December 1, 2026</p>
          <p>Sources: connected Google, Microsoft and partner APIs</p>
        </div>
        <ReportCompany brand={brand} />
        {/* what every later page prints in its margins */}
        <div className="mt-10 border-t border-dashed border-border pt-3 text-[11px] text-[#6b6b76]">
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-faint">Page margins (pages 2 onwards)</p>
          {brand.report.header && <p>{brand.report.header}</p>}
          <p className="flex justify-between gap-4"><span>{footer}</span><span>Page 2 of 12</span></p>
        </div>
      </div>
    </div>
  );
}

export function LoginPreview({ brand }: { brand: Branding }) {
  const logo = logoSet(brand);
  const wide = isWideLogo(logo);
  const name = brandName(brand);
  const vars = brand.loginBranding ? (loginTheme(brand.colors) as React.CSSProperties) : undefined;
  return (
    <div aria-hidden style={{ colorScheme: "light", ...vars }} className="rounded-lg border border-[#ECE6E0] bg-[#FBF8F4] p-5 text-[#17120E]">
      {!brand.loginBranding && <p className="mb-3 rounded-md bg-[#F3ECE5] px-2.5 py-1.5 text-[11.5px] text-[#6B635C]">Sign-in page branding is off: it shows the SEO Insights look. Turn it on under “Sign-in page”.</p>}
      <div className="flex items-center gap-2">
        {!brand.loginBranding ? <><BrandMark className="h-6" /><span className="text-[16px] font-semibold">{BRAND_NAME}</span></> : (
          <>
            {logo ? <BrandLogo logo={logo} alt="" mode="light" className={wide ? "h-8 max-w-[200px]" : "h-7 max-w-[56px]"} />
              : <BrandSquare src={brand.favicon?.url ?? null} monogram={monogram(name)} className="size-7" />}
            {!wide && <span className="text-[16px] font-semibold">{name}</span>}
          </>
        )}
      </div>
      <p className="mt-6 font-serif text-[30px] leading-none">Sign in</p>
      <div className="mt-5 space-y-2.5">
        {[{ icon: Mail, text: "you@company.com" }, { icon: Lock, text: "••••••••" }].map(({ icon: Icon, text }, i) => (
          <div key={text} className={cn("flex items-center gap-2 rounded-lg border bg-white px-3 py-2.5 text-[13px] text-[#9a9aa5]",
            i === 0 ? "border-[var(--login-ring,#F26A1B)] ring-4 ring-[var(--login-ring,#F26A1B)]/15" : "border-[#E2DAD2]")}>
            <Icon className="size-4" /> {text}
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end text-[12.5px] font-semibold text-[var(--login-link,#EA5A22)]">Forgot password?</div>
      <div className="mt-3 rounded-lg bg-[var(--login-button,#17120E)] py-2.5 text-center text-[13.5px] font-semibold text-[var(--login-button-fg,#fff)]">Sign in</div>
      <p className="mt-4 text-[11px] text-[#8C837B]">© 2026 {brand.loginBranding ? brand.company.name || name : SITE.operator}</p>
    </div>
  );
}
