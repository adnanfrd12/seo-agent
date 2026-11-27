import type { LogoSet } from "@/lib/org/branding-theme";
import { cn } from "@/lib/utils";

/**
 * An organization's logo. mode "auto" follows the system light/dark setting (the dashboard); "light" and "dark"
 * are fixed (reports and the sign-in page are always light; previews show either). When only the version for the
 * other background exists, it sits on a small plate so it stays visible. Size it with a height class (h-6…).
 */
export function BrandLogo({ logo, alt, mode = "auto", className }: { logo: LogoSet; alt: string; mode?: "auto" | "light" | "dark"; className?: string }) {
  const img = (src: string, extra?: string) => (
    // eslint-disable-next-line @next/next/no-img-element -- organization logo from the public org-assets bucket
    <img src={src} alt={alt} draggable={false} className={cn("h-full w-auto max-w-full object-contain object-left", extra)} />
  );
  const box = "inline-flex shrink-0 items-center";
  const plateLight = "rounded-md bg-white px-1.5 py-1";
  const plateDark = "rounded-md bg-[#17171A] px-1.5 py-1";

  if (mode !== "auto") {
    const own = mode === "light" ? logo.light : logo.dark;
    const other = mode === "light" ? logo.dark : logo.light;
    const src = own ?? other;
    if (!src) return null;
    return <span className={cn(box, !own && (mode === "light" ? plateDark : plateLight), className)}>{img(src)}</span>;
  }
  if (logo.light && logo.dark && logo.light !== logo.dark) {
    return <span className={cn(box, className)}>{img(logo.light, "dark:hidden")}{img(logo.dark, "hidden dark:block")}</span>;
  }
  if (logo.light && logo.dark) return <span className={cn(box, className)}>{img(logo.light)}</span>;
  if (logo.light) return <span className={cn(box, "dark:rounded-md dark:bg-white dark:px-1.5 dark:py-1", className)}>{img(logo.light)}</span>;
  return <span className={cn(box, plateDark, "dark:bg-transparent dark:p-0", className)}>{img(logo.dark!)}</span>;
}

/** A square mark (favicon or square logo), or the name's initials on the primary colour. */
export function BrandSquare({ src, monogram, className }: { src: string | null; monogram: string; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- organization favicon/logo from the public org-assets bucket
    <img src={src} alt="" draggable={false} className={cn("size-6 shrink-0 rounded-[5px] object-contain", className)} />
  ) : (
    <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-[6px] bg-accent text-[10.5px] font-semibold tracking-tight text-accent-foreground", className)}>
      {monogram}
    </span>
  );
}
