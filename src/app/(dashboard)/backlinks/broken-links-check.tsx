"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { checkBrokenBacklinks } from "./actions";

/** "Check now" for links pointing at missing pages (owners and admins; about 3 cents). */
export function BrokenLinksCheck({ canEdit, checked }: { canEdit: boolean; checked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canEdit) return null;
  return (
    <div className="space-y-1.5">
      <button className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-60" disabled={pending}
        onClick={() => start(async () => {
          setMsg(null);
          const r = await checkBrokenBacklinks(checked);
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          router.refresh();
        })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {checked ? "Re-check now" : "Check now"} <span className="opacity-70">(≈$0.03)</span>
      </button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>}
    </div>
  );
}
