import { brandCss, type BrandColors } from "@/lib/org/branding-theme";

/**
 * Applies an organization's colours to the design tokens (light, dark and print), for the page it's rendered in:
 * the dashboard frame of that organization, or its reports. Renders nothing when the organization kept the default
 * colours. The CSS holds generated #RRGGBB values only.
 */
export function BrandStyle({ colors }: { colors: BrandColors }) {
  const css = brandCss(colors);
  return css ? <style data-org-brand="" dangerouslySetInnerHTML={{ __html: css }} /> : null;
}
