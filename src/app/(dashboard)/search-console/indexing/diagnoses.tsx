"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Tag } from "@/components/ga4x/table";
import type { IndexDiagnosis } from "@/lib/gscx/indexing-ai";
import { cn } from "@/lib/utils";
import { diagnoseIndexPage } from "../gscx-actions";

/** One page of the inventory: index status from the URL Inspection API, crawl facts and Search Console numbers. */
export interface IndexRow {
  url: string; path: string; status: string; statusTone: string; reason: string; last: string; lastB: string; as: string; sm: string;
  refs: number; impr: number; fetch: string; linksIn: number;
  /** inspected and not indexed: Claude can diagnose it */
  diagnosable: boolean;
}
const usd = (v: number) => `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`;
const path = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";

const FACETS: { k: keyof IndexRow; label: string }[] = [
  { k: "status", label: "Index status" }, { k: "reason", label: "Reason" }, { k: "as", label: "Crawled as" },
  { k: "sm", label: "Sitemap" }, { k: "lastB", label: "Last crawled" }, { k: "fetch", label: "Page fetch" },
];
const COLS: { k: keyof IndexRow; label: string; num?: boolean }[] = [
  { k: "path", label: "URL" }, { k: "status", label: "Status" }, { k: "reason", label: "Reason / coverage state" }, { k: "last", label: "Last crawl" },
  { k: "as", label: "Crawled as" }, { k: "sm", label: "In sitemap" }, { k: "refs", label: "Referring URLs", num: true },
  { k: "linksIn", label: "Links in", num: true }, { k: "impr", label: "Impr. 28d", num: true },
];
/** a not-indexed status picked in the filter: the AI diagnosis columns and actions show */
const notIndexedPick = (v: string | undefined) => Boolean(v && v.startsWith("Not indexed"));

/**
 * Every page and whether it's on Google, in one table: filters, sorting and "Show all". With a "Not indexed" status
 * picked, Claude's possible issue and recommended solution show for each page, and the pages on screen that aren't
 * diagnosed yet are diagnosed automatically (owners and admins; results are stored, so nothing is paid twice).
 */
export function IndexTable({ rows, stored, canRun, est, site }: { rows: IndexRow[]; stored: Record<string, IndexDiagnosis>; canRun: boolean; est: number; site?: string }) {
  const router = useRouter();
  const [diags, setDiags] = useState(stored);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [sortK, setSortK] = useState<keyof IndexRow | null>(null);
  const [dir, setDir] = useState(-1);
  const [lim, setLim] = useState(25);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const tried = useRef<Set<string>>(new Set());
  const stopped = useRef<string | null>(null);
  const running = busy.size > 0;
  const diagMode = notIndexedPick(f.status);

  const match = (r: IndexRow, skip?: string) => FACETS.every((fc) => fc.k === skip || f[fc.k] == null || String(r[fc.k]) === f[fc.k]);
  const sorted = useMemo(() => {
    if (!sortK) return rows;
    return [...rows].sort((a, b) => { const x = a[sortK], y = b[sortK]; return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir; });
  }, [rows, sortK, dir]);
  const all = sorted.filter((r) => match(r));
  const shown = all.slice(0, lim);
  const todo = all.filter((r) => r.diagnosable && !diags[r.url]);
  const selList = [...sel].filter((u) => rows.some((r) => r.url === u && r.diagnosable));

  async function run(urls: string[], again: boolean, ask: boolean) {
    if (!urls.length) return;
    if (ask && urls.length > 1 && !window.confirm(`Diagnose ${urls.length} pages with Claude? Estimated cost about ${usd(est * urls.length)} (${usd(est)} a page), taken from the monthly Claude budget.`)) return;
    setMsg(null);
    let done = 0, spent = 0;
    const queue = [...urls];
    const worker = async () => {
      while (queue.length && !stopped.current) {
        const u = queue.shift()!;
        tried.current.add(u);
        setBusy((b) => new Set(b).add(u));
        const r = await diagnoseIndexPage(u, again).catch(() => ({ ok: false, message: "The request failed. Try again.", stop: false, diagnosis: undefined }));
        setBusy((b) => { const n = new Set(b); n.delete(u); return n; });
        if (r.ok && r.diagnosis) {
          const d = r.diagnosis; done++; if (r.message !== "Already diagnosed.") spent += d.cost;
          setDiags((o) => ({ ...o, [u]: d })); setErrs((o) => { const n = { ...o }; delete n[u]; return n; });
        } else {
          setErrs((o) => ({ ...o, [u]: r.message }));
          // out of budget or AI not set up: stop, including the automatic runs, until the page is reloaded
          if ("stop" in r && r.stop) stopped.current = r.message;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
    setSel(new Set());
    const stop = stopped.current;
    setMsg(stop ? { ok: false, text: `${done ? `${done} diagnosed (${usd(spent)}), then stopped: ` : ""}${stop}` } : { ok: done === urls.length, text: `${done} of ${urls.length} diagnosed${spent ? ` · ${usd(spent)}` : ""}.` });
    router.refresh();
  }

  // automatic diagnosis: with a "Not indexed" status picked, the not-yet-diagnosed pages on screen (owners and admins)
  const autoKey = diagMode && canRun ? shown.filter((r) => r.diagnosable && !diags[r.url]).map((r) => r.url).join("|") : "";
  useEffect(() => {
    if (!autoKey || running || stopped.current) return;
    // each page is tried once per visit (a page that failed isn't retried in a loop)
    const urls = autoKey.split("|").filter((u) => !tried.current.has(u));
    if (urls.length) void run(urls, false, false);
    // run() only reads refs and state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, running]);

  const toggle = (u: string) => setSel((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; });
  const pageRows = shown.filter((r) => r.diagnosable);
  const allOn = pageRows.length > 0 && pageRows.every((r) => sel.has(r.url));
  const span = COLS.length + (diagMode ? (canRun ? 4 : 3) : 0);

  return (
    <div>
      <div className="mb-3 space-y-1.5">
        {FACETS.map((fc) => {
          const cnt = new Map<string, number>();
          for (const r of rows.filter((x) => match(x, fc.k))) { const v = String(r[fc.k]); cnt.set(v, (cnt.get(v) ?? 0) + 1); }
          const keys = [...cnt.keys()].sort((a, b) => cnt.get(b)! - cnt.get(a)!);
          return (
            <div key={fc.k} className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-faint">{fc.label}</span>
              <Chip on={f[fc.k] == null} onClick={() => setF((o) => { const n = { ...o }; delete n[fc.k]; return n; })}>All</Chip>
              {keys.slice(0, 14).map((v) => <Chip key={v} on={f[fc.k] === v} onClick={() => { setF((o) => ({ ...o, [fc.k]: v })); setLim(25); }}>{v} <b className="ml-0.5 tabular-nums text-faint">{cnt.get(v)}</b></Chip>)}
            </div>
          );
        })}
        {Object.keys(f).length > 0 && <p className="text-xs text-muted">{all.length} of {rows.length} pages match. <button type="button" className="ml-1 rounded border border-border px-1.5 py-0.5 hover:bg-surface-muted" onClick={() => setF({})}>Clear filters</button></p>}
        {!diagMode && rows.some((r) => r.diagnosable) && (
          <p className="text-xs text-muted">Pick a <b>Not indexed</b> status to see each page&apos;s possible issue and recommended solution (AI diagnosis).</p>
        )}
        {diagMode && (canRun ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" className={btn} disabled={running || !selList.length} onClick={() => run(selList, false, true)}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Diagnose selected ({selList.length}) · about {usd(est * selList.filter((u) => !diags[u]).length)}
            </button>
            <button type="button" className={btn} disabled={running || !todo.length} onClick={() => run(todo.map((r) => r.url), false, true)}>
              Diagnose all not yet diagnosed ({todo.length}) · about {usd(est * todo.length)}
            </button>
            <span className="text-xs text-muted">Pages on screen are diagnosed automatically · Claude Sonnet · about {usd(est)} a page · stored, so it isn&apos;t paid again.</span>
          </div>
        ) : <p className="text-xs text-muted">An owner or admin runs diagnoses; stored ones show here for everyone.</p>)}
        {diagMode && running && <p role="status" className="text-xs text-muted"><Loader2 className="mr-1 inline size-3 animate-spin" />Diagnosing {busy.size} page{busy.size === 1 ? "" : "s"}…</p>}
        {msg && <p role="status" className={cn("text-xs", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-hairline">
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {diagMode && canRun && <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all shown" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(pageRows.map((r) => r.url)))} /></th>}
              {COLS.map((c) => (
                <th key={c.k} aria-sort={sortK === c.k ? (dir > 0 ? "ascending" : "descending") : "none"}
                  className={cn("cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:text-foreground", c.num ? "text-right" : "text-left")}
                  onClick={() => { setDir(sortK === c.k ? -dir : -1); setSortK(c.k); }}>
                  {c.label}{sortK === c.k ? (dir > 0 ? " ↑" : " ↓") : ""}
                </th>
              ))}
              {diagMode && <><th className="px-3 py-2 text-left">Possible issue</th><th className="px-3 py-2 text-left">Recommended solution</th><th className="px-3 py-2" /></>}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {shown.map((r) => {
              const d = diags[r.url], b = busy.has(r.url), e = errs[r.url];
              return (
                <Fragment key={r.url}>
                  <tr className="hover:bg-surface-sunken">
                    {diagMode && canRun && <td className="px-3 py-2 align-top">{r.diagnosable && <input type="checkbox" aria-label={`Select ${r.path}`} checked={sel.has(r.url)} onChange={() => toggle(r.url)} />}</td>}
                    <td className="max-w-[22rem] px-3 py-2 align-top">{site ? <a href={r.url} target="_blank" rel="noreferrer" className="break-all hover:underline">{r.path}</a> : <span className="break-all">{r.path}</span>}</td>
                    <td className="px-3 py-2 align-top"><Tag tone={r.statusTone}>{r.status}</Tag></td>
                    <td className="min-w-[12rem] px-3 py-2 align-top text-secondary">{r.reason}</td>
                    <td className="whitespace-nowrap px-3 py-2 align-top">{r.last}</td>
                    <td className="px-3 py-2 align-top">{r.as}</td>
                    <td className="px-3 py-2 align-top">{r.sm}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">{r.refs}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">{r.linksIn}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">{r.impr}</td>
                    {diagMode && (
                      <>
                        <td className="min-w-[16rem] px-3 py-2 align-top">
                          {!r.diagnosable ? <span className="text-faint">–</span>
                            : d ? <>{d.issue} <Tag tone={d.confidence === "High" ? "bad" : d.confidence === "Medium" ? "warn" : "mute"}>{d.confidence} confidence</Tag></>
                              : e ? <span className="text-negative">{e}</span>
                                : b ? <span className="text-muted"><Loader2 className="mr-1 inline size-3 animate-spin" />Diagnosing…</span>
                                  : <span className="text-faint">Not diagnosed yet</span>}
                        </td>
                        <td className="min-w-[16rem] px-3 py-2 align-top">{d ? d.solution : <span className="text-faint">–</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                          {d && <button type="button" className="mr-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-muted" aria-expanded={open === r.url} onClick={() => setOpen(open === r.url ? null : r.url)}>{open === r.url ? "Hide" : "Details"}</button>}
                          {canRun && r.diagnosable && <button type="button" disabled={b || running} title={`About ${usd(est)}`} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-muted disabled:opacity-60" onClick={() => run([r.url], !!d, true)}>
                            {b ? <Loader2 className="inline size-3.5 animate-spin" /> : d ? `Re-run · ${usd(est)}` : `Diagnose · ${usd(est)}`}
                          </button>}
                        </td>
                      </>
                    )}
                  </tr>
                  {diagMode && d && open === r.url && (
                    <tr><td colSpan={span} className="bg-surface-sunken px-4 py-3"><Details d={d} /></td></tr>
                  )}
                </Fragment>
              );
            })}
            {!shown.length && <tr><td colSpan={span} className="px-3 py-6 text-center text-sm text-muted">No pages match.</td></tr>}
          </tbody>
        </table>
      </div>
      {all.length > lim && (
        <p className="mt-2 text-xs text-muted">Showing {lim} of {all.length} pages.
          <button type="button" className="ml-1 rounded border border-border px-1.5 py-0.5 hover:bg-surface-muted" onClick={() => setLim(1e9)}>Show all</button>
          {diagMode && canRun ? " Pages shown are diagnosed automatically." : ""}
        </p>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return items.length ? <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3><ul className="list-disc space-y-0.5 pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null;
}

function Details({ d }: { d: IndexDiagnosis }) {
  return (
    <div className="space-y-3 text-sm">
      <List title="Why we think so" items={d.evidence} />
      {d.links.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Add these internal links</h3>
          <table className="w-full text-sm"><thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted"><th className="py-1 pr-3">From page</th><th className="py-1 pr-3">Anchor text</th><th className="py-1">Where on that page</th></tr></thead>
            <tbody className="divide-y divide-hairline">{d.links.map((l, i) => <tr key={i}><td className="py-1 pr-3 align-top"><a href={l.from} target="_blank" rel="noreferrer" className="break-all hover:underline">{path(l.from)}</a></td><td className="py-1 pr-3 align-top font-medium">“{l.anchor}”</td><td className="py-1 align-top">{l.where}</td></tr>)}</tbody></table>
        </div>
      )}
      <List title="Content changes" items={d.content} />
      <List title="Technical fixes" items={d.technical} />
      <List title="After fixing" items={d.after} />
      <p className="text-xs text-muted">
        {d.facts.words ?? "–"} words · {d.facts.contentLinksIn} internal links in · {d.facts.impressions90} impressions in 90 days
        {d.facts.similar.filter((s) => s.overlap != null).map((s) => ` · ${s.overlap}% text overlap with ${path(s.url)}`).join("")}
        {" · "}Likely reasons from the live page, our crawl and Search Console; Google doesn&apos;t publish its exact reason. Diagnosed {d.at.slice(0, 10)} · {usd(d.cost)}.
      </p>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "border-foreground bg-foreground text-background" : "border-border text-secondary hover:bg-surface-muted")}>{children}</button>;
}
