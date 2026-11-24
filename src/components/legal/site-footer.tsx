import Link from "next/link";
import { SITE } from "@/config/platforms";
import { cn } from "@/lib/utils";

export const FOOTER_LINKS = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms and Conditions" },
  { href: "/data-deletion", label: "Data Deletion" },
  { href: "/platforms", label: "Platforms and permissions" },
  { href: `mailto:${SITE.email}`, label: "Contact" },
] as const;

/**
 * Shared footer: full on public pages (sign-in, legal, platforms, deletion status), `muted` and smaller at the
 * bottom of the signed-in app.
 */
export function SiteFooter({ muted = false, className }: { muted?: boolean; className?: string }) {
  const link = muted
    ? "rounded text-muted outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-accent"
    : "rounded text-[#5a5a63] outline-none hover:text-[#E8452C] hover:underline focus-visible:ring-2 focus-visible:ring-[#F26A1B]";
  return (
    <footer className={cn(muted ? "border-t border-hairline px-4 py-4 text-[11px] text-faint md:px-6" : "border-t border-[#F1ECE7] bg-white px-4 py-7 text-[13px] text-[#8a8a94]", className)}>
      <div className={cn("mx-auto flex max-w-5xl flex-col items-center gap-2 text-center", muted && "max-w-none")}>
        <p className={muted ? "" : "text-[#3a3a42]"}>
          <strong className={muted ? "font-semibold text-muted" : "font-semibold text-[#1f1f25]"}>{SITE.product}</strong>
          {" "}· Operated by {SITE.operator} · {SITE.city}
        </p>
        <nav aria-label="Legal">
          <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {FOOTER_LINKS.map((l) => (
              <li key={l.href}>
                {l.href.startsWith("mailto:") ? <a href={l.href} className={link}>{l.label}</a> : <Link href={l.href} className={link}>{l.label}</Link>}
              </li>
            ))}
          </ul>
        </nav>
        <p>© 2026 {SITE.operator}</p>
      </div>
    </footer>
  );
}
