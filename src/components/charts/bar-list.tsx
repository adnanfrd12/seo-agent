export interface BarItem {
  label: string;
  value: number;
  /** pre-formatted secondary text, e.g. "42.1%" */
  detail?: string;
}

/** Ranked horizontal bars, single hue (magnitude). Exact values are always printed beside the bar. */
export function BarList({
  title, items, valueLabel, emptyText = "No data for this period.",
}: { title: string; items: BarItem[]; valueLabel: string; emptyText?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <section className="min-w-0 rounded-[10px] border border-border bg-surface px-4 pb-4 pt-3.5 sm:px-5" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="shrink-0 text-xs text-muted">{valueLabel}</span>
      </div>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((i) => (
            <li key={i.label} className="text-[13px]">
              <div className="flex justify-between gap-3">
                <span className="truncate" title={i.label}>{i.label}</span>
                <span className="shrink-0 tabular-nums">
                  {new Intl.NumberFormat("en-US").format(i.value)}
                  {i.detail && <span className="ml-2 inline-block min-w-9 text-right text-muted">{i.detail}</span>}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                <div className="h-full rounded-full bg-series" style={{ width: `${i.value > 0 ? Math.max(1.5, (i.value / max) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
