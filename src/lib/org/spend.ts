import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FEATURE_LABEL } from "@/lib/ai/usage";
import { MODELS, readSettings } from "@/lib/aiqw/settings";
import { shiftDays } from "@/lib/analytics/range";
import { AUTO_SHARE, getSettings as dfsSettings, PER_CLIENT_SHARE } from "@/lib/dataforseo/budget";
import { dfsBalance } from "@/lib/dataforseo/client";
import { pagedRows } from "@/lib/db/paged";
import { orgConfig, type OrgConfig } from "@/lib/org/config";

/**
 * Spend of a whole organization (every client, archived ones included), for the "AI spend" and "All tools spend"
 * tabs of the organization settings. Owners and admins only: the route that serves this checks the role first.
 *
 * Claude: the same records claudeUsage() (src/lib/ai/usage.ts) reads per client, read once for all clients of the
 * organization: Nova answers, roadmap generations, AI quick wins runs, AI insights / 30-day strategy / PDF import
 * runs, SEO Coach analyses and the usage log (ai_usage_events). Budgets: each client's monthly Claude budget and its
 * spend this calendar month (UTC), counted like claudeMonthSpend() (src/lib/aiqw/store.ts) so the numbers match the
 * limit that pauses AI features.
 * Tools: dfs_spend (every paid DataForSEO and treg.to call, automatic or manual) plus the Claude total.
 *
 * Days, months, "today" and the charts use the organization's time zone. The Claude budget month and the DataForSEO
 * daily limit are UTC, as the limits themselves are.
 */

export type SpendRange = "7d" | "30d" | "90d" | "12m";
export const SPEND_RANGES: SpendRange[] = ["7d", "30d", "90d", "12m"];
export type SpendKind = "ai" | "tools";

/** A user-facing failure (shown as is). */
export class SpendError extends Error {}

/* ------------------------------------------------------------------ types sent to the browser */
export interface SpendPeriod {
  range: SpendRange;
  bucket: "day" | "month";
  /** inclusive local days (organization time zone) */
  start: string; end: string; prevStart: string; prevEnd: string;
  today: string; timezone: string;
}
export interface SpendSeries { key: string; label: string; color: string; values: number[] }
export interface SpendSplit { id: string; label: string; series: SpendSeries[] }
export interface SpendKpis {
  today: number; yesterday: number;
  /** this calendar month so far ("YYYY-MM") and the pace for the whole month */
  month: number; monthKey: string; projected: number | null;
  lastMonth: number; lastMonthKey: string;
  range: number; prevRange: number;
  count: number; prevCount: number;
}
export interface SpendItem {
  key: string; label: string; cost: number; count: number; prevCost: number; prevCount: number;
  /** share of the range total (0..1) */
  share: number;
  /** its colour in the chart (null when folded into "Other") */
  color: string | null;
  clients: number; last: string | null;
}
export type BudgetStatus = "over" | "near" | "ok" | "off";
export interface AiClientRow {
  id: string; name: string; archived: boolean;
  cost: number; runs: number; prevCost: number; share: number; topFeature: string | null;
  /** Claude spend this calendar month (UTC), as the budget counts it */
  monthSpent: number; budget: number; used: number | null; status: BudgetStatus;
}
export interface AiSpendReport {
  kind: "ai";
  org: { id: string; name: string; timezone: string };
  generatedAt: string;
  period: SpendPeriod;
  buckets: string[];
  kpis: SpendKpis;
  splits: SpendSplit[];
  features: SpendItem[];
  models: SpendItem[];
  clients: AiClientRow[];
  budget: { month: string; totalBudget: number; totalSpent: number; over: number; near: number; off: number };
  counts: { clients: number; archived: number; withSpend: number };
}

export type ProviderId = "dataforseo" | "treg" | "claude";
export type GroupId = "rank" | "keywords" | "backlinks" | "competitors" | "ai_visibility" | "local" | "reviews" | "audit" | "lighthouse" | "youtube" | "social" | "other";
export interface EndpointRow {
  endpoint: string; label: string; group: GroupId; groupLabel: string; provider: ProviderId; providerLabel: string;
  calls: number; cost: number; avg: number; autoCalls: number; autoCost: number; manualCalls: number; manualCost: number;
  prevCalls: number; prevCost: number; clients: number; last: string | null;
}
export interface ToolsClientRow {
  id: string; name: string; archived: boolean;
  dataforseo: number; treg: number; claude: number; total: number;
  calls: number; runs: number; auto: number; manual: number; prevTotal: number; share: number;
}
export type ToolStatus = "set_up" | "not_set_up" | "per_client" | "unknown";
export interface ToolInfo { id: string; name: string; billing: "per_request" | "free" | "subscription"; note: string; status: ToolStatus }
export interface DfsLimitInfo {
  /** "global": the per-organization limit table isn't there yet, so this is the former platform-wide setting */
  scope: "organization" | "global";
  dailyLimit: number; autoLimit: number; perClientLimit: number; autoRefresh: boolean;
  /** UTC day the limit counts */
  today: string; spentToday: number; autoToday: number; manualToday: number;
  topToday: { name: string; cost: number }[];
  /** busiest UTC day of the range and how many days used 90%+ of today's limit */
  peak: { day: string; cost: number } | null; daysNear: number;
  balance: number | null; avgDaily30: number; runwayDays: number | null;
}
export interface ToolsSpendReport {
  kind: "tools";
  org: { id: string; name: string; timezone: string };
  generatedAt: string;
  period: SpendPeriod;
  buckets: string[];
  kpis: SpendKpis & { calls: { dataforseo: number; treg: number; claude: number } };
  splits: SpendSplit[];
  providers: (SpendItem & { status: ToolStatus })[];
  groups: (SpendItem & { provider: ProviderId; endpoints: number })[];
  endpoints: EndpointRow[];
  clients: ToolsClientRow[];
  source: { auto: { cost: number; calls: number; prevCost: number }; manual: { cost: number; calls: number; prevCost: number }; claude: { cost: number; runs: number } };
  dfs: DfsLimitInfo;
  tools: ToolInfo[];
  counts: { clients: number; archived: number; withSpend: number };
}
export type SpendReport = AiSpendReport | ToolsSpendReport;

/* ------------------------------------------------------------------ small helpers */
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round = (v: number, d = 6) => Math.round(v * 10 ** d) / 10 ** d;
const CAT = (i: number) => `var(--cat-${i + 1})`;
const OTHER_COLOR = "var(--cat-other)";
const CLAUDE_COLOR = "var(--cat-7)";

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return "UTC"; }
}
const fmts = new Map<string, Intl.DateTimeFormat>();
/** The local day ("YYYY-MM-DD") of a timestamp in a time zone, or null when it isn't a date. */
export function dayOf(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (tz === "UTC") return new Date(t).toISOString().slice(0, 10);
  let f = fmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }); fmts.set(tz, f); }
  return f.format(t);
}
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const daysIn = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
function dayList(a: string, b: string): string[] { const out: string[] = []; for (let d = a; d <= b; d = shiftDays(d, 1)) out.push(d); return out; }
function monthList(a: string, b: string): string[] { const out: string[] = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; }

/** The selected range and the one before it, in the organization's time zone, ending today (spend today is real). */
export function spendPeriod(range: SpendRange, timezone: string, now = new Date()): SpendPeriod {
  const today = dayOf(now.toISOString(), timezone) ?? now.toISOString().slice(0, 10);
  if (range === "12m") {
    const m = today.slice(0, 7);
    const start = `${addMonths(m, -11)}-01`;
    return { range, bucket: "month", start, end: today, prevStart: `${addMonths(m, -23)}-01`, prevEnd: shiftDays(start, -1), today, timezone };
  }
  const n = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const start = shiftDays(today, -(n - 1)), prevEnd = shiftDays(start, -1);
  return { range, bucket: "day", start, end: today, prevStart: shiftDays(prevEnd, -(n - 1)), prevEnd, today, timezone };
}
export const bucketsOf = (p: SpendPeriod) => (p.bucket === "day" ? dayList(p.start, p.end) : monthList(p.start.slice(0, 7), p.end.slice(0, 7)));
/** First local day whose records a report needs: the previous period, last month and the last 30 days. */
function firstDay(p: SpendPeriod): string {
  const lastMonthStart = `${addMonths(p.today.slice(0, 7), -1)}-01`;
  return [p.prevStart, lastMonthStart, shiftDays(p.today, -30)].sort()[0];
}
/** A UTC timestamp safely before the start of a local day in any time zone (offsets are within ±14 hours). */
const lowerBound = (day: string) => `${shiftDays(day, -1)}T00:00:00.000Z`;
const utcMonthStart = (now = new Date()) => `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`;

/* ------------------------------------------------------------------ reading */
type Res<T> = { data: T[]; error: unknown };
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const missingTable = (e: unknown) => { const c = (e as { code?: string } | null)?.code; return c === "42P01" || c === "PGRST205"; };
function rowsOf<T>(parts: Res<T>[], what: string, optional = false): T[] {
  for (const p of parts) {
    if (!p.error) continue;
    if (optional && missingTable(p.error)) return [];
    console.error(`org spend: reading ${what} failed`, (p.error as { message?: string })?.message ?? p.error);
    throw new SpendError(`Couldn't read ${what}. Try again in a moment.`);
  }
  return parts.flatMap((p) => p.data);
}
/** Runs async jobs with at most `n` in flight. */
async function pool<T>(jobs: (() => Promise<T>)[], n = 6): Promise<T[]> {
  const out = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const k = next++; out[k] = await jobs[k](); } }));
  return out;
}
/** Every row for these clients (ids in chunks so the request URL stays short), 1,000 per request. */
function readAll<T>(ids: string[], build: (ids: string[]) => (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<Res<T>[]> {
  return pool(chunk(ids, 120).map((part) => () => pagedRows<T>(build(part), 500_000)));
}

export interface OrgClient { id: string; name: string; archived: boolean; budget: number }
async function loadOrg(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin.from("organizations").select("id, name, timezone").eq("id", orgId).maybeSingle();
  if (error) throw new SpendError("Couldn't read this organization. Try again in a moment.");
  if (!data) throw new SpendError("This organization doesn't exist any more.");
  return { id: data.id as string, name: data.name as string, timezone: validTimeZone(data.timezone as string | null) };
}
async function loadClients(admin: SupabaseClient, orgId: string): Promise<OrgClient[]> {
  const res = await pagedRows<{ id: string; name: string; archived_at: string | null; ai_qw: unknown }>((from, to) =>
    admin.from("clients").select("id, name, archived_at, ai_qw:settings->ai_qw").eq("organization_id", orgId).order("id").range(from, to));
  return rowsOf([res], "the organization's clients").map((c) => ({ id: c.id, name: c.name, archived: Boolean(c.archived_at), budget: readSettings(c.ai_qw).monthlyBudget }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ Claude records (same sources as claudeUsage) */
export interface AiEvent { at: string; clientId: string; feature: string; model: string | null; cost: number }
const runFeature = (kind: string | null) => (kind === "strategy" ? "30-Day Strategy" : kind === "insights" ? "AI SEO Insights" : "PDF report reading");

/**
 * Every Claude record of these clients since `since` (all of them when null), plus each client's Claude spend this
 * calendar month (UTC) counted like claudeMonthSpend().
 */
export async function loadClaude(admin: SupabaseClient, ids: string[], since: string | null): Promise<{ events: AiEvent[]; month: Map<string, number> }> {
  if (!ids.length) return { events: [], month: new Map() };
  const monthStart = utcMonthStart(), askKey = `ask:${monthStart.slice(0, 7)}`;
  const from = since ?? "1970-01-01T00:00:00.000Z";
  type Nova = { client_id: string; created_at: string; cost_usd: unknown };
  type Roadmap = { client_id: string; created_at: string; cost: string | null; model: string | null };
  type Aiqw = { client_id: string; fetched_at: string; cost: unknown; started: string | null; ucost: string | null; umodel: string | null };
  type Run = { client_id: string; created_at: string; kind: string | null; model: string | null; cost_usd: unknown };
  type Coach = { client_id: string; fetched_at: string; cost: unknown; generated: string | null; dmodel: string | null; dcost: string | null };
  type Logged = { client_id: string; created_at: string; feature: string; model: string | null; cost_usd: unknown };
  type Ask = { client_id: string; cost: unknown };
  const [nova, roadmap, aiqw, runs, coach, logged, ask] = await Promise.all([
    readAll<Nova>(ids, (p) => (f, t) => admin.from("nova_messages").select("client_id, created_at, cost_usd").in("client_id", p).eq("role", "assistant").gt("cost_usd", 0).gte("created_at", from).order("id").range(f, t)),
    readAll<Roadmap>(ids, (p) => (f, t) => admin.from("roadmap_changes").select("client_id, created_at, cost:after->>cost_usd, model:after->>model").in("client_id", p).eq("action", "month.generate").gte("created_at", from).order("id").range(f, t)),
    // a run row is saved again as it progresses, so fetched_at is never before the run started
    readAll<Aiqw>(ids, (p) => (f, t) => admin.from("dfs_cache").select("client_id, fetched_at, cost, started:data->>startedAt, ucost:data->usage->>cost, umodel:data->usage->>model").in("client_id", p).eq("endpoint", "aiqw").like("params_hash", "run:%").gte("fetched_at", from).order("id").range(f, t)),
    readAll<Run>(ids, (p) => (f, t) => admin.from("ai_analysis_runs").select("client_id, created_at, kind, model, cost_usd").in("client_id", p).not("cost_usd", "is", null).gte("created_at", from).order("id").range(f, t)),
    readAll<Coach>(ids, (p) => (f, t) => admin.from("dfs_cache").select("client_id, fetched_at, cost, generated:data->>generatedAt, dmodel:data->>model, dcost:data->>cost").in("client_id", p).like("endpoint", "coach_%").gte("fetched_at", from).order("id").range(f, t)),
    readAll<Logged>(ids, (p) => (f, t) => admin.from("ai_usage_events").select("client_id, created_at, feature, model, cost_usd").in("client_id", p).gte("created_at", from).order("id").range(f, t)),
    // Nova answers and roadmap generations also add up in one row per month, which is what the budget counts
    readAll<Ask>(ids, (p) => (f, t) => admin.from("dfs_cache").select("client_id, cost").in("client_id", p).eq("endpoint", "aiqw").eq("params_hash", askKey).gte("fetched_at", monthStart).order("id").range(f, t)),
  ]);
  const novaRows = rowsOf(nova, "Nova answers"), roadmapRows = rowsOf(roadmap, "roadmap generations"), aiqwRows = rowsOf(aiqw, "AI quick wins runs");
  const runRows = rowsOf(runs, "AI analysis runs"), coachRows = rowsOf(coach, "SEO Coach analyses");
  // the usage log arrived with a later migration: without it, it simply adds nothing (as in claudeUsage)
  const loggedRows = rowsOf(logged, "the AI usage log", true), askRows = rowsOf(ask, "monthly AI totals");

  const events: AiEvent[] = [
    ...novaRows.map((r) => ({ at: r.created_at, clientId: r.client_id, feature: "Nova chat", model: null, cost: num(r.cost_usd) })),
    ...roadmapRows.map((r) => ({ at: r.created_at, clientId: r.client_id, feature: "SEO Roadmap", model: r.model ?? null, cost: num(r.cost) })),
    ...aiqwRows.map((r) => ({ at: r.started ?? r.fetched_at, clientId: r.client_id, feature: "AI Quick Wins", model: r.umodel ?? null, cost: num(r.ucost ?? r.cost) })),
    ...runRows.map((r) => ({ at: r.created_at, clientId: r.client_id, feature: runFeature(r.kind), model: r.model ?? null, cost: num(r.cost_usd) })),
    ...coachRows.map((r) => ({ at: r.generated ?? r.fetched_at, clientId: r.client_id, feature: "SEO Coach", model: r.dmodel ?? null, cost: num(r.dcost ?? r.cost) })),
    ...loggedRows.map((r) => ({ at: r.created_at, clientId: r.client_id, feature: FEATURE_LABEL[r.feature] ?? String(r.feature), model: r.model ?? null, cost: num(r.cost_usd) })),
  ].filter((e) => e.cost > 0 && Boolean(e.at));

  // this month's spend per client, as claudeMonthSpend() counts it
  const month = new Map<string, number>(), start = Date.parse(monthStart);
  const add = (id: string, v: unknown) => month.set(id, (month.get(id) ?? 0) + num(v));
  for (const r of askRows) add(r.client_id, r.cost);
  for (const r of aiqwRows) if (String(r.started ?? "") >= monthStart) add(r.client_id, r.cost);
  for (const r of loggedRows) if (Date.parse(r.created_at) >= start) add(r.client_id, r.cost_usd);
  for (const r of runRows) if (Date.parse(r.created_at) >= start) add(r.client_id, r.cost_usd);
  for (const r of coachRows) if (Date.parse(r.fetched_at) >= start) add(r.client_id, r.cost);
  return { events, month };
}

/* ------------------------------------------------------------------ DataForSEO and treg.to calls (dfs_spend) */
export interface ToolCall { at: string; day: string; clientId: string; endpoint: string; cost: number; source: "auto" | "manual" }
/** Every dfs_spend row of these clients from `sinceDay` (UTC day), read in parallel by month so a year stays quick. */
export async function loadToolCalls(admin: SupabaseClient, ids: string[], sinceDay: string | null): Promise<ToolCall[]> {
  if (!ids.length) return [];
  const end = shiftDays(new Date().toISOString().slice(0, 10), 1);
  const slices: [string | null, string | null][] = [];
  if (!sinceDay) slices.push([null, null]);
  else for (let a = sinceDay; a <= end; a = shiftDays(a, 31)) slices.push([a, shiftDays(a, 30) < end ? shiftDays(a, 30) : null]);
  type Row = { client_id: string; endpoint: string; cost: unknown; source: string; created_at: string; day: string };
  const jobs = slices.flatMap(([a, b]) => chunk(ids, 120).map((part) => () => pagedRows<Row>((f, t) => {
    let q = admin.from("dfs_spend").select("client_id, endpoint, cost, source, created_at, day").in("client_id", part);
    if (a) q = q.gte("day", a);
    if (b) q = q.lte("day", b);
    return q.order("id").range(f, t);
  }, 500_000)));
  return rowsOf(await pool(jobs), "API spend").map((r) => ({ at: r.created_at, day: r.day, clientId: r.client_id, endpoint: r.endpoint, cost: num(r.cost), source: r.source === "auto" ? "auto" : "manual" }));
}

/* ------------------------------------------------------------------ endpoint groups (where recordSpend is called) */
export const GROUP_LABEL: Record<GroupId, string> = {
  rank: "Rank tracking", keywords: "Keywords & search results", backlinks: "Backlinks", competitors: "Competitors",
  ai_visibility: "AI visibility (LLMs)", local: "Local SEO & maps", reviews: "Reviews & listings", audit: "On-page & site audit",
  lighthouse: "Lighthouse", youtube: "YouTube", social: "Social public numbers", other: "Other",
};
export const PROVIDER_LABEL: Record<ProviderId, string> = { dataforseo: "DataForSEO", treg: "treg.to", claude: "Anthropic Claude" };
const EXACT: Record<string, [GroupId, string]> = {
  rank: ["rank", "Rank checks (Google results)"], rank_metrics: ["rank", "Tracked keyword metrics"],
  ranked_keywords: ["keywords", "Organic keywords"], rank_overview: ["keywords", "Domain rank overview"], relevant_pages: ["keywords", "Top pages"],
  blog_keywords: ["keywords", "Blog keyword volumes"], aiqw_kw: ["keywords", "AI quick wins: keyword data"], aiqw_serp: ["keywords", "AI quick wins: Google results"],
  toolkit_serp: ["keywords", "SEO Toolkit: Google results"], fanout_volume: ["keywords", "Fan-out query volumes"], gbp_kw_volume: ["keywords", "Business Profile keyword volumes"],
  summary: ["backlinks", "Backlink summary"], new_lost: ["backlinks", "New and lost backlinks over time"], history: ["backlinks", "Backlink history"],
  backlinks: ["backlinks", "Backlink list"], new_backlinks: ["backlinks", "New backlinks"], lost_backlinks: ["backlinks", "Lost backlinks"],
  broken_backlinks: ["backlinks", "Broken backlinks"], referring_domains: ["backlinks", "Referring domains"], anchors: ["backlinks", "Anchor texts"],
  domain_pages: ["backlinks", "Linked pages"], link_gap: ["backlinks", "Link gap"],
  link_changes_is_new: ["backlinks", "Daily check: new backlinks"], link_changes_is_lost: ["backlinks", "Daily check: lost backlinks"],
  competitors: ["competitors", "Competitor list"], competitors_auto: ["competitors", "Competitor discovery"], domain_overview: ["competitors", "Competitor overview"],
  kw_gap: ["competitors", "Keyword gap"], kw_shared: ["competitors", "Shared keywords"], comp_pages: ["competitors", "Competitor top pages"],
  comp_links: ["competitors", "Competitor backlinks"], comp_history: ["competitors", "Competitor backlink history"],
  audit: ["audit", "Site audit crawl"], audit_detail: ["audit", "Site audit details"], lighthouse: ["lighthouse", "Lighthouse audit"],
  gbp_profile: ["local", "Business Profile data"], gbp_posts: ["local", "Business Profile posts"], maps_grid: ["local", "Map grid rankings"],
  gbp_reviews: ["reviews", "Google reviews"], review_profiles_discovery: ["reviews", "Review profile discovery"],
  ai_visibility: ["ai_visibility", "AI visibility check"], llm_brand_history: ["ai_visibility", "Brand mentions over time (ChatGPT)"],
  yt_organic: ["youtube", "YouTube search results"], yt_video_info: ["youtube", "YouTube video details"],
  api_tests: ["other", "API connection tests"],
};
const NAMES: Record<string, string> = {
  chat_gpt: "ChatGPT", google: "Google AI", perplexity: "Perplexity", gemini: "Gemini", claude: "Claude", entities: "ChatGPT, named as a brand",
  bbb: "BBB", yellowpages: "Yellow Pages", angi: "Angi", houzz: "Houzz", thumbtack: "Thumbtack", nextdoor: "Nextdoor", yelp: "Yelp",
  trustpilot: "Trustpilot", tripadvisor: "Tripadvisor", facebook: "Facebook", instagram: "Instagram", threads: "Threads", tiktok: "TikTok",
  twitter: "X (Twitter)", x: "X (Twitter)", linkedin: "LinkedIn", pinterest: "Pinterest", youtube: "YouTube", probe: "test lookup", history: "over time",
};
const nice = (s: string) => NAMES[s] ?? s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Which tool, group and readable name a dfs_spend endpoint belongs to. */
export function endpointInfo(endpoint: string): { provider: ProviderId; group: GroupId; label: string } {
  const exact = EXACT[endpoint];
  if (exact) return { provider: "dataforseo", group: exact[0], label: exact[1] };
  const rest = (p: string) => endpoint.slice(p.length);
  if (endpoint.startsWith("treg_")) return { provider: "treg", group: "social", label: `Public profile: ${nice(rest("treg_"))}` };
  if (endpoint.startsWith("keywords_")) return { provider: "dataforseo", group: "keywords", label: `Keyword research: ${rest("keywords_")}` };
  if (endpoint.startsWith("llm_topic_")) return { provider: "dataforseo", group: "ai_visibility", label: `Top domains in AI answers (${nice(rest("llm_topic_"))})` };
  if (endpoint.startsWith("llm_brand_")) return { provider: "dataforseo", group: "ai_visibility", label: `Brand mentions (${nice(rest("llm_brand_"))})` };
  if (endpoint.startsWith("llm_")) return { provider: "dataforseo", group: "ai_visibility", label: `AI answers: ${rest("llm_").replace(/_/g, " ")}` };
  if (endpoint.startsWith("listing_find_")) return { provider: "dataforseo", group: "reviews", label: `Listing search: ${nice(rest("listing_find_"))}` };
  if (endpoint.startsWith("listing_read_")) return { provider: "dataforseo", group: "reviews", label: `Listing page: ${nice(rest("listing_read_"))}` };
  if (endpoint.startsWith("listing_")) return { provider: "dataforseo", group: "reviews", label: `Listing page: ${nice(rest("listing_"))}` };
  if (endpoint.startsWith("reviews_")) return { provider: "dataforseo", group: "reviews", label: `Reviews: ${nice(rest("reviews_"))}` };
  if (endpoint.startsWith("link_changes_")) return { provider: "dataforseo", group: "backlinks", label: "Daily backlink check" };
  if (endpoint.startsWith("comp_")) return { provider: "dataforseo", group: "competitors", label: `Competitors: ${rest("comp_").replace(/_/g, " ")}` };
  if (endpoint.startsWith("yt_")) return { provider: "dataforseo", group: "youtube", label: `YouTube: ${rest("yt_").replace(/_/g, " ")}` };
  if (endpoint.startsWith("gbp_")) return { provider: "dataforseo", group: "local", label: `Business Profile: ${rest("gbp_").replace(/_/g, " ")}` };
  if (endpoint.startsWith("audit")) return { provider: "dataforseo", group: "audit", label: `Site audit: ${endpoint.replace(/_/g, " ")}` };
  return { provider: "dataforseo", group: "other", label: endpoint };
}

/** Readable model name ("claude-opus-5-5" → "Claude Opus 5.5"). */
export function modelLabel(id: string | null): string {
  if (!id) return "Model not recorded";
  if (id in MODELS) return MODELS[id as keyof typeof MODELS].label.replace(/ \(.*\)$/, "");
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  return m ? `Claude ${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : id;
}

/* ------------------------------------------------------------------ aggregation (pure) */
interface Placed { day: string; cur: boolean; prev: boolean; bucket: number }
/** Where a local day falls: in the range (and which chart bucket), in the previous period, or neither. */
function placer(p: SpendPeriod, buckets: string[]) {
  const index = new Map(buckets.map((b, i) => [b, i]));
  return (day: string): Placed => {
    const cur = day >= p.start && day <= p.end, prev = day >= p.prevStart && day <= p.prevEnd;
    return { day, cur, prev, bucket: cur ? index.get(p.bucket === "day" ? day : day.slice(0, 7)) ?? -1 : -1 };
  };
}
class Tally {
  cost = 0; count = 0; prevCost = 0; prevCount = 0; last: string | null = null;
  readonly clients = new Set<string>();
  values: number[];
  constructor(n: number) { this.values = new Array(n).fill(0); }
  add(pl: Placed, cost: number, at: string, clientId: string, count = 1) {
    if (pl.cur) {
      this.cost += cost; this.count += count; this.clients.add(clientId);
      if (pl.bucket >= 0) this.values[pl.bucket] += cost;
      if (!this.last || Date.parse(at) > Date.parse(this.last)) this.last = new Date(at).toISOString();
    } else if (pl.prev) { this.prevCost += cost; this.prevCount += count; }
  }
}
const tallyOf = <K,>(m: Map<K, Tally>, k: K, n: number) => { let t = m.get(k); if (!t) { t = new Tally(n); m.set(k, t); } return t; };

function kpisOf(p: SpendPeriod, items: { day: string; cost: number }[], range: Tally): SpendKpis {
  const yesterday = shiftDays(p.today, -1), month = p.today.slice(0, 7), lastMonth = addMonths(month, -1);
  let today = 0, yday = 0, mtd = 0, lm = 0;
  for (const e of items) {
    if (e.day === p.today) today += e.cost; else if (e.day === yesterday) yday += e.cost;
    if (e.day.startsWith(month)) mtd += e.cost; else if (e.day.startsWith(lastMonth)) lm += e.cost;
  }
  const dayNo = Number(p.today.slice(8, 10));
  return {
    today: round(today), yesterday: round(yday), month: round(mtd), monthKey: month,
    projected: dayNo >= 3 ? round((mtd / dayNo) * daysIn(month)) : null,
    lastMonth: round(lm), lastMonthKey: lastMonth,
    range: round(range.cost), prevRange: round(range.prevCost), count: range.count, prevCount: range.prevCount,
  };
}
/**
 * The biggest `n` entries get their own colour (in rank order); the rest fold into one grey "Other" series.
 * `keepOrder` keeps the given order (fixed sets such as tools, or automatic / manual), so the stack never reshuffles.
 */
function splitOf(id: string, label: string, entries: { key: string; label: string; t: Tally; color?: string }[], n: number, otherLabel: string, palette: string[], keepOrder = false): { split: SpendSplit; colors: Map<string, string> } {
  const ranked = entries.filter((e) => e.t.cost > 0);
  if (!keepOrder) ranked.sort((a, b) => b.t.cost - a.t.cost);
  const head = ranked.slice(0, n), tail = ranked.slice(n);
  const colors = new Map<string, string>();
  let slot = 0;
  const series: SpendSeries[] = head.map((e) => {
    const color = e.color ?? palette[slot++ % palette.length];
    colors.set(e.key, color);
    return { key: e.key, label: e.label, color, values: e.t.values.map((v) => round(v)) };
  });
  if (tail.length) {
    const values = tail[0].t.values.map((_, i) => round(tail.reduce((a, e) => a + e.t.values[i], 0)));
    series.push({ key: "__other", label: tail.length === 1 ? tail[0].label : `${otherLabel} (${tail.length})`, color: OTHER_COLOR, values });
  }
  return { split: { id, label, series }, colors };
}
function itemsOf(entries: { key: string; label: string; t: Tally }[], total: number, colors: Map<string, string>): SpendItem[] {
  return entries.filter((e) => e.t.cost > 0 || e.t.prevCost > 0)
    .map((e) => ({ key: e.key, label: e.label, cost: round(e.t.cost), count: e.t.count, prevCost: round(e.t.prevCost), prevCount: e.t.prevCount, share: total ? e.t.cost / total : 0, color: colors.get(e.key) ?? null, clients: e.t.clients.size, last: e.t.last }))
    .sort((a, b) => b.cost - a.cost || b.prevCost - a.prevCost);
}
const clientLabel = (c: OrgClient) => (c.archived ? `${c.name} (archived)` : c.name);

export function buildAiReport(input: { org: { id: string; name: string; timezone: string }; clients: OrgClient[]; period: SpendPeriod; events: AiEvent[]; month: Map<string, number>; now?: Date }): AiSpendReport {
  const { org, clients, period: p, events } = input;
  const buckets = bucketsOf(p), n = buckets.length, place = placer(p, buckets);
  const total = new Tally(n), byFeature = new Map<string, Tally>(), byModel = new Map<string, Tally>(), byClient = new Map<string, Tally>();
  const featureOfClient = new Map<string, Map<string, number>>();
  const known = new Set(clients.map((c) => c.id));
  const dated: { day: string; cost: number }[] = [];
  for (const e of events) {
    if (!known.has(e.clientId)) continue;
    const day = dayOf(e.at, p.timezone);
    if (!day) continue;
    dated.push({ day, cost: e.cost });
    const pl = place(day);
    if (!pl.cur && !pl.prev) continue;
    total.add(pl, e.cost, e.at, e.clientId);
    tallyOf(byFeature, e.feature, n).add(pl, e.cost, e.at, e.clientId);
    tallyOf(byModel, e.model ?? "", n).add(pl, e.cost, e.at, e.clientId);
    tallyOf(byClient, e.clientId, n).add(pl, e.cost, e.at, e.clientId);
    if (pl.cur) { const m = featureOfClient.get(e.clientId) ?? new Map<string, number>(); m.set(e.feature, (m.get(e.feature) ?? 0) + e.cost); featureOfClient.set(e.clientId, m); }
  }
  const palette = Array.from({ length: 8 }, (_, i) => CAT(i));
  const featureEntries = [...byFeature].map(([k, t]) => ({ key: k, label: k, t }));
  // models keep one colour each whatever the range: the three current models first, "not recorded" in grey
  const MODEL_SLOT: Record<string, number> = { "claude-opus-5-5": 6, "claude-sonnet-5-5": 0, "claude-haiku-5-5": 2 };
  const modelEntries = [...byModel].map(([k, t]) => ({ key: k, label: modelLabel(k || null), t, color: !k ? OTHER_COLOR : k in MODEL_SLOT ? CAT(MODEL_SLOT[k]) : undefined }));
  const byId = new Map(clients.map((c) => [c.id, c]));
  const clientEntries = [...byClient].map(([k, t]) => ({ key: k, label: clientLabel(byId.get(k)!), t }));
  const f = splitOf("feature", "Feature", featureEntries, 7, "Other features", palette);
  const m = splitOf("model", "Model", modelEntries, 7, "Other models", [1, 3, 4, 5, 7].map(CAT));
  const c = splitOf("client", "Client", clientEntries, 7, "Other clients", palette);

  const rows: AiClientRow[] = clients.map((cl) => {
    const t = byClient.get(cl.id);
    const spent = round(input.month.get(cl.id) ?? 0);
    const used = cl.budget > 0 ? spent / cl.budget : null;
    const status: BudgetStatus = cl.budget <= 0 ? "off" : spent >= cl.budget ? "over" : spent >= cl.budget * 0.8 ? "near" : "ok";
    const top = [...(featureOfClient.get(cl.id) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { id: cl.id, name: cl.name, archived: cl.archived, cost: round(t?.cost ?? 0), runs: t?.count ?? 0, prevCost: round(t?.prevCost ?? 0), share: total.cost ? (t?.cost ?? 0) / total.cost : 0, topFeature: top, monthSpent: spent, budget: cl.budget, used, status };
  }).sort((a, b) => b.cost - a.cost || b.monthSpent - a.monthSpent || a.name.localeCompare(b.name));
  const live = rows.filter((r) => !r.archived);
  return {
    kind: "ai", org, generatedAt: (input.now ?? new Date()).toISOString(), period: p, buckets,
    kpis: kpisOf(p, dated, total),
    splits: [f.split, m.split, c.split],
    features: itemsOf(featureEntries, total.cost, f.colors),
    models: itemsOf(modelEntries, total.cost, m.colors),
    clients: rows,
    budget: {
      month: utcMonthStart(input.now).slice(0, 7),
      totalBudget: round(live.reduce((a, r) => a + r.budget, 0)), totalSpent: round(rows.reduce((a, r) => a + r.monthSpent, 0)),
      over: live.filter((r) => r.status === "over").length, near: live.filter((r) => r.status === "near").length, off: live.filter((r) => r.status === "off").length,
    },
    counts: { clients: clients.length, archived: clients.filter((x) => x.archived).length, withSpend: rows.filter((r) => r.cost > 0).length },
  };
}

export function buildToolsReport(input: {
  org: { id: string; name: string; timezone: string }; clients: OrgClient[]; period: SpendPeriod; calls: ToolCall[]; events: AiEvent[];
  limit: { scope: "organization" | "global"; dailyBudget: number; autoRefresh: boolean }; balance: number | null; tools: ToolInfo[];
  status: Record<ProviderId, ToolStatus>; now?: Date;
}): ToolsSpendReport {
  const { org, clients, period: p } = input;
  const now = input.now ?? new Date();
  const buckets = bucketsOf(p), n = buckets.length, place = placer(p, buckets);
  const known = new Set(clients.map((c) => c.id)), byId = new Map(clients.map((c) => [c.id, c]));
  const total = new Tally(n);
  const byProvider = new Map<ProviderId, Tally>(), byGroup = new Map<GroupId, Tally>(), bySource = new Map<string, Tally>(), byClient = new Map<string, Tally>();
  const byEndpoint = new Map<string, { t: Tally; auto: Tally; manual: Tally }>();
  const perClient = new Map<string, { dataforseo: number; treg: number; claude: number; calls: number; runs: number; auto: number; manual: number }>();
  const pc = (id: string) => { let o = perClient.get(id); if (!o) { o = { dataforseo: 0, treg: 0, claude: 0, calls: 0, runs: 0, auto: 0, manual: 0 }; perClient.set(id, o); } return o; };
  const dated: { day: string; cost: number }[] = [];
  const callCount = { dataforseo: 0, treg: 0, claude: 0 };
  const utcToday = now.toISOString().slice(0, 10);
  const today = { total: 0, auto: 0, manual: 0, byClient: new Map<string, number>() };
  const utcDays = new Map<string, number>(), dfsLast30 = { cost: 0 };
  const day30 = shiftDays(utcToday, -29);

  for (const c of input.calls) {
    if (!known.has(c.clientId)) continue;
    const info = endpointInfo(c.endpoint);
    // the daily limit counts UTC days (dfs_spend.day), over the organization's whole spend
    if (c.day === utcToday) { today.total += c.cost; today[c.source] += c.cost; today.byClient.set(c.clientId, (today.byClient.get(c.clientId) ?? 0) + c.cost); }
    if (c.day >= day30 && c.day <= utcToday && info.provider === "dataforseo") dfsLast30.cost += c.cost;
    const day = dayOf(c.at, p.timezone) ?? c.day;
    dated.push({ day, cost: c.cost });
    const pl = place(day);
    if (!pl.cur && !pl.prev) continue;
    // the limit's own days, for the busiest day of the range
    if (pl.cur) utcDays.set(c.day, (utcDays.get(c.day) ?? 0) + c.cost);
    total.add(pl, c.cost, c.at, c.clientId);
    tallyOf(byProvider, info.provider, n).add(pl, c.cost, c.at, c.clientId);
    tallyOf(byGroup, info.group, n).add(pl, c.cost, c.at, c.clientId);
    tallyOf(bySource, c.source, n).add(pl, c.cost, c.at, c.clientId);
    tallyOf(byClient, c.clientId, n).add(pl, c.cost, c.at, c.clientId);
    let ep = byEndpoint.get(c.endpoint);
    if (!ep) { ep = { t: new Tally(n), auto: new Tally(n), manual: new Tally(n) }; byEndpoint.set(c.endpoint, ep); }
    ep.t.add(pl, c.cost, c.at, c.clientId);
    (c.source === "auto" ? ep.auto : ep.manual).add(pl, c.cost, c.at, c.clientId);
    if (pl.cur) {
      const o = pc(c.clientId);
      o[info.provider === "treg" ? "treg" : "dataforseo"] += c.cost; o.calls += 1; o[c.source] += c.cost;
      callCount[info.provider === "treg" ? "treg" : "dataforseo"] += 1;
    }
  }
  const claude = new Tally(n);
  for (const e of input.events) {
    if (!known.has(e.clientId)) continue;
    const day = dayOf(e.at, p.timezone);
    if (!day) continue;
    dated.push({ day, cost: e.cost });
    const pl = place(day);
    if (!pl.cur && !pl.prev) continue;
    total.add(pl, e.cost, e.at, e.clientId);
    claude.add(pl, e.cost, e.at, e.clientId);
    tallyOf(byProvider, "claude", n).add(pl, e.cost, e.at, e.clientId);
    tallyOf(byClient, e.clientId, n).add(pl, e.cost, e.at, e.clientId);
    if (pl.cur) { const o = pc(e.clientId); o.claude += e.cost; o.runs += 1; callCount.claude += 1; }
  }

  const palette = Array.from({ length: 8 }, (_, i) => CAT(i));
  const claudeSeries = (label: string): { key: string; label: string; t: Tally; color: string } => ({ key: "claude", label, t: claude, color: CLAUDE_COLOR });
  // providers keep fixed colours; Claude is the same purple on every split
  const PROVIDER_COLOR: Record<ProviderId, string> = { dataforseo: CAT(0), treg: CAT(1), claude: CLAUDE_COLOR };
  const providerEntries = (["dataforseo", "treg", "claude"] as ProviderId[]).map((k) => ({ key: k, label: PROVIDER_LABEL[k], t: byProvider.get(k) ?? new Tally(n), color: PROVIDER_COLOR[k] }));
  const groupEntries = [...byGroup].map(([k, t]) => ({ key: k, label: GROUP_LABEL[k], t }));
  const pv = splitOf("provider", "Tool", providerEntries, 3, "Other", palette, true);
  const gr = splitOf("group", "Group", groupEntries, 6, "Other tools", [0, 1, 2, 3, 4, 5, 7].map(CAT));
  const grClaude = claude.cost > 0 ? [{ key: "claude", label: "Claude (AI features)", color: CLAUDE_COLOR, values: claude.values.map((v) => round(v)) }] : [];
  const src = splitOf("source", "Automatic or manual", [
    { key: "auto", label: "Automatic (scheduled)", t: bySource.get("auto") ?? new Tally(n), color: "var(--series)" },
    { key: "manual", label: "Manual (button clicks)", t: bySource.get("manual") ?? new Tally(n), color: "color-mix(in oklab, var(--series) 40%, var(--surface))" },
    claudeSeries("Claude (not split)"),
  ], 3, "Other", palette, true);
  const clientEntries = [...byClient].map(([k, t]) => ({ key: k, label: clientLabel(byId.get(k)!), t }));
  const cl = splitOf("client", "Client", clientEntries, 7, "Other clients", palette);

  const providers = itemsOf(providerEntries, total.cost, pv.colors).map((i) => ({ ...i, status: input.status[i.key as ProviderId] ?? "unknown" as ToolStatus }));
  for (const k of ["dataforseo", "treg", "claude"] as ProviderId[]) if (!providers.some((x) => x.key === k)) providers.push({ key: k, label: PROVIDER_LABEL[k], cost: 0, count: 0, prevCost: 0, prevCount: 0, share: 0, color: PROVIDER_COLOR[k], clients: 0, last: null, status: input.status[k] ?? "unknown" });
  const endpointsPerGroup = new Map<GroupId, number>();
  const endpoints: EndpointRow[] = [...byEndpoint].map(([endpoint, v]) => {
    const info = endpointInfo(endpoint);
    if (v.t.count) endpointsPerGroup.set(info.group, (endpointsPerGroup.get(info.group) ?? 0) + 1);
    return {
      endpoint, label: info.label, group: info.group, groupLabel: GROUP_LABEL[info.group], provider: info.provider, providerLabel: PROVIDER_LABEL[info.provider],
      calls: v.t.count, cost: round(v.t.cost), avg: v.t.count ? round(v.t.cost / v.t.count) : 0,
      autoCalls: v.auto.count, autoCost: round(v.auto.cost), manualCalls: v.manual.count, manualCost: round(v.manual.cost),
      prevCalls: v.t.prevCount, prevCost: round(v.t.prevCost), clients: v.t.clients.size, last: v.t.last,
    };
  }).filter((e) => e.calls > 0 || e.prevCalls > 0).sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  const groups = itemsOf(groupEntries, total.cost, gr.colors).map((i) => ({ ...i, provider: (i.key === "social" ? "treg" : "dataforseo") as ProviderId, endpoints: endpointsPerGroup.get(i.key as GroupId) ?? 0 }));

  const clientRows: ToolsClientRow[] = clients.map((c) => {
    const o = perClient.get(c.id), t = byClient.get(c.id);
    const totalC = (o?.dataforseo ?? 0) + (o?.treg ?? 0) + (o?.claude ?? 0);
    return {
      id: c.id, name: c.name, archived: c.archived,
      dataforseo: round(o?.dataforseo ?? 0), treg: round(o?.treg ?? 0), claude: round(o?.claude ?? 0), total: round(totalC),
      calls: o?.calls ?? 0, runs: o?.runs ?? 0, auto: round(o?.auto ?? 0), manual: round(o?.manual ?? 0), prevTotal: round(t?.prevCost ?? 0),
      share: total.cost ? totalC / total.cost : 0,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const cap = input.limit.dailyBudget;
  const peak = [...utcDays].sort((a, b) => b[1] - a[1])[0];
  const avgDaily30 = dfsLast30.cost / 30;
  const auto = bySource.get("auto"), manual = bySource.get("manual");
  return {
    kind: "tools", org, generatedAt: now.toISOString(), period: p, buckets,
    kpis: { ...kpisOf(p, dated, total), calls: callCount },
    splits: [pv.split, { ...gr.split, series: [...gr.split.series, ...grClaude] }, src.split, cl.split],
    providers, groups, endpoints, clients: clientRows,
    source: {
      auto: { cost: round(auto?.cost ?? 0), calls: auto?.count ?? 0, prevCost: round(auto?.prevCost ?? 0) },
      manual: { cost: round(manual?.cost ?? 0), calls: manual?.count ?? 0, prevCost: round(manual?.prevCost ?? 0) },
      claude: { cost: round(claude.cost), runs: claude.count },
    },
    dfs: {
      scope: input.limit.scope, dailyLimit: cap, autoLimit: round(cap * AUTO_SHARE, 4), perClientLimit: round(cap * PER_CLIENT_SHARE, 4), autoRefresh: input.limit.autoRefresh,
      today: utcToday, spentToday: round(today.total), autoToday: round(today.auto), manualToday: round(today.manual),
      topToday: [...today.byClient].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, cost]) => ({ name: clientLabel(byId.get(id)!), cost: round(cost) })),
      peak: peak ? { day: peak[0], cost: round(peak[1]) } : null,
      daysNear: [...utcDays.values()].filter((v) => v >= cap * 0.9).length,
      balance: input.balance, avgDaily30: round(avgDaily30), runwayDays: input.balance != null && avgDaily30 > 0 ? Math.floor(input.balance / avgDaily30) : null,
    },
    tools: input.tools,
    counts: { clients: clients.length, archived: clients.filter((x) => x.archived).length, withSpend: clientRows.filter((r) => r.total > 0).length },
  };
}

/* ------------------------------------------------------------------ tools without a per-request cost */
const FREE_AND_SUBSCRIPTION: { id: string; name: string; billing: "free" | "subscription"; note: string; keys?: string[]; perClient?: boolean }[] = [
  { id: "composio", name: "Composio", billing: "free", note: "Google Analytics, Search Console and social media logins", keys: ["COMPOSIO_API_KEY"] },
  { id: "google", name: "Google APIs", billing: "free", note: "Business Profile, PageSpeed / Chrome UX Report and YouTube data", keys: ["GOOGLE_GBP_CLIENT_ID", "GOOGLE_API_KEY", "PAGESPEED_API_KEY", "YOUTUBE_API_KEY"] },
  { id: "bing", name: "Bing Webmaster Tools", billing: "free", note: "Bing search performance and crawl health", keys: ["BING_WEBMASTER_API_KEY"] },
  { id: "clarity", name: "Microsoft Clarity", billing: "free", note: "Recordings, rage clicks and errors, connected per client", perClient: true },
  { id: "lbm", name: "Local Brand Manager", billing: "subscription", note: "Business Profile data and geogrid rankings", keys: ["LOCAL_BRAND_MANAGER_API_TOKEN"] },
  { id: "seosignalx", name: "SEOSignalX", billing: "subscription", note: "Audits, patches and on-page signals", keys: ["SEOSIGNALX_MCP_TOKEN"] },
];
async function toolStatus(orgId: string): Promise<{ cfg: OrgConfig | null; tools: ToolInfo[]; status: Record<ProviderId, ToolStatus> }> {
  let cfg: OrgConfig | null = null;
  try { cfg = await orgConfig(orgId); } catch { /* shown as unknown */ }
  const has = (...keys: string[]): ToolStatus => (!cfg ? "unknown" : keys.some((k) => cfg!.has(k)) ? "set_up" : "not_set_up");
  return {
    cfg,
    tools: FREE_AND_SUBSCRIPTION.map((t) => ({ id: t.id, name: t.name, billing: t.billing, note: t.note, status: t.perClient ? "per_client" : has(...(t.keys ?? [])) })),
    status: {
      dataforseo: !cfg ? "unknown" : cfg.has("DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD") ? "set_up" : "not_set_up",
      treg: has("TREG_API_KEY"), claude: has("ANTHROPIC_API_KEY"),
    },
  };
}
/** The DataForSEO daily limit of the organization; "global" while the per-organization table isn't there yet. */
async function limitOf(admin: SupabaseClient, orgId: string) {
  const [probe, settings] = await Promise.all([
    admin.from("organization_dfs_settings").select("organization_id").eq("organization_id", orgId).maybeSingle(),
    dfsSettings(admin, { orgId }),
  ]);
  return { scope: (probe.error ? "global" : "organization") as "organization" | "global", ...settings };
}
/** `p`, or `fallback` when it fails or takes longer than `ms` (an outside service must not hold up the report). */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p.catch(() => fallback), new Promise<T>((r) => { timer = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------------ the two reports */
export async function aiSpendReport(admin: SupabaseClient, orgId: string, range: SpendRange): Promise<AiSpendReport> {
  const [org, clients] = await Promise.all([loadOrg(admin, orgId), loadClients(admin, orgId)]);
  const period = spendPeriod(range, org.timezone);
  const { events, month } = await loadClaude(admin, clients.map((c) => c.id), lowerBound(firstDay(period)));
  return buildAiReport({ org, clients, period, events, month });
}

export async function toolsSpendReport(admin: SupabaseClient, orgId: string, range: SpendRange): Promise<ToolsSpendReport> {
  const [org, clients, st, limit] = await Promise.all([loadOrg(admin, orgId), loadClients(admin, orgId), toolStatus(orgId), limitOf(admin, orgId)]);
  const period = spendPeriod(range, org.timezone);
  const first = firstDay(period), ids = clients.map((c) => c.id);
  const [calls, claude, balance] = await Promise.all([
    loadToolCalls(admin, ids, shiftDays(first, -1)),
    loadClaude(admin, ids, lowerBound(first)),
    st.cfg && st.status.dataforseo === "set_up" ? within(dfsBalance(st.cfg), 5000, null) : Promise.resolve(null),
  ]);
  return buildToolsReport({ org, clients, period, calls, events: claude.events, limit, balance, tools: st.tools, status: st.status });
}

/** Every record of the range, for the "download all records" CSV. */
export async function spendRecords(admin: SupabaseClient, orgId: string, kind: SpendKind, range: SpendRange): Promise<{ filename: string; headers: string[]; rows: unknown[][] }> {
  const [org, clients] = await Promise.all([loadOrg(admin, orgId), loadClients(admin, orgId)]);
  const p = spendPeriod(range, org.timezone), byId = new Map(clients.map((c) => [c.id, c])), ids = clients.map((c) => c.id);
  const inRange = (day: string | null): day is string => !!day && day >= p.start && day <= p.end;
  const name = (id: string) => byId.get(id)?.name ?? "", archived = (id: string) => (byId.get(id)?.archived ? "yes" : "no");
  const slug = org.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "organization";
  if (kind === "ai") {
    const { events } = await loadClaude(admin, ids, lowerBound(p.start));
    const rows = events.map((e) => ({ e, day: dayOf(e.at, p.timezone) })).filter((x) => inRange(x.day)).sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at))
      .map(({ e, day }) => [new Date(e.at).toISOString(), day, name(e.clientId), archived(e.clientId), e.feature, e.model ?? "", modelLabel(e.model), round(e.cost)]);
    return { filename: `${slug}-claude-spend-${p.start}_${p.end}.csv`, headers: ["Time (UTC)", `Day (${p.timezone})`, "Client", "Archived", "Feature", "Model id", "Model", "Cost (USD)"], rows };
  }
  const calls = await loadToolCalls(admin, ids, shiftDays(p.start, -1));
  const rows = calls.map((c) => ({ c, day: dayOf(c.at, p.timezone) ?? c.day })).filter((x) => inRange(x.day)).sort((a, b) => Date.parse(a.c.at) - Date.parse(b.c.at))
    .map(({ c, day }) => { const i = endpointInfo(c.endpoint); return [new Date(c.at).toISOString(), day, c.day, name(c.clientId), archived(c.clientId), PROVIDER_LABEL[i.provider], GROUP_LABEL[i.group], c.endpoint, i.label, c.source, round(c.cost)]; });
  return { filename: `${slug}-tools-spend-${p.start}_${p.end}.csv`, headers: ["Time (UTC)", `Day (${p.timezone})`, "Limit day (UTC)", "Client", "Archived", "Tool", "Group", "Endpoint", "What", "Automatic or manual", "Cost (USD)"], rows };
}
