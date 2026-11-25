"use client";

import { useState, type ReactNode } from "react";
import { useStored } from "./stored";
import { cn } from "@/lib/utils";
import { fmt, C, GOOD, BAD, type Fmt } from "./fmt";

/* Charts of the GA4 leads screens (the sample dashboard's chart set, in the dashboard's colours).
   Every mark has a native tooltip (<title>) with its label and exact value. */

const sumOf = (a: number[]) => a.reduce((t, x) => t + x, 0);
/** SVG coordinates rounded to 0.01 so the server and the browser print the same numbers (no hydration mismatch). */
const r2 = (v: number) => Math.round(v * 100) / 100;
const esc = (s: string) => s;
function niceMax(v: number) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const svgCls = "h-auto w-full [&_text]:fill-[var(--muted)] [&_text]:text-[11px] [&_.vl]:fill-[var(--foreground)] [&_.vl]:font-semibold [&_.vl]:text-[10.5px] [&_.vli]:fill-white [&_.vli]:text-[10px] [&_.vli]:font-semibold [&_.grid]:stroke-[var(--hairline)]";

export interface Series { name: string; tech?: string; values: (number | null)[]; color: string; dash?: boolean; area?: boolean }

function Legend({ series, square }: { series: Series[]; square?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.name + (s.dash ? "-p" : "")} className="inline-flex items-center gap-1.5">
          <b className={cn("inline-block", square ? "size-2.5 rounded-[2px]" : "h-[3px] w-3 rounded-full")} style={{ background: s.color, opacity: s.dash ? 0.55 : 1 }} />
          {s.name}{s.tech && s.tech !== s.name && <span className="font-mono text-[10.5px] text-faint">({s.tech})</span>}
        </span>
      ))}
    </div>
  );
}

function LineSvg({ labels, series, h = 230, f = "k", invert }: { labels: string[]; series: Series[]; h?: number; f?: Fmt; invert?: boolean }) {
  const W = 680, H = h, l = 48, r = 22, t = 18, b = 28, iw = W - l - r, ih = H - t - b;
  const vals = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!vals.length) vals.push(0);
  let lo: number, hi: number;
  if (invert) { lo = Math.max(1, Math.floor(Math.min(...vals) - 0.5)); hi = Math.ceil(Math.max(...vals) + 0.5); }
  else { lo = 0; const mv = Math.max(...vals, 1e-9); hi = vals.every(Number.isInteger) && mv <= 8 ? Math.ceil(mv) + 1 : niceMax(mv * 1.1); }
  const y = (v: number) => r2(invert ? t + ((v - lo) / (hi - lo)) * ih : t + ih - ((v - lo) / (hi - lo)) * ih);
  const x = (i: number) => r2(l + (labels.length < 2 ? iw / 2 : (i * iw) / (labels.length - 1)));
  const nt = invert ? 4 : hi <= 9 && Number.isInteger(hi) && vals.every(Number.isInteger) ? hi : 4;
  const step = Math.max(1, Math.ceil(labels.length / 7));
  const solid = series.filter((s) => !s.dash);
  const allLab = labels.length <= 16 && solid.length <= 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={svgCls} role="img" aria-label={`${series.map((s) => s.name).join(", ")} chart`}>
      {Array.from({ length: nt + 1 }, (_, k) => { const v = lo + ((hi - lo) * k) / nt, yy = y(v); return <g key={k}><line className="grid" x1={l} x2={W - r} y1={yy} y2={yy} /><text x={l - 6} y={yy + 4} textAnchor="end">{invert ? v.toFixed(1) : fmt(f === "pct" ? "pct" : "k", v)}</text></g>; })}
      {labels.map((lb, i) => (i % step === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle">{lb}</text> : null))}
      {series.map((s) => {
        const pts = s.values.map((v, i) => (v == null ? null : ([x(i), y(v), v, i] as const))).filter(Boolean) as (readonly [number, number, number, number])[];
        if (!pts.length) return null;
        const d = pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" ");
        return (
          <g key={s.name + (s.dash ? "p" : "")}>
            {s.area && <path d={`${d} L${pts.at(-1)![0]} ${t + ih} L${pts[0][0]} ${t + ih}Z`} fill={s.color} opacity={0.12} />}
            <path d={d} fill="none" stroke={s.color} strokeWidth={s.dash ? 1.6 : 2.2} strokeDasharray={s.dash ? "5 4" : undefined} opacity={s.dash ? 0.7 : 1} strokeLinejoin="round" strokeLinecap="round" />
            {!s.dash && pts.map((q, i) => { const last = i === pts.length - 1; if (!allLab && !last) return null; return <g key={i}><circle cx={q[0]} cy={q[1]} r={last ? 4 : 3} fill="var(--surface)" stroke={s.color} strokeWidth={2} /><text className="vl" x={q[0]} y={q[1] - 8} textAnchor={last && !allLab ? "end" : "middle"} style={{ fill: s.color }}>{fmt(f, q[2])}</text></g>; })}
            {labels.length <= 200 && pts.map((q) => <circle key={`h${q[3]}`} cx={q[0]} cy={q[1]} r={7} fill="transparent"><title>{`${labels[q[3]]} · ${s.name}: ${fmt(f, q[2])}`}</title></circle>)}
          </g>
        );
      })}
    </svg>
  );
}

function ColSvg({ labels, series, h = 220, f = "k", stacked = true }: { labels: string[]; series: Series[]; h?: number; f?: Fmt; stacked?: boolean }) {
  const W = 680, H = h, l = 48, r = 10, t = 18, b = 28, iw = W - l - r, ih = H - t - b;
  const S = series.map((s) => ({ ...s, values: s.values.map((v) => v ?? 0) }));
  const totals = labels.map((_, i) => (stacked ? sumOf(S.map((s) => s.values[i])) : Math.max(0, ...S.map((s) => s.values[i]))));
  const mxv = Math.max(...totals, 1e-9), ints = S.every((s) => s.values.every(Number.isInteger));
  const hi = ints && mxv <= 8 ? Math.ceil(mxv) + 1 : niceMax(mxv * 1.12);
  const bw = iw / Math.max(1, labels.length);
  const nt = ints && mxv <= 8 ? hi : 4;
  const step = Math.max(1, Math.ceil(labels.length / 12));
  const grpLab = !stacked && labels.length * S.length <= 48, stkTot = stacked && S.length > 1 && labels.length <= 35, oneLab = S.length === 1 && labels.length <= 35;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={svgCls} role="img" aria-label="column chart">
      {Array.from({ length: nt + 1 }, (_, k) => { const v = (hi * k) / nt, yy = t + ih - (v / hi) * ih; return <g key={k}><line className="grid" x1={l} x2={W - r} y1={yy} y2={yy} /><text x={l - 6} y={yy + 4} textAnchor="end">{fmt(f === "pct" ? "pct" : "k", v)}</text></g>; })}
      {labels.map((lb, i) => {
        let acc = 0;
        return (
          <g key={i}>
            {S.map((s, si) => {
              const v = s.values[i], hh = (v / hi) * ih;
              const xx = stacked ? l + i * bw + bw * 0.14 : l + i * bw + bw * 0.1 + si * ((bw * 0.8) / S.length);
              const ww = stacked ? bw * 0.72 : (bw * 0.8) / S.length - 1.5;
              const yy = stacked ? t + ih - acc - hh : t + ih - hh;
              if (stacked) acc += hh;
              if (hh <= 0) return null;
              return (
                <g key={si}>
                  <rect x={xx} y={yy} width={Math.max(1, ww)} height={hh} fill={s.color} rx={2.5}><title>{`${lb} · ${s.name}: ${fmt(f, v)}`}</title></rect>
                  {(grpLab || oneLab) ? <text className="vl" x={xx + ww / 2} y={yy - 4} textAnchor="middle">{fmt(f, v)}</text>
                    : stacked && S.length > 1 && hh >= 13 && ww >= 14 ? <text className="vli" x={xx + ww / 2} y={yy + hh / 2 + 4} textAnchor="middle">{fmt(f, v)}</text> : null}
                </g>
              );
            })}
            {stkTot && totals[i] > 0 && <text className="vl" x={l + i * bw + bw / 2} y={t + ih - acc - 4} textAnchor="middle">{fmt(f, totals[i])}</text>}
            {i % step === 0 && <text x={l + i * bw + bw / 2} y={H - 8} textAnchor="middle">{lb}</text>}
          </g>
        );
      })}
    </svg>
  );
}

type Kind = "line" | "group" | "stack";
/** Remembers each chart's Line / Bars / Stacked choice on this device. */
function useKind(id: string | undefined, initial: Kind): [Kind, (k: Kind) => void] {
  const [v, set] = useStored(id ? `ga4x:chart:${id}` : null);
  const [local, setLocal] = useState<Kind>(initial);
  const k = v === "line" || v === "group" || v === "stack" ? v : local;
  return [k, (x) => { setLocal(x); set(x); }];
}
function Toggle({ kinds, kind, set }: { kinds: [Kind, string][]; kind: Kind; set: (k: Kind) => void }) {
  return (
    <div role="group" aria-label="Chart type" className="mb-2 inline-flex rounded-md border border-border p-0.5 text-xs">
      {kinds.map(([k, lab]) => (
        <button key={k} type="button" aria-pressed={k === kind} onClick={() => set(k)}
          className={cn("rounded px-2 py-0.5", k === kind ? "bg-surface-muted font-medium text-foreground" : "text-muted hover:text-foreground")}>{lab}</button>
      ))}
    </div>
  );
}

export function LineChart({ id, labels, series, h, f = "k", invert, noToggle }: { id?: string; labels: string[]; series: Series[]; h?: number; f?: Fmt; invert?: boolean; noToggle?: boolean }) {
  const multi = series.filter((s) => !s.dash).length > 1;
  const [kind, set] = useKind(id, "line");
  const body = kind === "line" || invert || noToggle ? <LineSvg labels={labels} series={series} h={h} f={f} invert={invert} /> : <ColSvg labels={labels} series={series.filter((s) => !s.dash || kind === "group")} h={h} f={f} stacked={kind === "stack"} />;
  return (
    <div>
      {!invert && !noToggle && <Toggle kinds={[["line", "Line"], ["group", "Bars"], ...(multi ? ([["stack", "Stacked"]] as [Kind, string][]) : [])]} kind={kind} set={set} />}
      {body}
      {(series.length > 1 || series[0]?.name) && <Legend series={series} />}
    </div>
  );
}
export function ColChart({ id, labels, series, h, f = "k", stacked }: { id?: string; labels: string[]; series: Series[]; h?: number; f?: Fmt; stacked?: boolean }) {
  const multi = series.length > 1;
  const [kind, set] = useKind(id, !multi ? "group" : stacked === false ? "group" : "stack");
  return (
    <div>
      <Toggle kinds={[["group", multi ? "Grouped bars" : "Bars"], ...(multi ? ([["stack", "Stacked"]] as [Kind, string][]) : []), ["line", "Line"]]} kind={kind} set={set} />
      {kind === "line" ? <LineSvg labels={labels} series={series} h={h} f={f} /> : <ColSvg labels={labels} series={series} h={h} f={f} stacked={kind === "stack"} />}
      {multi && <Legend series={series} square />}
    </div>
  );
}

export function Spark({ values, color = C[0] }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const W = 160, H = 34, mx = Math.max(...values), mn = Math.min(...values), rg = mx - mn || 1;
  const pts = values.map((v, i) => [(i * W) / (values.length - 1), H - 3 - ((v - mn) / rg) * (H - 8)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="mt-2 h-9 w-full">
      <path d={`${d} L${W} ${H} L0 ${H}Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface Bar { label: string; tech?: string; value: number; color?: string; right?: string; href?: string; mono?: boolean }
export function BarList({ rows, f = "int", color = C[0], max, empty = "No data in this period." }: { rows: Bar[]; f?: Fmt; color?: string; max?: number; empty?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const m = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} title={`${r.label}: ${fmt(f, r.value)}`}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className={cn("min-w-0 truncate", r.mono && "font-mono text-xs")}>{r.href ? <a href={r.href} target="_blank" rel="noreferrer" className="hover:underline">{r.label}</a> : r.label}{r.tech && <span className="ml-1 font-mono text-[10.5px] text-faint">{r.tech}</span>}</span>
            <span className="shrink-0 tabular-nums text-muted">{r.right ?? fmt(f, r.value)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full" style={{ width: `${((r.value / m) * 100).toFixed(1)}%`, background: r.color ?? color }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ parts, f = "int", label = "" }: { parts: { label: string; tech?: string; value: number; color: string }[]; f?: Fmt; label?: string }) {
  const tot = sumOf(parts.map((p) => p.value));
  let a = -Math.PI / 2;
  const segs = parts.map((p) => {
    const fr = tot ? p.value / tot : 0, a2 = a + fr * Math.PI * 2, large = fr > 0.5 ? 1 : 0, r = 60, ri = 38, cx = 70, cy = 70;
    const P = (rr: number, ang: number) => `${(cx + rr * Math.cos(ang)).toFixed(2)},${(cy + rr * Math.sin(ang)).toFixed(2)}`;
    const el = fr >= 0.999 ? <circle key={p.label} cx={70} cy={70} r={49} fill="none" stroke={p.color} strokeWidth={22}><title>{`${p.label}: ${fmt(f, p.value)} (100%)`}</title></circle>
      : fr > 0 ? <path key={p.label} d={`M${P(r, a)} A${r} ${r} 0 ${large} 1 ${P(r, a2)} L${P(ri, a2)} A${ri} ${ri} 0 ${large} 0 ${P(ri, a)}Z`} fill={p.color}><title>{`${p.label}: ${fmt(f, p.value)} (${fmt("pct", fr)})`}</title></path> : null;
    a = a2; return el;
  });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label={label}>{tot ? segs : <circle cx={70} cy={70} r={49} fill="none" stroke="var(--surface-muted)" strokeWidth={22} />}</svg>
      <div className="min-w-[160px] flex-1 space-y-1.5">
        {parts.map((p) => (
          <div key={p.label} className="flex justify-between gap-2 text-[13px]">
            <span className="min-w-0"><b className="mr-1.5 inline-block size-2.5 rounded-[2px] align-middle" style={{ background: p.color }} />{p.label}{p.tech && p.tech !== p.label && <small className="ml-1 font-mono text-[10.5px] text-faint">{p.tech}</small>}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{fmt(f, p.value)} · {fmt("pct", tot ? p.value / tot : 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Heat({ rows, cols, m, color = C[0], f = "int", suffix = "" }: { rows: string[]; cols: string[]; m: number[][]; color?: string; f?: Fmt; suffix?: string }) {
  const mx = Math.max(...m.flat(), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[3px] text-xs">
        <thead><tr><th />{cols.map((c) => <th key={c} className="px-1 py-1 text-center font-medium text-muted">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r}><th className="pr-2 text-left font-medium text-muted">{r}</th>
            {m[i].map((v, j) => <td key={j} title={`${r} · ${cols[j]}: ${fmt(f, v)}`} className="rounded px-1 py-1.5 text-center tabular-nums" style={{ background: `color-mix(in srgb, ${color} ${Math.round((v / mx) * 85)}%, var(--surface-muted))`, color: v / mx > 0.55 ? "white" : undefined }}>{v ? `${fmt(f, v)}${suffix}` : ""}</td>)}
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

export function Gauge({ v, label, sub, color = C[2] }: { v: number | null; label: string; sub?: string; color?: string }) {
  const val = v == null || Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v));
  const a = Math.PI * (1 - val), R = 62, cx = 80, cy = 78, x = cx + R * Math.cos(a), y = cy - R * Math.sin(a);
  return (
    <div className="text-center">
      <svg viewBox="0 0 160 92" className="mx-auto w-full max-w-[160px]" role="img" aria-label={`${label} ${v == null ? "no data" : fmt("pct", val)}`}>
        <path d="M18 78 A62 62 0 0 1 142 78" fill="none" stroke="var(--surface-muted)" strokeWidth={14} strokeLinecap="round" />
        {val > 0 && <path d={`M18 78 A62 62 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />}
        <text x={80} y={74} textAnchor="middle" className="fill-[var(--foreground)] text-[22px] font-semibold">{v == null ? "000" : `${Math.round(val * 100)}%`}</text>
      </svg>
      <div className="text-[13px] font-medium">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Sankey({ flows, h, rightColor, f = "int" }: { flows: [string, string, number][]; h?: number; rightColor?: string; f?: Fmt }) {
  const F = flows.filter((x) => x[2] > 0);
  if (!F.length) return <p className="py-6 text-center text-sm text-muted">No flows in this period.</p>;
  const L = [...new Set(F.map((x) => x[0]))], R = [...new Set(F.map((x) => x[1]))];
  const lt = L.map((n) => sumOf(F.filter((x) => x[0] === n).map((x) => x[2]))), rt = R.map((n) => sumOf(F.filter((x) => x[1] === n).map((x) => x[2])));
  const tot = sumOf(lt), gap = 8, W = 680, H = h ?? Math.max(240, Math.max(L.length, R.length) * 34 + 20);
  const k = (H - 20 - gap * (Math.max(L.length, R.length) - 1)) / tot;
  const lx = 170, rx = W - 190, nw = 12;
  const ly: Record<string, { y: number; h: number; off: number }> = {}, ry: typeof ly = {};
  let y = 10; L.forEach((n, i) => { ly[n] = { y, h: lt[i] * k, off: 0 }; y += lt[i] * k + gap; });
  y = 10; R.forEach((n, i) => { ry[n] = { y, h: rt[i] * k, off: 0 }; y += rt[i] * k + gap; });
  const paths = [...F].sort((a, b) => L.indexOf(a[0]) - L.indexOf(b[0]) || R.indexOf(a[1]) - R.indexOf(b[1])).map(([a, b2, v], i) => {
    const th = v * k, A = ly[a], B = ry[b2], y0 = A.y + A.off + th / 2, y1 = B.y + B.off + th / 2; A.off += th; B.off += th;
    const mx = (lx + nw + rx) / 2;
    return <path key={i} d={`M${lx + nw} ${y0.toFixed(1)} C${mx} ${y0.toFixed(1)} ${mx} ${y1.toFixed(1)} ${rx} ${y1.toFixed(1)}`} stroke={C[L.indexOf(a) % C.length]} strokeOpacity={0.35} strokeWidth={Math.max(1, th)} fill="none"><title>{`${a} → ${b2}: ${fmt(f, v)}`}</title></path>;
  });
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={svgCls} role="img" aria-label="flow diagram">
      {paths}
      {L.map((n, i) => <g key={n}><rect x={lx} y={ly[n].y} width={nw} height={Math.max(1, ly[n].h)} fill={C[i % C.length]} rx={2} /><text x={lx - 6} y={ly[n].y + ly[n].h / 2 + 4} textAnchor="end" style={{ fill: "var(--foreground)" }}>{cut(n, 24)} <tspan style={{ fill: "var(--muted)" }}>{fmt(f, lt[i])}</tspan></text></g>)}
      {R.map((n, i) => <g key={n}><rect x={rx} y={ry[n].y} width={nw} height={Math.max(1, ry[n].h)} fill={rightColor ?? "var(--muted)"} rx={2} /><text x={rx + nw + 6} y={ry[n].y + ry[n].h / 2 + 4} style={{ fill: "var(--foreground)" }}>{cut(n, 26)} <tspan style={{ fill: "var(--muted)" }}>{fmt(f, rt[i])}</tspan></text></g>)}
    </svg>
  );
}

export function Treemap({ items, h = 300, f = "int" }: { items: { label: string; value: number; color?: string }[]; h?: number; f?: Fmt }) {
  const nodes0 = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (!nodes0.length) return <p className="py-6 text-center text-sm text-muted">No data in this period.</p>;
  const W = 100, H = 60, tot = sumOf(nodes0.map((i) => i.value));
  type N = { label: string; value: number; a: number; c: string };
  const nodes: N[] = nodes0.map((it, i) => ({ label: it.label, value: it.value, a: (it.value / tot) * W * H, c: it.color ?? C[i % C.length] }));
  const out: (N & { x: number; y: number; w: number; h: number })[] = [];
  let rect = { x: 0, y: 0, w: W, h: H }, row: N[] = [];
  const rest = [...nodes];
  const worst = (rw: N[], side: number) => { const s = sumOf(rw.map((n) => n.a)), mx = Math.max(...rw.map((n) => n.a)), mn = Math.min(...rw.map((n) => n.a)); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
  const lay = (rw: N[]) => {
    const s = sumOf(rw.map((n) => n.a));
    if (rect.w >= rect.h) { const w = s / rect.h; let yy = rect.y; rw.forEach((n) => { const hh = n.a / w; out.push({ ...n, x: rect.x, y: yy, w, h: hh }); yy += hh; }); rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h }; }
    else { const hh = s / rect.w; let xx = rect.x; rw.forEach((n) => { const w = n.a / hh; out.push({ ...n, x: xx, y: rect.y, w, h: hh }); xx += w; }); rect = { x: rect.x, y: rect.y + hh, w: rect.w, h: rect.h - hh }; }
  };
  while (rest.length) { const side = Math.min(rect.w, rect.h), c = rest[0]; if (!row.length || worst([...row, c], side) <= worst(row, side)) { row.push(c); rest.shift(); } else { lay(row); row = []; } }
  if (row.length) lay(row);
  return (
    <div className="relative w-full overflow-hidden rounded-md" style={{ height: h }} role="img" aria-label="treemap">
      {out.map((n) => (
        <div key={n.label} title={`${n.label}: ${fmt(f, n.value)} (${fmt("pct", n.value / tot)})`} className="absolute overflow-hidden border border-[var(--surface)] p-1.5 text-[11px] leading-tight text-white"
          style={{ left: `${n.x}%`, top: `${(n.y / H) * 100}%`, width: `${n.w}%`, height: `${(n.h / H) * 100}%`, background: `color-mix(in srgb, ${n.c} 82%, var(--surface))` }}>
          {n.w > 15 && n.h > 9 && <><b className="block truncate font-semibold">{n.label}</b><span className="opacity-90">{fmt(f, n.value)} · {fmt("pct", n.value / tot)}</span></>}
        </div>
      ))}
    </div>
  );
}

export function CalHeat({ values, start, color = C[2], label = "value" }: { values: number[]; start: string; color?: string; label?: string }) {
  const cs = 14, gp = 3, st = new Date(`${start}T00:00:00Z`), off = (st.getUTCDay() + 6) % 7, weeks = Math.ceil((values.length + off) / 7);
  const W = 40 + weeks * (cs + gp), H = 24 + 7 * (cs + gp), mx = Math.max(...values, 1);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // month label on the first week column of each month
  const monthAt = new Map<number, string>();
  { let lastM = -1; values.forEach((_, i) => { const kk = i + off, d = kk % 7, t = new Date(st.getTime() + i * 86_400_000); if ((t.getUTCDate() <= 7 && t.getUTCMonth() !== lastM && d === 0) || i === 0) { lastM = t.getUTCMonth(); monthAt.set(i, MON[lastM]); } }); }
  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: Math.round(W * 1.15), minWidth: Math.min(W, 380) }} className={svgCls} role="img" aria-label="calendar heatmap">
          {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) => (d ? <text key={i} x={0} y={24 + i * (cs + gp) + 11}>{d}</text> : null))}
          {values.map((v, i) => {
            const kk = i + off, w = Math.floor(kk / 7), d = kk % 7, t = new Date(st.getTime() + i * 86_400_000), x = 36 + w * (cs + gp), y = 22 + d * (cs + gp);
            const mlab: ReactNode = monthAt.has(i) ? <text x={x} y={12}>{monthAt.get(i)}</text> : null;
            return <g key={i}>{mlab}<rect x={x} y={y} width={cs} height={cs} rx={3} fill={v ? color : "var(--surface-muted)"} fillOpacity={v ? 0.15 + (0.85 * v) / mx : 1} stroke="var(--border)" strokeWidth={0.5}><title>{`${t.toISOString().slice(0, 10)}: ${fmt("int", v)} ${label}`}</title></rect></g>;
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-muted"><span className="mr-1">Less</span>{[0, 0.25, 0.5, 0.75, 1].map((fr) => <b key={fr} className="inline-block size-3 rounded-[3px]" style={{ background: color, opacity: 0.15 + 0.85 * fr }} />)}<span className="ml-1">More</span></div>
    </div>
  );
}

export function BubbleMap({ pts, color = C[0], label = "value", h = 320, f = "int" }: { pts: { label: string; lat: number; lon: number; v: number; c?: string }[]; color?: string; label?: string; h?: number; f?: Fmt }) {
  const P = pts.filter((p) => p.v > 0);
  if (!P.length) return <p className="py-6 text-center text-sm text-muted">No places to show in this period.</p>;
  let a0 = Math.min(...P.map((p) => p.lat)), a1 = Math.max(...P.map((p) => p.lat)), o0 = Math.min(...P.map((p) => p.lon)), o1 = Math.max(...P.map((p) => p.lon));
  const pa = (a1 - a0) * 0.18 + 0.3, po = (o1 - o0) * 0.12 + 0.4; a0 -= pa; a1 += pa; o0 -= po; o1 += po;
  const W = 680, H = h, sx = (o: number) => r2(((o - o0) / (o1 - o0)) * W), sy = (a: number) => r2(H - ((a - a0) / (a1 - a0)) * H), mx = Math.max(...P.map((p) => p.v), 1);
  const step = Math.max(1, Math.ceil((o1 - o0) / 12));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn(svgCls, "rounded-md bg-surface-sunken")} role="img" aria-label={`map of ${label} by city`}>
      {Array.from({ length: Math.floor((o1 - Math.ceil(o0)) / step) + 1 }, (_, i) => Math.ceil(o0) + i * step).map((o) => <line key={`o${o}`} className="grid" x1={sx(o)} x2={sx(o)} y1={0} y2={H} strokeDasharray="2 4" />)}
      {Array.from({ length: Math.floor((a1 - Math.ceil(a0)) / step) + 1 }, (_, i) => Math.ceil(a0) + i * step).map((a) => <line key={`a${a}`} className="grid" y1={sy(a)} y2={sy(a)} x1={0} x2={W} strokeDasharray="2 4" />)}
      {[...P].sort((a, b) => b.v - a.v).map((p) => {
        const rr = 4 + Math.sqrt(p.v / mx) * 30, x = sx(p.lon), y = sy(p.lat), right = x > W - 150;
        return <g key={p.label}><circle cx={x} cy={y} r={rr} fill={p.c ?? color} fillOpacity={0.38} stroke={p.c ?? color}><title>{`${p.label}: ${fmt(f, p.v)} ${label}`}</title></circle>
          <text x={right ? x - rr - 4 : x + rr + 4} y={y + 4} textAnchor={right ? "end" : "start"} style={{ fill: "var(--foreground)", fontWeight: 500 }}>{p.label} <tspan style={{ fill: "var(--muted)" }}>{fmt(f, p.v)}</tspan></text></g>;
      })}
    </svg>
  );
}

export function Scatter({ points, xLabel, yLabel, xf = "k", yf = "pct", logX, xRef, yRef, h = 300, quad, diag }: {
  points: { x: number; y: number; s?: number; label: string; show?: boolean; c?: string }[]; xLabel: string; yLabel: string; xf?: Fmt; yf?: Fmt; logX?: boolean; xRef?: number; yRef?: number | null; h?: number; quad?: [string, number, number][]; diag?: boolean;
}) {
  if (!points.length) return <p className="py-6 text-center text-sm text-muted">Not enough data in this period.</p>;
  const W = 680, H = h, l = 56, r = 18, t = 14, b = 44, iw = W - l - r, ih = H - t - b;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let x0 = Math.min(...xs); const x1 = Math.max(...xs); if (logX) x0 = Math.max(1, x0);
  const tx = (v: number) => (logX ? Math.log10(Math.max(1, v)) : v);
  const X0 = tx(x0) - (logX ? 0.1 : (x1 - x0) * 0.05 || 1), X1 = tx(x1) + (logX ? 0.1 : (x1 - x0) * 0.05 || 1);
  const y1 = niceMax(Math.max(...ys, 1e-9) * 1.08);
  const sx = (v: number) => r2(l + ((tx(v) - X0) / (X1 - X0)) * iw), sy = (v: number) => r2(t + ih - (v / y1) * ih);
  const smax = Math.max(...points.map((p) => p.s ?? 1), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={svgCls} role="img" aria-label={`${yLabel} by ${xLabel}`}>
      {[0, 1, 2, 3, 4].map((k) => { const v = (y1 * k) / 4, yy = sy(v); return <g key={k}><line className="grid" x1={l} x2={W - r} y1={yy} y2={yy} /><text x={l - 6} y={yy + 4} textAnchor="end">{fmt(yf, v)}</text></g>; })}
      {[0, 1, 2, 3, 4, 5].map((k) => { const v = logX ? 10 ** (X0 + ((X1 - X0) * k) / 5) : X0 + ((X1 - X0) * k) / 5; return <text key={k} x={sx(v)} y={H - 24} textAnchor="middle">{fmt(xf, v)}</text>; })}
      <text x={l + iw / 2} y={H - 6} textAnchor="middle" style={{ fontWeight: 600 }}>{xLabel}</text>
      <text x={12} y={t + ih / 2} textAnchor="middle" transform={`rotate(-90 12 ${t + ih / 2})`} style={{ fontWeight: 600 }}>{yLabel}</text>
      {xRef != null && <line x1={sx(xRef)} x2={sx(xRef)} y1={t} y2={t + ih} stroke="var(--muted)" strokeDasharray="4 4" opacity={0.6} />}
      {yRef != null && <line x1={l} x2={W - r} y1={sy(yRef)} y2={sy(yRef)} stroke="var(--muted)" strokeDasharray="4 4" opacity={0.6} />}
      {diag && (() => { const lo = Math.max(X0, 0), hi = Math.min(X1, y1); return hi > lo ? <line x1={sx(lo)} y1={sy(lo)} x2={sx(hi)} y2={sy(hi)} stroke="var(--muted)" strokeDasharray="4 4" opacity={0.7} /> : null; })()}
      {quad?.map(([txt, ax, ay]) => <text key={txt} x={ax ? W - r - 6 : l + 6} y={ay ? t + 14 : t + ih - 6} textAnchor={ax ? "end" : "start"} style={{ fontWeight: 600, opacity: 0.75 }}>{txt}</text>)}
      {[...points].sort((a, b) => (b.s ?? 1) - (a.s ?? 1)).map((p, i) => {
        const rr = 3 + Math.sqrt((p.s ?? 1) / smax) * 16, cx = sx(p.x), cy = sy(p.y), lf = cx > W - 170;
        return <g key={`${p.label}-${i}`}><circle cx={cx} cy={cy} r={rr} fill={p.c ?? C[0]} fillOpacity={0.45} stroke={p.c ?? C[0]}><title>{`${p.label} · ${xLabel}: ${fmt(xf, p.x)} · ${yLabel}: ${fmt(yf, p.y)}${p.s != null ? ` · size: ${fmt("int", p.s)}` : ""}`}</title></circle>
          {p.show && <text x={lf ? cx - rr - 3 : cx + rr + 3} y={cy + 4} textAnchor={lf ? "end" : "start"} style={{ fill: "var(--foreground)" }}>{p.label.length > 34 ? `${p.label.slice(0, 32)}…` : p.label}</text>}</g>;
      })}
    </svg>
  );
}

export function CompareBars({ rows, f = "int", color = C[0], invert }: { rows: { label: string; cur: number; prev: number }[]; f?: Fmt; color?: string; invert?: boolean }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">No data in this period.</p>;
  const mx = Math.max(...rows.flatMap((r) => [r.cur, r.prev]), 1);
  return (
    <div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} title={`${r.label}: ${fmt(f, r.cur)} now, ${fmt(f, r.prev)} before`}>
            <div className="flex justify-between gap-3 text-[13px]"><span className="min-w-0 truncate">{r.label}</span><span className="shrink-0 tabular-nums">{fmt(f, r.cur)} <Delta cur={r.cur} prev={r.prev} invert={invert} /></span></div>
            <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
              <div className="absolute inset-y-0 left-0 rounded-full border border-[var(--muted)] opacity-40" style={{ width: `${(r.prev / mx) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.cur / mx) * 100}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted"><span className="inline-flex items-center gap-1.5"><b className="h-[3px] w-3 rounded-full" style={{ background: color }} />This period</span><span className="inline-flex items-center gap-1.5"><b className="h-[3px] w-3 rounded-full bg-[var(--muted)] opacity-50" />Previous period</span></div>
    </div>
  );
}

export function Delta({ cur, prev, invert, className }: { cur: number | null; prev: number | null; invert?: boolean; className?: string }) {
  if (prev == null || cur == null || (prev === 0 && cur === 0)) return <span className={cn("text-xs text-faint", className)}>–</span>;
  if (!prev) return <span className={cn("text-xs font-medium text-positive", className)}>new</span>;
  const d = (cur - prev) / prev, good = invert ? d < 0 : d > 0;
  return <span className={cn("text-xs font-medium tabular-nums", Math.abs(d) < 1e-9 ? "text-faint" : good ? "text-positive" : "text-negative", className)}>{d > 0 ? "↑" : "↓"} {Math.abs(d * 100).toFixed(1)}%</span>;
}

export function Stack100({ rows, names, colors, f = "int" }: { rows: { label: string; parts: number[] }[]; names: string[]; colors?: string[]; f?: Fmt }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">No data in this period.</p>;
  const col = (i: number) => colors?.[i] ?? C[i % C.length];
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">{names.map((n, i) => <span key={n} className="inline-flex items-center gap-1.5"><b className="size-2 rounded-[2px]" style={{ background: col(i) }} />{n}</span>)}</div>
      <div className="space-y-2.5">
        {rows.map((r) => { const t = sumOf(r.parts) || 1; return (
          <div key={r.label}>
            <div className="flex justify-between gap-3 text-[13px]"><span className="min-w-0 truncate">{r.label}</span><span className="tabular-nums text-muted">{fmt(f, sumOf(r.parts))}</span></div>
            <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-surface-muted">{r.parts.map((v, i) => (v ? <div key={i} style={{ width: `${((v / t) * 100).toFixed(2)}%`, background: col(i) }} title={`${names[i]}: ${fmt(f, v)} (${fmt("pct", v / t)})`} /> : null))}</div>
          </div>); })}
      </div>
    </div>
  );
}

export function Funnel({ steps, mono }: { steps: [string, number][]; mono?: boolean }) {
  const top = steps[0]?.[1] || 1;
  return (
    <div className="space-y-2.5">
      {steps.map(([l, v], i) => (
        <div key={l} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className={cn("truncate", mono && "font-mono text-xs")}>{l}</span>
          <div className="h-3 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-[var(--cat-1)]" style={{ width: `${((v / top) * 100).toFixed(1)}%` }} /></div>
          <span className="tabular-nums text-muted">{fmt("int", v)}{i ? ` · ${fmt("pct", steps[i - 1][1] ? v / steps[i - 1][1] : 0)}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

/* "What changed" charts: a plain-English summary, change bars (default) or a running-total waterfall */
const chgTxt = (v: number, f: Fmt) => (!v ? "no change" : `${fmt(f, Math.abs(v))} ${v > 0 ? "more" : "fewer"}`);
export function WhatChanged({ id, items, start, f = "int", unit, startLabel = "Previous", endLabel = "Now" }: { id?: string; items: { label: string; value: number }[]; start: number; f?: Fmt; unit: string; startLabel?: string; endLabel?: string }) {
  const [stored, store] = useStored(id ? `ga4x:wf:${id}` : null);
  const [local, setLocal] = useState<"bars" | "wf">("bars");
  const kind = stored === "bars" || stored === "wf" ? stored : local;
  const set = (k: "bars" | "wf") => { setLocal(k); store(k); };
  const its = items.filter((i) => i.value !== 0);
  const end = start + sumOf(items.map((i) => i.value)), d = end - start;
  const ups = its.filter((i) => i.value > 0).sort((a, b) => b.value - a.value), dns = its.filter((i) => i.value < 0).sort((a, b) => a.value - b.value);
  const top = (a: typeof its) => { if (!a.length) return null; const v = a[0].value, t = a.filter((i) => i.value === v).slice(0, 3); return { names: t.map((i) => i.label), v, each: t.length > 1 }; };
  const join = (n: string[]) => (n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n.at(-1)}` : n[0]);
  const tu = top(ups), td = top(dns), U = unit.charAt(0).toUpperCase() + unit.slice(1);
  return (
    <div>
      <p className="mb-3 text-sm">
        {U} went {d >= 0 ? "up" : "down"} from <b>{fmt(f, start)}</b> to <b>{fmt(f, end)}</b> ({chgTxt(d, f)}).
        {tu && <> The biggest increase came from <b>{join(tu.names)}</b> ({chgTxt(tu.v, f)}{tu.each ? " each" : ""}).</>}
        {td && <> <b>{join(td.names)}</b> brought {fmt(f, Math.abs(td.v))} fewer{td.each ? " each" : ""}.</>}
        {ups.length > 0 && dns.length > 0 && <> {ups.length} sources grew, {dns.length} shrank.</>}
      </p>
      <div role="group" aria-label="Chart type" className="mb-2 inline-flex rounded-md border border-border p-0.5 text-xs">
        {([["bars", "Change by item"], ["wf", "Running total"]] as const).map(([k, lab]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => set(k)} className={cn("rounded px-2 py-0.5", kind === k ? "bg-surface-muted font-medium text-foreground" : "text-muted hover:text-foreground")}>{lab}</button>)}
      </div>
      {!its.length ? <p className="py-4 text-sm text-muted">No change between the two periods.</p> : kind === "bars" ? (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline gap-2 text-sm"><span>{startLabel} <b>{fmt(f, start)}</b></span><span className="text-muted">→</span><span>{endLabel} <b>{fmt(f, end)}</b></span><span className={d >= 0 ? "text-positive" : "text-negative"}>{chgTxt(d, f)}{start ? ` (${d >= 0 ? "+" : ""}${((d / start) * 100).toFixed(1)}%)` : ""}</span></div>
          <div className="space-y-1.5">
            {[...its].sort((a, b) => b.value - a.value).map((i) => { const mx = Math.max(...its.map((x) => Math.abs(x.value)), 1), w = (Math.abs(i.value) / mx) * 50; return (
              <div key={i.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-[13px]" title={`${i.label}: ${i.value > 0 ? "+" : ""}${fmt(f, i.value)}`}>
                <span className="truncate">{i.label}</span>
                <div className="relative h-3"><i className="absolute inset-y-0 left-1/2 w-px bg-[var(--border-strong)]" /><b className="absolute inset-y-0 rounded-sm" style={{ width: `${w}%`, background: i.value >= 0 ? GOOD : BAD, ...(i.value >= 0 ? { left: "50%" } : { right: "50%" }) }} /></div>
                <span className={cn("text-xs tabular-nums", i.value >= 0 ? "text-positive" : "text-negative")}>{chgTxt(i.value, f)}</span>
              </div>); })}
          </div>
        </div>
      ) : (
        <div><Waterfall items={its} start={start} f={f} unit={unit} startLabel={startLabel} endLabel={endLabel} />
          <p className="mt-2 text-xs text-muted" title={`The first bar is ${startLabel.toLowerCase()} (${fmt(f, start)}). Each bar after it moves the total up (green) or down (red) by that item's change. The last bar is ${endLabel.toLowerCase()} (${fmt(f, end)}).`}>The axis doesn&apos;t start at zero.</p></div>
      )}
    </div>
  );
}
function Waterfall({ items, start, f, unit, startLabel, endLabel }: { items: { label: string; value: number }[]; start: number; f: Fmt; unit: string; startLabel: string; endLabel: string }) {
  const end = start + sumOf(items.map((i) => i.value)), W = 680, H = 260, l = 52, r = 10, t = 14, b = 56, iw = W - l - r, ih = H - t - b;
  let run = start;
  const bars: { label: string; y0: number; y1: number; tot?: boolean; v?: number }[] = [{ label: startLabel, y0: 0, y1: start, tot: true }];
  items.forEach((i) => { bars.push({ label: i.label, y0: run, y1: run + i.value, v: i.value }); run += i.value; });
  bars.push({ label: endLabel, y0: 0, y1: end, tot: true });
  const hiV = Math.max(...bars.map((x) => Math.max(x.y0, x.y1))), loV = Math.min(...bars.filter((x) => !x.tot).map((x) => Math.min(x.y0, x.y1)), start, end);
  const span = hiV - loV || hiV * 0.2 || 1, mn = Math.max(0, Math.floor((loV - span * 0.6) / 10) * 10), mx = hiV + span * 0.25;
  bars.forEach((x) => { if (x.tot) x.y0 = mn; });
  const sy = (v: number) => r2(t + ih - ((v - mn) / (mx - mn)) * ih), bw = iw / bars.length;
  const plural = (n: number) => (Math.abs(n) === 1 ? unit.replace(/s$/, "") : unit);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={svgCls} role="img" aria-label="change waterfall">
      {[0, 1, 2, 3, 4].map((k) => { const v = mn + ((mx - mn) * k) / 4, yy = sy(v); return <g key={k}><line className="grid" x1={l} x2={W - r} y1={yy} y2={yy} /><text x={l - 6} y={yy + 4} textAnchor="end">{fmt(f, v)}</text></g>; })}
      {bars.slice(0, -1).map((x, i) => <line key={`c${i}`} x1={l + i * bw + bw * 0.85} x2={l + (i + 1) * bw + bw * 0.15} y1={sy(x.y1)} y2={sy(x.y1)} stroke="var(--muted)" strokeDasharray="3 3" />)}
      {bars.map((x, i) => {
        const xx = l + i * bw + bw * 0.15, w = bw * 0.7, ya = sy(Math.max(x.y0, x.y1)), yb = sy(Math.min(x.y0, x.y1));
        const c = x.tot ? C[3] : (x.v ?? 0) >= 0 ? GOOD : BAD, lb = x.label.length > 16 ? `${x.label.slice(0, 15)}…` : x.label;
        return <g key={i}><rect x={xx} y={ya} width={w} height={Math.max(1, yb - ya)} fill={c} rx={2} opacity={0.85}><title>{`${x.label}: ${x.tot ? fmt(f, x.y1) : `${(x.v ?? 0) > 0 ? "+" : ""}${fmt(f, x.v ?? 0)}`}`}</title></rect>
          <text x={xx + w / 2} y={ya - 5} textAnchor="middle" style={{ fill: x.tot ? "var(--foreground)" : c, fontWeight: 600 }}>{x.tot ? `${fmt(f, x.y1)} ${plural(x.y1)}` : chgTxt(x.v ?? 0, f)}</text>
          <text x={xx + w / 2} y={H - b + 14} textAnchor="end" transform={`rotate(-30 ${xx + w / 2} ${H - b + 14})`}>{esc(lb)}</text></g>;
      })}
    </svg>
  );
}
