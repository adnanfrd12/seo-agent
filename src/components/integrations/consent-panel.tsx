import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { PlatformEntry } from "@/config/platforms";
import { cn } from "@/lib/utils";

/**
 * Shown before the platform's consent screen (and next to API-key forms): what SEO Insights reads, why, the exact
 * permissions, and links to Privacy and Data Deletion. Generated from the platform registry.
 */
export function ConsentPanel({ p, className, children }: { p: PlatformEntry; className?: string; children?: React.ReactNode }) {
  return (
    <div role="region" aria-label={`${p.name}: what SEO Insights will access`} className={cn("rounded-lg border border-border bg-background p-3 text-[13px] leading-relaxed", className)}>
      <p className="flex items-center gap-1.5 font-semibold text-foreground"><ShieldCheck className="size-4 text-positive" aria-hidden /> Read-only. We never post or change anything.</p>
      <p className="mt-1.5"><span className="font-medium text-foreground">Data accessed:</span> <span className="text-secondary">{p.dataAccessed.join("; ")}.</span></p>
      <p className="mt-1"><span className="font-medium text-foreground">Why:</span> <span className="text-secondary">{p.purpose}</span></p>
      <p className="mt-1 font-medium text-foreground">Permissions{p.connection === "api_key" ? "" : " you'll be asked to approve"}:</p>
      <ul className="mt-0.5 space-y-0.5 text-secondary">
        {p.scopes.map((s) => <li key={s.scope}><code className="break-all text-[12px] text-foreground">{s.scope}</code>: {s.reason}</li>)}
      </ul>
      <p className="mt-1.5 text-muted">
        <Link href="/privacy" target="_blank" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</Link>
        {" · "}<Link href="/data-deletion" target="_blank" className="underline underline-offset-2 hover:text-foreground">Data Deletion</Link>
        {" · "}<Link href={`/platforms#platform-${p.id.replace(/_/g, "-")}`} target="_blank" className="underline underline-offset-2 hover:text-foreground">All permissions</Link>
      </p>
      {children && <div className="mt-2.5 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** Small "Coming soon" badge for registry entries with status `planned`. */
export function ComingSoon() {
  return <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] text-muted">Coming soon</span>;
}
