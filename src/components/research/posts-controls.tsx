"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { checkPosts, refreshPosts } from "@/app/(dashboard)/local-seo/posts-actions";

const btn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";

/** "Refresh posts" (owners/admins) and a free 15-second check while posts are being collected. */
export function PostsRefresh({ canEdit, waiting, hasData, businesses }: { canEdit: boolean; waiting: boolean; hasData: boolean; businesses: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => { const r = await checkPosts(); if (r.done || !r.pending) router.refresh(); }, 15_000);
    return () => clearInterval(t);
  }, [waiting, router]);
  const est = (Math.max(1, businesses) * 0.3).toFixed(1);
  return (
    <div className="space-y-1.5">
      {canEdit ? (
        <button className={btn} disabled={pending || waiting} onClick={() => start(async () => {
          setMsg(null);
          const r = await refreshPosts();
          setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          router.refresh();
        })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {hasData ? "Refresh posts" : "Load posts"} <span className="opacity-70">(≈{est}¢)</span>
        </button>
      ) : <p className="text-xs text-muted">Only owners and admins can refresh posts.</p>}
      {waiting && <p className="flex items-center gap-1.5 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> Collecting posts and checking links. This updates by itself.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-positive" : "text-sm text-negative"}>{msg.text}</p>}
    </div>
  );
}
