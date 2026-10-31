import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Highlight } from "@/lib/overview/highlights";
import { cn } from "@/lib/utils";

const TONE = {
  good: { dot: "bg-positive", label: "Improved" },
  bad: { dot: "bg-negative", label: "Needs attention" },
  info: { dot: "bg-warn", label: "Worth knowing" },
} as const;

/**
 * "What stands out": up to four statements that answer what happened, why it matters and what to do,
 * placed above the detailed numbers of a tab, as quiet rows with a status dot. Falls back to an
 * explicit "stable" message so the strip never silently disappears.
 */
export function Highlights({ items, stableNote }: { items: Highlight[]; stableNote?: string }) {
  const list = items.length ? items : [{ tone: "info" as const, title: "A steady period", detail: stableNote ?? "No metric moved enough to flag. The detailed numbers are below.", href: undefined, action: undefined }];
  return (
    <section aria-label="What stands out" className="mb-6 overflow-hidden rounded-[10px] border border-border bg-surface">
      <ul className={cn("grid", list.length > 1 && "lg:grid-cols-2")}>
        {list.map((h, i) => {
          const t = TONE[h.tone];
          const body = (
            <span className="flex gap-3">
              <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", t.dot)} aria-label={t.label} role="img" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-snug">{h.title}</span>
                {h.detail && <span className="mt-0.5 block text-[13px] leading-relaxed text-secondary">{h.detail}</span>}
                {h.action && <span className="mt-1 flex items-start gap-1.5 text-[13px] text-foreground"><ArrowRight className="mt-[3px] size-3 shrink-0 text-muted" aria-hidden />{h.action}</span>}
              </span>
            </span>
          );
          const cls = cn("block h-full px-4 py-3 sm:px-5", "border-hairline", i > 0 && "border-t", list.length > 1 && i === 1 && "lg:border-t-0", list.length > 1 && i % 2 === 1 && "lg:border-l");
          return (
            // an odd last item takes the whole row, so the strip never ends in an empty cell
            <li key={i} className={cn(list.length > 1 && list.length % 2 === 1 && i === list.length - 1 && "lg:col-span-2")}>
              {h.href ? <Link href={h.href} className={cn(cls, "transition-colors hover:bg-surface-sunken")}>{body}</Link> : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
