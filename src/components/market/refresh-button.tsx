"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { refreshBrandLookupNow } from "@/app/(dashboard)/ai-visibility/actions";
import { refreshCompetitorExtrasNow } from "@/app/(dashboard)/competitors/actions";

type R = { ok: true; message: string } | { ok: false; error: string };
const ACTIONS: Record<"brand" | "compExtras", () => Promise<R>> = { brand: () => refreshBrandLookupNow(), compExtras: () => refreshCompetitorExtrasNow() };

/** A small "fetch now" button for a weekly dataset (the scheduled run normally keeps it fresh). */
export function MarketRefreshButton({ action, label, estimate }: { action: "brand" | "compExtras"; label: string; estimate: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-1">
      <button type="button" disabled={pending} onClick={() => start(async () => {
        setMsg(null);
        const r = await ACTIONS[action]();
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
        if (r.ok) router.refresh();
      })} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />} {label} <span className="opacity-70">({estimate})</span>
      </button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>}
    </div>
  );
}
