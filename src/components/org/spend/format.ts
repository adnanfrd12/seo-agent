import { toCsv } from "@/lib/analytics/csv";
import type { SpendRange } from "@/lib/org/spend";

/* Formatting for the organization spend tabs (browser side). Every amount is US dollars, as the providers bill. */

export const RANGES: { id: SpendRange; label: string; long: string }[] = [
  { id: "7d", label: "7 days", long: "Last 7 days" },
  { id: "30d", label: "30 days", long: "Last 30 days" },
  { id: "90d", label: "90 days", long: "Last 90 days" },
  { id: "12m", label: "12 months", long: "Last 12 months" },
];
export const rangeLong = (r: SpendRange) => RANGES.find((x) => x.id === r)?.long ?? r;
export const isRange = (v: unknown): v is SpendRange => RANGES.some((x) => x.id === v);

const grouped2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grouped0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const int = new Intl.NumberFormat("en-US");

/** $0.00 · $0.0031 (sub-cent amounts keep 4 decimals) · $1,234.56 · $12,346 */
export function usd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a === 0) return "$0.00";
  if (a < 0.01) return `${s}$${a.toFixed(4)}`;
  if (a < 10_000) return `${s}$${grouped2.format(a)}`;
  return `${s}$${grouped0.format(a)}`;
}
/** Short form for chart labels: $0.42 · $3.1 · $48 · $1.2K */
export function usdShort(v: number): string {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a === 0) return "$0";
  if (a < 0.01) return `${s}$${a.toFixed(3)}`;
  if (a < 10) return `${s}$${a.toFixed(2)}`;
  if (a < 100) return `${s}$${a.toFixed(1)}`;
  if (a < 10_000) return `${s}$${grouped0.format(a)}`;
  return `${s}$${(a / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}
/** Axis tick: as many decimals as the step needs ($0 · $0.25 · $0.50; $0 · $5 · $10). */
export function usdTick(v: number, step: number): string {
  if (step >= 1) return v >= 10_000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : `$${grouped0.format(v)}`;
  return `$${v.toFixed(step >= 0.01 ? 2 : 3)}`;
}
export const count = (n: number | null | undefined) => (n == null ? "—" : int.format(n));
/** A share of a whole (0..1): 34% · 2.5% · <0.1% */
export function share(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0%";
  const p = v * 100;
  return p < 0.1 ? "<0.1%" : p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}
/** Growth as text: "12.5%" up to tenfold, then a multiple ("14×") so a tiny base doesn't print "103,761%". */
export function growth(cur: number, prev: number): string {
  const ratio = cur / prev;
  if (ratio >= 10) return `${ratio >= 100 ? Math.round(ratio).toLocaleString("en-US") : ratio.toFixed(1)}×`;
  const p = Math.abs((ratio - 1) * 100);
  return `${p >= 100 ? Math.round(p).toLocaleString("en-US") : p.toFixed(1)}%`;
}
/** Change against the previous period. More spend reads as the "worse" direction. */
export function change(cur: number, prev: number): { text: string; tone: "up" | "down" | "flat" | "new" | "none" } {
  if (!prev && !cur) return { text: "–", tone: "none" };
  if (!prev) return { text: "new", tone: "new" };
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.0005) return { text: "0%", tone: "flat" };
  return { text: `${d > 0 ? "▲" : "▼"} ${growth(cur, prev)}`, tone: d > 0 ? "up" : "down" };
}
/** Per-call amounts keep sub-cent precision: $0.0137 (but $0.25) */
export const usdUnit = (v: number) => (v > 0 && v < 0.1 ? `$${v.toFixed(4)}` : usd(v));

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11-27" → "Nov 27" (with the year when asked) */
export function dayLabel(iso: string, year = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MON[m - 1]} ${d}${year ? `, ${y}` : ""}`;
}
/** "2026-11" → "Nov 2026" or "November 2026" */
export function monthLabel(ym: string, long = false): string {
  const [y, m] = ym.split("-").map(Number);
  return `${(long ? MONTH : MON)[m - 1]} ${y}`;
}
/** Chart column label: days as "Nov 27", months as "Nov" (with the year on January and the first column). */
export function bucketLabel(key: string, kind: "day" | "month", first = false): string {
  if (kind === "day") return dayLabel(key);
  const [y, m] = key.split("-").map(Number);
  return m === 1 || first ? `${MON[m - 1]} ${String(y).slice(2)}` : MON[m - 1];
}
export const bucketLong = (key: string, kind: "day" | "month") => (kind === "day" ? dayLabel(key, true) : monthLabel(key, true));
export function spanLabel(a: string, b: string): string {
  return a.slice(0, 4) === b.slice(0, 4) ? `${dayLabel(a)} – ${dayLabel(b, true)}` : `${dayLabel(a, true)} – ${dayLabel(b, true)}`;
}
/** "2026-11-27T10:42:00Z" → "Nov 27, 10:42" in the viewer's own clock */
export function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Saves rows as a CSV file (cells are escaped and spreadsheet formulas defused by toCsv). */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const csvName = (...parts: string[]) => parts.filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
/** Raw amounts for CSV cells (no float noise like 0.30000000000000004). */
export const raw = (v: number) => Math.round(v * 1e6) / 1e6;
