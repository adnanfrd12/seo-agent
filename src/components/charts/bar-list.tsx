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
    <section className="rounded-xl border border-border bg-surface p-4" aria-label={title}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted">{valueLabel}</span>
      </div>
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.label} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate">{i.label}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {new Intl.NumberFormat("en-US").format(i.value)}
                  {i.detail && <span className="ml-2">{i.detail}</span>}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
