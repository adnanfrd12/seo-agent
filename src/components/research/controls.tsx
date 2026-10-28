"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { checkLinkChanges, runCoreRefresh, runDeepDive, runLinkGap, saveResearchTarget, researchKeywords, type KeywordRows } from "@/app/(dashboard)/research-actions";
import { MARKETS } from "@/lib/dataforseo/locations";
import { ResearchTable, type Col } from "./research-table";
import { Tabs } from "./tabs";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const btn2 = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const field = "w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
type R = { ok: true; message: string; cost: number } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<R>) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });
  const note = msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>;
  return { pending, run, note };
}

const ago = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

/** Paid-lookup buttons. They only run when clicked; stored data is reused while it is still fresh. */
export function RefreshControls({ canEdit, coreAt, deepAt, estCore, estDeep, show = "both" }: {
  canEdit: boolean; coreAt: string | null; deepAt: string | null; estCore: number; estDeep: number; show?: "core" | "deep" | "both";
}) {
  const { pending, run, note } = useRun();
  if (!canEdit) return <p className="text-xs text-muted">Data updated {ago(coreAt) ?? "never"}. Owners and admins can refresh it.</p>;
  const go = (fn: (force: boolean) => Promise<R>, at: string | null, label: string, est: number) => {
    const force = Boolean(at) && Date.now() - Date.parse(at!) < 7 * 86_400_000;
    if (force && !confirm(`${label} was updated ${ago(at)}. Refresh it again anyway? This costs about $${est.toFixed(2)}.`)) return;
    run(() => fn(force));
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {show !== "deep" && (
          <button className={coreAt ? btn2 : btn} disabled={pending} onClick={() => go(runCoreRefresh, coreAt, "Overview data", estCore)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {coreAt ? "Refresh overview data" : "Run first analysis"} <span className="opacity-70">(≈${estCore.toFixed(2)})</span>
          </button>
        )}
        {show !== "core" && (
          <button className={deepAt ? btn2 : btn} disabled={pending} onClick={() => go(runDeepDive, deepAt, "The deep dive", estDeep)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {deepAt ? "Refresh deep dive" : "Run deep dive"} <span className="opacity-70">(≈${estDeep.toFixed(2)})</span>
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Overview data {ago(coreAt) ? `updated ${ago(coreAt)}` : "not fetched yet"}; refreshed automatically about weekly.
        {show !== "core" && ` Deep dive ${ago(deepAt) ? `updated ${ago(deepAt)}` : "not run yet"}; stored for 14 days. Opening this page never costs anything.`}
      </p>
      {note}
    </div>
  );
}

/** The client's research domain, market, auto-refresh switch and competitors. */
export function TargetForm({ canEdit, domain, location, autoRefresh, competitors }: {
  canEdit: boolean; domain: string; location: number; autoRefresh: boolean; competitors: string[];
}) {
  const { pending, run, note } = useRun();
  const [d, setD] = useState(domain), [loc, setLoc] = useState(location), [auto, setAuto] = useState(autoRefresh), [comp, setComp] = useState(competitors.join(", "));
  const changed = d !== domain || loc !== location || auto !== autoRefresh || comp !== competitors.join(", ");
  return (
    <fieldset disabled={!canEdit || pending} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Website<input className={`${field} mt-1`} value={d} onChange={(e) => setD(e.target.value)} placeholder="example.com" /></label>
      <label className="text-sm">Country for rankings and keyword data
        <select className={`${field} mt-1`} value={loc} onChange={(e) => setLoc(Number(e.target.value))}>{MARKETS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select>
      </label>
      <label className="text-sm sm:col-span-2">Competitors (up to 8, comma separated; used for link gap analysis)
        <input className={`${field} mt-1`} value={comp} onChange={(e) => setComp(e.target.value)} placeholder="competitor1.com, competitor2.com" />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Refresh the overview data automatically about once a week</label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        {canEdit && <button type="button" className={btn} disabled={!changed || pending} onClick={() => run(() => saveResearchTarget({ domain: d, location: loc, autoRefresh: auto, competitors: comp }))}>
          {pending && <Loader2 className="size-4 animate-spin" />} Save</button>}
        {changed && domain && d.trim().toLowerCase() !== domain && <span className="text-xs text-muted">Changing the website clears the stored data for this client.</span>}
        {note}
      </div>
    </fieldset>
  );
}

/** Link gap: sites that link to a competitor but not to this client. */
export function LinkGapForm({ canEdit, competitors }: { canEdit: boolean; competitors: string[] }) {
  const { pending, run, note } = useRun();
  const [c, setC] = useState(competitors[0] ?? "");
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">Competitor
        <input list="gap-competitors" className={`${field} mt-1 w-64`} value={c} onChange={(e) => setC(e.target.value)} placeholder="competitor.com" />
        <datalist id="gap-competitors">{competitors.map((x) => <option key={x} value={x} />)}</datalist>
      </label>
      <button className={btn} disabled={pending || c.trim().length < 3} onClick={() => run(() => runLinkGap(c, false))}>
        {pending && <Loader2 className="size-4 animate-spin" />} Find link gaps <span className="opacity-70">(≈$0.04)</span>
      </button>
      {note}
    </div>
  );
}

/** Manual "look for new and lost links now"; the scheduled job already does this daily for active clients. */
export function LinkChangeCheck({ canEdit }: { canEdit: boolean }) {
  const { pending, run, note } = useRun();
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={btn2} disabled={pending} onClick={() => run(() => checkLinkChanges(false))}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Check for link changes <span className="opacity-70">(≈$0.05)</span>
      </button>
      {note}
    </div>
  );
}

const KW_COLS: Col[] = [
  { key: "keyword", label: "Keyword" }, { key: "volume", label: "Volume / mo", type: "int", hint: "Average monthly Google searches" },
  { key: "difficulty", label: "Difficulty", type: "int", hint: "0-100: how hard it is to rank in the top 10" },
  { key: "cpc", label: "CPC", type: "usd", hint: "Average cost per click in Google Ads" }, { key: "competition", label: "Ad competition", type: "badge" },
  { key: "intent", label: "Intent", type: "badge" }, { key: "trend", label: "12-mo trend", type: "spark" },
];
const KW_PRESETS = [
  { label: "Easy wins (difficulty ≤ 30, volume ≥ 100)", where: [{ key: "difficulty", op: "lte" as const, value: 30 }, { key: "volume", op: "gte" as const, value: 100 }] },
  { label: "High volume (≥ 1,000)", where: [{ key: "volume", op: "gte" as const, value: 1000 }] },
  { label: "Low competition (difficulty ≤ 20)", where: [{ key: "difficulty", op: "lte" as const, value: 20 }] },
];
const KINDS = [
  { key: "ideas", label: "Keyword ideas", help: "Broad list of related keywords, ordered by volume." },
  { key: "suggestions", label: "Suggestions", help: "Keywords that contain your seed phrase." },
  { key: "related", label: "Related searches", help: "What people also search for (Google's related searches)." },
] as const;

export function KeywordResearch({ canEdit, defaultLocation }: { canEdit: boolean; defaultLocation: number }) {
  const [seed, setSeed] = useState("");
  const [loc, setLoc] = useState(defaultLocation);
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("ideas");
  const [results, setResults] = useState<Record<string, KeywordRows & { seed: string; loc: number }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const search = (k: (typeof KINDS)[number]["key"], force = false) => start(async () => {
    setMsg(null);
    const r = await researchKeywords(k, seed, loc, force);
    if (!r.ok) { setMsg(r.error); return; }
    setResults((prev) => ({ ...prev, [k]: { ...r.data, seed: seed.trim(), loc } }));
  });
  const cur = results[kind];
  const stale = cur && (cur.seed.toLowerCase() !== seed.trim().toLowerCase() || cur.loc !== loc);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
          <label className="text-sm">Seed keyword<input className={`${field} mt-1`} value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. led signs"
            onKeyDown={(e) => { if (e.key === "Enter" && canEdit && seed.trim().length >= 2) search(kind); }} /></label>
          <label className="text-sm">Country<select className={`${field} mt-1`} value={loc} onChange={(e) => setLoc(Number(e.target.value))}>{MARKETS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select></label>
          <button className={btn} disabled={!canEdit || pending || seed.trim().length < 2} onClick={() => search(kind)}>
            {pending && <Loader2 className="size-4 animate-spin" />} Search <span className="opacity-70">(≈$0.03)</span>
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          {canEdit ? "Each new search costs about 2–3 cents and each result is stored for 30 days, shared by every client, so repeating a search is free."
            : "Only owners and admins can run new searches (they spend API credit)."}
        </p>
        {msg && <p role="alert" className="mt-2 text-sm text-negative">{msg}</p>}
      </div>

      <Tabs label="Keyword research type" onChange={(k) => setKind(k as typeof kind)} items={KINDS.map((k) => ({
        key: k.key, label: k.label, badge: results[k.key]?.rows.length,
        content: (
          <div className="space-y-2">
            <p className="text-xs text-muted">{k.help}</p>
            {results[k.key] ? (
              <>
                <p className="text-xs text-muted">
                  “{results[k.key].seed}” · {results[k.key].fromCache ? `stored result from ${ago(results[k.key].fetchedAt)} (free)` : "fetched just now"}
                  {results[k.key].total > results[k.key].rows.length ? ` · showing the top ${results[k.key].rows.length} of ${results[k.key].total.toLocaleString("en-US")}` : ""}
                </p>
                <ResearchTable title={k.label} rows={results[k.key].rows} columns={KW_COLS} searchKeys={["keyword"]} presets={KW_PRESETS}
                  ranges={[{ key: "volume", label: "Volume / mo" }, { key: "difficulty", label: "Difficulty" }, { key: "cpc", label: "CPC ($)" }]}
                  facets={[{ key: "intent", label: "Intent" }, { key: "competition", label: "Ad competition" }]}
                  initialSort={{ key: "volume", dir: "desc" }} csvName={`keywords-${k.key}-${results[k.key].seed.replace(/\W+/g, "-")}`} />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
                {pending && kind === k.key ? "Searching…" : canEdit ? <button className={btn2} disabled={pending || seed.trim().length < 2} onClick={() => { setKind(k.key); search(k.key); }}>Load {k.label.toLowerCase()} for “{seed.trim() || "…"}”</button> : "No search yet."}
              </div>
            )}
            {stale && <p className="text-xs text-muted">The keyword or country changed since this list was loaded. Press Search to update it.</p>}
          </div>
        ),
      }))} />
    </div>
  );
}
