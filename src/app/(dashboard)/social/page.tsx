import { CircleAlert, CircleX, KeyRound, Link2Off } from "lucide-react";
import { TabHeader } from "@/components/dashboard/tab-header";
import { ResearchTable } from "@/components/research/research-table";
import { SocialConnect, SocialRefresh, SocialSettings } from "@/components/research/social-controls";
import { researchPage } from "@/lib/dataforseo/view";
import { composioReady, setupNote, socialConnections, type SocialConnection } from "@/lib/social/composio";
import { clientSocial, engagementOf, loadSocial, tokenState, type SocialPoint, type SocialRow } from "@/lib/social/fetch";
import { PLATFORM_INFO, PLATFORMS, type Platform } from "@/lib/social/platforms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300; // a manual refresh reads up to 8 platforms

const fmt = (v: number | null | undefined) => (v == null ? "—" : Intl.NumberFormat("en-US", { notation: v >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(v));

/** Change since the oldest point at least `days` back (or the first point). */
function growth(h: SocialPoint[], days: number): number | null {
  if (h.length < 2) return null;
  const last = h.at(-1)!;
  const cutoff = new Date(Date.parse(last.date) - days * 86_400_000).toISOString().slice(0, 10);
  const base = [...h].reverse().find((p) => p.date <= cutoff) ?? h[0];
  return base === last || last.followers == null || base.followers == null ? null : last.followers - base.followers;
}

function Spark({ points }: { points: (number | null)[] }) {
  const vals = points.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (vals.length < 2) return <p className="text-xs text-faint">Trend appears after the second weekly snapshot.</p>;
  const min = Math.min(...vals.map((p) => p.v)), max = Math.max(...vals.map((p) => p.v));
  const W = 160, H = 36, span = Math.max(1, points.length - 1);
  const d = vals.map((p, k) => `${k ? "L" : "M"}${((p.i / span) * W).toFixed(1)},${(H - 2 - ((p.v - min) / (max - min || 1)) * (H - 4)).toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full" role="img" aria-label="Followers over time"><path d={d} fill="none" stroke="var(--color-accent, currentColor)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

function Card({ p, row, url, token, ready, connected }: { p: Platform; row: SocialRow | undefined; url: string | undefined; token: "client" | "env" | null; ready: boolean; connected: boolean }) {
  const hint = connected ? "Connected. Press Refresh stats to read it." : ready ? "Press Connect above and log in to read full analytics." : null;
  const info = PLATFORM_INFO[p];
  const ok = row?.status === "ok" || (row?.history.length ?? 0) > 0;
  const g30 = row ? growth(row.history, 30) : null;
  const eng = row ? engagementOf(row.posts) : null;
  return (
    <section aria-label={info.label} className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{info.label}</h2>
          {url ? <a href={url} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted hover:underline">{url.replace(/^https?:\/\/(www\.)?/, "")}</a> : <p className="text-xs text-faint">No profile URL</p>}
        </div>
        {row?.mode === "connected" ? <span className="shrink-0 rounded-md bg-positive/15 px-1.5 py-0.5 text-[11px] text-positive">Connected</span> : row?.mode === "public" ? <span className="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-secondary" title={row.source ?? ""}>Public numbers</span> : row?.source && <span className="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] text-secondary">{row.source}</span>}
      </div>
      {ok && row && (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-muted">{p === "youtube" ? "Subscribers" : "Followers"}</dt><dd className="text-lg font-semibold tabular-nums">{fmt(row.profile.followers)}{g30 != null && g30 !== 0 && <span className={`ml-1 text-xs ${g30 > 0 ? "text-positive" : "text-negative"}`}>{g30 > 0 ? "+" : ""}{fmt(g30)}</span>}</dd></div>
            <div><dt className="text-xs text-muted">{p === "youtube" || p === "tiktok" ? "Videos" : "Posts"}</dt><dd className="text-lg font-semibold tabular-nums">{fmt(row.profile.posts ?? (row.posts.length || null))}</dd></div>
            <div><dt className="text-xs text-muted">Views</dt><dd className="tabular-nums">{fmt(row.profile.views)}</dd></div>
            <div><dt className="text-xs text-muted" title="Likes + comments + shares on the posts read">Engagement</dt><dd className="tabular-nums">{fmt(eng ?? (row.mode === "connected" && (row.profile.likes != null || row.profile.comments != null) ? (row.profile.likes ?? 0) + (row.profile.comments ?? 0) : null))}</dd></div>
            {row.profile.impressions != null && <div><dt className="text-xs text-muted">Impressions</dt><dd className="tabular-nums">{fmt(row.profile.impressions)}</dd></div>}
            {row.profile.reach != null && <div><dt className="text-xs text-muted">Reach</dt><dd className="tabular-nums">{fmt(row.profile.reach)}</dd></div>}
          </dl>
          <Spark points={row.history.map((h) => h.followers)} />
        </>
      )}
      {row?.status === "needs" || (!row && url && !info.free && !token) ? (
        <p className="flex gap-1.5 text-xs text-warn"><KeyRound className="mt-0.5 size-3.5 shrink-0" /><span><b>Needs:</b> {row?.needs && !/token|developer app|Meta app|LinkedIn app|Pinterest developer/i.test(row.needs) ? row.needs : hint ?? row?.needs ?? info.needs}</span></p>
      ) : row?.status === "error" ? (
        <p className="flex gap-1.5 text-xs text-negative"><CircleX className="mt-0.5 size-3.5 shrink-0" /><span>{row.error}</span></p>
      ) : !url && p !== "instagram" ? (
        <p className="flex gap-1.5 text-xs text-muted"><Link2Off className="mt-0.5 size-3.5 shrink-0" /><span>{hint && !info.free ? hint : <>Add the profile URL below.{!info.free && <> Then: {info.needs}</>}</>}</span></p>
      ) : !row ? (
        <p className="flex gap-1.5 text-xs text-muted"><CircleAlert className="mt-0.5 size-3.5 shrink-0" /><span>Not read yet. It refreshes weekly, or press Refresh stats.</span></p>
      ) : null}
      {row && <p className="mt-auto text-[11px] text-faint">Read {row.fetchedAt.slice(0, 10)}{row.history.length > 1 ? ` · ${row.history.length} snapshots` : ""}</p>}
    </section>
  );
}

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ connected?: string; connect_error?: string }> }) {
  const sp = await searchParams;
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit } = page;
  const supabase = await createClient();
  const [rows, social] = await Promise.all([loadSocial(supabase, client.id), clientSocial(createAdminClient(), client.id)]);
  const tokens = tokenState(social.tokens);
  let conns: SocialConnection[] = [];
  try { conns = await socialConnections(client.id); } catch { /* Composio unreachable: show the buttons anyway */ }
  const connectRows = PLATFORMS.map((p) => {
    const c = conns.find((x) => x.platform === p);
    return { platform: p, state: c?.status === "ACTIVE" ? "connected" as const : c ? "pending" as const : "none" as const, ready: composioReady(p), note: composioReady(p) ? null : setupNote(p) };
  });
  const yt = rows.youtube;
  const posts = PLATFORMS.flatMap((p) => (rows[p]?.posts ?? []).map((x) => ({
    platform: PLATFORM_INFO[p].label, title: x.title || "(no text)", url: x.url, date: x.date, views: x.views, likes: x.likes, comments: x.comments, shares: x.shares,
    engagement: (x.likes ?? 0) + (x.comments ?? 0) + (x.shares ?? 0),
  })));
  const ranks = (yt?.rankings ?? []).map((r) => ({ ...r, found: r.position != null ? "Ranks" : "Not in results", in: r.total }));

  return (
    <>
      <TabHeader source={null} eyebrow="Social media" title="Social" description="Followers, posts, engagement and growth on YouTube, Facebook, Instagram, TikTok, X, LinkedIn, Threads and Pinterest, plus where the client's videos rank in YouTube search for its tracked keywords." guide={[
        { term: "Sources", text: "YouTube is read from public YouTube search results (DataForSEO) or the YouTube Data API when a key is set. The other platforms are read through Composio once the account owner presses Connect and logs in (official APIs, read-only); accounts that are not connected can show public numbers." },
        { term: "Engagement", text: "Likes + comments + shares on the posts read in the latest refresh (up to the newest 20 to 50 per platform)." },
        { term: "Growth", text: "Each refresh stores a snapshot (weekly automatically, or when Refresh stats is pressed). The +/− next to followers compares with about 30 days ago." },
        { term: "YouTube rankings", text: "Position of the client's best video among the video results of a YouTube search for each of the first 5 tracked keywords (US)." },
      ]} />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted">Refreshed weekly · YouTube via DataForSEO costs at most about $0.07 per refresh; the official APIs are free</p>
        <SocialRefresh canEdit={canEdit} />
      </div>

      {sp.connected && canEdit && !sp.connect_error && <p role="status" className="mb-4 rounded-lg border border-positive/40 bg-positive/10 px-3 py-2 text-sm">{PLATFORM_INFO[sp.connected as Platform]?.label ?? "The account"} is connected and its stats were read.</p>}
      {sp.connect_error && canEdit && <p role="alert" className="mb-4 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-sm">{sp.connect_error.slice(0, 300)}</p>}
      <div className="mb-4"><SocialConnect canEdit={canEdit} rows={connectRows} /></div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLATFORMS.map((p) => <Card key={p} p={p} row={rows[p]} url={social.profiles[p]} token={tokens[p]} ready={composioReady(p)} connected={conns.some((c) => c.platform === p && c.status === "ACTIVE")} />)}
      </div>

      {canEdit && <div className="mt-6"><SocialSettings profiles={social.profiles} tokens={tokens} linkedinOrgId={typeof social.settings.linkedin_org_id === "string" ? social.settings.linkedin_org_id : null} /></div>}

      {ranks.length > 0 && (
        <div className="mt-6">
          <ResearchTable title="YouTube search rankings for tracked keywords" rows={ranks as unknown as Record<string, unknown>[]} csvName={`youtube-rankings-${client.id}`}
            columns={[{ key: "keyword", label: "Keyword", type: "keyword" }, { key: "position", label: "Position", type: "int" }, { key: "found", label: "Status", type: "badge" }, { key: "title", label: "Best video" }, { key: "url", label: "Video", type: "url" }, { key: "in", label: "Videos checked", type: "int" }]}
            initialSort={{ key: "position", dir: "asc" }} empty="No rankings yet." />
        </div>
      )}

      <div className="mt-6">
        <ResearchTable title="Top posts and videos (all platforms)" rows={posts as unknown as Record<string, unknown>[]} searchKeys={["title"]} csvName={`social-posts-${client.id}`}
          columns={[{ key: "platform", label: "Platform", type: "badge" }, { key: "title", label: "Post / video" }, { key: "date", label: "Date", type: "date" }, { key: "views", label: "Views", type: "int" }, { key: "likes", label: "Likes", type: "int" }, { key: "comments", label: "Comments", type: "int" }, { key: "shares", label: "Shares", type: "int" }, { key: "engagement", label: "Engagement", type: "int" }, { key: "url", label: "Open", type: "open" }]}
          facets={[{ key: "platform", label: "Platform" }]} initialSort={{ key: "engagement", dir: "desc" }}
          empty="No posts read yet. Add profile URLs and API access, then press Refresh stats." />
      </div>
    </>
  );
}
