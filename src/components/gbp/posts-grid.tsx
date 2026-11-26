"use client";

import { useState } from "react";
import { ExternalLink, ImageOff } from "lucide-react";
import { Dialog, DialogBody } from "@/components/dashboard/dialog";

export type PostItem = {
  id: string; summary: string | null; topic: string | null; state: string | null; date: string | null; image: string | null;
  ctaType: string | null; ctaUrl: string | null; searchUrl: string | null; metrics: Record<string, number> | null;
  event: string | null; offer: string | null; mediaCount: number;
};

const safe = (u: string | null) => (u && u.startsWith("https://") ? u : null);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");
const label = (s: string | null) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ") : null);
const METRIC: Record<string, string> = { LOCAL_POST_VIEWS_SEARCH: "Views on Search", LOCAL_POST_ACTIONS_CALL_TO_ACTION: "Button clicks" };
const FIRST = 6;

/** Posts as a grid of cards; "View all" opens the full list, a click on a post shows everything Google returned for it. */
export function PostsGrid({ posts }: { posts: PostItem[] }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<PostItem | null>(null);
  const shown = all ? posts : posts.slice(0, FIRST);
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpen(p)} className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-border text-left outline-none transition hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent">
              {safe(p.image)
                // eslint-disable-next-line @next/next/no-img-element -- Google-hosted post media
                ? <img src={safe(p.image)!} alt="" loading="lazy" className="aspect-[16/9] w-full bg-surface-muted object-cover" />
                : <span className="grid aspect-[16/9] w-full place-items-center bg-surface-muted text-faint"><ImageOff className="size-5" aria-hidden /></span>}
              <span className="flex flex-1 flex-col gap-1 p-3 text-sm">
                <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  {p.topic && <span className="rounded bg-surface-muted px-1.5 py-0.5 text-secondary">{label(p.topic)}</span>}
                  <span>{day(p.date)}</span>
                  {p.state && p.state !== "LIVE" && <span className="text-negative">{label(p.state)}</span>}
                </span>
                <span className="line-clamp-3">{p.summary ?? "(no text)"}</span>
                {p.metrics && Object.keys(p.metrics).length > 0 && (
                  <span className="mt-auto pt-1 text-xs text-muted">{Object.entries(p.metrics).map(([k, v]) => `${METRIC[k] ?? label(k)}: ${v}`).join(" · ")}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {posts.length > FIRST && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-sm font-medium text-accent">
          {all ? "Show fewer" : `View all ${posts.length} posts`}
        </button>
      )}
      <Dialog open={open !== null} onClose={() => setOpen(null)} title={open ? `${label(open.topic) ?? "Post"} · ${day(open.date)}` : ""}>
        {open && (
          <DialogBody className="space-y-3 text-foreground">
            {safe(open.image) && (
              // eslint-disable-next-line @next/next/no-img-element -- Google-hosted post media
              <img src={safe(open.image)!} alt="" className="w-full rounded-lg bg-surface-muted object-cover" />
            )}
            <p className="whitespace-pre-line">{open.summary ?? "(no text)"}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              {([
                ["Status", label(open.state)], ["Button", label(open.ctaType)], ["Button link", open.ctaUrl], ["Event", open.event], ["Offer", open.offer],
                ["Photos/videos", open.mediaCount ? String(open.mediaCount) : null],
                ...Object.entries(open.metrics ?? {}).map(([k, v]) => [METRIC[k] ?? label(k), String(v)] as const),
              ] as const).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-all">{v}</dd></div>
              ))}
            </dl>
            {!open.metrics && <p className="text-xs text-muted">Google doesn&apos;t report views or clicks for this post.</p>}
            {safe(open.searchUrl) && (
              <a href={safe(open.searchUrl)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm underline decoration-border-strong underline-offset-2 hover:decoration-foreground">
                View on Google <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </DialogBody>
        )}
      </Dialog>
    </>
  );
}
