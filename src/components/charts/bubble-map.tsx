export interface Bubble { label: string; x: number; y: number; size: number; highlight?: boolean }

/**
 * Competition map: x = share of answers that name the brand (%), y = average position in those answers
 * (1 at the top, so higher on the chart is better), bubble area = number of mentions. The client is
 * drawn in the accent colour, everyone else in a neutral tone, and every bubble is labelled.
 */
export function BubbleMap({ title, items, xLabel, yLabel }: { title: string; items: Bubble[]; xLabel: string; yLabel: string }) {
  const w = 640, h = 300, pl = 44, pr = 16, pt = 14, pb = 34;
  // a little headroom so the largest bubbles at the edges aren't cut off
  const maxX = Math.max(10, ...items.map((i) => i.x)) * 1.08, maxY = Math.max(3, ...items.map((i) => i.y)) + 0.4;
  const maxS = Math.max(1, ...items.map((i) => i.size));
  const x = (v: number) => pl + (v / maxX) * (w - pl - pr);
  const y = (v: number) => pt + ((v - 1) / Math.max(1, maxY - 1)) * (h - pt - pb);
  const r = (s: number) => 5 + Math.sqrt(s / maxS) * 16;
  const ticksX = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round((t * maxX) / 1.08));
  const ticksY = [...new Set([1, Math.ceil((maxY - 0.4) / 2), Math.floor(maxY)])];
  return (
    <figure className="rounded-xl border border-border bg-surface p-4">
      <figcaption className="mb-2 text-sm font-semibold">{title}</figcaption>
      {items.length === 0 ? <p className="py-8 text-center text-sm text-muted">No brands named yet.</p> : (
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`${title}: ${items.map((i) => `${i.label} ${i.x}% at position ${i.y}`).join("; ")}`}>
          {ticksX.map((t) => <g key={`x${t}`}><line x1={x(t)} x2={x(t)} y1={pt} y2={h - pb} stroke="var(--border)" /><text x={x(t)} y={h - pb + 14} textAnchor="middle" fontSize="11" fill="var(--muted)">{t}%</text></g>)}
          {ticksY.map((t) => <g key={`y${t}`}><line x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} stroke="var(--border)" /><text x={pl - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">#{t}</text></g>)}
          <text x={(w + pl) / 2} y={h - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">{xLabel}</text>
          <text x={12} y={(h - pb + pt) / 2} textAnchor="middle" fontSize="11" fill="var(--muted)" transform={`rotate(-90 12 ${(h - pb + pt) / 2})`}>{yLabel}</text>
          {[...items].sort((a, b) => b.size - a.size).map((i) => (
            <g key={i.label}>
              <circle cx={x(i.x)} cy={y(i.y)} r={r(i.size)} fill={i.highlight ? "var(--accent)" : "var(--muted)"} fillOpacity={i.highlight ? 0.85 : 0.35} stroke={i.highlight ? "var(--accent)" : "var(--muted)"} strokeWidth="1.5">
                <title>{`${i.label}: named in ${i.x}% of answers, average position #${i.y}, ${i.size} mention${i.size === 1 ? "" : "s"}`}</title>
              </circle>
              {(() => {
                // labels near the right edge go on the left of their bubble so they stay readable
                const left = x(i.x) > w - 150;
                return <text x={left ? x(i.x) - r(i.size) - 3 : x(i.x) + r(i.size) + 3} y={y(i.y) + 4} textAnchor={left ? "end" : "start"} fontSize="11" fontWeight={i.highlight ? 700 : 400} fill="var(--foreground)">{i.label.length > 22 ? `${i.label.slice(0, 21)}…` : i.label}</text>;
              })()}
            </g>
          ))}
        </svg>
      )}
    </figure>
  );
}
