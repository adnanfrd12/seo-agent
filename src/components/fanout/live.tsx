"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ClipboardCopy, Download, Loader2, Radar, Upload } from "lucide-react";
import { importPastedFanoutAction, runLiveFanoutAction } from "@/app/(dashboard)/fan-out-queries/actions";
import { cn } from "@/lib/utils";

/* types and constants mirrored from lib/fanout/live (server-only) */
type Platform = "chatgpt" | "claude" | "gemini" | "grok" | "perplexity";
const PLATFORMS: Platform[] = ["chatgpt", "claude", "gemini", "grok", "perplexity"];
const LABEL: Record<Platform, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", grok: "Grok", perplexity: "Perplexity" };
const EST: Record<Platform, number> = { chatgpt: 0.05, claude: 0.09, gemini: 0.03, grok: 0.05, perplexity: 0.03 };
const TONE: Record<Platform, string> = { chatgpt: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", claude: "bg-orange-500/10 text-orange-700 dark:text-orange-300", gemini: "bg-blue-500/10 text-blue-700 dark:text-blue-300", grok: "bg-slate-500/15 text-slate-700 dark:text-slate-300", perplexity: "bg-teal-500/10 text-teal-700 dark:text-teal-300" };
interface Citation { url: string; title: string | null }
export interface LiveRowView { seed: string; platform: Platform; run_no: number; model: string | null; queries: string[]; queries_exposed: boolean; answer: string | null; citations: Citation[]; client_cited: boolean; cost_usd: number; error: string | null }
export interface LiveBatchView { id: string; at: string; seeds: string[]; platforms: Platform[]; rows: LiveRowView[] }

const input = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";
const primary = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const usd = (v: number) => `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`;
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const keywordsOf = (s: string) => [...new Set(s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean))];

function Chip({ p }: { p: Platform }) { return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[p])}>{LABEL[p]}</span>; }

/** Fan-Out Queries → Real AI search queries: ask the AI platforms (API keys) or paste ChatGPT's network response (free). */
export function LiveFanout({ canEdit, ready, tableReady, batches, domain }: {
  canEdit: boolean; ready: Record<Platform, boolean>; tableReady: boolean; batches: LiveBatchView[]; domain: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"ask" | "paste">("ask");
  const [kw, setKw] = useState("");
  const [picked, setPicked] = useState<Platform[]>(PLATFORMS.filter((p) => ready[p]));
  const [runs, setRuns] = useState(1);
  const [pasteKw, setPasteKw] = useState("");
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [batchId, setBatchId] = useState<string | null>(batches[0]?.id ?? null);
  const [copied, setCopied] = useState(false);
  const kws = keywordsOf(kw);
  const asks = kws.length * picked.length * runs;
  const est = kws.length * runs * picked.reduce((a, p) => a + EST[p], 0);

  const batch = batches.find((b) => b.id === batchId) ?? batches[0] ?? null;
  // every query across the batch: which platforms ran it and how often
  const merged = useMemo(() => {
    const m = new Map<string, { query: string; seeds: Set<string>; platforms: Set<Platform>; n: number }>();
    for (const r of batch?.rows ?? []) for (const q of r.queries) {
      const k = q.toLowerCase();
      const e = m.get(k) ?? { query: q, seeds: new Set<string>(), platforms: new Set<Platform>(), n: 0 };
      e.seeds.add(r.seed); e.platforms.add(r.platform); e.n++; m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.platforms.size - a.platforms.size || b.n - a.n);
  }, [batch]);

  const run = (fn: () => Promise<{ ok: true; message: string; batchId: string } | { ok: false; error: string }>, after?: () => void) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    if (r.ok) { setBatchId(r.batchId); after?.(); router.refresh(); }
  });
  const csv = () => {
    const rows = [["query", "platforms", "times", "keywords"], ...merged.map((q) => [q.query, [...q.platforms].map((p) => LABEL[p]).join(" | "), String(q.n), [...q.seeds].join(" | ")])];
    const blob = new Blob([rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `fan-out-real-queries-${domain}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <section aria-label="Real AI search queries" className="mb-6 rounded-[10px] border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Radar className="size-4 text-accent" aria-hidden /> Real AI search queries</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-secondary">What ChatGPT, Claude, Gemini, Grok and Perplexity actually searched the web for when asked a keyword, and the sources they cited. Use their wording as H2 sections or new pages.</p>
        </div>
      </div>
      {!tableReady && <p role="alert" className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-warn">Storage isn&apos;t set up yet: apply migration 20261130000040_fanout_live.sql.</p>}

      {canEdit && tableReady && (
        <div className="mt-4">
          <div className="mb-3 flex gap-1" role="tablist">
            {([["ask", "Ask the AIs (API)"], ["paste", "Paste from ChatGPT (free)"]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); setMsg(null); }}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", tab === k ? "bg-foreground text-background" : "text-secondary hover:bg-surface-muted")}>{l}</button>
            ))}
          </div>
          {tab === "ask" ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <label className="block text-sm font-medium">Keywords <span className="font-normal text-muted">(one per line, up to 10)</span>
                <textarea value={kw} onChange={(e) => setKw(e.target.value)} rows={4} className={cn(input, "mt-1")} placeholder={"led signs houston\nbest outdoor business signs"} />
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium">Platforms</p>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => (
                    <label key={p} className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm", ready[p] ? "border-border" : "border-dashed border-border text-muted")} title={ready[p] ? `About ${usd(EST[p])} per question` : "Add the API key in Settings → Organization → Integrations"}>
                      <input type="checkbox" disabled={!ready[p]} checked={picked.includes(p)} onChange={() => setPicked((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))} />
                      {LABEL[p]}{!ready[p] && <span className="text-[11px]">· no key</span>}
                    </label>
                  ))}
                </div>
                {PLATFORMS.some((p) => !ready[p]) && <p className="text-xs text-muted">Platforms without a key: add it in <Link href="/settings/organization/integrations" className="underline">Settings → Organization → Integrations</Link>, or use Paste from ChatGPT.</p>}
                <label className="flex items-center gap-2 text-sm">Ask each
                  <select value={runs} onChange={(e) => setRuns(Number(e.target.value))} className="rounded-lg border border-border bg-background px-2 py-1">
                    {[1, 2, 3].map((n) => <option key={n} value={n}>{n}×</option>)}
                  </select>
                  <span className="text-xs text-muted">AIs search differently each time; 2–3× shows the stable queries.</span>
                </label>
                <button type="button" className={primary} disabled={pending || !kws.length || !picked.length || asks > 30}
                  onClick={() => run(() => runLiveFanoutAction({ keywords: kws, platforms: picked, runs }))}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />} Get real queries
                </button>
                <p className="text-xs text-muted">{asks ? `${asks} question${asks === 1 ? "" : "s"} · about ${usd(est)}${asks > 30 ? " · at most 30 per run" : ""}` : "Enter keywords and pick platforms."}{pending ? " · this can take a few minutes" : ""}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <ol className="list-decimal space-y-0.5 pl-5 text-xs text-secondary">
                <li>Ask your keyword in ChatGPT (chatgpt.com, logged in) and wait for the answer.</li>
                <li>Right-click → Inspect → <b>Network</b>. Copy the part of the address after <code>/c/</code> and paste it in the Network filter.</li>
                <li>Refresh the page, click the request with that code, open <b>Response</b>, select all and copy.</li>
                <li>Paste it below: every search query (&quot;queries&quot;) and cited site is found automatically.</li>
              </ol>
              <label className="block text-sm font-medium">Keyword you asked
                <input value={pasteKw} onChange={(e) => setPasteKw(e.target.value)} className={cn(input, "mt-1")} placeholder="led signs houston" />
              </label>
              <label className="block text-sm font-medium">ChatGPT network Response
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} className={cn(input, "mt-1 font-mono text-xs")} placeholder='{"mapping": … "queries": ["…"] …}' />
              </label>
              <button type="button" className={primary} disabled={pending || !pasteKw.trim() || !paste.trim()}
                onClick={() => run(() => importPastedFanoutAction({ keyword: pasteKw, text: paste }), () => setPaste(""))}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Import queries
              </button>
            </div>
          )}
          {msg && <p role={msg.ok ? "status" : "alert"} className={cn("mt-2 text-sm", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
        </div>
      )}

      {batch && (
        <div className="mt-5 border-t border-hairline pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={batch.id} onChange={(e) => setBatchId(e.target.value)} className="max-w-full rounded-lg border border-border bg-background px-2 py-1 text-sm" aria-label="Run">
              {batches.map((b) => <option key={b.id} value={b.id}>{new Date(b.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {b.seeds.slice(0, 2).join(", ")}{b.seeds.length > 2 ? ` +${b.seeds.length - 2}` : ""}</option>)}
            </select>
            <span className="flex flex-wrap gap-1">{batch.platforms.map((p) => <Chip key={p} p={p} />)}</span>
            <span className="ml-auto flex gap-2">
              <button type="button" className={btn} disabled={!merged.length} onClick={() => { void navigator.clipboard?.writeText(merged.map((q) => `## ${q.query.charAt(0).toUpperCase()}${q.query.slice(1)}`).join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                {copied ? <Check className="size-4 text-positive" /> : <ClipboardCopy className="size-4" />} Copy as H2s
              </button>
              <button type="button" className={btn} disabled={!merged.length} onClick={csv}><Download className="size-4" /> CSV</button>
            </span>
          </div>

          <h3 className="mb-1 text-sm font-semibold">All queries <span className="font-normal text-muted">({merged.length}, most platforms first)</span></h3>
          {merged.length ? (
            <div className="max-h-[28rem] overflow-auto rounded-lg border border-hairline">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Query the AI searched</th><th className="px-3 py-2">Seen on</th><th className="px-3 py-2 text-right">Times</th><th className="px-3 py-2">Keyword</th></tr></thead>
                <tbody className="divide-y divide-hairline">
                  {merged.map((q) => (
                    <tr key={q.query}><td className="px-3 py-1.5">{q.query}</td><td className="px-3 py-1.5"><span className="flex flex-wrap gap-1">{[...q.platforms].map((p) => <Chip key={p} p={p} />)}</span></td><td className="px-3 py-1.5 text-right tabular-nums">{q.n}</td><td className="px-3 py-1.5 text-muted">{[...q.seeds].join(", ")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-muted">No search queries in this run.</p>}

          <h3 className="mb-1 mt-4 text-sm font-semibold">Each answer</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {batch.rows.map((r, i) => (
              <details key={i} className="rounded-lg border border-hairline p-3 text-sm" open={batch.rows.length <= 4}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <Chip p={r.platform} /><span className="font-medium">{r.seed}</span>{r.run_no > 1 && <span className="text-xs text-muted">#{r.run_no}</span>}
                  <span className="text-xs text-muted">{r.error ? "failed" : `${r.queries.length} searches · ${r.citations.length} sources`}</span>
                  {r.client_cited && <span className="rounded-full bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive">cites {domain}</span>}
                </summary>
                {r.error ? <p className="mt-2 text-negative">{r.error}</p> : (
                  <div className="mt-2 space-y-2">
                    {r.queries.length ? <ul className="list-disc pl-5">{r.queries.map((q) => <li key={q}>{q}</li>)}</ul>
                      : <p className="text-muted">{r.queries_exposed ? "It answered without searching the web." : `${LABEL[r.platform]} doesn't return the searches it ran; its sources are below.`}</p>}
                    {r.answer && <p className="rounded-md bg-surface-sunken p-2 text-xs text-secondary">{r.answer}{r.answer.length >= 1500 ? "…" : ""}</p>}
                    {r.citations.length > 0 && (
                      <ul className="space-y-0.5 text-xs">
                        {r.citations.slice(0, 12).map((c) => (
                          <li key={c.url} className={cn("truncate", host(c.url).endsWith(domain.replace(/^www\./, "")) && "font-semibold text-positive")}>
                            <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">{host(c.url)}</a>{c.title && <span className="text-muted"> · {c.title}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[11px] text-faint">{r.model ?? ""}{r.cost_usd ? ` · ${usd(r.cost_usd)}` : ""}</p>
                  </div>
                )}
              </details>
            ))}
          </div>
        </div>
      )}
      {!batch && tableReady && <p className="mt-4 text-sm text-muted">{canEdit ? "No real AI queries yet: ask the AIs or paste from ChatGPT above." : "No real AI queries yet. An owner or admin can run them."}</p>}
    </section>
  );
}
