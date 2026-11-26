import Link from "next/link";
import { ResearchTable, type Col } from "@/components/research/research-table";
import { Card, Meter, Stat } from "@/components/toolkit/ui";
import type { RunDetail, RunListItem } from "@/lib/fanout/run";
import { FANOUT_TYPES, MODE_LABEL, TYPE_LABEL, usd } from "@/lib/fanout/shared";
import { cn } from "@/lib/utils";

const path = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/ (home)" : x.pathname; } catch { return u; } };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const runTitle = (r: RunListItem) => (r.kind === "pages" ? r.inputs.map(path) : r.inputs).slice(0, 3).join(", ") + (r.inputs.length > 3 ? ` +${r.inputs.length - 3}` : "");

/** Recent runs: everyone can open any of them. */
export function RunList({ runs, current }: { runs: RunListItem[]; current: string | null }) {
  return (
    <Card title="Runs" right={`${runs.length} saved`}>
      <ul className="-mx-1 max-h-[28rem] space-y-0.5 overflow-y-auto">
        {runs.map((r) => (
          <li key={r.id}>
            <Link href={`/fan-out-queries?run=${r.id}`} className={cn("block rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted", r.id === current && "bg-surface-muted")}>
              <span className="block truncate font-medium">{runTitle(r)}</span>
              <span className="block text-xs text-muted">{when(r.created_at)} UTC · {r.kind === "pages" ? "Pages" : "Keywords"} · {r.query_count} queries · {usd(r.ai_cost_usd + r.volume_cost_usd)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RunView({ run }: { run: RunDetail }) {
  const pages = run.kind === "pages";
  const hasVolume = run.queries.some((q) => q.volume != null);
  const byType = FANOUT_TYPES.map((t) => ({ t, n: run.queries.filter((q) => q.type === t).length })).filter((x) => x.n);
  const cov = (c: string) => run.queries.filter((q) => q.coverage === c).length;
  const rows = run.queries.map((q) => ({
    seed: pages ? path(q.seed) : q.seed, page: pages ? q.seed : undefined, query: q.query, type: TYPE_LABEL[q.type] ?? q.type,
    intent: q.intent, reasoning: q.reasoning, coverage: q.coverage, suggestion: q.suggestion, volume: q.volume ?? null,
  }));
  const columns: Col[] = [
    { key: "seed", label: pages ? "Page" : "Keyword" },
    { key: "query", label: "Fan-out query", type: "keyword" },
    { key: "type", label: "Type", type: "badge" },
    ...(pages ? [{ key: "coverage", label: "Coverage", type: "badge" as const }, { key: "suggestion", label: "Suggestion" }] : []),
    { key: "intent", label: "User intent" },
    { key: "reasoning", label: "Why it is run" },
    ...(hasVolume ? [{ key: "volume", label: "Volume", type: "int" as const, hint: "Monthly Google searches (DataForSEO)" }] : []),
    ...(pages ? [{ key: "page", label: "URL", type: "open" as const }] : []),
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Fan-out queries" value={run.queries.length} sub={`${run.inputs.length} ${pages ? "page" : "keyword"}${run.inputs.length === 1 ? "" : "s"} · ${MODE_LABEL[run.mode] ?? run.mode}`} />
        {pages
          ? <><Stat label="Covered" value={cov("covered")} sub="answered on the page" /><Stat label="Missing or partial" value={cov("missing") + cov("partial")} sub={`${cov("missing")} missing · ${cov("partial")} partial`} /></>
          : <><Stat label="Query types" value={byType.length} sub={byType.slice(0, 3).map((x) => TYPE_LABEL[x.t]).join(", ")} /><Stat label="With volume" value={run.queries.filter((q) => (q.volume ?? 0) > 0).length} sub={hasVolume ? "searched on Google monthly" : "volume not requested"} /></>}
        <Stat label="Cost" value={usd(run.ai_cost_usd + run.volume_cost_usd)} sub={`AI ${usd(run.ai_cost_usd)} · volumes ${usd(run.volume_cost_usd)}`} />
      </div>

      {run.errors.length > 0 && (
        <div role="alert" className="rounded-[10px] border border-negative/30 bg-negative/5 p-3 text-sm">
          <p className="font-medium text-negative">{run.errors.length} {pages ? "page" : "keyword"}{run.errors.length === 1 ? "" : "s"} failed</p>
          <ul className="mt-1 space-y-0.5 text-xs text-secondary">{run.errors.map((e) => <li key={e.input} className="break-words"><span className="font-medium">{pages ? path(e.input) : e.input}</span>: {e.error}</li>)}</ul>
        </div>
      )}

      {pages && run.summaries.length > 0 && (
        <Card title="Coverage by page">
          <ul className="space-y-3">
            {run.summaries.map((s) => {
              const total = s.covered + s.partial + s.missing;
              return (
                <li key={s.url} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center sm:gap-4">
                  <div className="min-w-0 text-sm">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate font-medium hover:underline">{s.title ?? path(s.url)}</a>
                    <p className="truncate text-xs text-muted">{path(s.url)} · topic: {s.topic} · main query: {s.mainQuery}</p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Meter value={s.covered + s.partial / 2} max={Math.max(1, total)} color="var(--positive)" />
                    <span className="w-28 shrink-0 text-right tabular-nums">{s.covered} / {total} covered</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!pages && byType.length > 0 && (
        <Card title="Query types">
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {byType.map((x) => (
              <li key={x.t} className="flex items-center gap-3 text-sm">
                <span className="w-36 shrink-0">{TYPE_LABEL[x.t]}</span>
                <Meter value={x.n} max={Math.max(...byType.map((y) => y.n))} />
                <span className="w-8 shrink-0 text-right tabular-nums text-muted">{x.n}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ResearchTable title="Fan-out queries" rows={rows} columns={columns} searchKeys={["query", "seed", "intent", "suggestion"]}
        facets={[{ key: "seed", label: pages ? "Page" : "Keyword" }, { key: "type", label: "Type" }, ...(pages ? [{ key: "coverage", label: "Coverage" }] : [])]}
        presets={pages ? [{ label: "Missing", where: [{ key: "coverage", op: "eq", value: "missing" }] }, { label: "Partial", where: [{ key: "coverage", op: "eq", value: "partial" }] }] : []}
        initialSort={hasVolume ? { key: "volume", dir: "desc" } : undefined} pageSize={50}
        csvName={`fan-out-${pages ? "pages" : "keywords"}-${run.created_at.slice(0, 10)}`} empty="No queries in this run." />
    </div>
  );
}
