export type Num = number | null | undefined;

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const fmtInt = (n: Num) => (n == null ? "—" : nf.format(n));
export const fmtDecimal = (n: Num) => (n == null ? "—" : nf1.format(n));
export const fmtCompact = (n: Num) => (n == null ? "—" : compact.format(n));
export const fmtPercent = (ratio: Num, digits = 1) =>
  ratio == null ? "—" : `${(ratio * 100).toFixed(digits)}%`;
export const fmtMoney = (n: Num, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
export function fmtDuration(seconds: Num) {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/**
 * Percentage change from `previous` to `current`, or null when it can't be computed honestly
 * (missing comparison data, or a zero baseline).
 */
export function pctChange(current: Num, previous: Num): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Whether a change is good: usually up, but e.g. average search position is better when lower. */
export function isFavorable(change: number | null, higherIsBetter: boolean): boolean | null {
  if (change === null || change === 0) return null;
  return higherIsBetter ? change > 0 : change < 0;
}

/** Supabase returns numerics as numbers or strings depending on the type; normalize safely. */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
