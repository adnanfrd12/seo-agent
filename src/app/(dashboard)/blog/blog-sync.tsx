"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { crawlBlogNow, fetchBlogKeywordsNow, syncBlogNow } from "./actions";

type Run = () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;

/**
 * Owner controls. Everything also runs automatically every day; these run it now:
 * read the blog (free), DataForSEO keywords for new or all posts (paid, estimate shown), and
 * posts found by DataForSEO's site crawler (adds posts only).
 */
export function BlogSync({ dfs, newPosts, allPosts, perPost }: { dfs: boolean; newPosts: number; allPosts: number; perPost: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = (label: string, run: Run) => start(async () => {
    setMsg(null); setBusy(label);
    const r = await run();
    setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    setBusy(null);
    router.refresh();
  });
  const item = "block w-full rounded-md px-3 py-2 text-left text-[13px] hover:bg-surface-muted disabled:opacity-50";
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => go("read", syncBlogNow)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-muted disabled:opacity-60">
          {busy === "read" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />} {busy === "read" ? "Reading posts…" : "Read the blog now"}
        </button>
        {dfs && (
          <details className="relative">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
              {busy && busy !== "read" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} DataForSEO <ChevronDown className="size-3.5" aria-hidden />
            </summary>
            <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-surface p-1 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.3)]">
              <button type="button" disabled={pending || !newPosts} className={item} onClick={() => go("new", () => fetchBlogKeywordsNow("new"))}>
                Keywords for new posts<span className="block text-xs text-muted">{newPosts} from the last 60 days · about ${(newPosts * perPost).toFixed(2)}</span>
              </button>
              <button type="button" disabled={pending || !allPosts} className={item} onClick={() => go("all", () => fetchBlogKeywordsNow("all"))}>
                Keywords for every post<span className="block text-xs text-muted">{allPosts} posts without their own list · about ${(allPosts * perPost).toFixed(2)}</span>
              </button>
              <button type="button" disabled={pending} className={item} onClick={() => go("crawl", crawlBlogNow)}>
                Find posts with the site crawler<span className="block text-xs text-muted">Adds posts the crawler found that aren&apos;t listed yet · a new crawl is about $0.03</span>
              </button>
            </div>
          </details>
        )}
      </div>
      {pending && <p className="text-xs text-muted">{busy === "read" ? "Reading every post on the site. This can take a few minutes the first time." : "Working… this can take a few minutes."}</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "max-w-md text-xs text-positive sm:text-right" : "max-w-md text-xs text-negative sm:text-right"}>{msg.text}</p>}
    </div>
  );
}
