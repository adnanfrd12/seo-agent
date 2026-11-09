"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface DivergingPoint { date: string; up: number; down: number }

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

/**
 * Gains above the zero line, losses below it, one pair per month (e.g. new vs lost backlinks).
 * Values are always positive in the data; losses are drawn negative.
 */
export function DivergingBars({ title, sub, data, upLabel, downLabel, upColor, downColor = "var(--warn)" }: {
  title: string; sub?: string; data: DivergingPoint[]; upLabel: string; downLabel: string; upColor: string; downColor?: string;
}) {
  const rows = data.map((d) => ({ date: d.date, up: d.up, down: -Math.abs(d.down) }));
  const totalUp = data.reduce((a, d) => a + d.up, 0), totalDown = data.reduce((a, d) => a + Math.abs(d.down), 0);
  return (
    <figure className="flex min-w-0 flex-col rounded-[10px] border border-border bg-surface px-4 pb-3 pt-3.5 sm:px-5" aria-label={title}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <figcaption className="text-[15px] font-semibold">{title}</figcaption>
          {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
        </div>
        <span className="text-xs text-muted">DFS</span>
      </div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: upColor }} aria-hidden />{upLabel} · <span className="tabular-nums">{nf.format(totalUp)}</span></li>
        <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: downColor }} aria-hidden />{downLabel} · <span className="tabular-nums">{nf.format(totalDown)}</span></li>
      </ul>
      {rows.length === 0 ? (
        <div className="flex h-60 items-center justify-center text-sm text-muted">No monthly data yet.</div>
      ) : (
        <div className="h-60" role="img" aria-label={`${title}: ${data.map((d) => `${monthLabel(d.date)} +${d.up} / -${Math.abs(d.down)}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} stackOffset="sign" margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={monthLabel} tick={{ fill: "var(--faint)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} tickMargin={8} />
              <YAxis width={48} tick={{ fill: "var(--faint)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => nf.format(v)} allowDecimals={false} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Tooltip
                cursor={{ fill: "var(--surface-muted)" }}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)", padding: "8px 10px" }}
                labelStyle={{ color: "var(--muted)", marginBottom: 4 }}
                labelFormatter={(l) => monthLabel(String(l))}
                formatter={(v, name) => [nf.format(Math.abs(Number(v))), name === "up" ? upLabel : downLabel]}
              />
              <Bar dataKey="up" stackId="s" fill={upColor} radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="down" stackId="s" fill={downColor} radius={[0, 0, 2, 2]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
