import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { screenData } from "@/lib/aiqw/ask";
import { screenForPath, screenLabel } from "@/lib/aiqw/screens";
import { loadSocial } from "@/lib/social/fetch";
import { PLATFORM_INFO, PLATFORMS } from "@/lib/social/platforms";
import { coachEvidence } from "./coach";
import type { EvidenceItem } from "./evidence";

/**
 * AI data intelligence: one place that turns the client's stored, synced data into structured JSON for Claude.
 *
 *  - brief(): a compact evidence package (every connected source, with stable ids) sent with each request and
 *    cached for a few hours, so a conversation never re-reads every table.
 *  - detail(): larger datasets for one source, fetched only when Claude asks for them (tool calling).
 *  - history(): monthly totals for trend questions.
 *
 * New integrations become available to Nova and the roadmap by adding a DATA_VIEWS entry (and, for the brief, an
 * item in the shared evidence builder): nothing else needs to change.
 */

export interface Brief {
  builtAt: string;
  period: { start: string; end: string };
  connected: string[];
  unavailable: string[];
  items: EvidenceItem[];
}

/** Detailed views Claude can request. `screen` reuses the per-screen data blocks behind each screen's AI quick wins. */
export const DATA_VIEWS: { key: string; label: string; screen?: string; evidence?: RegExp }[] = [
  { key: "search_console_overview", label: "Search Console totals, top queries and top pages (28 days vs previous)", screen: "gsc:overview" },
  { key: "search_console_queries", label: "Search Console queries in detail", screen: "gsc:queries" },
  { key: "search_console_pages", label: "Search Console pages in detail", screen: "gsc:pages" },
  { key: "search_console_opportunities", label: "Search Console opportunities: quick wins, declining keywords, decaying pages", screen: "gsc:opps" },
  { key: "search_console_cannibalization", label: "Queries where several pages compete", screen: "gsc:cannibal" },
  { key: "search_console_indexing", label: "Indexing and coverage", screen: "gsc:indexing" },
  { key: "ga4_overview", label: "GA4 totals, channels and landing pages (leads, engagement)", screen: "ga4:home" },
  { key: "ga4_acquisition", label: "GA4 acquisition (channels, sources)", screen: "ga4:acq" },
  { key: "ga4_engagement", label: "GA4 engagement by page", screen: "ga4:eng" },
  { key: "ga4_leads", label: "GA4 leads and conversions", screen: "ga4:leads" },
  { key: "business_profile", label: "Google Business Profile performance, search terms and reviews", screen: "business-profile" },
  { key: "bing", label: "Bing Webmaster Tools search performance and crawl health", screen: "bing" },
  { key: "clarity", label: "Microsoft Clarity behaviour (rage clicks, dead clicks, scroll depth)", screen: "clarity" },
  { key: "social", label: "Connected social media accounts: followers, reach, views, engagement, posts", screen: "social" },
  { key: "keywords", label: "Ranking keywords (Search Console + DataForSEO)", screen: "dfs:keywords" },
  { key: "backlinks", label: "Backlink profile (DataForSEO)", screen: "dfs:backlinks" },
  { key: "competitors", label: "Competitor analysis: competitor sites, keyword gaps, head-to-head rankings", evidence: /^dfs\.(comp|gap|h2h|comp_threat)/ },
  { key: "rank_tracking", label: "Rank tracking for tracked keywords", evidence: /^rank\./ },
  { key: "site_audit", label: "Site audit issues and Lighthouse scores", evidence: /^(audit|lighthouse)\./ },
  { key: "ai_visibility", label: "AI assistant visibility (ChatGPT, Perplexity, Gemini, Claude)", evidence: /^ai\./ },
  { key: "local_seo", label: "Local SEO: reviews, map rank grid, local competitors", evidence: /^(gbp|maps)\./ },
  { key: "imported_reports", label: "Figures from imported PDF reports (not API-verified)", evidence: /^imported\./ },
];

const BRIEF_ENDPOINT = "ai_brief";
const VIEW_ENDPOINT = "ai_view";
const BRIEF_TTL_MS = 3 * 60 * 60 * 1000;
/** Nova answers from a brief up to this old while a fresh one is built in the background. */
const BRIEF_STALE_MAX_MS = 24 * 60 * 60 * 1000;

/** When any of the client's sources last synced (a cached brief or view older than this is out of date). Memoised
 * for a few seconds so one answer (brief + several views) asks once. */
const syncMemo = new Map<string, { at: number; value: Promise<number> }>();
function lastSync(admin: SupabaseClient, clientId: string): Promise<number> {
  const m = syncMemo.get(clientId);
  if (m && Date.now() - m.at < 20_000) return m.value;
  const value = Promise.resolve(admin.from("integration_connections").select("last_synced_at").eq("client_id", clientId).not("last_synced_at", "is", null).order("last_synced_at", { ascending: false }).limit(1).maybeSingle())
    .then(({ data }) => (data?.last_synced_at ? Date.parse(data.last_synced_at) : 0), () => 0);
  syncMemo.set(clientId, { at: Date.now(), value });
  return value;
}
const cachedRow = (admin: SupabaseClient, clientId: string, endpoint: string, key: string) =>
  admin.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", endpoint).eq("params_hash", key).maybeSingle();
const isFresh = (fetchedAt: string, synced: number) => { const at = Date.parse(fetchedAt); return Date.now() - at < BRIEF_TTL_MS && synced <= at; };

/** The compact evidence package, rebuilt when older than a few hours or after a sync. */
export async function brief(admin: SupabaseClient, clientId: string, timezone: string, opts: { fresh?: boolean } = {}): Promise<Brief> {
  if (!opts.fresh) {
    const [{ data: cached }, synced] = await Promise.all([cachedRow(admin, clientId, BRIEF_ENDPOINT, "brief"), lastSync(admin, clientId)]);
    if (cached && isFresh(cached.fetched_at, synced)) return cached.data as Brief;
  }
  const end = shiftDays(todayIn(timezone), -3), period = { start: shiftDays(end, -27), end };
  const ev = await coachEvidence(admin, clientId, period);
  const social = await socialEvidence(admin, clientId, period).catch(() => ({ items: [] as EvidenceItem[], unavailable: ["Social media accounts (could not be read)"] }));
  const items = [...ev.items, ...social.items];
  const out: Brief = { builtAt: new Date().toISOString(), period, connected: [...new Set(items.map((i) => i.source))], unavailable: [...ev.unavailable, ...social.unavailable], items };
  await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: BRIEF_ENDPOINT, params_hash: "brief", params: {}, data: out, row_count: out.items.length, cost: 0, fetched_at: out.builtAt }, { onConflict: "client_id,endpoint,params_hash" });
  return out;
}

/**
 * The brief for a chat answer, without making the user wait for a rebuild: a cached brief up to a day old is
 * used as is (refresh: true tells the caller to rebuild it in the background for the next message). Only a
 * missing or very old brief is built inline.
 */
export async function briefForChat(admin: SupabaseClient, clientId: string, timezone: string): Promise<{ brief: Brief; refresh: boolean }> {
  const [{ data: cached }, synced] = await Promise.all([cachedRow(admin, clientId, BRIEF_ENDPOINT, "brief"), lastSync(admin, clientId)]);
  if (cached) {
    if (isFresh(cached.fetched_at, synced)) return { brief: cached.data as Brief, refresh: false };
    if (Date.now() - Date.parse(cached.fetched_at) < BRIEF_STALE_MAX_MS) return { brief: cached.data as Brief, refresh: true };
  }
  return { brief: await brief(admin, clientId, timezone, { fresh: true }), refresh: false };
}

/** One screen's data blocks, cached like the brief (3 hours, or until the next sync), so repeat questions are instant. */
async function cachedScreen(admin: SupabaseClient, clientId: string, screen: string): Promise<Awaited<ReturnType<typeof screenData>>> {
  const [{ data: row }, synced] = await Promise.all([cachedRow(admin, clientId, VIEW_ENDPOINT, screen), lastSync(admin, clientId)]);
  if (row && isFresh(row.fetched_at, synced)) return ((row.data as { blocks?: Awaited<ReturnType<typeof screenData>> }).blocks ?? []);
  const blocks = await screenData(admin, clientId, screen);
  await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: VIEW_ENDPOINT, params_hash: screen, params: { screen }, data: { blocks }, row_count: blocks.length, cost: 0, fetched_at: new Date().toISOString() }, { onConflict: "client_id,endpoint,params_hash" })
    .then(() => undefined, () => undefined);
  return blocks;
}

const refreshing = new Set<string>();
/**
 * Gets Nova ready for this client before the first question: rebuilds a stale brief and caches the most-used
 * views (no AI calls, no cost). Safe to call often: it does nothing when everything is fresh.
 */
export async function warmNova(admin: SupabaseClient, clientId: string, timezone: string) {
  if (refreshing.has(clientId)) return;
  refreshing.add(clientId);
  try {
    const { refresh } = await briefForChat(admin, clientId, timezone);
    await Promise.all([
      refresh ? brief(admin, clientId, timezone, { fresh: true }) : null,
      ...["gsc:overview", "ga4:home"].map((s) => cachedScreen(admin, clientId, s).catch(() => [])),
    ]);
  } finally {
    refreshing.delete(clientId);
  }
}

/** Social accounts (stored reads, connected or public): audience, growth, reach, posting and the best post of the period. */
async function socialEvidence(admin: SupabaseClient, clientId: string, period: { start: string; end: string }) {
  const rows = await loadSocial(admin, clientId);
  const items: EvidenceItem[] = [];
  const add = (id: string, source: string, label: string, value: string, detail?: string) => items.push({ id, source, label, value, detail });
  const f = (n: number | null | undefined) => (n == null ? "n/a" : Math.round(n).toLocaleString("en-US"));
  for (const p of PLATFORMS) {
    const r = rows[p];
    if (!r || (r.status !== "ok" && !r.history.length)) continue;
    const src = `Social: ${PLATFORM_INFO[p].label}`, mode = r.mode === "connected" ? "connected account" : r.mode === "public" ? "public numbers only" : "token";
    const h = r.history.filter((x) => x.date >= period.start && x.date <= period.end && x.followers != null);
    add(`social.${p}.followers`, src, `${PLATFORM_INFO[p].label} followers${r.profile.handle ? ` (@${r.profile.handle.replace(/^@/, "")})` : ""}`, f(r.profile.followers),
      `${mode}${h.length >= 2 ? `; ${f(h[0].followers)} on ${h[0].date} → ${f(h[h.length - 1].followers)} on ${h[h.length - 1].date}` : ""}; read ${r.fetchedAt.slice(0, 10)}`);
    for (const [k, label] of [["views", "views"], ["impressions", "impressions"], ["reach", "reach"]] as const) {
      const v = r.totals?.[k] ?? (k === "views" ? r.profile.views : k === "impressions" ? r.profile.impressions : r.profile.reach);
      if (v != null) add(`social.${p}.${k}`, src, `${PLATFORM_INFO[p].label} ${label} (last 28 days as reported)`, f(v));
    }
    const posts = r.posts.filter((x) => x.date && x.date >= period.start && x.date <= period.end);
    const eng = (x: { likes: number | null; comments: number | null; shares: number | null }) => (x.likes ?? 0) + (x.comments ?? 0) + (x.shares ?? 0);
    add(`social.${p}.posts`, src, `${PLATFORM_INFO[p].label} posts published ${period.start} to ${period.end}`, String(posts.length),
      posts.length ? `${(posts.reduce((a, x) => a + eng(x), 0) / posts.length).toFixed(1)} likes+comments+shares per post` : `latest post ${r.posts.map((x) => x.date).filter(Boolean).sort().pop() ?? "unknown"}`);
    const top = [...r.posts].sort((a, b) => eng(b) - eng(a) || (b.views ?? 0) - (a.views ?? 0))[0];
    if (top) add(`social.${p}.top_post`, src, `${PLATFORM_INFO[p].label} best post among the latest ${r.posts.length}`, `${eng(top)} engagements${top.views != null ? `, ${f(top.views)} views` : ""}`, `${top.date ?? "?"}: "${(top.title || "(no text)").slice(0, 90)}"${top.url ? ` ${top.url}` : ""}`);
  }
  return { items, unavailable: items.length ? [] : ["Social media accounts (none connected or read yet)"] };
}

/** The brief as compact text: one line per evidence item (id | source | label | value | detail). */
export function briefText(b: Brief, maxItems = 220): string {
  return [
    `Data period: ${b.period.start} to ${b.period.end} (compared with the previous 28 days where shown).`,
    `Connected sources: ${b.connected.join(", ") || "none"}.`,
    "EVIDENCE (id | source | label | value | detail):",
    ...b.items.slice(0, maxItems).map((i) => `${i.id} | ${i.source} | ${i.label} | ${i.value}${i.detail ? ` | ${i.detail.slice(0, 220)}` : ""}`),
    b.items.length > maxItems ? `(${b.items.length - maxItems} more items available through tools)` : "",
    "NOT AVAILABLE (never make claims about these):",
    ...b.unavailable.map((u) => `- ${u}`),
  ].filter(Boolean).join("\n");
}

/** Which sources are connected and which detailed views can be requested. */
export function dataSources(b: Brief) {
  const ids = b.items.map((i) => i.id);
  return {
    period: b.period,
    connected: b.connected,
    not_available: b.unavailable,
    views: DATA_VIEWS.map((v) => ({ key: v.key, label: v.label, has_data: v.evidence ? ids.some((x) => v.evidence!.test(x)) : undefined })),
  };
}

const cap = (v: unknown, max = 14_000) => { const s = JSON.stringify(v); return s.length > max ? `${s.slice(0, max)}…(truncated)` : s; };

/** One detailed view as JSON (truncated to keep requests small). */
export async function detail(admin: SupabaseClient, clientId: string, b: Brief, view: string): Promise<string> {
  const v = DATA_VIEWS.find((x) => x.key === view);
  if (!v) return cap({ error: `Unknown view "${view}". Use one of: ${DATA_VIEWS.map((x) => x.key).join(", ")}` });
  if (v.screen) {
    const blocks = await cachedScreen(admin, clientId, v.screen);
    if (!blocks.length) return cap({ view, data: null, note: "No stored data for this view (not connected, not synced yet, or nothing in the period)." });
    return cap({ view, blocks });
  }
  const items = b.items.filter((i) => v.evidence!.test(i.id));
  return cap({ view, items: items.length ? items : null, note: items.length ? undefined : "Nothing stored for this view yet." });
}

/** Monthly totals for GA4, Search Console (web) and Business Profile over the last `months` complete months. */
export async function history(db: SupabaseClient, clientId: string, timezone: string, months: number): Promise<string> {
  const today = todayIn(timezone);
  const end = shiftDays(`${today.slice(0, 7)}-01`, -1);
  const startD = new Date(`${end.slice(0, 7)}-01T00:00:00Z`); startD.setUTCMonth(startD.getUTCMonth() - (months - 1));
  const start = startD.toISOString().slice(0, 10);
  const out: Record<string, unknown> = { months: `${start.slice(0, 7)} to ${end.slice(0, 7)}`, note: "Calendar-month totals from synced data. Months without stored data are missing, not zero." };
  for (const p of ["ga4", "gsc", "gbp"] as const) {
    const { data, error } = await db.rpc("get_analytics_trends", { p_client_id: clientId, p_provider: p, p_start: start, p_end: end, p_granularity: "month", p_compare: false, ...(p === "gsc" ? { p_search_type: "web" } : {}) });
    const rows = ((data as { current?: Record<string, unknown>[] } | null)?.current ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, typeof x === "number" ? Math.round(x * 1000) / 1000 : x])));
    out[p === "ga4" ? "google_analytics" : p === "gsc" ? "search_console_web" : "business_profile"] = error ? "unavailable" : rows.length ? rows : "no data";
  }
  return cap(out);
}

/**
 * What a dashboard page shows, so Nova can answer "this page" questions: the exact screen first (the same data
 * blocks the page's AI quick wins use), then the section the page belongs to.
 */
const PAGE_DATA: [RegExp, { screen?: string; view?: string; note?: string }][] = [
  [/^\/search-console(\/|$)/, { screen: "gsc:overview" }],
  [/^\/analytics(\/|$)/, { screen: "ga4:home" }],
  [/^\/business-profile(\/|$)/, { screen: "business-profile" }],
  [/^\/bing(\/|$)/, { screen: "bing" }],
  [/^\/clarity(\/|$)/, { screen: "clarity" }],
  [/^\/social(\/|$)/, { screen: "social" }],
  [/^\/seosignalx(\/|$)/, { screen: "seosignalx" }],
  [/^\/backlinks(\/|$)/, { screen: "dfs:backlinks" }],
  [/^\/(organic-keywords|keyword-research|keyword|ai-quick-wins\/keywords)(\/|$)/, { screen: "dfs:keywords" }],
  [/^\/competitors(\/|$)/, { view: "competitors" }],
  [/^\/rank-tracking(\/|$)/, { view: "rank_tracking" }],
  [/^\/(site-audit|technical-seo)(\/|$)/, { view: "site_audit" }],
  [/^\/ai-visibility(\/|$)/, { view: "ai_visibility" }],
  [/^\/(local-seo|reviews)(\/|$)/, { view: "local_seo" }],
  [/^\/(imports|history)(\/|$)/, { view: "imported_reports" }],
  [/^\/roadmap(\/|$)/, { note: "This is the SEO Roadmap page: read it with get_roadmap / get_roadmap_progress / get_roadmap_tasks." }],
  [/^\/(overview|insights|opportunities|strategy|coach|reports|ai-quick-wins)(\/|$)/, { note: "This page summarises data across sources; it is all in the evidence brief. Fetch a detailed view only if the question needs more." }],
];

export async function pageData(admin: SupabaseClient, clientId: string, b: Brief, path: string): Promise<string> {
  const rule = PAGE_DATA.find(([re]) => re.test(path))?.[1];
  const screen = screenForPath(path) ?? rule?.screen;
  if (screen) {
    const blocks = await cachedScreen(admin, clientId, screen);
    return cap({ page: path, shows: screenLabel(screen), blocks: blocks.length ? blocks : null, note: blocks.length ? undefined : "No stored data for this page yet (not connected, not synced, or nothing in the period)." });
  }
  if (rule?.view) return detail(admin, clientId, b, rule.view);
  return cap({ page: path, note: rule?.note ?? "This page has no dedicated dataset. Answer from the evidence brief, or fetch a detailed view with get_client_analytics." });
}

