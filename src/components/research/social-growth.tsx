"use client";

import { useState } from "react";
import { ColChart } from "@/components/ga4x/charts";

export interface GrowthData {
  days: string[];
  followers: (number | null)[] | null;
  likes: (number | null)[] | null;
  likesFrom: "account" | "posts" | null;
  views: (number | null)[] | null;
  videos: { id: string; title: string; url: string | null; gains: (number | null)[]; total: number }[];
}

const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Card({ title, sub, foot, children }: { title: string; sub?: string; foot: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-border bg-surface p-4">
      <p className="text-sm font-semibold">{title}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      <div className="mt-2">{children}</div>
      <p className="mt-2 text-[11px] text-faint">{foot}</p>
    </div>
  );
}

/**
 * Day-to-day gains from the daily snapshots (each day's numbers minus the day before). Bars or a line, with the
 * value on every day. A day without both snapshots is left empty rather than estimated.
 */
export function SocialGrowth({ platform, label, color, data, since, firstDay, videoNoun = "video" }: {
  platform: string; label: string; color: string; data: GrowthData | null;
  /** "Tracking since" date (the connect date, or the first snapshot) */
  since: string | null;
  /** the first snapshot (gains start the next day) */
  firstDay: string | null;
  videoNoun?: string;
}) {
  const [video, setVideo] = useState(data?.videos[0]?.id ?? "");
  const foot = `${since ? `Tracking since ${since}` : "Tracking starts with the next daily read"} · updated daily`;
  const labels = (data?.days ?? []).map(short);
  const chart = (id: string, name: string, values: (number | null)[]) => (
    <ColChart id={`social:${platform}:${id}`} labels={labels} series={[{ name, values, color }]} f="int" />
  );
  const cards: React.ReactNode[] = [];
  if (data?.followers) cards.push(<Card key="f" title="Followers gained per day" foot={foot}>{chart("followers", "Followers gained", data.followers)}</Card>);
  if (data?.likes) cards.push(<Card key="l" title="Likes gained per day" sub={data.likesFrom === "posts" ? `On the latest ${videoNoun}s ${label} returns` : undefined} foot={foot}>{chart("likes", "Likes gained", data.likes)}</Card>);
  if (data?.views) cards.push(<Card key="v" title="Views gained per day" sub={`All ${videoNoun}s ${label} returns`} foot={foot}>{chart("views", "Views gained", data.views)}</Card>);
  const v = data?.videos.find((x) => x.id === video) ?? data?.videos[0];
  if (v) cards.push(
    <Card key="pv" title={`Views gained per day, per ${videoNoun}`} foot={foot}>
      <label className="mb-2 block">
        <span className="sr-only">Choose a {videoNoun}</span>
        <select value={v.id} onChange={(e) => setVideo(e.target.value)} className="h-8 w-full truncate rounded-md border border-border bg-background px-2 text-xs">
          {data!.videos.map((x) => <option key={x.id} value={x.id}>{x.title.slice(0, 80)} (+{x.total.toLocaleString("en-US")})</option>)}
        </select>
      </label>
      {chart("video", "Views gained", v.gains)}
      {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-muted underline underline-offset-2 hover:text-foreground">Open the {videoNoun}</a>}
    </Card>,
  );

  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Daily growth <span className="font-normal text-muted">· updated daily</span></p>
      {cards.length ? <div className="grid gap-4 lg:grid-cols-2">{cards}</div> : (
        <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs text-muted">
          {firstDay ? `Daily gains appear after the second daily snapshot (first snapshot ${short(firstDay)}).` : "Daily gains appear once two daily snapshots exist."} {foot}.
        </p>
      )}
    </div>
  );
}
