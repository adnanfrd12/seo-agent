"use client";

import { useRef, useState, useTransition } from "react";
import { PlayCircle } from "lucide-react";
import { ExplainIssue } from "@/components/dashboard/explain-issue";
import { Legend, Panel, type StackKey } from "@/components/charts/ai-charts";
import type { Recording } from "@/lib/clarity/recordings";
import { loadPageRecordings } from "@/app/(dashboard)/clarity/actions";
import { cn } from "@/lib/utils";

export interface PageIssue { path: string; url: string; sessions: number; counts: Record<string, number>; total: number }
export type PageRec = Recording & { issues: string[] };
export interface PageError { message: string; count: number }
export interface ClickErr { element: string; count: number }
export interface ErrorMessage { message: string; count: number; pages: string[]; recs: Recording[] }
export interface ErrorMeta { fetchedAt: string | null; period: string | null; error?: string }

const nf = new Intl.NumberFormat("en-US");
const linkCls = "text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground";

/** Plain-language hint for the error messages browsers commonly report. */
export function errorHint(message: string): string | null {
  if (/^script error\.?$/i.test(message)) return "The browser hid the details because the failing script is loaded from another domain (a plugin, widget or tag). Adding crossorigin=\"anonymous\" to that script tag reveals the real message.";
  if (/ResizeObserver loop/i.test(message)) return "A browser warning from a layout script (sliders, menus). Usually harmless to visitors.";
  if (/is not a function|is not defined|undefined|null/i.test(message)) return "A script calls something that isn't loaded: often a jQuery or plugin conflict, or scripts loading in the wrong order.";
  return null;
}

function RecRow({ r, path }: { r: Recording & { issues?: string[] }; path?: string }) {
  const first = (() => { try { return new URL(r.url ?? "").pathname; } catch { return r.url ?? "(unknown page)"; } })();
  return (
    <li className="flex items-start gap-3 py-2.5">
      <a href={r.link} target="_blank" rel="noopener noreferrer" aria-label={`Watch recording from ${r.at ?? "unknown time"}`}
        className="mt-0.5 shrink-0 text-foreground hover:text-accent"><PlayCircle className="size-5" aria-hidden /></a>
      <div className="min-w-0 flex-1">
        <a href={r.link} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium hover:underline">
          {[r.at && `${r.at} UTC`, r.duration].filter(Boolean).join(" · ") || "Recording"}
        </a>
        <p className="truncate text-xs text-muted" title={(r.visited ?? [r.url ?? ""]).join(" → ")}>
          {[first !== path && `Starts on ${first}`, r.pages != null && `${r.pages} page${r.pages === 1 ? "" : "s"}`, r.clicks != null && `${r.clicks} clicks`, r.lcp && `LCP ${r.lcp}`].filter(Boolean).join(" · ")}
        </p>
        {r.issues && r.issues.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1">
            {r.issues.map((i) => <span key={i} className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-secondary">{i}</span>)}
          </p>
        )}
        {r.events.length > 0 && <p className="mt-0.5 truncate text-xs text-secondary" title={r.events.join(" · ")}>{r.events.join(" · ")}</p>}
      </div>
    </li>
  );
}

/**
 * The pages with the most errors and dead clicks as clickable bars; the selected page's error
 * messages, click errors and session recordings open beside it (below on small screens).
 */
export function PageIssues({ keys, pages, recs, jsErrors, clickErrors, messages, meta, range, canLoad }: {
  keys: StackKey[]; pages: PageIssue[]; recs: Record<string, PageRec[]>;
  jsErrors: Record<string, PageError[]>; clickErrors: Record<string, ClickErr[]>; messages: ErrorMessage[];
  meta: ErrorMeta | null; range: string; canLoad: boolean;
}) {
  const [selected, setSelected] = useState(pages[0]?.path ?? null);
  const [showAll, setShowAll] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, { recs: Recording[]; at: string } | { error: string }>>({});
  const [pending, start] = useTransition();
  const detail = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...pages.map((p) => p.total));
  const shown = showAll ? pages : pages.slice(0, 10);
  const page = pages.find((p) => p.path === selected) ?? null;

  const pick = (path: string) => {
    setSelected(path);
    // on one-column layouts the panel sits below the list
    if (typeof window !== "undefined" && window.innerWidth < 1024) setTimeout(() => detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const load = (p: PageIssue) => start(async () => {
    const r = await loadPageRecordings(p.url);
    setLoaded((o) => ({ ...o, [p.path]: r.ok ? { recs: r.recordings, at: r.fetchedAt } : { error: r.error } }));
  });

  const stored = page ? recs[page.path] ?? [] : [];
  const extra = page ? loaded[page.path] : undefined;
  const tagged = new Map(stored.map((r) => [r.link, r.issues]));
  const all: (Recording & { issues?: string[] })[] = extra && "recs" in extra
    ? [...stored, ...extra.recs.filter((r) => !tagged.has(r.link)).map((r) => ({ ...r, issues: r.events.some((e) => /dead click/i.test(e)) ? ["Dead clicks"] : r.events.some((e) => /rage click/i.test(e)) ? ["Rage clicks"] : [] }))]
    : stored;
  const errs = page ? jsErrors[page.path] ?? [] : [];
  const clicks = page ? clickErrors[page.path] ?? [] : [];

  return (
    <section aria-label="Problem pages" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Pages with the most errors and dead clicks" sub={`Friction events per page, ${range} · select a page to see its recordings`}
          right={<span className="text-xs text-muted">Events</span>}>
          <Legend items={keys} />
          <ul className="mt-4 space-y-1">
            {shown.map((p) => {
              const active = p.path === selected;
              return (
                <li key={p.path}>
                  <button type="button" onClick={() => pick(p.path)} aria-pressed={active}
                    className={cn("grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-surface-sunken sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]",
                      active && "bg-surface-sunken font-medium ring-1 ring-border-strong")}>
                    <span className="truncate" title={p.path}>{p.path}</span>
                    <span className="flex h-3.5 min-w-0 gap-[2px]" style={{ width: `${Math.max((p.total / max) * 100, 1.5)}%` }} aria-hidden>
                      {keys.map((k) => (p.counts[k.key] ?? 0) > 0 && (
                        <span key={k.key} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flexGrow: p.counts[k.key], flexBasis: 0, background: k.color }} />
                      ))}
                    </span>
                    <span className="text-right tabular-nums text-secondary">{nf.format(p.total)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {pages.length > 10 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className={cn("mt-3 self-start text-sm font-medium", linkCls)}>
              {showAll ? "Show top 10" : `Show all ${pages.length} pages`}
            </button>
          )}
        </Panel>

        <div ref={detail} className="min-w-0 scroll-mt-4">
          {page ? (
            <Panel title={page.path} sub={`${nf.format(page.sessions)} sessions · ${nf.format(page.total)} friction events, ${range}`}
              right={<a href={page.url} target="_blank" rel="noopener noreferrer" className={cn("text-xs", linkCls)}>Open page</a>}>
              <dl className="flex flex-wrap gap-2">
                {keys.filter((k) => (page.counts[k.key] ?? 0) > 0).map((k) => (
                  <div key={k.key} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
                    <span className="size-2 rounded-[2px]" style={{ background: k.color }} aria-hidden />
                    <dt className="text-secondary">{k.label}</dt><dd className="font-semibold tabular-nums">{nf.format(page.counts[k.key])}</dd>
                  </div>
                ))}
              </dl>

              <h4 className="mt-4 text-[13px] font-semibold">JavaScript errors on this page <span className="font-normal text-muted">· last 3 days</span></h4>
              {errs.length ? (
                <ul className="mt-1 divide-y divide-hairline">
                  {errs.map((e) => (
                    <li key={e.message} className="py-2 text-[13px]">
                      <div className="flex items-baseline justify-between gap-3"><ExplainIssue title={`JavaScript error on ${page.path}`} detail={`${e.message}
Seen ${e.count} times in the last 3 days.${errorHint(e.message) ? `
${errorHint(e.message)}` : ""}`} className="min-w-0 hover:text-accent"><code className="break-words font-mono text-[12px] underline decoration-border-strong decoration-dotted underline-offset-2">{e.message}</code></ExplainIssue><span className="shrink-0 tabular-nums text-secondary">{nf.format(e.count)}×</span></div>
                      {errorHint(e.message) && <p className="mt-0.5 text-xs text-muted">{errorHint(e.message)}</p>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-[13px] text-muted">{meta ? "None reported by Clarity for this page in the last 3 days." : "Error messages are pulled with the next daily Clarity sync."}</p>}

              {clicks.length > 0 && (
                <>
                  <h4 className="mt-4 text-[13px] font-semibold">Clicks that triggered an error</h4>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {clicks.map((c) => <li key={c.element} className="rounded-full border border-border px-2.5 py-1 text-xs">“{c.element || "(no text)"}” <span className="tabular-nums text-muted">{c.count}×</span></li>)}
                  </ul>
                </>
              )}

              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-[13px] font-semibold">Recordings <span className="font-normal text-muted">· {all.length}{extra && "recs" in extra ? " · every session loaded" : " with issues, last 30 days"}</span></h4>
                {canLoad && !(extra && "recs" in extra) && (
                  <button type="button" disabled={pending} onClick={() => load(page)}
                    className="rounded-lg border border-border bg-surface px-3 py-1 text-xs font-medium hover:bg-surface-sunken disabled:opacity-60">
                    {pending ? "Loading…" : "Load more from Clarity"}
                  </button>
                )}
              </div>
              {extra && "error" in extra && <p role="alert" className="mt-1 text-xs text-negative">{extra.error}</p>}
              {all.length ? (
                <ul className="mt-1 max-h-[28rem] divide-y divide-hairline overflow-y-auto pr-1">{all.map((r) => <RecRow key={r.link} r={r} path={page.path} />)}</ul>
              ) : <p className="mt-1 text-[13px] text-muted">No stored recording visited this page in the last 30 days.</p>}
              <p className="mt-3 text-xs text-muted">Tags are for the whole session; the timeline shows where each click happened. Recordings open in Clarity&apos;s player.</p>
            </Panel>
          ) : (
            <Panel title="Page details"><p className="text-sm text-muted">Select a page to see its errors and recordings.</p></Panel>
          )}
        </div>
      </div>

      <Panel title="JavaScript errors reported by Clarity" sub={meta?.period ? `Error messages ${meta.period.replace(/'/g, "")} (UTC)` : "Error messages from the last 3 days"}>
        {meta?.error && !messages.length && <p className="text-sm text-negative">Error details couldn’t be pulled: {meta.error}</p>}
        {!meta && <p className="text-sm text-muted">Error messages are pulled with the next daily Clarity sync.</p>}
        {messages.length > 0 && (
          <ul className="divide-y divide-hairline">
            {messages.map((m) => (
              <li key={m.message} className="grid grid-cols-1 gap-1 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <code className="break-words font-mono text-[12px] font-medium">{m.message}</code>
                  {errorHint(m.message) && <p className="text-xs text-muted">{errorHint(m.message)}</p>}
                  <p className="mt-0.5 text-xs text-secondary">
                    {m.pages.slice(0, 6).map((p, i) => <span key={p}>{i > 0 && ", "}<button type="button" onClick={() => pages.some((x) => x.path === p) && pick(p)} className={pages.some((x) => x.path === p) ? linkCls : ""}>{p}</button></span>)}
                    {m.pages.length > 6 && ` +${m.pages.length - 6} more`}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className="tabular-nums text-secondary">{nf.format(m.count)}×</span>
                  {m.recs.slice(0, 4).map((r) => (
                    <a key={r.link} href={r.link} target="_blank" rel="noopener noreferrer" aria-label={`Watch a recording with this error (${r.at ?? ""})`} title={`${r.at ?? ""} UTC`} className="text-foreground hover:text-accent">
                      <PlayCircle className="size-4" aria-hidden />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          Clarity shares each error&apos;s message, page and count, plus the text of clicks that triggered one. It doesn&apos;t share the script file, line or stack trace; a developer can see those in the browser console on the page.
        </p>
      </Panel>
    </section>
  );
}
