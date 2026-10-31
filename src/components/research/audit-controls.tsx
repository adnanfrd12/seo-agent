"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gauge, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { checkSiteAudit, refreshCruxNow, runLighthouseNow, runSiteAudit } from "@/app/(dashboard)/site-audit/actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const field = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SIZES = [50, 150, 300, 500];
// per-page DataForSEO prices for each crawl mode (mirrors RENDER_MODES in lib/dataforseo/audit.ts)
const MODES = [
  { key: "html", label: "HTML only", perPage: 0.00015, note: "reads the server's HTML; cheapest" },
  { key: "js", label: "Render JavaScript", perPage: 0.0015, note: "runs scripts first, so content and links built by JavaScript are seen (10x the price)" },
  { key: "browser", label: "Full browser rendering", perPage: 0.0051, note: "a real browser with images and styles, plus Core Web Vitals per page (34x)" },
] as const;
const cost = (n: number, perPage = 0.00015) => `$${(n * perPage + 0.002).toFixed(3)}`;

/** Starts a crawl. Costs a fraction of a cent per page; the estimate is shown next to the choice. */
export function AuditRun({ canEdit, busy, hasResult, mode: savedMode = "html" }: { canEdit: boolean; busy: boolean; hasResult: boolean; mode?: string }) {
  const router = useRouter();
  const [pages, setPages] = useState(150);
  const [mode, setMode] = useState(savedMode);
  const m = MODES.find((x) => x.key === mode) ?? MODES[0];
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return <p className="text-xs text-muted">Only owners and admins can start an audit.</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Pages to crawl
          <select className={`${field} mt-1 block`} value={pages} onChange={(e) => setPages(Number(e.target.value))} disabled={pending || busy}>
            {SIZES.map((n) => <option key={n} value={n}>{n} pages (≈{cost(n, m.perPage)})</option>)}
          </select>
        </label>
        <label className="text-sm">Crawl mode
          <select className={`${field} mt-1 block max-w-full`} value={mode} onChange={(e) => setMode(e.target.value)} disabled={pending || busy}>
            {MODES.map((x) => <option key={x.key} value={x.key}>{x.label} (${x.perPage} a page)</option>)}
          </select>
        </label>
        <button className={btn} disabled={pending || busy} onClick={() => start(async () => {
          setMsg(null);
          const r = await runSiteAudit(pages, mode);
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          router.refresh();
        })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />} {hasResult ? "Run a new audit" : "Run first audit"}
        </button>
      </div>
      <p className="text-xs text-muted">{m.label}: {m.note}. The weekly automatic audit uses the mode you run last.</p>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>}
    </div>
  );
}

/** Shown while a crawl runs: asks for progress every 15 seconds (free) and reloads the page when it finishes. */
export function AuditProgress({ crawled, max }: { crawled: number; max: number }) {
  const router = useRouter();
  const [now, setNow] = useState({ crawled, max });
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const s = await checkSiteAudit();
      if (!live) return;
      if (s.state === "crawling") setNow({ crawled: s.crawled, max: s.max });
      else { router.refresh(); }
    };
    const t = setInterval(tick, 15_000);
    void tick();
    return () => { live = false; clearInterval(t); };
  }, [router]);
  const pct = Math.min(100, Math.round((now.crawled / Math.max(now.max, 1)) * 100));
  return (
    <div role="status" className="rounded-[10px] border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><Loader2 className="size-4 animate-spin" aria-hidden /> Crawling the website… {now.crawled} of up to {now.max} pages</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="mt-2 text-xs text-muted">This takes a few minutes and you can leave the page: the results are stored when the crawl finishes.</p>
    </div>
  );
}

/** Runs Lighthouse on 1-3 pages, mobile and desktop (half a cent per page per device). */
export function LighthouseRun({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [pages, setPages] = useState(3);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Pages to test
          <select className={`${field} mt-1 block`} value={pages} onChange={(e) => setPages(Number(e.target.value))} disabled={pending}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? "Home page" : `Home + ${n - 1} top page${n > 2 ? "s" : ""}`} (≈${(n * 2 * 0.005).toFixed(2)})</option>)}
          </select>
        </label>
        <button className={btn} disabled={pending} onClick={() => start(async () => {
          setMsg(null);
          const r = await runLighthouseNow(pages);
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          router.refresh();
        })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Gauge className="size-4" />} Run Lighthouse
        </button>
      </div>
      {pending && <p className="text-xs text-muted">Testing each page on mobile and desktop. This can take up to two minutes.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>}
    </div>
  );
}

/** Re-reads Google's real-user data (Chrome UX Report) for the tested pages. Free. */
export function CruxRefresh({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return null;
  return (
    <div className="space-y-1.5">
      <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60" disabled={pending} onClick={() => start(async () => {
        setMsg(null);
        const r = await refreshCruxNow();
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
        router.refresh();
      })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh real-user data <span className="opacity-70">(free)</span>
      </button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`max-w-md break-words text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </div>
  );
}
