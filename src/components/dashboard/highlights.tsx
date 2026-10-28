import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, Lightbulb } from "lucide-react";
import type { Highlight } from "@/lib/overview/highlights";
import { cn } from "@/lib/utils";

const TONE = {
  good: { icon: CheckCircle2, bar: "border-l-positive", iconCls: "text-positive", label: "Improved" },
  bad: { icon: CircleAlert, bar: "border-l-negative", iconCls: "text-negative", label: "Needs attention" },
  info: { icon: Lightbulb, bar: "border-l-accent", iconCls: "text-accent", label: "Worth knowing" },
} as const;

/**
 * "What stands out": up to four statements that answer what happened, why it matters and what to do,
 * placed above the detailed numbers of a tab. Falls back to an explicit "stable" message so the strip
 * never silently disappears.
 */
export function Highlights({ items, stableNote }: { items: Highlight[]; stableNote?: string }) {
  const list = items.length ? items : [{ tone: "info" as const, title: "A steady period", detail: stableNote ?? "No metric moved enough to flag. The detailed numbers are below.", href: undefined, action: undefined }];
  return (
    <section aria-label="What stands out" className="rise mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">What stands out</h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {list.map((h, i) => {
          const t = TONE[h.tone];
          const body = (
            <>
              <span className="flex items-start gap-2">
                <t.icon className={cn("mt-0.5 size-4 shrink-0", t.iconCls)} aria-label={t.label} />
                <span className="text-sm font-semibold leading-snug">{h.title}</span>
              </span>
              {h.detail && <span className="mt-1 block text-xs text-muted">{h.detail}</span>}
              {h.action && <span className="mt-2 flex items-start gap-1.5 text-xs font-medium"><ArrowRight className="mt-0.5 size-3 shrink-0 text-accent" aria-hidden />{h.action}</span>}
            </>
          );
          return (
            <li key={i}>
              {h.href
                ? <Link href={h.href} className={cn("lift block h-full rounded-xl border border-l-4 border-border bg-surface p-3.5", t.bar)}>{body}</Link>
                : <div className={cn("h-full rounded-xl border border-l-4 border-border bg-surface p-3.5", t.bar)}>{body}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
