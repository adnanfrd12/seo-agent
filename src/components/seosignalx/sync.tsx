"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { syncSeoSignalX } from "@/app/(dashboard)/seosignalx/actions";

/** "Synced … ago" with a button that reads SEOSignalX again now (free; it also refreshes by itself every 6 hours). */
export function SxSync({ fetchedAt }: { fetchedAt: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="text-right">
      <button type="button" disabled={busy} onClick={() => start(async () => {
        setErr(null);
        const r = await syncSeoSignalX();
        if (!r.ok) setErr(r.error);
        router.refresh();
      })} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium hover:bg-surface-muted disabled:opacity-60">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Sync
      </button>
      <p className="mt-1 text-[11px] text-muted">Updated {new Date(fetchedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
      {err && <p role="alert" className="mt-1 max-w-[14rem] text-[11px] text-negative">{err}</p>}
    </div>
  );
}
