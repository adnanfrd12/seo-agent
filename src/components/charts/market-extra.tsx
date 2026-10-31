import { Legend, Panel } from "@/components/charts/ai-charts";

/**
 * Grouped horizontal bars: one group per entity (a site), one bar per measure side by side, every value
 * printed. Used where the measures must not be added up (e.g. links gained vs links lost).
 */
export interface GroupKey { key: string; label: string; color: string }
export interface GroupRow { label: string; values: Record<string, number | null>; note?: string }

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function GroupedBars({ title, sub, keys, rows, valueLabel, empty = "No data yet." }: {
  title: string; sub?: string; keys: GroupKey[]; rows: GroupRow[]; valueLabel: string; empty?: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => keys.map((k) => r.values[k.key] ?? 0)));
  return (
    <Panel title={title} sub={sub} right={<span className="text-xs text-muted">{valueLabel}</span>}>
      {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">{empty}</p> : (
        <>
          <div className="mb-3"><Legend items={keys} /></div>
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.label} className="min-w-0">
                <p className="mb-1 flex items-baseline justify-between gap-2 text-[13px]"><span className="min-w-0 truncate font-medium" title={r.label}>{r.label}</span>{r.note && <span className="shrink-0 text-xs text-muted">{r.note}</span>}</p>
                <div className="space-y-1">
                  {keys.map((k) => {
                    const v = r.values[k.key];
                    return (
                      <div key={k.key} className="flex items-center gap-2" aria-label={`${r.label}, ${k.label}: ${v == null ? "no data" : nf.format(v)}`}>
                        <span className="h-2.5 min-w-0 flex-1 rounded-[3px] bg-surface-muted">
                          <span className="block h-full rounded-[3px]" style={{ width: v ? `${Math.max(1.5, (v / max) * 100)}%` : 0, background: k.color }} />
                        </span>
                        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-secondary">{v == null ? "—" : nf.format(v)}</span>
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
