"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanSearch } from "lucide-react";
import { checkSiteAudit, runSiteAudit } from "@/app/(dashboard)/site-audit/actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";
const field = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent";
const SIZES = [50, 150, 300, 500];
const cost = (n: number) => `$${(n * 0.00015 + 0.002).toFixed(3)}`;

/** Starts a crawl. Costs a fraction of a cent per page; the estimate is shown next to the choice. */
export function AuditRun({ canEdit, busy, hasResult }: { canEdit: boolean; busy: boolean; hasResult: boolean }) {
  const router = useRouter();
  const [pages, setPages] = useState(150);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return <p className="text-xs text-muted">Only owners and admins can start an audit.</p>;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Pages to crawl
          <select className={`${field} mt-1 block`} value={pages} onChange={(e) => setPages(Number(e.target.value))} disabled={pending || busy}>
            {SIZES.map((n) => <option key={n} value={n}>{n} pages (≈{cost(n)})</option>)}
          </select>
        </label>
        <button className={btn} disabled={pending || busy} onClick={() => start(async () => {
          setMsg(null);
          const r = await runSiteAudit(pages);
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          router.refresh();
        })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />} {hasResult ? "Run a new audit" : "Run first audit"}
        </button>
      </div>
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
    <div role="status" className="rounded-xl border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><Loader2 className="size-4 animate-spin" aria-hidden /> Crawling the website… {now.crawled} of up to {now.max} pages</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="mt-2 text-xs text-muted">This takes a few minutes and you can leave the page: the results are stored when the crawl finishes.</p>
    </div>
  );
}
