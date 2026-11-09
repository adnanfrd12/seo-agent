import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Small shared pieces for the site-scan Toolkit pages. */
export const PRIO_CLS: Record<string, string> = {
  Critical: "bg-negative text-white", High: "bg-negative/10 text-negative", Medium: "bg-warn/10 text-warn", Low: "bg-surface-muted text-secondary", Info: "bg-positive/10 text-positive",
};
export function Prio({ p }: { p: string }) {
  return <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-medium", PRIO_CLS[p] ?? PRIO_CLS.Low)}>{p}</span>;
}
export function BackToToolkit() {
  return <Link href="/toolkit" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"><ArrowLeft className="size-3.5" /> SEO Toolkit</Link>;
}
export function Card({ title, sub, children, className, right }: { title: string; sub?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <section aria-label={title} className={cn("min-w-0 rounded-[10px] border border-border bg-surface p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h2 className="text-[15px] font-semibold">{title}</h2>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
export interface Fix { prio: "Critical" | "High" | "Medium" | "Low"; issue: string; fix: string; count?: number }
const ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
export function FixList({ fixes, empty }: { fixes: Fix[]; empty: string }) {
  const list = [...fixes].sort((a, b) => ORDER[a.prio] - ORDER[b.prio]);
  if (!list.length) return <p className="text-sm text-positive">{empty}</p>;
  return (
    <ol className="divide-y divide-hairline">
      {list.map((f, i) => (
        <li key={i} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3">
          <span className="w-20 shrink-0"><Prio p={f.prio} /></span>
          <div className="min-w-0 text-sm">
            <p className="font-medium">{f.issue}{f.count != null && <span className="font-normal text-muted"> · {f.count}</span>}</p>
            <p className="text-secondary">{f.fix}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
export const pathLabel = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/ (home)" : x.pathname; } catch { return u; } };
export const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "never");
