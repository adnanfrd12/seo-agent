"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { runTechnicalChecksNow } from "@/app/(dashboard)/technical-seo/actions";

/** Owner button: re-reads robots.txt, sitemaps and a sample of pages from the website (free, about 30 seconds). */
export function TechnicalRun({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return null;
  return (
    <div className="space-y-1.5">
      <button className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60" disabled={pending} onClick={() => start(async () => {
        setMsg(null);
        const r = await runTechnicalChecksNow();
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
        router.refresh();
      })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Run technical checks <span className="opacity-70">(free)</span>
      </button>
      {pending && <p className="text-xs text-muted">Reading robots.txt, sitemaps and up to 25 pages. About 30 seconds.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`max-w-md break-words text-sm ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.text}</p>}
    </div>
  );
}
