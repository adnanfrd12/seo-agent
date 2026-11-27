import { BrandLockup } from "@/components/brand/brand-mark";
import { BrandLogo } from "@/components/org/branding/brand-logo";
import { BrandStyle } from "@/components/org/branding/brand-style";
import { brandName, cssString, hasCompanyInfo, isWideLogo, logoSet, websiteLabel, type Branding, type LogoSet } from "@/lib/org/branding-theme";
import { cn } from "@/lib/utils";

/**
 * Report branding (the /report view, its print and the server PDF) for the organization that owns the client.
 * Nothing set: exactly the SEO Insights report. Pure components (no server code), so the branding settings preview
 * renders the same header.
 */

/** Whether the organization replaced the SEO Insights identity (then the report never names SEO Insights). */
const ownIdentity = (b: Branding) => Boolean(b.displayName || logoSet(b) || b.company.name);

/** The text in the bottom-left margin of every page after the cover (globals.css has the default). */
export function reportFooterText(b: Branding): string {
  if (b.report.footer) return b.report.footer;
  if (!ownIdentity(b)) return "SEO Insights · Performance report";
  const identity = b.displayName ?? (b.company.name || null);
  return identity ? `${identity} · Performance report` : "Performance report";
}

/**
 * The logo on the report: on screen it follows light/dark mode like the dashboard (the report page does); printed
 * and in the PDF it is always the light-background version, because reports always print on white.
 */
function ReportLogo({ logo, alt, className }: { logo: LogoSet; alt: string; className: string }) {
  // one image: a light-background logo gets a white plate in dark mode, a dark-background one keeps its dark plate
  if (!logo.light || !logo.dark || logo.light === logo.dark) return <BrandLogo logo={logo} alt={alt} mode={logo.light ? "auto" : "light"} className={className} />;
  return (
    <>
      <BrandLogo logo={logo} alt={alt} mode="light" className={cn("dark:hidden print:inline-flex!", className)} />
      <BrandLogo logo={logo} alt="" mode="dark" className={cn("hidden dark:inline-flex print:hidden!", className)} />
    </>
  );
}

/** Top of the cover (`alwaysLight`: a preview drawn on white whatever the system theme): the organization's logo (light-background version) and name, and the report header text. */
export function ReportBrandHeader({ brand, alwaysLight = false }: { brand: Branding; alwaysLight?: boolean }) {
  const logo = logoSet(brand);
  const custom = Boolean(brand.displayName || logo);
  const name = brandName(brand);
  const header = brand.report.header ? <p className="max-w-[48%] pt-1 text-right text-sm text-muted">{brand.report.header}</p> : null;
  if (!custom && !header) return <BrandLockup tagline="Analytics Dashboard" />;
  const wide = isWideLogo(logo);
  return (
    <div className="flex items-start justify-between gap-6">
      {custom ? (
        <div className="flex min-w-0 items-center gap-3">
          {logo && alwaysLight && <BrandLogo logo={logo} alt={wide ? name : ""} mode="light" className={wide ? "h-12 max-w-[62mm]" : "h-11 max-w-[32mm]"} />}
          {logo && !alwaysLight && <ReportLogo logo={logo} alt={wide ? name : ""} className={wide ? "h-12 max-w-[62mm]" : "h-11 max-w-[32mm]"} />}
          {!wide && <p className="min-w-0 text-xl font-semibold tracking-tight">{name}</p>}
        </div>
      ) : <BrandLockup tagline="Analytics Dashboard" />}
      {header}
    </div>
  );
}

/** Bottom of the cover: who prepared the report (company info) and the footer text, when set. */
export function ReportCompany({ brand }: { brand: Branding }) {
  const c = brand.company;
  if (!hasCompanyInfo(brand) && !brand.report.footer) return null;
  const contact = [
    c.website && <a key="w" href={c.website}>{websiteLabel(c.website)}</a>,
    c.email && <a key="e" href={`mailto:${c.email}`}>{c.email}</a>,
    c.phone && <span key="p">{c.phone}</span>,
  ].filter(Boolean);
  return (
    <div className="mt-6 border-t border-border pt-4 text-sm text-muted">
      {hasCompanyInfo(brand) && (
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">Prepared by</p>
            {c.name && <p className="mt-1 font-semibold text-foreground">{c.name}</p>}
            {c.address && <p className="mt-0.5 whitespace-pre-line">{c.address}</p>}
          </div>
          {contact.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 sm:justify-end">
              {contact.map((node, i) => <span key={i} className="inline-flex gap-3">{i > 0 && <span aria-hidden className="text-faint">·</span>}{node}</span>)}
            </p>
          )}
        </div>
      )}
      {brand.report.footer && <p className="mt-3 text-xs">{brand.report.footer}</p>}
    </div>
  );
}

/**
 * The organization's colours for the report, and the text printed in the page margins of every page after the
 * cover: the header text top left, the footer text bottom left ("Page n of m" stays bottom right).
 */
export function ReportPageStyle({ brand }: { brand: Branding }) {
  // only override the default footer (globals.css) when the organization changed something it shows
  const footer = (brand.report.footer || ownIdentity(brand)) ? reportFooterText(brand) : "";
  const css = [
    footer && `@page{@bottom-left{content:${cssString(footer)}}}`,
    brand.report.header && `@page{@top-left{content:${cssString(brand.report.header)};font:9px system-ui,sans-serif;color:#6b6b76}}@page :first{@top-left{content:none}}`,
  ].filter(Boolean).join("");
  return (
    <>
      <BrandStyle colors={brand.colors} />
      {css && <style data-org-report="" dangerouslySetInnerHTML={{ __html: css }} />}
    </>
  );
}
