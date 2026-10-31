"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { resolveRange } from "@/lib/analytics/range";
import { cn } from "@/lib/utils";

/** Pages whose data follows the date range (the same list the proxy remembers a range for). */
const RANGE_PATHS = new Set(["/overview", "/analytics", "/search-console", "/business-profile", "/bing", "/opportunities", "/insights", "/strategy"]);
const PRESETS = [
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "month", label: "Last month" },
] as const;

const fmt = (iso: string, withYear: boolean) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

/**
 * The one date control, in the top bar of every date-driven page. It reads and writes the same URL
 * parameters the pages always used (range / start / end / compare), keeps every other parameter, and
 * shows nothing on pages whose data doesn't depend on dates.
 */
export function TopRange({ timeZone, defaultDays }: { timeZone: string; defaultDays: number }) {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!RANGE_PATHS.has(path)) return null;

  const get = (k: string) => sp.get(k) ?? undefined;
  // the Overview's executive report defaults to the last complete month
  const range = resolveRange(
    { range: get("range") ?? (path === "/overview" && !get("start") ? "month" : undefined), start: get("start"), end: get("end") },
    timeZone, defaultDays,
  );
  const compare = sp.get("compare") === "1";
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) q.delete(k); else q.set(k, v); }
    // a new period starts every list on its first page
    for (const k of [...q.keys()]) if (k.endsWith("_page")) q.delete(k);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
  const label = `${fmt(range.start, !sameYear)} – ${fmt(range.end, true)}`;

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border-strong bg-surface px-2.5 text-[13px] font-medium outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent"
      >
        <CalendarDays className="size-3.5 text-muted" aria-hidden />
        <span className="whitespace-nowrap">{label}</span>
        {compare && <span className="hidden whitespace-nowrap font-normal text-muted sm:inline">vs previous</span>}
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </button>

      {open && (
        <div role="dialog" aria-label="Date range" className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-border bg-surface p-1.5 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.25)]">
          <ul className="space-y-0.5">
            {PRESETS.map((p) => (
              <li key={p.id}>
                <Link href={href({ range: p.id, start: null, end: null })} onClick={() => setOpen(false)}
                  className={cn("flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] hover:bg-surface-muted", range.preset === p.id && "font-medium")}>
                  {p.label}{range.preset === p.id && <Check className="size-3.5 text-accent" aria-hidden />}
                </Link>
              </li>
            ))}
          </ul>
          <form
            className="mt-1.5 space-y-2 border-t border-hairline px-1 pt-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const start = String(f.get("start") ?? ""), end = String(f.get("end") ?? "");
              if (!start || !end) return;
              setOpen(false);
              router.push(href({ range: null, start, end }));
            }}
          >
            <p className="text-xs font-medium text-muted">Custom range</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">From
                <input type="date" name="start" defaultValue={range.start} required className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-[13px] text-foreground" />
              </label>
              <label className="text-xs text-muted">To
                <input type="date" name="end" defaultValue={range.end} required className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-[13px] text-foreground" />
              </label>
            </div>
            <button className="h-8 w-full rounded-md border border-border-strong text-[13px] font-medium hover:bg-surface-muted">Apply</button>
          </form>
          <Link href={href({ compare: compare ? null : "1" })} onClick={() => setOpen(false)} role="switch" aria-checked={compare}
            className="mt-1.5 flex items-center justify-between rounded-md border-t border-hairline px-2.5 pb-1.5 pt-2.5 text-[13px] hover:bg-surface-muted">
            Compare with previous period
            <span className={cn("relative h-4 w-7 rounded-full transition-colors", compare ? "bg-accent" : "bg-border-strong")}>
              <span className={cn("absolute top-0.5 size-3 rounded-full bg-surface transition-[left]", compare ? "left-3.5" : "left-0.5")} />
            </span>
          </Link>
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] text-faint">{range.days} days · data up to yesterday</p>
        </div>
      )}
    </div>
  );
}
