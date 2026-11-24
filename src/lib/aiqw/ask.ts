import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ga4WinsFor } from "@/lib/ga4x/load";
import { pageTable } from "@/lib/gscx/analysis";
import { gscWinsFor } from "@/lib/gscx/load";
import { pathOf } from "@/lib/gscx/model";
import { loadPlatformData } from "./platforms";
import { screenLabel } from "./screens";
import { loadItems } from "./store";
import { SOCIAL_SOURCES } from "./types";

/**
 * "💬 Ask Claude": the data a screen shows, trimmed to the top rows, as JSON blocks. Built on the server from the
 * stored data (never from what the browser sends), aggregated only: no personal data, no tokens.
 */
export interface DataBlock { name: string; source: string; rows: unknown }

const r2 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100) / 100);

export async function screenData(admin: SupabaseClient, clientId: string, screen: string): Promise<DataBlock[]> {
  const out: DataBlock[] = [];
  const family = screen.split(":")[0];
  if (family === "gsc" || screen === "dfs:keywords") {
    const v = await gscWinsFor(admin, clientId);
    if (v) {
      const { g } = v;
      const cur = g.totals(), prev = g.totals(true);
      out.push({ name: `Search Console totals, ${g.p.start} to ${g.p.end} vs ${g.p.pstart} to ${g.p.pend}`, source: "Search Console", rows: { current: { clicks: cur.clicks, impressions: cur.impressions, ctr: r2(cur.ctr), position: r2(cur.pos) }, previous: { clicks: prev.clicks, impressions: prev.impressions, ctr: r2(prev.ctr), position: r2(prev.pos) } } });
      const q = g.queries(), qp = g.queries(true);
      out.push({ name: "Top 30 queries by impressions (28 days, with the previous 28 days)", source: "Search Console", rows: [...q].sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 30).map(([k, m]) => ({ query: k, clicks: m.clicks, impressions: m.impressions, ctr: r2(m.ctr), position: r2(m.pos), prev_clicks: qp.get(k)?.clicks ?? 0, prev_impressions: qp.get(k)?.impressions ?? 0 })) });
      out.push({ name: "Top 25 pages by clicks (28 days)", source: "Search Console", rows: pageTable(g).sort((a, b) => b.clicks - a.clicks).slice(0, 25).map((p) => ({ page: pathOf(p.page), clicks: p.clicks, impressions: p.impressions, ctr: r2(p.ctr), position: r2(p.pos), change_in_clicks: p.dClicks })) });
    }
  }
  if (family === "ga4" || family === "gsc" && screen === "gsc:overview") {
    const v = await ga4WinsFor(admin, clientId);
    if (v) {
      const { g } = v;
      const cur = g.total(), prev = g.total(true);
      out.push({ name: `GA4 totals (qualified leads), ${g.p.start} to ${g.p.end} vs ${g.p.pstart} to ${g.p.pend}`, source: "GA4", rows: { current: { sessions: cur.sessions, engaged: cur.engaged, engagement_rate: r2(cur.er), leads: cur.leads, lead_rate: r2(cur.lr), new_users: cur.newUsers }, previous: { sessions: prev.sessions, engaged: prev.engaged, engagement_rate: r2(prev.er), leads: prev.leads, lead_rate: r2(prev.lr), new_users: prev.newUsers } } });
      const ch = g.by((x) => (x.ch ? String(x.ch) : null)).sort((a, b) => b.sessions - a.sessions).slice(0, 12);
      out.push({ name: "Channels (30 days)", source: "GA4", rows: ch.map((r) => ({ channel: r.key, sessions: r.sessions, leads: r.leads, lead_rate: r2(r.lr), engagement_rate: r2(r.er) })) });
      const lp = g.by((x) => (x.land ? String(x.land) : null)).sort((a, b) => b.sessions - a.sessions).slice(0, 25);
      out.push({ name: "Top 25 landing pages (30 days)", source: "GA4", rows: lp.map((r) => ({ page: r.key, sessions: r.sessions, leads: r.leads, lead_rate: r2(r.lr), engagement_rate: r2(r.er) })) });
    }
  }
  const platformFor: Record<string, Parameters<typeof loadPlatformData>[2]> = { "business-profile": ["gbp"], bing: ["bing"], clarity: ["clarity"], social: [...SOCIAL_SOURCES], seosignalx: ["seosignalx"] };
  if (platformFor[screen]) {
    const d = await loadPlatformData(admin, clientId, platformFor[screen]);
    if (d.gbp) {
      const days = [...d.gbp.daily].sort((a, b) => a.metric_date.localeCompare(b.metric_date)).slice(-56);
      out.push({ name: "Business Profile daily actions (last 56 days)", source: "Google Business Profile", rows: days.map((r) => ({ date: r.metric_date, calls: r.call_clicks, website_clicks: r.website_clicks, directions: r.direction_requests, views: (r.impressions_desktop_maps ?? 0) + (r.impressions_desktop_search ?? 0) + (r.impressions_mobile_maps ?? 0) + (r.impressions_mobile_search ?? 0) })) });
      out.push({ name: "Searches that found the profile (latest month, top 30)", source: "Google Business Profile", rows: d.gbp.keywords.sort((a, b) => (b.impressions ?? b.impressions_threshold ?? 0) - (a.impressions ?? a.impressions_threshold ?? 0)).slice(0, 30).map((k) => ({ month: k.month, keyword: k.keyword, impressions: k.impressions ?? `fewer than ${k.impressions_threshold}` })) });
      out.push({ name: "Reviews (ratings and reply status only)", source: "Google Business Profile", rows: d.gbp.reviews.slice(0, 100).map((r) => ({ date: r.reviewed_at?.slice(0, 10), rating: r.rating, replied: Boolean(r.reply_text) })) });
    }
    if (d.bing) {
      const byQ = new Map<string, { clicks: number; impressions: number }>();
      for (const r of d.bing.queries) { const x = byQ.get(r.query) ?? { clicks: 0, impressions: 0 }; x.clicks += Number(r.clicks); x.impressions += Number(r.impressions); byQ.set(r.query, x); }
      out.push({ name: "Bing queries (last 4 weeks, top 30)", source: "Bing Webmaster Tools", rows: [...byQ].sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 30).map(([query, x]) => ({ query, ...x })) });
      out.push({ name: "Bing crawl (latest day)", source: "Bing Webmaster Tools", rows: d.bing.crawl });
    }
    if (d.clarity) {
      const by = new Map<string, Record<string, number>>();
      for (const r of d.clarity) { let p: string; try { p = new URL(r.value).pathname; } catch { continue; } const m = by.get(p) ?? {}; m[r.metric] = (m[r.metric] ?? 0) + Number(r.metric === "Traffic" ? r.sessions ?? r.count ?? 0 : r.count ?? 0); by.set(p, m); }
      out.push({ name: "Clarity per page (last 30 days, top 25 by sessions)", source: "Microsoft Clarity", rows: [...by].sort((a, b) => (b[1].Traffic ?? 0) - (a[1].Traffic ?? 0)).slice(0, 25).map(([page, m]) => ({ page, sessions: m.Traffic ?? 0, rage_clicks: m.RageClickCount ?? 0, dead_clicks: m.DeadClickCount ?? 0, quick_backs: m.QuickbackClick ?? 0, js_errors: m.ScriptErrorCount ?? 0 })) });
    }
    for (const p of SOCIAL_SOURCES) {
      const s = d.social[p];
      if (!s || s.status !== "ok") continue;
      out.push({ name: `${p} profile and last 15 posts`, source: p, rows: { followers: s.profile.followers, posts: s.profile.posts, views: s.profile.views, reach: s.profile.reach ?? null, recent: s.posts.slice(0, 15).map((x) => ({ date: x.date, title: (x.title ?? "").slice(0, 100), views: x.views ?? null, likes: x.likes ?? null, comments: x.comments ?? null, shares: x.shares ?? null })) } });
    }
    for (const a of d.seosignalx ?? []) out.push({ name: `SEOSignalX ${a.audit} audit`, source: "SEOSignalX", rows: { score: a.score, rating: a.rating, failed_or_warning: a.failed.slice(0, 30) } });
  }
  const items = (await loadItems(admin, clientId)).filter((w) => w.seen_run && (w.status === "todo" || w.status === "doing") && (w.scope_screens.includes(screen) || screen === "gsc:overview" || screen === "ga4:home"));
  if (items.length) out.push({ name: `Open quick wins for ${screenLabel(screen)}`, source: "Quick wins engine", rows: items.slice(0, 10).map((w) => ({ rank: w.rank, title: w.title, page: w.page_url, gain: `${w.computed_gain} ${w.gain_unit}`, effort: w.effort })) });
  return out;
}

export const ASK_SYSTEM = `You answer questions about one business's website, search, analytics, local and social performance inside its reporting portal.
Rules:
- Answer only from the data blocks provided with the question. Quote the numbers you use, with their period.
- If the data can't answer the question, say so plainly and name the data that would be needed.
- Never invent numbers, pages, queries or causes; when you suggest a likely cause, say it is a hypothesis and what would confirm it.
- Be brief: a direct answer first, then up to 5 short bullet points. Plain language for a business owner.`;
