"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { runFanoutAction } from "@/app/(dashboard)/fan-out-queries/actions";
import { Tabs } from "@/components/research/tabs";
import type { PageOption, PageSource } from "@/lib/fanout/pages";
import { estimate, MAX_KEYWORDS, MAX_PAGES, MODE_LABEL, parseKeywords, usd, type FanoutMode } from "@/lib/fanout/shared";
import { cn } from "@/lib/utils";

const SRC: Record<PageSource, string> = { crawl: "Crawl", blog: "Blog", gsc: "Search Console" };
const input = "h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm";
const path = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/ (home)" : `${x.pathname}${x.search}`; } catch { return u; } };

/** Owner/admin controls: one keyword, a pasted list, or pages of the site. Shows the cost before anything runs. */
export function FanoutRunner({ canEdit, pages, domain }: { canEdit: boolean; pages: PageOption[]; domain: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"one" | "bulk" | "pages">("one");
  const [one, setOne] = useState("");
  const [bulk, setBulk] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<FanoutMode>("ai_mode");
  const [volume, setVolume] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const bulkList = useMemo(() => parseKeywords(bulk), [bulk]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (f ? pages.filter((p) => p.url.toLowerCase().includes(f) || (p.title ?? "").toLowerCase().includes(f)) : pages).slice(0, 150);
  }, [pages, filter]);

  if (!canEdit) return <p className="text-xs text-muted">Only owners and admins can run fan-out queries. Everyone can view the results below.</p>;

  const items = tab === "one" ? parseKeywords(one).slice(0, 1) : tab === "bulk" ? bulkList : picked;
  const kind = tab === "pages" ? "pages" : "keywords";
  const max = kind === "pages" ? MAX_PAGES : MAX_KEYWORDS;
  const est = estimate(kind, items.length, mode, volume);
  const label = tab === "one" ? "Get fan-out queries" : tab === "bulk" ? "Import fan-out queries" : "Fetch from pages";
  const wait = kind === "pages" ? `Reading ${items.length} page${items.length === 1 ? "" : "s"} and checking coverage. About ${Math.ceil(items.length / 3) * 40} seconds.` : `Generating for ${items.length} keyword${items.length === 1 ? "" : "s"}. About ${Math.ceil(items.length / 4) * 25} seconds.`;

  const toggle = (url: string) => setPicked((p) => (p.includes(url) ? p.filter((x) => x !== url) : p.length >= MAX_PAGES ? p : [...p, url]));
  const addExtra = () => {
    const raw = extra.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${domain}${raw.startsWith("/") ? "" : "/"}${raw}`;
    if (!picked.includes(url) && picked.length < MAX_PAGES) setPicked([...picked, url]);
    setExtra("");
  };
  const run = () => start(async () => {
    setMsg(null);
    const r = await runFanoutAction({ kind, items, mode, volume });
    if (r.ok) { setMsg({ ok: true, text: r.message }); router.push(`/fan-out-queries?run=${r.runId}`); router.refresh(); }
    else setMsg({ ok: false, text: r.error });
  });

  return (
    <section className="mb-5 rounded-[10px] border border-border bg-surface p-4 sm:p-5" aria-label="Run fan-out queries">
      <Tabs label="Input" onChange={(k) => setTab(k as typeof tab)} items={[
        {
          key: "one", label: "One keyword", content: (
            <label className="block max-w-xl"><span className="mb-1 block text-xs text-muted">Keyword</span>
              <input value={one} onChange={(e) => setOne(e.target.value)} placeholder="e.g. custom led signs for business" className={input}
                onKeyDown={(e) => { if (e.key === "Enter" && items.length && !pending) { e.preventDefault(); run(); } }} /></label>
          ),
        },
        {
          key: "bulk", label: "Bulk", badge: bulkList.length || undefined, content: (
            <label className="block max-w-xl"><span className="mb-1 block text-xs text-muted">Keywords, one per line (up to {MAX_KEYWORDS})</span>
              <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6} placeholder={"channel letter signs\nled sign repair\nmonument signs cost"}
                className="w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm" />
              {bulkList.length > MAX_KEYWORDS && <span className="mt-1 block text-xs text-negative">{bulkList.length} keywords: remove {bulkList.length - MAX_KEYWORDS} to run.</span>}
            </label>
          ),
        },
        {
          key: "pages", label: "From pages", badge: picked.length || undefined, content: (
            <div className="space-y-2">
              <p className="text-xs text-muted">Pick up to {MAX_PAGES} pages. Each page is read and checked against the fan-out queries for its main topic.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${pages.length} pages`} className={cn(input, "sm:max-w-xs")} />
                <div className="flex min-w-0 flex-1 gap-2">
                  <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={`Or add a URL on ${domain}`} className={input}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }} />
                  <button type="button" onClick={addExtra} className="h-9 shrink-0 rounded-md border border-border-strong px-3 text-sm text-secondary hover:bg-surface-muted hover:text-foreground">Add</button>
                </div>
              </div>
              {picked.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {picked.map((u) => <li key={u}><button type="button" onClick={() => toggle(u)} title="Remove" className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-secondary hover:text-foreground">{path(u)} ×</button></li>)}
                </ul>
              )}
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                {shown.length ? (
                  <ul className="divide-y divide-border">
                    {shown.map((p) => (
                      <li key={p.url}>
                        <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 text-sm hover:bg-surface-muted">
                          <input type="checkbox" className="mt-1" checked={picked.includes(p.url)} onChange={() => toggle(p.url)} disabled={!picked.includes(p.url) && picked.length >= MAX_PAGES} />
                          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.title ?? path(p.url)}</span><span className="block truncate text-xs text-muted">{path(p.url)}</span></span>
                          <span className="hidden shrink-0 text-xs text-muted sm:block">{p.sources.map((s) => SRC[s]).join(" · ")}{p.impressions > 0 && ` · ${p.impressions.toLocaleString()} impr.`}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-3 py-6 text-center text-sm text-muted">{pages.length ? "No page matches." : "No stored pages yet. Run a Site Audit, sync the blog or connect Search Console, or add a URL above."}</p>}
              </div>
            </div>
          ),
        },
      ]} />

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex items-center gap-2 text-sm"><span className="text-muted">Depth</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as FanoutMode)} className="h-9 rounded-md border border-border-strong bg-surface px-2 text-sm">
            {(Object.keys(MODE_LABEL) as FanoutMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={volume} onChange={(e) => setVolume(e.target.checked)} /> Search volume (DataForSEO)</label>
        <div className="flex flex-col gap-1 sm:ml-auto sm:items-end">
          <button type="button" onClick={run} disabled={pending || !items.length || items.length > max}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {label}
            {items.length > 0 && <span className="opacity-70">(about {usd(est.total)})</span>}
          </button>
          {items.length > 0 && <span className="text-xs text-muted">Claude ~{usd(est.ai)}{volume && <> · volumes up to ~{usd(est.volume)} (cached ones are free)</>}</span>}
        </div>
      </div>
      {pending && <p className="mt-2 text-xs text-muted">{wait}</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={cn("mt-2 max-w-2xl break-words text-sm", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>}
    </section>
  );
}
