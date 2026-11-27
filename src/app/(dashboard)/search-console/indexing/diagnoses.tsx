"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Tag } from "@/components/ga4x/table";
import type { IndexDiagnosis } from "@/lib/gscx/indexing-ai";
import { cn } from "@/lib/utils";
import { diagnoseIndexPage } from "../gscx-actions";

export interface DiagRow { url: string; path: string; reason: string; impr: number; last: string; linksIn: number }
const usd = (v: number) => `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`;
const path = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60";

/**
 * Pages Google hasn't indexed, with Claude's possible issue and recommended solution for each. Owners and admins run
 * diagnoses (one page, the selected pages or all not yet diagnosed) with the cost shown first; everyone reads stored ones.
 */
export function IndexDiagnoses({ rows, stored, canRun, est, site }: { rows: DiagRow[]; stored: Record<string, IndexDiagnosis>; canRun: boolean; est: number; site?: string }) {
  const router = useRouter();
  const [diags, setDiags] = useState(stored);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [lim, setLim] = useState(25);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const running = busy.size > 0;

  const reasons = [...rows.reduce((m, r) => m.set(r.reason, (m.get(r.reason) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const shown = rows.filter((r) => !reason || r.reason === reason);
  const todo = shown.filter((r) => !diags[r.url]);
  const selList = [...sel].filter((u) => rows.some((r) => r.url === u));

  async function run(urls: string[], again: boolean) {
    if (!urls.length) return;
    if (urls.length > 1 && !window.confirm(`Diagnose ${urls.length} pages with Claude? Estimated cost about ${usd(est * urls.length)} (${usd(est)} a page), taken from the monthly Claude budget.`)) return;
    setMsg(null);
    let done = 0, spent = 0, stop: string | null = null;
    const queue = [...urls];
    const worker = async () => {
      while (queue.length && !stop) {
        const u = queue.shift()!;
        setBusy((b) => new Set(b).add(u));
        const r = await diagnoseIndexPage(u, again).catch(() => ({ ok: false, message: "The request failed. Try again.", stop: false, diagnosis: undefined }));
        setBusy((b) => { const n = new Set(b); n.delete(u); return n; });
        if (r.ok && r.diagnosis) {
          const d = r.diagnosis; done++; if (r.message !== "Already diagnosed.") spent += d.cost;
          setDiags((o) => ({ ...o, [u]: d })); setErrs((o) => { const n = { ...o }; delete n[u]; return n; });
        } else {
          setErrs((o) => ({ ...o, [u]: r.message }));
          if ("stop" in r && r.stop) stop = r.message;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
    setSel(new Set());
    setMsg(stop ? { ok: false, text: `${done ? `${done} diagnosed (${usd(spent)}), then stopped: ` : ""}${stop}` } : { ok: done === urls.length, text: `${done} of ${urls.length} diagnosed${spent ? ` · ${usd(spent)}` : ""}.` });
    router.refresh();
  }

  const toggle = (u: string) => setSel((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; });
  const allOn = shown.length > 0 && shown.slice(0, lim).every((r) => sel.has(r.url));

  return (
    <div>
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-faint">Reason</span>
          <Chip on={!reason} onClick={() => setReason(null)}>All</Chip>
          {reasons.slice(0, 14).map(([k, n]) => <Chip key={k} on={reason === k} onClick={() => setReason(k)}>{k} <b className="ml-0.5 tabular-nums text-faint">{n}</b></Chip>)}
        </div>
        {canRun ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} disabled={running || !selList.length} onClick={() => run(selList, false)}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Diagnose selected ({selList.length}) · about {usd(est * selList.filter((u) => !diags[u]).length)}
            </button>
            <button type="button" className={btn} disabled={running || !todo.length} onClick={() => run(todo.map((r) => r.url), false)}>
              Diagnose all not yet diagnosed ({todo.length}) · about {usd(est * todo.length)}
            </button>
            <span className="text-xs text-muted">Claude Sonnet · about {usd(est)} a page · stored, so it isn&apos;t paid again.</span>
          </div>
        ) : <p className="text-xs text-muted">An owner or admin runs diagnoses; stored ones show here for everyone.</p>}
        {msg && <p role="status" className={cn("text-xs", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-hairline">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              {canRun && <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all shown" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.slice(0, lim).map((r) => r.url)))} /></th>}
              <th className="px-3 py-2">URL</th><th className="px-3 py-2">Google&apos;s reason</th><th className="px-3 py-2 text-right">Links in</th>
              <th className="px-3 py-2">Possible issue</th><th className="px-3 py-2">Recommended solution</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {shown.slice(0, lim).map((r) => {
              const d = diags[r.url], b = busy.has(r.url), e = errs[r.url];
              return (
                <Fragment key={r.url}>
                  <tr className="hover:bg-surface-sunken">
                    {canRun && <td className="px-3 py-2 align-top"><input type="checkbox" aria-label={`Select ${r.path}`} checked={sel.has(r.url)} onChange={() => toggle(r.url)} /></td>}
                    <td className="min-w-[12rem] max-w-[18rem] px-3 py-2 align-top">{site ? <a href={r.url} target="_blank" rel="noreferrer" className="break-all hover:underline">{r.path}</a> : <span className="break-all">{r.path}</span>}<div className="text-[11px] text-faint">Last crawl {r.last} · {r.impr} impr. 28d</div></td>
                    <td className="min-w-[10rem] px-3 py-2 align-top text-secondary">{r.reason}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">{r.linksIn}</td>
                    <td className="min-w-[16rem] px-3 py-2 align-top">{d ? <>{d.issue} <Tag tone={d.confidence === "High" ? "bad" : d.confidence === "Medium" ? "warn" : "mute"}>{d.confidence} confidence</Tag></> : e ? <span className="text-negative">{e}</span> : <span className="text-faint">Not diagnosed yet</span>}</td>
                    <td className="min-w-[16rem] px-3 py-2 align-top">{d ? d.solution : <span className="text-faint">–</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                      {d && <button type="button" className="mr-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-muted" aria-expanded={open === r.url} onClick={() => setOpen(open === r.url ? null : r.url)}>{open === r.url ? "Hide" : "Details"}</button>}
                      {canRun && <button type="button" disabled={b || running} title={`About ${usd(est)}`} className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-muted disabled:opacity-60" onClick={() => run([r.url], !!d)}>
                        {b ? <Loader2 className="inline size-3.5 animate-spin" /> : d ? `Re-run · ${usd(est)}` : `Diagnose · ${usd(est)}`}
                      </button>}
                    </td>
                  </tr>
                  {d && open === r.url && (
                    <tr><td colSpan={canRun ? 7 : 6} className="bg-surface-sunken px-4 py-3"><Details d={d} /></td></tr>
                  )}
                </Fragment>
              );
            })}
            {!shown.length && <tr><td colSpan={canRun ? 7 : 6} className="px-3 py-6 text-center text-sm text-muted">Every inspected page is on Google.</td></tr>}
          </tbody>
        </table>
      </div>
      {shown.length > lim && <p className="mt-2 text-xs text-muted">Showing {lim} of {shown.length} pages. <button type="button" className="ml-1 rounded border border-border px-1.5 py-0.5 hover:bg-surface-muted" onClick={() => setLim(1e9)}>Show all</button></p>}
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
