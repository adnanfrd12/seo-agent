"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2 } from "lucide-react";
import { fetchKeywordData } from "@/app/(dashboard)/ai-quick-wins/actions";

/** Fetches DataForSEO volume, difficulty, intent and SERP features for the top 300 Search Console queries. */
export function FetchKeywords({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" title="Top 300 queries · one DataForSEO Labs request per 700 keywords · cached 24 hours" disabled={!canEdit || pending} onClick={() => start(async () => { const r = await fetchKeywordData(); setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error }); router.refresh(); })}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Fetch DataForSEO data
      </button>
      {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</span>}
    </div>
  );
}
