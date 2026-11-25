"use client";

import { useMemo, useState } from "react";
import { Bookmark, ChevronDown, ExternalLink, Eye, Heart, MessageCircle, MousePointerClick, Play, Repeat2 } from "lucide-react";
import { SocialLogo } from "@/components/brand/social-logos";
import { AccountAvatar } from "@/components/research/social-controls";
import { PLATFORM_INFO, type Platform } from "@/lib/social/platforms";
import type { SocialPost } from "@/lib/social/metrics";
import { cn } from "@/lib/utils";

const PAGE = 6;
const nf = (v: number) => Intl.NumberFormat("en-US", { notation: v >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(v);
const dateLabel = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** How each platform names its counts (Pinterest "likes" are saves, its "shares" are clicks). */
const LABELS: Partial<Record<Platform, { likes?: string; comments?: string; shares?: string; views?: string }>> = {
  pinterest: { likes: "Saves", comments: "Reactions", shares: "Clicks", views: "Impressions" },
  threads: { comments: "Replies", shares: "Reposts" },
  x: { comments: "Replies", shares: "Reposts", views: "Impressions" },
  youtube: { views: "Views" },
};
/** Media shape per platform, so a grid of one platform lines up. */
const ASPECT: Record<Platform, string> = {
  youtube: "aspect-video", tiktok: "aspect-[4/5]", instagram: "aspect-square", pinterest: "aspect-[4/5]",
  facebook: "aspect-[4/3]", x: "aspect-[4/3]", threads: "aspect-[4/3]", linkedin: "aspect-[4/3]",
};
const VIDEO = /video|reel|short/i;

/**
 * The account's posts as cards, newest first: who posted, when, the text, the picture or video thumbnail and
 * the counts the platform reports. Six at a time, with "Show more".
 */
export function SocialPostGrid({ platform, posts, account }: {
  platform: Platform; posts: SocialPost[];
  account: { handle: string | null; name: string | null; avatar: string | null };
}) {
  const [shown, setShown] = useState(PAGE);
  const [sort, setSort] = useState<"recent" | "top">("recent");
  const sorted = useMemo(() => {
    const eng = (x: SocialPost) => (x.likes ?? 0) + (x.comments ?? 0) + (x.shares ?? 0);
    return [...posts].sort((a, b) => sort === "top" ? (eng(b) - eng(a)) || ((b.views ?? 0) - (a.views ?? 0)) : (b.date ?? "").localeCompare(a.date ?? ""));
  }, [posts, sort]);
  if (!posts.length) return null;
  const label = PLATFORM_INFO[platform].label;
  const noun = platform === "youtube" || platform === "tiktok" ? "videos" : platform === "pinterest" ? "pins" : "posts";

  return (
    <section aria-label={`${label} ${noun}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{label} {noun} <span className="font-normal text-muted">· {posts.length}</span></h4>
        <div role="tablist" aria-label="Order" className="inline-flex gap-0.5 rounded-lg bg-surface-muted p-[3px] text-xs">
          {(["recent", "top"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={sort === k} onClick={() => { setSort(k); setShown(PAGE); }}
              className={cn("rounded-md px-2.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-accent", sort === k ? "bg-surface font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-secondary hover:text-foreground")}>
              {k === "recent" ? "Newest" : "Most engagement"}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.slice(0, shown).map((x) => <PostCard key={x.id} platform={platform} post={x} account={account} />)}
      </ul>

      {shown < sorted.length && (
        <div className="flex justify-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-4 text-sm font-medium outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent">
            <ChevronDown className="size-4" aria-hidden /> Show more <span className="text-muted">({sorted.length - shown} more)</span>
          </button>
        </div>
      )}
    </section>
  );
}

function PostCard({ platform, post: x, account }: { platform: Platform; post: SocialPost; account: { handle: string | null; name: string | null; avatar: string | null } }) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const label = PLATFORM_INFO[platform].label;
  const L = LABELS[platform] ?? {};
  const handle = account.handle?.replace(/^@/, "") || null;
  const who = handle ? `@${handle}` : account.name ?? label;
  const text = (x.text ?? x.title ?? "").trim();
  const long = text.length > 220;
  const video = platform === "youtube" || platform === "tiktok" || VIDEO.test(x.type ?? "");
  // YouTube thumbnails follow the video id, so older reads without a picture still show one
  const image = x.image ?? (platform === "youtube" && /^[\w-]{11}$/.test(x.id) ? `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg` : null);
  const stats = [
    x.likes != null && { icon: platform === "pinterest" ? Bookmark : Heart, label: L.likes ?? "Likes", v: x.likes },
    x.comments != null && { icon: MessageCircle, label: L.comments ?? "Comments", v: x.comments },
    x.shares != null && { icon: platform === "pinterest" ? MousePointerClick : Repeat2, label: L.shares ?? "Shares", v: x.shares },
    x.views != null && { icon: Eye, label: L.views ?? "Views", v: x.views },
  ].filter(Boolean) as { icon: typeof Heart; label: string; v: number }[];

  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
      <div className="flex items-center gap-2.5 px-3.5 pt-3">
        <AccountAvatar src={account.avatar} label={who} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight">{who}</p>
          <p className="text-[11px] text-muted">{x.date ? dateLabel(x.date) : "Date not given"}{x.type ? ` · ${x.type.replace(/_/g, " ").toLowerCase()}` : ""}</p>
        </div>
        <SocialLogo platform={platform} className="size-4 shrink-0 text-foreground" />
      </div>

      {text && (
        <div className="px-3.5 pt-2.5">
          <p className={cn("whitespace-pre-line break-words text-[13px] leading-relaxed text-foreground", !open && "line-clamp-4")}>{text}</p>
          {long && <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 text-xs font-medium text-muted hover:text-foreground">{open ? "Show less" : "Show all"}</button>}
        </div>
      )}

      {image && !broken ? (
        <a href={x.url ?? undefined} target="_blank" rel="noopener noreferrer" className={cn("relative mx-3.5 mt-3 block overflow-hidden rounded-lg border border-hairline bg-surface-muted", ASPECT[platform])} tabIndex={x.url ? undefined : -1} aria-label={x.url ? `Open on ${label}` : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- platform CDN image; links change on each read */}
          <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover transition duration-300 hover:scale-[1.02]" />
          {video && <span className="absolute left-1/2 top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm" aria-hidden><Play className="ml-0.5 size-5 fill-current" /></span>}
        </a>
      ) : image && broken ? (
        <p className="mx-3.5 mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted">The picture link expired; it renews on the next sync.</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline px-3.5 py-2.5 text-xs text-secondary">
        {stats.length ? stats.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1 tabular-nums" title={s.label}>
            <s.icon className="size-3.5" aria-hidden /><span className="font-medium text-foreground">{nf(s.v)}</span><span className="sr-only"> {s.label}</span>
          </span>
        )) : <span className="text-muted">No counts reported</span>}
        {x.url && (
          <a href={x.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-muted hover:text-foreground">
            Open <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
    </li>
  );
}
