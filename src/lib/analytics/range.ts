const DAY = 86_400_000;

export interface DateRangeSel {
  start: string;
  end: string;
  preset: "7" | "30" | "90" | "month" | "custom";
  days: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (s: string | undefined): s is string => !!s && ISO.test(s) && !Number.isNaN(Date.parse(s));

export function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
export const shiftDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * Resolves ?range=7|30|90 or ?start=&end= into an inclusive range ending yesterday
 * (today's data is always partial). Custom ranges are validated and capped to 2 years.
 */
export function resolveRange(
  sp: { range?: string; start?: string; end?: string },
  timeZone: string,
  defaultDays: number,
): DateRangeSel {
  const yesterday = shiftDays(todayIn(timeZone), -1);

  if (valid(sp.start) && valid(sp.end) && sp.start <= sp.end) {
    const start = sp.start;
    const end = sp.end > yesterday ? yesterday : sp.end;
    const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
    if (days >= 1 && days <= 731) return { start, end, preset: "custom", days };
  }
  if (sp.range === "month" || (!sp.range && String(defaultDays) === "month")) {
    return { ...monthRange(previousMonth(todayIn(timeZone))), preset: "month" };
  }
  const preset = (["7", "30", "90"].includes(sp.range ?? "") ? sp.range : String(defaultDays)) as "7" | "30" | "90";
  const days = Number(preset);
  return { start: shiftDays(yesterday, -(days - 1)), end: yesterday, preset, days };
}

/** "YYYY-MM" of the calendar month before the given date. */
export function previousMonth(isoDay: string): string {
  const [y, m] = isoDay.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Inclusive start/end of a calendar month "YYYY-MM". */
export function monthRange(ym: string): { start: string; end: string; days: number } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}`, days: last };
}

export const isMonth = (s: string | undefined): s is string => !!s && /^d{4}-(0[1-9]|1[0-2])$/.test(s);

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
