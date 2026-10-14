import { cn } from "@/lib/utils";

export const BRAND_NAME = "SEO Insights";

/** Three ascending rounded bars (the product mark). Pure SVG, so it stays sharp at any size. */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 40 44" className={cn("h-8 w-auto", className)}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}
    >
      <rect x="0" y="24" width="11" height="20" rx="5.5" fill="#D93A2B" />
      <rect x="14.5" y="12" width="11" height="32" rx="5.5" fill="#F2701E" />
      <rect x="29" y="0" width="11" height="44" rx="5.5" fill="#EA4A2A" />
    </svg>
  );
}

/** Mark + wordmark with the small caps tagline, as used in the sidebar and login page. */
export function BrandLockup({
  tagline = "Analytics Dashboard", size = "md", stacked = false, className,
}: { tagline?: string; size?: "sm" | "md" | "lg"; stacked?: boolean; className?: string }) {
  const mark = size === "lg" ? "h-14" : size === "md" ? "h-9" : "h-6";
  const name = size === "lg" ? "text-3xl" : size === "md" ? "text-xl" : "text-base";
  return (
    <div className={cn("flex items-center gap-3", stacked && "flex-col gap-2 text-center", className)}>
      <BrandMark className={mark} />
      <div className={stacked ? "" : "leading-tight"}>
        <p className={cn("font-semibold tracking-tight", name)}>{BRAND_NAME}</p>
        {tagline && (
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted">{tagline}</p>
        )}
      </div>
    </div>
  );
}
