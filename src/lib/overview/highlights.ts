/**
 * "What stands out" helpers shared by every analytics tab. Each tab turns its own numbers into a few
 * plain-language statements (what happened, and what to do about it), all computed from stored data.
 */
export interface Highlight {
  tone: "good" | "bad" | "info";
  title: string;
  detail?: string;
  /** one concrete next step, shown under the detail */
  action?: string;
  href?: string;
}

type Num = number | null | undefined;

/** A period-over-period movement worth mentioning, or null when it is too small or has too little volume. */
export function movement(label: string, cur: Num, prev: Num, o: {
  fmt: (n: number) => string; lowerIsBetter?: boolean; minBase?: number; minPct?: number; action?: string; actionWhenBad?: string; href?: string;
}): Highlight | null {
  if (cur == null || prev == null || prev === 0 || Math.abs(prev) < (o.minBase ?? 0)) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < (o.minPct ?? 8)) return null;
  const good = o.lowerIsBetter ? pct < 0 : pct > 0;
  return {
    tone: good ? "good" : "bad",
    title: `${label} ${o.lowerIsBetter ? (pct < 0 ? "improved" : "worsened") : pct > 0 ? "rose" : "fell"} ${Math.abs(pct).toFixed(0)}%`,
    detail: `${o.fmt(prev)} → ${o.fmt(cur)} compared with the previous period.`,
    action: good ? o.action : (o.actionWhenBad ?? o.action),
    href: o.href,
  };
}

/** Keeps the strongest few: bad news first, then good, then info. */
export function pickHighlights(items: (Highlight | null | undefined | false)[], max = 4): Highlight[] {
  const rank = { bad: 0, good: 1, info: 2 } as const;
  return items.filter((x): x is Highlight => Boolean(x)).sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, max);
}
