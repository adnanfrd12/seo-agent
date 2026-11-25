"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { runStatus, startQuickWins } from "@/app/(dashboard)/ai-quick-wins/actions";
import { ruleLabelClient } from "./labels";
import { SCREENS } from "@/lib/aiqw/screens";
import { SOURCE_LABEL, SOURCES, type Depth, type RunState, type Scope, type Source, type StoredWin } from "@/lib/aiqw/types";
import { Tag } from "@/components/ga4x/table";
import { SourceBadge } from "./badges";
import { cn } from "@/lib/utils";

const btnPrimary = "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

/** Live run steps, polled every 2 seconds until the run ends (it keeps running on the server if the page is left). */
export function useRun(initial: string | null, onEnd?: (r: RunState) => void) {
  const [runId, setRunId] = useState<string | null>(initial);
  const [run, setRun] = useState<RunState | null>(null);
  const end = useRef(onEnd);
  useEffect(() => { end.current = onEnd; });
  useEffect(() => {
    if (!runId) return;
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await runStatus(runId).catch(() => null);
      if (!alive) return;
      if (r) setRun(r);
      if (r && r.status !== "running") { end.current?.(r); return; }
      timer = setTimeout(tick, 2000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [runId]);
  return { run, runId, setRunId };
}

/** Step state marker: filled dot when done, spinning ring while running, empty ring while waiting. */
function Marker({ state }: { state: RunState["steps"][number]["state"] }) {
  if (state === "done") return <span className="block size-4 rounded-full bg-positive" aria-label="Done" />;
  if (state === "running") return <span className="block size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label="Running" />;
  if (state === "failed") return <span className="grid size-4 place-items-center rounded-full bg-negative text-[10px] font-bold leading-none text-white" aria-label="Failed">!</span>;
  if (state === "skipped") return <span className="block size-4 rounded-full border-2 border-dashed border-border-strong" aria-label="Skipped" />;
  return <span className="block size-4 rounded-full border-2 border-border" aria-label="Waiting" />;
}
const secs = (ms?: number) => (ms == null ? "" : ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`);
const k = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

/** The run's steps, one box each, with the time each took. */
export function RunSteps({ run }: { run: RunState }) {
  return (
    <div className="space-y-3 text-sm">
      <ol className="space-y-2">
        {run.steps.map((s) => (
          <li key={s.key} className={cn("flex items-start gap-3 rounded-lg px-3 py-2.5", s.state === "pending" || s.state === "skipped" ? "bg-surface-muted/60" : "bg-surface-muted")}>
            <span className="mt-0.5 shrink-0"><Marker state={s.state} /></span>
            <span className="min-w-0 flex-1">
              <span className={cn("font-medium", (s.state === "pending" || s.state === "skipped") && "text-muted")}>{s.label}</span>
              {s.detail && <span className="block text-xs text-muted">{s.detail}</span>}
            </span>
            {s.ms != null && s.state !== "pending" && <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{secs(s.ms)}</span>}
          </li>
        ))}
      </ol>
      {Object.keys(run.counts.perRule).length > 0 && (
        <details className="rounded-md bg-surface-muted p-2 text-xs">
          <summary className="cursor-pointer font-medium">Candidates per rule ({run.counts.candidates})</summary>
          <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">{Object.entries(run.counts.perRule).map(([r, n]) => <li key={r} className="flex justify-between gap-2"><span className="truncate">{ruleLabelClient(r)}</span><b>{n}</b></li>)}</ul>
        </details>
      )}
      {run.status === "failed" && <p role="alert" className="rounded-md bg-negative-soft p-2 text-negative">{run.error}</p>}
    </div>
  );
}

/** After a run: quick wins kept, Claude tokens, cost and time. */
export function RunSummary({ run }: { run: RunState }) {
  const ms = run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null;
  const tiles = [
    ["Quick wins", String(run.counts.kept)],
    ["Claude tokens", `${k(run.usage.input + run.usage.cacheRead + run.usage.cacheWrite)} in · ${k(run.usage.output)} out`],
    ["Claude cost", `$${run.usage.cost.toFixed(2)}${run.usage.dfsCost ? ` + $${run.usage.dfsCost.toFixed(2)} DataForSEO` : ""}`],
    ["Time", ms != null ? secs(ms) : "–"],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([l, v]) => <div key={l} className="rounded-lg border border-border bg-background p-2.5"><p className="text-[11px] text-muted">{l}</p><p className="mt-0.5 text-base font-semibold tabular-nums">{v}</p></div>)}
    </div>
  );
}

/** The run's top results, compact, like the sample: title, for the owner, where, why, the text to paste, sources and gain. */
export function TopResults({ wins }: { wins: StoredWin[] }) {
  if (!wins.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Top {wins.length} results</p>
      <ol className="space-y-2">
        {wins.map((w) => (
          <li key={w.key} className="rounded-lg border border-border bg-background p-3 text-[13px]">
            <p className="font-semibold leading-snug">{w.rank}. {w.title}</p>
            <p className="mt-1"><b>For the owner:</b> {w.plain_summary}</p>
            <p className="mt-0.5"><b>Where:</b> {w.where}</p>
            <p className="mt-0.5"><b>Why:</b> {w.why}</p>
            {w.suggested_change && <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-2 font-mono text-[12px]">{w.suggested_change}</pre>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {w.sources.map((s) => <SourceBadge key={s} s={s} />)}
              <Tag tone={w.effort === "Low" ? "good" : w.effort === "Medium" ? "warn" : "bad"}>{w.effort} effort</Tag>
              <span className="ml-auto font-mono text-xs font-semibold text-positive">+{w.computed_gain} {w.gain_unit}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface PanelProps {
  status: Record<Source, { ok: boolean; note: string }>;
  pages: string[];
  lastRun: { at: string; trigger: string; kept: number; cost: number } | null;
  /** the latest run (finished or still going), shown in Run progress until a new one starts */
  latest: RunState | null;
  /** that run's top results */
  recent: StoredWin[];
  activeRun: string | null;
  canEdit: boolean;
  defaultScreen?: string;
}

/** "✨ Generate quick wins": scope, data sources (every platform the portal uses), depth, then the live run. */
export function GeneratePanel({ status, pages, lastRun, latest, recent, activeRun, canEdit, defaultScreen }: PanelProps) {
  const router = useRouter();
  const [kind, setKind] = useState<Scope["kind"]>("site");
  const [screen, setScreen] = useState(defaultScreen ?? SCREENS[0].key);
  const [page, setPage] = useState(pages[0] ?? "");
  const [sources, setSources] = useState<Source[]>(SOURCES.filter((s) => status[s]?.ok));
  const [depth, setDepth] = useState<Depth>("standard");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onEnd = useCallback(() => router.refresh(), [router]);
  const { run, setRunId } = useRun(activeRun, onEnd);
  const running = run?.status === "running" || busy;
  const shown = run ?? latest;

  async function go() {
    setErr(null); setBusy(true);
    const scope: Scope = kind === "site" ? { kind } : kind === "screen" ? { kind, screen } : { kind: "page", url: page };
    const r = await startQuickWins({ scope, depth, sources });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setRunId(r.runId);
  }
  const toggle = (s: Source) => setSources((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));
  const group = (title: string, list: Source[]) => (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{title}</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {list.map((s) => (
          <li key={s}>
            <label className={cn("flex items-start gap-2 rounded-md px-1.5 py-1 text-sm", status[s]?.ok ? "cursor-pointer hover:bg-surface-muted" : "opacity-60")}>
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={sources.includes(s)} disabled={!status[s]?.ok || running} onChange={() => toggle(s)} />
              <span className="min-w-0"><span className="font-medium">{SOURCE_LABEL[s]}</span><span className={cn("block text-[11px]", status[s]?.ok ? "text-muted" : "text-warn")}>{status[s]?.note}</span></span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <section className="min-w-0 rounded-[10px] border border-border bg-surface p-4 lg:col-span-7" aria-labelledby="gen-title">
        <h2 id="gen-title" className="text-[15px] font-semibold">Generate quick wins</h2>
        <fieldset className="mt-3" disabled={running || !canEdit}>
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Scope</legend>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="scope" className="accent-[var(--accent)]" checked={kind === "site"} onChange={() => setKind("site")} /> Whole site</label>
            <label className="flex flex-wrap items-center gap-2"><input type="radio" name="scope" className="accent-[var(--accent)]" checked={kind === "screen"} onChange={() => setKind("screen")} /> This screen only
              <select aria-label="Screen" value={screen} onChange={(e) => { setScreen(e.target.value); setKind("screen"); }} className="min-w-0 max-w-full rounded-md border border-border bg-background px-2 py-1 text-xs">
                {SCREENS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className="flex flex-wrap items-center gap-2"><input type="radio" name="scope" className="accent-[var(--accent)]" checked={kind === "page"} onChange={() => setKind("page")} disabled={!pages.length} /> One page
              <select aria-label="Page" value={page} onChange={(e) => { setPage(e.target.value); setKind("page"); }} className="min-w-0 max-w-full rounded-md border border-border bg-background px-2 py-1 text-xs" disabled={!pages.length}>
                {pages.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset className="mt-4 space-y-3" disabled={running || !canEdit}>
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Data to use</legend>
          {group("Google and Microsoft", ["gsc", "ga4", "gbp", "bing", "clarity"])}
          {group("Social media", ["youtube", "facebook", "instagram", "threads", "x", "tiktok", "pinterest", "linkedin"])}
          {group("Research and audits", ["dataforseo", "crawl", "seosignalx"])}
        </fieldset>
        <fieldset className="mt-4" disabled={running || !canEdit}>
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Depth</legend>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-start gap-2"><input type="radio" name="depth" className="mt-1 accent-[var(--accent)]" checked={depth === "standard"} onChange={() => setDepth("standard")} /> <span>Standard (about 1–3 minutes) <span className="block text-xs text-muted">Uses stored DataForSEO data, so no new charges.</span></span></label>
            <label className="flex items-start gap-2"><input type="radio" name="depth" className="mt-1 accent-[var(--accent)]" checked={depth === "deep"} onChange={() => setDepth("deep")} /> <span>Deep: also check Google results for the top 20 opportunities <span className="block text-xs text-muted">Refreshes search volume too; charged within the monthly DataForSEO limit.</span></span></label>
          </div>
        </fieldset>
        <button type="button" className={cn(btnPrimary, "mt-4 h-11 w-full")} onClick={go} disabled={running || !canEdit || !sources.length} aria-busy={running}>
          {running ? <><Loader2 className="size-5 animate-spin" aria-hidden /><span className="sr-only">Generating quick wins</span></> : <><Sparkles className="size-4" aria-hidden /> Generate quick wins</>}
        </button>
        {!canEdit && <p className="mt-2 text-xs text-muted">Only owners and admins can run quick wins.</p>}
        {err && <p role="alert" className="mt-2 text-sm text-negative">{err}</p>}
        <p className="mt-2 text-xs text-muted">{lastRun ? `Last run: ${new Date(lastRun.at).toLocaleString()} (${lastRun.trigger}) · ${lastRun.kept} quick wins · $${lastRun.cost.toFixed(3)}` : "No run yet."}</p>
      </section>
      <section className="min-w-0 rounded-[10px] border border-border bg-surface p-4 lg:col-span-5" aria-live="polite" aria-labelledby="prog-title">
        <h2 id="prog-title" className="mb-3 text-[15px] font-semibold">Run progress</h2>
        {shown ? (
          <div className="space-y-3">
            {!run && <p className="text-xs text-muted">Last run · {new Date(shown.startedAt).toLocaleString()} · {shown.trigger}</p>}
            <RunSteps run={shown} />
            {shown.status === "done" && <RunSummary run={shown} />}
            {shown.status === "done" && <TopResults wins={recent.filter((w) => w.run_id === shown.id || !run)} />}
          </div>
        ) : <p className="text-sm text-muted">Press Generate to start. The run continues if you leave this page.</p>}
      </section>
    </div>
  );
}
