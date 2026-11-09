"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, ScanSearch } from "lucide-react";
import { runSiteScanNow } from "@/lib/toolkit/scan-actions";

/** Owner button for the free site scan behind the drift, AI readiness, image, hreflang and planner tools. */
export function ScanRun({ canEdit, allowReset = false }: { canEdit: boolean; allowReset?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return null;
  const run = (reset: boolean) => start(async () => {
    if (reset && !window.confirm("Start a new baseline? Today's pages become the reference; the change log is kept.")) return;
    setMsg(null);
    const r = await runSiteScanNow(reset);
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    router.refresh();
  });
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        <button className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60" disabled={pending} onClick={() => run(false)}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />} Scan website now <span className="opacity-70">(free)</span>
        </button>
        {allowReset && (
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60" disabled={pending} onClick={() => run(true)}>
            <RotateCcw className="size-4" /> Reset baseline
          </button>
        )}
      </div>
      {pending && <p className="text-xs text-muted">Reading up to 25 key pages, robots.txt, llms.txt and image sizes. One to three minutes.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`max-w-md break-words text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </div>
  );
}
