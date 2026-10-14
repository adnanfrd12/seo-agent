import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Consistent section title: source badge, title, optional context line and "View details" link. */
export function SectionHeader({
  source, title, subtitle, href, id,
}: { source?: string; title: string; subtitle?: string; href?: string; id?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {source && (
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              {source}
            </span>
          )}
          <h2 id={id} className="text-base font-semibold tracking-tight">{title}</h2>
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          View details <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
