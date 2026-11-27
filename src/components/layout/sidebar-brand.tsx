import { BrandMark, BRAND_NAME } from "@/components/brand/brand-mark";
import { BrandLogo, BrandSquare } from "@/components/org/branding/brand-logo";
import { isWideLogo, type ShellBrand } from "@/lib/org/branding-theme";

/**
 * The brand at the top of the sidebar: the active organization's logo and display name, or the SEO Insights mark
 * and name when it has no branding (brand = null). A wordmark-style logo is shown alone (it carries the name).
 */
export function SidebarBrand({ brand, collapsed }: { brand: ShellBrand | null; collapsed: boolean }) {
  if (!brand) {
    return (
      <>
        <BrandMark className="h-5" />
        {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight">{BRAND_NAME}</span>}
      </>
    );
  }
  if (collapsed) return <BrandSquare src={brand.mark} monogram={brand.monogram} />;
  const wide = isWideLogo(brand.logo);
  return (
    <>
      {brand.logo ? <BrandLogo logo={brand.logo} alt={wide ? brand.name : ""} className={wide ? "h-7 max-w-[168px]" : "h-6 max-w-[48px]"} />
        : <BrandSquare src={brand.mark} monogram={brand.monogram} />}
      {!wide && <span className="truncate text-[15px] font-semibold tracking-tight">{brand.name}</span>}
    </>
  );
}

/** The collapsed sidebar's square mark (turns into the expand button on hover). */
export function SidebarBrandSquare({ brand, className }: { brand: ShellBrand | null; className?: string }) {
  return brand ? <BrandSquare src={brand.mark} monogram={brand.monogram} className={className} /> : <BrandMark className={`h-5 ${className ?? ""}`} />;
}
