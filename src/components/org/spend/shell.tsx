"use client";

import { useEffect, useState } from "react";
import { Download, Lock, RefreshCw } from "lucide-react";
import { useStored } from "@/components/ga4x/stored";
import { cn } from "@/lib/utils";
import type { SpendKind, SpendRange, SpendReport } from "@/lib/org/spend";
import { isRange, RANGES, spanLabel, timeLabel } from "./format";
import { Segmented } from "./ui";

type Loaded<R> = { key: string; report: R | null; error: string | null; status: number };
const FAIL = "Couldn't load spend. Try again.";

/**
 * Loads an organization's spend report for the chosen range (remembered on this device, shared by both spend tabs)
 * and renders it. The range filter sits above everything it scopes; while another range loads, the current numbers
 * stay on screen, dimmed, instead of flashing a skeleton.
 */
export function SpendShell<R extends SpendReport>({ orgId, kind, children }: { orgId: string; kind: SpendKind; children: (report: R) => React.ReactNode }) {
  const [stored, store] = useStored("org-spend:range");
  const range: SpendRange = isRange(stored) ? stored : "30d";
  const [nonce, setNonce] = useState(0);
  const key = `${orgId}|${kind}|${range}|${nonce}`;
  const [state, setState] = useState<Loaded<R>>({ key: "", report: null, error: null, status: 0 });

  useEffect(() => {
    const ctrl = new AbortController();
    const k = `${orgId}|${kind}|${range}|${nonce}`;
    (async () => {
      let status = 0;
      try {
        const res = await fetch(`/api/org/spend?${new URLSearchParams({ org: orgId, kind, range })}`, { signal: ctrl.signal, cache: "no-store" });
        status = res.status;
        const json = (res.headers.get("content-type") ?? "").includes("application/json") ? ((await res.json()) as R | { error?: string }) : null;
        // a lapsed session is redirected to the sign-in page, which isn't JSON
        if (!json) throw new Error(res.redirected || res.status === 401 ? "Your session has expired. Sign in again to see spend." : FAIL);
        if (!res.ok || !("kind" in json)) throw new Error(("error" in json && json.error) || FAIL);
        setState({ key: k, report: json, error: null, status });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setState({ key: k, report: null, error: e instanceof Error && e.message ? e.message : FAIL, status });
      }
    })();
    return () => ctrl.abort();
  }, [orgId, kind, range, nonce]);

  const loading = state.key !== key;
  const report = state.report;
  const p = report?.period;
  const csv = `/api/org/spend?${new URLSearchParams({ org: orgId, kind, range, format: "csv" })}`;

  return (
    // grids follow the width of this area (settings has a side menu), not the window
    <div className="@container min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <Segmented size="md" label="Period" value={range} onChange={(v) => store(v)} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
          {p && <p className="text-xs text-muted">{spanLabel(p.start, p.end)} <span className="text-faint">vs</span> {spanLabel(p.prevStart, p.prevEnd)} · {p.timezone}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted" aria-live="polite">{loading ? "Updating…" : report ? `Updated ${timeLabel(report.generatedAt)}` : ""}</span>
          <button type="button" onClick={() => setNonce((x) => x + 1)} disabled={loading} title="Reload the numbers"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-xs font-medium text-secondary outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60">
            <RefreshCw className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")} aria-hidden /> Refresh
          </button>
          {report && (
            <a href={csv} download title="Every record of this period, one row per run or call"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-strong px-2 text-xs font-medium text-secondary outline-none hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
              <Download className="size-3.5" aria-hidden /> All records
            </a>
          )}
        </div>
      </div>

      {state.error && !loading ? (
        state.status === 403 ? (
          <div className="rounded-[10px] border border-border bg-surface px-5 py-10 text-center">
            <Lock className="mx-auto size-5 text-muted" aria-hidden />
            <p className="mt-2 text-sm font-medium">Owners and admins only</p>
            <p className="mt-1 text-[13px] text-muted">{state.error}</p>
          </div>
        ) : (
          <div role="alert" className="rounded-[10px] border border-negative/30 bg-negative-soft px-5 py-6 text-center">
            <p className="text-sm font-medium text-negative">{state.error}</p>
            <button type="button" onClick={() => setNonce((x) => x + 1)} className="mt-3 h-8 rounded-md border border-border-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-muted">Try again</button>
          </div>
        )
      ) : !report ? (
        <Skeleton />
      ) : (
        <div aria-busy={loading} className={cn("transition-opacity", loading && "pointer-events-none opacity-55")}>{children(report as R)}</div>
      )}
    </div>
  );
}

function Skeleton() {
  const block = "skeleton rounded-[10px]";
  return (
    <div aria-busy="true" aria-label="Loading spend">
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @6xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className={`${block} h-[104px]`} />)}
      </div>
      <div className={`${block} mt-4 h-[22rem]`} />
      <div className="mt-4 grid gap-4 @4xl:grid-cols-2">
        <div className={`${block} h-64`} />
        <div className={`${block} h-64`} />
      </div>
      <span className="sr-only">Loading spend…</span>
    </div>
  );
}
