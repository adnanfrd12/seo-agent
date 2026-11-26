"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, ChevronRight, Copy, ImageIcon, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { fixAuditIssue, loadAuditDetail, suggestAltText, type DetailResponse } from "@/app/(dashboard)/site-audit/detail-actions";
import { dialogBtn } from "@/components/dashboard/dialog";
import { ResearchTable } from "@/components/research/research-table";
import type { AuditDetail, ImageRow } from "@/lib/audit/details";
import { ALT_BATCH, AI_FIX_MAX_ITEMS, estimateAltCost, estimateFixCost, howTo } from "@/lib/audit/guide";
import { cn } from "@/lib/utils";

const link = "break-all underline decoration-border-strong underline-offset-2 hover:text-foreground hover:decoration-foreground";
const shortUrl = (u: string) => { try { const x = new URL(u); return `${x.pathname}${x.search}` || "/"; } catch { return u; } };

/** Wide modal on the native <dialog> (same look as the app's Dialog, sized for tables). */
function Panel({ open, onClose, title, sub, children }: { open: boolean; onClose: () => void; title: React.ReactNode; sub?: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={`${id}-t`} onCancel={(e) => { e.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
      className="app-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[72rem] overflow-y-auto rounded-xl border border-border bg-surface p-0 text-foreground shadow-[0_24px_64px_-20px_rgb(0_0_0/0.45)] backdrop:bg-black/40 dark:backdrop:bg-black/65">
      {open && (
        <>
          <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-hairline bg-surface px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id={`${id}-t`} className="text-[17px] font-semibold leading-snug">{title}</h2>
              {sub && <div className="mt-0.5 text-sm text-secondary">{sub}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-5 px-5 py-4 text-sm">{children}</div>
        </>
      )}
    </dialog>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label="Copy" title="Copy" className="inline-grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground"
      onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Groups({ d }: { d: AuditDetail }) {
  const groups = d.groups ?? [];
  if (!groups.length) return <p className="rounded-[10px] border border-dashed border-border p-4 text-muted">No groups found in this crawl.</p>;
  return (
    <ul className="space-y-2">
      {groups.map((g, i) => (
        <li key={i}>
          <details className="rounded-[10px] border border-border bg-surface" open={i < 3}>
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0 break-words font-medium">{g.label}</span>
              <span className="shrink-0 tabular-nums text-muted">{g.pages.length} pages</span>
            </summary>
            <ul className="space-y-1 border-t border-border px-4 py-3 text-[13px]">
              {g.pages.map((p) => (
                <li key={p.url} className="flex flex-wrap items-baseline gap-x-2">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className={link}>{p.url}</a>
                  {p.title && d.key.includes("content") && <span className="text-muted">{p.title}</span>}
                  {p.similarity != null && p.similarity > 0 && <span className="text-xs text-faint">similarity {p.similarity}/10</span>}
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Images({ d }: { d: AuditDetail }) {
  const imgs = d.images ?? [];
  const field = d.key === "no_image_alt" ? "alt" : "title";
  if (!imgs.length) return <p className="rounded-[10px] border border-dashed border-border p-4 text-muted">No image without {field === "alt" ? "alt text" : "a title"} was found in the pages read. The crawler may have counted images added by scripts or empty decorative alt attributes.</p>;
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border">
      <table className="w-full min-w-[52rem] text-[13px]">
        <thead className="bg-surface-sunken text-left text-xs text-muted">
          <tr><th className="px-3 py-2 font-medium">Image</th><th className="px-3 py-2 font-medium">Image URL · pages</th><th className="px-3 py-2 font-medium">Current alt / title</th><th className="px-3 py-2 font-medium">AI suggestion</th></tr>
        </thead>
        <tbody>
          {imgs.map((im: ImageRow) => {
            const s = d.alt?.[im.src];
            return (
              <tr key={im.src} className="border-t border-hairline align-top">
                <td className="px-3 py-2">
                  <a href={im.src} target="_blank" rel="noopener noreferrer" title="Open image" className="block size-16 overflow-hidden rounded-md border border-border bg-surface-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- external images of the audited site */}
                    <img src={im.src} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain" />
                  </a>
                </td>
                <td className="max-w-[22rem] px-3 py-2">
                  <a href={im.src} target="_blank" rel="noopener noreferrer" className={link}>{shortUrl(im.src)}</a>
                  <p className="mt-1 text-xs text-muted">On {im.pages.length} page{im.pages.length === 1 ? "" : "s"}:</p>
                  <ul className="text-xs">
                    {im.pages.slice(0, 3).map((p) => <li key={p}><a href={p} target="_blank" rel="noopener noreferrer" className={link}>{shortUrl(p)}</a></li>)}
                    {im.pages.length > 3 && <li className="text-faint">+{im.pages.length - 3} more</li>}
                  </ul>
                </td>
                <td className="px-3 py-2 text-xs">
                  <p><span className="text-muted">alt:</span> {im.alt === null ? <span className="text-negative">missing</span> : im.alt === "" ? <span className="text-warn">empty</span> : im.alt}</p>
                  <p><span className="text-muted">title:</span> {im.title ? im.title : <span className="text-faint">none</span>}</p>
                </td>
                <td className="px-3 py-2 text-xs">
                  {s ? (
                    <>
                      <p className="flex items-start gap-1"><span className="min-w-0 flex-1"><span className="text-muted">alt:</span> {s.alt || <span className="text-faint">(decorative: alt=&quot;&quot;)</span>}</span><CopyBtn text={s.alt} /></p>
                      <p className="flex items-start gap-1"><span className="min-w-0 flex-1"><span className="text-muted">title:</span> {s.title}</span><CopyBtn text={s.title} /></p>
                    </>
                  ) : d.altSkipped?.includes(im.src) ? <span className="text-faint">Couldn&apos;t be read (type or size)</span> : <span className="text-faint">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AiFixes({ d }: { d: AuditDetail }) {
  if (!d.ai) return null;
  return (
    <div className="space-y-2">
      <p className="text-secondary">{d.ai.summary}</p>
      <ul className="space-y-2">
        {d.ai.fixes.map((f, i) => (
          <li key={i} className="rounded-[10px] border border-border bg-surface p-3">
            <p className="break-all text-xs text-muted">{/^https?:\/\//.test(f.target) ? <a href={f.target} target="_blank" rel="noopener noreferrer" className={link}>{f.target}</a> : f.target}</p>
            <p className="mt-1 font-medium">{f.action}</p>
            {f.value && (
              <div className="mt-1.5 flex items-start gap-1 rounded-md bg-surface-sunken px-2.5 py-1.5 font-mono text-[12.5px]">
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{f.value}</span><CopyBtn text={f.value} />
              </div>
            )}
            <p className="mt-1 text-xs text-muted">{f.why}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-faint">Written by Claude {d.ai.at.slice(0, 10)} · ${d.ai.cost.toFixed(3)}. Check each fix before applying it.</p>
    </div>
  );
}

export interface PanelIssue { key: string; label: string; count?: number | null; why?: string; fix?: string; severity?: "error" | "warning" | "notice" }

/**
 * The detail panel for one issue or metric: what is affected (URLs, links, groups, images), how to fix it,
 * and Claude's fixes. Opens from DetailTrigger; data loads on first open and is stored for next time.
 */
export function DetailPanel({ issue, open, onClose, canEdit }: { issue: PanelIssue; open: boolean; onClose: () => void; canEdit: boolean }) {
  const [res, setRes] = useState<DetailResponse | null>(null);
  const [loading, startLoad] = useTransition();
  const [aiBusy, startAi] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = (force = false) => startLoad(async () => { setMsg(null); setRes(await loadAuditDetail(issue.key, force)); });
  useEffect(() => { if (open && !res) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = res?.ok ? res.detail : null;
  const steps = howTo(issue.key);
  const items = d ? (d.kind === "groups" ? d.groups?.length ?? 0 : d.kind === "images" ? 0 : d.rows.length) : 0;
  const altLeft = d?.images ? d.images.filter((i) => !d.alt?.[i.src] && !d.altSkipped?.includes(i.src) && !/\.(svg|avif|ico|bmp|tiff?)(\?|$)/i.test(i.src)).length : 0;
  const runAi = (fn: () => Promise<{ ok: true; detail: AuditDetail; message: string } | { ok: false; error: string }>) => startAi(async () => {
    setMsg(null);
    const r = await fn();
    if (r.ok) { setRes({ ok: true, detail: r.detail, fromCache: true }); setMsg({ ok: true, text: r.message }); } else setMsg({ ok: false, text: r.error });
  });

  return (
    <Panel open={open} onClose={onClose} title={issue.label}
      sub={<>{issue.count != null && <span className="tabular-nums">{issue.count.toLocaleString("en-US")} affected · </span>}{d ? `read from the crawl ${d.fetchedAt.slice(0, 10)}` : "loading from the crawl"}</>}>
      {(issue.why || steps.length > 0 || issue.fix) && (
        <section aria-label="How to fix" className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {issue.why && <div><h3 className="mb-1 font-semibold">Why it matters</h3><p className="text-secondary">{issue.why}</p></div>}
          <div>
            <h3 className="mb-1 font-semibold">How to fix</h3>
            {steps.length ? <ol className="list-decimal space-y-0.5 pl-5 text-secondary">{steps.map((s) => <li key={s}>{s}</li>)}</ol> : <p className="text-secondary">{issue.fix}</p>}
          </div>
        </section>
      )}

      {loading && !d && <p className="flex items-center gap-2 text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Reading the affected {issue.key.includes("image") ? "pages and images (up to a minute)" : "URLs"}…</p>}
      {res && !res.ok && (
        <div className="space-y-2">
          <p role="alert" className="rounded-[10px] border border-negative/40 bg-negative/10 p-3 text-negative">{res.error}</p>
          {res.sample?.length ? <ul className="space-y-0.5 text-xs">{res.sample.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer" className={link}>{u}</a></li>)}</ul> : null}
        </div>
      )}

      {d && (
        <>
          {canEdit && (d.kind === "images" ? (d.images?.length ?? 0) > 0 : items > 0) && (
            <section aria-label="AI" className="rounded-[10px] border border-border bg-surface-sunken p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 font-semibold"><Sparkles className="size-4 text-accent" aria-hidden /> {d.kind === "images" ? `AI ${d.key === "no_image_alt" ? "alt text" : "titles"} for each image` : "Fix with AI"}</h3>
                  <p className="text-xs text-muted">
                    {d.kind === "images"
                      ? altLeft ? `Claude looks at the next ${Math.min(ALT_BATCH, altLeft)} image${Math.min(ALT_BATCH, altLeft) === 1 ? "" : "s"} and writes alt text and a title. About $${estimateAltCost(Math.min(ALT_BATCH, altLeft)).toFixed(2)}; ${altLeft} without a suggestion.` : "Every listed image has a suggestion."
                      : `Claude writes the exact fix for ${Math.min(items, AI_FIX_MAX_ITEMS)} ${d.kind === "groups" ? "group" : "item"}${Math.min(items, AI_FIX_MAX_ITEMS) === 1 ? "" : "s"}${items > AI_FIX_MAX_ITEMS ? ` (first ${AI_FIX_MAX_ITEMS} of ${items})` : ""}. About $${estimateFixCost(items).toFixed(2)} from the monthly Claude budget.`}
                  </p>
                </div>
                <button type="button" className={dialogBtn.primary} disabled={aiBusy || (d.kind === "images" && !altLeft)}
                  onClick={() => runAi(() => (d.kind === "images" ? suggestAltText(d.key) : fixAuditIssue(d.key)))}>
                  {aiBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : d.kind === "images" ? <ImageIcon className="size-4" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                  {d.kind === "images" ? "Suggest with AI" : d.ai ? "Write fixes again" : "Fix with AI"}
                </button>
              </div>
              {msg && <p role={msg.ok ? "status" : "alert"} className={cn("mt-2", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
              {d.kind !== "images" && d.ai && <div className="mt-3"><AiFixes d={d} /></div>}
            </section>
          )}
          {!canEdit && d.ai && <section aria-label="AI fixes"><h3 className="mb-2 font-semibold">AI fixes</h3><AiFixes d={d} /></section>}

          <section aria-label="Affected" className="space-y-2">
            {d.note && <p className="text-xs text-muted">{d.note}</p>}
            {d.kind === "groups" ? <Groups d={d} /> : d.kind === "images" ? <Images d={d} /> : (
              <ResearchTable title={`Affected ${d.kind === "links" ? "links" : d.kind === "errors" ? "HTML errors" : "pages"} (${d.total.toLocaleString("en-US")})`} rows={d.rows} columns={d.columns}
                searchKeys={d.columns.filter((c) => !c.type || c.type === "url" || c.type === "badge").map((c) => c.key)} pageSize={20} csvName={`audit-${d.key}`} empty="Nothing affected in this crawl." />
            )}
          </section>
          <p className="flex flex-wrap items-center gap-2 text-xs text-faint">
            {res?.ok && res.fromCache ? "Stored" : "Read"} {d.fetchedAt.slice(0, 16).replace("T", " ")} UTC{d.cost > 0 ? ` · $${d.cost.toFixed(4)}` : " · free"}
            {canEdit && <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline" disabled={loading} onClick={() => load(true)}><RefreshCw className={cn("size-3", loading && "animate-spin")} aria-hidden /> Read again</button>}
          </p>
        </>
      )}
    </Panel>
  );
}

/** Wraps any issue row or number so that clicking it opens its detail panel. */
export function DetailTrigger({ issue, canEdit, className, children, ariaLabel }: { issue: PanelIssue; canEdit: boolean; className?: string; children: React.ReactNode; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={cn("text-left", className)} aria-label={ariaLabel ?? `Show what is affected: ${issue.label}`} onClick={() => setOpen(true)}>{children}</button>
      <DetailPanel issue={issue} open={open} onClose={() => setOpen(false)} canEdit={canEdit} />
    </>
  );
}

/** One issue row in the Errors / Warnings / Notices lists. */
export function IssueRow({ issue, canEdit }: { issue: PanelIssue & { count: number; urls: string[] }; canEdit: boolean }) {
  return (
    <DetailTrigger issue={issue} canEdit={canEdit} className="group flex w-full flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border bg-surface px-4 py-2.5 text-sm transition hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent">
      <span className="font-medium">{issue.label}</span>
      <span className="flex items-center gap-1.5 tabular-nums text-muted">{issue.count.toLocaleString("en-US")} page{issue.count > 1 ? "s" : ""}<ChevronRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
    </DetailTrigger>
  );
}

/** A number in the links/duplicates box that opens its list. */
export function MetricValue({ issue, value, canEdit }: { issue: PanelIssue; value: string; canEdit: boolean }) {
  return (
    <DetailTrigger issue={issue} canEdit={canEdit} className="inline-flex items-center gap-1 tabular-nums underline decoration-border-strong decoration-dotted underline-offset-2 hover:text-accent">
      {value}<ChevronRight className="size-3 opacity-60" aria-hidden />
    </DetailTrigger>
  );
}
