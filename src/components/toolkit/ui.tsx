import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared building blocks for the SEO Toolkit pages. */
export function BackToToolkit() {
  return <Link href="/toolkit" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"><ArrowLeft className="size-3.5" /> SEO Toolkit</Link>;
}

export function RunBar({ children, fetchedAt, cost, note }: { children: React.ReactNode; fetchedAt?: string | null; cost?: number | null; note?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between">
      <p className="text-xs text-muted">
        {fetchedAt ? <>Last run <span className="font-medium text-foreground">{new Date(fetchedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>{cost != null && <> · cost ${cost.toFixed(4)}</>}</> : "Not run yet for this client."}
        {note && <><br />{note}</>}
      </p>
      {children}
    </div>
  );
}

export function Card({ title, children, className, right }: { title?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-[10px] border border-border bg-surface p-4 sm:p-5", className)} aria-label={title}>
      {title && <div className="mb-3 flex items-baseline justify-between gap-3"><h2 className="text-[15px] font-semibold">{title}</h2>{right && <span className="shrink-0 text-xs text-muted">{right}</span>}</div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
    </div>
  );
}

export const PRIO_CLS: Record<string, string> = { Critical: "bg-negative text-white", High: "bg-negative/10 text-negative", Medium: "bg-warn/10 text-warn", Low: "bg-surface-muted text-secondary" };
export function Pill({ children, tone = "Low" }: { children: React.ReactNode; tone?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium", PRIO_CLS[tone] ?? PRIO_CLS.Low)}>{children}</span>;
}

/** Horizontal meter 0-100 (or 0-max). */
export function Meter({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  return <span className="relative block h-2.5 w-full rounded-full bg-surface-muted"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, Math.min(100, (value / max) * 100))}%`, background: color ?? "var(--accent)" }} /></span>;
}

export const shortUrl = (u: string | null | undefined) => { if (!u) return "—"; try { const x = new URL(u); return x.pathname === "/" ? `${x.host.replace(/^www\./, "")} (home)` : x.pathname; } catch { return u; } };
