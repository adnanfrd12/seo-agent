"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BRAND_NAME, BrandMark } from "@/components/brand/brand-mark";
import { BrandLogo, BrandSquare } from "@/components/org/branding/brand-logo";
import { useBrandFavicon } from "@/components/org/branding/use-brand-favicon";
import {
  DEFAULT_PUBLIC_BRANDING, isWideLogo, loginTheme, monogram, readPublicBranding, UUID_RE, websiteLabel, type PublicBranding,
} from "@/lib/org/branding-theme";

/**
 * Sign-in page branding. /login?org=<organization id> shows that organization's logo, name and colours, read in the
 * browser from the public branding route (only public fields; default branding when the organization didn't turn
 * this on or doesn't exist), so the page stays static. The organization last shown on this device is remembered,
 * so signing in again from a plain /login (e.g. after a session expires) keeps its look.
 * Without an organization everything renders exactly as the SEO Insights sign-in page.
 */
const REMEMBER_ORG = "seo-insights:login-org";
const noopSubscribe = () => () => {};

function readOrgId(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("org")?.trim().toLowerCase() ?? "";
  if (UUID_RE.test(fromUrl)) return fromUrl;
  try { const saved = window.localStorage.getItem(REMEMBER_ORG) ?? ""; return UUID_RE.test(saved) ? saved : ""; } catch { return ""; }
}
function remember(orgId: string | null) {
  try { if (orgId) window.localStorage.setItem(REMEMBER_ORG, orgId); else window.localStorage.removeItem(REMEMBER_ORG); } catch { /* storage blocked */ }
}

type LoginBrand = { status: "default" } | { status: "loading" } | { status: "branded"; brand: PublicBranding };
const Ctx = createContext<LoginBrand>({ status: "default" });
export const useLoginBrand = () => useContext(Ctx);

export function LoginBrandProvider({ children, title = "Sign in" }: { children: React.ReactNode; title?: string }) {
  const orgId = useSyncExternalStore(noopSubscribe, readOrgId, () => "");
  const [result, setResult] = useState<{ id: string; brand: PublicBranding } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    fetch(`/api/org/branding/${orgId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        const brand = readPublicBranding(json);
        remember(brand.custom ? orgId : null);
        if (live) setResult({ id: orgId, brand });
      })
      .catch(() => { if (live) setResult({ id: orgId, brand: DEFAULT_PUBLIC_BRANDING }); })
      .finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); ctrl.abort(); };
  }, [orgId]);

  const state: LoginBrand = !orgId ? { status: "default" }
    : result?.id !== orgId ? { status: "loading" }
    : result.brand.custom ? { status: "branded", brand: result.brand } : { status: "default" };
  const brand = state.status === "branded" ? state.brand : null;
  useBrandFavicon(brand?.favicon ?? null);
  useEffect(() => { if (brand) document.title = `${title} · ${brand.name}`; }, [brand, title]);

  return (
    <Ctx.Provider value={state}>
      {/* display: contents keeps the page's grid; the colour variables still reach everything inside */}
      <div className="contents" style={brand ? (loginTheme(brand.colors) as React.CSSProperties) : undefined}>{children}</div>
    </Ctx.Provider>
  );
}

function BrandedMark({ brand, size }: { brand: PublicBranding; size: "md" | "lg" }) {
  const wide = isWideLogo(brand.logo);
  return (
    <>
      {brand.logo
        ? <BrandLogo logo={brand.logo} alt={wide ? brand.name : ""} mode="light" className={wide ? "h-9 max-w-[220px]" : "h-8 max-w-[64px]"} />
        : <BrandSquare src={brand.favicon} monogram={monogram(brand.name)} className={size === "lg" ? "size-8" : "size-7"} />}
      {!wide && <span className={size === "lg" ? "text-[22px] font-bold tracking-tight" : "text-[19px] font-semibold tracking-[-0.01em]"}>{brand.name}</span>}
    </>
  );
}

/** The centred mark on the "Set a new password" card. */
export function LoginBrandCardMark() {
  const s = useLoginBrand();
  return (
    <div className="flex min-h-8 items-center justify-center gap-2.5">
      {s.status === "default" && <><BrandMark className="h-8" /><span className="text-[22px] font-bold tracking-tight">{BRAND_NAME}</span></>}
      {s.status === "branded" && <BrandedMark brand={s.brand} size="lg" />}
    </div>
  );
}

/** Top left: the organization's logo and name (links to its website), or the SEO Insights mark (links home). */
export function LoginBrandHome() {
  const s = useLoginBrand();
  const ring = "rounded-lg outline-none focus-visible:ring-4 focus-visible:ring-[var(--login-ring,#F26A1B)]/25";
  if (s.status === "loading") return <span aria-hidden className="block h-7 w-40" />;
  if (s.status === "default") {
    return (
      <Link href="/" className={`flex items-center gap-2.5 ${ring}`}>
        <BrandMark className="h-7" />
        <span className="text-[19px] font-semibold tracking-[-0.01em]">{BRAND_NAME}</span>
      </Link>
    );
  }
  const b = s.brand;
  return b.company.website
    ? <a href={b.company.website} rel="noopener" className={`flex min-w-0 items-center gap-2.5 ${ring}`}><BrandedMark brand={b} size="md" /></a>
    : <span className="flex min-w-0 items-center gap-2.5"><BrandedMark brand={b} size="md" /></span>;
}

/** Top right: "Home" (the SEO Insights site); for an organization, its website, or nothing. */
export function LoginBrandBack() {
  const s = useLoginBrand();
  const cls = "inline-flex items-center gap-1.5 rounded text-sm font-medium text-[#6B635C] outline-none hover:text-[#17120E] focus-visible:ring-2 focus-visible:ring-[var(--login-ring,#F26A1B)]";
  if (s.status === "loading") return null;
  if (s.status === "default") return <Link href="/" className={cls}><ArrowLeft className="size-4" aria-hidden /> Home</Link>;
  const site = s.brand.company.website;
  return site ? <a href={site} rel="noopener" className={cls}><ArrowLeft className="size-4" aria-hidden /> {websiteLabel(site).replace(/^www\./, "")}</a> : null;
}

/** Bottom: © year and the operator, or the organization's company (or display) name. */
export function LoginBrandFooter({ year, operator }: { year: string; operator: string }) {
  const s = useLoginBrand();
  const who = s.status === "branded" ? s.brand.company.name || s.brand.name : s.status === "loading" ? "" : operator;
  return <p className="min-h-4 text-center text-xs text-[#8C837B] lg:text-left">{who && `© ${year} ${who}`}</p>;
}
