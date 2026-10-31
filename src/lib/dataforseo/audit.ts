import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, recordSpend } from "./budget";
import { DfsError, dfsGet, dfsPost, dfsTaskPost } from "./client";
import { arr, num, obj, str, type Ctx, type Target } from "./research";

/**
 * Site audit (DataForSEO On-Page crawler). A crawl is an asynchronous task:
 *   start  -> one paid task_post (about $0.00015 per crawled page, e.g. 150 pages = 2 cents), id stored
 *   poll   -> free status checks (cron, and the Site Audit page while it is open)
 *   finish -> the crawled pages are fetched once (free), analysed here and stored for the page to read
 * Everything the dashboard shows comes from the stored result; opening the page never starts a crawl.
 */
export const PAGE_COST = 0.00015;
export const AUDIT_SIZES = [50, 150, 300, 500] as const;
export const DEFAULT_AUDIT_PAGES = 150;
/**
 * How pages are fetched. "html" reads the server's HTML only (cheapest). "js" runs the page's JavaScript first
 * (enable_javascript), so content and links added by scripts are seen. "browser" also loads every resource and
 * measures Core Web Vitals in a real browser (enable_browser_rendering). DataForSEO per-page prices:
 * $0.00015, $0.0015 and $0.0051 (help-center "cost of On-Page API parameters").
 */
export const RENDER_MODES = {
  html: { label: "HTML only", perPage: PAGE_COST },
  js: { label: "Render JavaScript", perPage: 0.0015 },
  browser: { label: "Full browser rendering", perPage: 0.0051 },
} as const;
export type RenderMode = keyof typeof RENDER_MODES;
export const renderModeOf = (v: unknown): RenderMode => (typeof v === "string" && v in RENDER_MODES ? (v as RenderMode) : "html");
export const auditEstimate = (pages: number, mode: RenderMode = "html") => Number((pages * RENDER_MODES[mode].perPage + 0.002).toFixed(4));
const STALE_AFTER_MS = 3 * 3_600_000; // a crawl that hasn't finished after 3 hours is given up on

export type Severity = "error" | "warning" | "notice";
export interface AuditIssue { key: string; label: string; severity: Severity; count: number; why: string; fix: string; urls: string[] }
export interface AuditPage { url: string; status: number | null; title: string | null; words: number | null; depth: number | null; ms: number | null; score: number | null; errors: number; warnings: number }
export interface AuditPoint { date: string; score: number | null; errors: number; warnings: number; pages: number }
export interface AuditResult {
  domain: string; startedAt: string; finishedAt: string; pages: number; maxPages: number;
  /** how pages were fetched; absent on audits stored before the option existed (those were HTML only) */
  render?: RenderMode;
  /** DataForSEO's on-page score, 0-100 */
  score: number | null;
  metrics: { internalLinks: number | null; externalLinks: number | null; brokenLinks: number | null; duplicateTitle: number | null; duplicateDescription: number | null; duplicateContent: number | null; nonIndexable: number | null };
  site: { sitemap: boolean | null; robots: boolean | null; ssl: boolean | null; http2: boolean | null; wwwRedirect: boolean | null; cms: string | null; server: string | null };
  issues: AuditIssue[];
  /** pages with the most problems first, at most 500 */
  rows: AuditPage[];
  cleanPages: number;
  history: AuditPoint[];
  previous: { date: string; score: number | null; errors: number; warnings: number; counts: Record<string, number> } | null;
}
export interface AuditTask {
  id: string; domain: string; maxPages: number; startedAt: string; status: "crawling" | "done" | "failed";
  crawled?: number; queued?: number; checkedAt?: string; error?: string; source: "auto" | "manual";
  render?: RenderMode;
}

type Check = { key: string; label: string; severity: Severity; why: string; fix: string; test?: (p: Json) => boolean };
type Json = Record<string, unknown>;

/** What the crawler can flag, in the order they are shown. A flag the crawler doesn't report simply never matches. */
const CATALOG: Check[] = [
  { key: "is_5xx_code", label: "Server errors (5xx)", severity: "error", why: "Pages that crash for visitors and search engines.", fix: "Check the server logs for these URLs and fix or remove them." },
  { key: "is_4xx_code", label: "Broken pages (4xx)", severity: "error", why: "Visitors and Google land on an error page, and any links pointing here are wasted.", fix: "Restore the page, redirect it to a relevant live page, or remove the links that point to it." },
  { key: "no_title", label: "Missing page title", severity: "error", why: "The title is the headline in Google results; without one Google invents it.", fix: "Write a unique title of about 30-60 characters that includes the main keyword." },
  { key: "canonical_to_broken", label: "Canonical points to a broken page", severity: "error", why: "Tells Google the 'real' version is a page that doesn't work, so this page can drop out of results.", fix: "Point the canonical tag at a working URL (usually the page itself)." },
  { key: "is_http", label: "Served over HTTP, not HTTPS", severity: "error", why: "Browsers warn visitors, and HTTPS is a ranking signal.", fix: "Redirect all HTTP URLs to HTTPS and update internal links." },
  { key: "duplicate_title", label: "Duplicate page titles", severity: "warning", why: "Several pages with the same title compete against each other.", fix: "Give each page a unique, descriptive title.", test: (p) => flagged(p.duplicate_title) },
  { key: "no_description", label: "Missing meta description", severity: "warning", why: "The description is the text under the title in results; a good one lifts click-through.", fix: "Write a unique 70-160 character description that invites the click." },
  { key: "duplicate_description", label: "Duplicate meta descriptions", severity: "warning", why: "Identical descriptions make pages look interchangeable in results.", fix: "Write a unique description for each page.", test: (p) => flagged(p.duplicate_description) },
  { key: "no_h1_tag", label: "Missing H1 heading", severity: "warning", why: "The H1 tells visitors and Google what the page is about.", fix: "Add one clear H1 that matches the page topic." },
  { key: "title_too_long", label: "Title too long", severity: "warning", why: "Google cuts long titles off, hiding your message.", fix: "Shorten the title to roughly 60 characters." },
  { key: "is_redirect", label: "Pages that redirect", severity: "warning", why: "Each redirect adds a delay and can lose some link value.", fix: "Update internal links to point straight at the final URL." },
  { key: "has_links_to_redirects", label: "Links pointing at redirects", severity: "warning", why: "Internal links that go through a redirect slow visitors and crawlers.", fix: "Replace these links with the final destination URL." },
  { key: "canonical_chain", label: "Canonical chains", severity: "warning", why: "A canonical that points to another canonical confuses Google about which page counts.", fix: "Point each canonical straight at the final page." },
  { key: "redirect_chain", label: "Redirect chains", severity: "warning", why: "Several redirects in a row slow the page and waste crawl budget.", fix: "Redirect the first URL straight to the last one." },
  { key: "is_broken", label: "Broken links or resources", severity: "warning", why: "Links or files on these pages don't work.", fix: "Fix or remove the broken links." },
  { key: "is_orphan_page", label: "Orphan pages (no internal links)", severity: "warning", why: "Pages nothing links to are hard for Google and visitors to find.", fix: "Link to them from related pages or the navigation, or remove them." },
  { key: "high_loading_time", label: "Slow loading", severity: "warning", why: "Slow pages lose visitors and rankings.", fix: "Compress images, enable caching and review heavy scripts." },
  { key: "low_content_rate", label: "Little text compared with code", severity: "notice", why: "Pages that are mostly code and little readable content tend to rank poorly.", fix: "Add useful text, or slim down the page code." },
  { key: "title_too_short", label: "Title too short", severity: "notice", why: "A very short title wastes space to describe the page.", fix: "Expand it to describe the page and include the main keyword." },
  { key: "no_image_alt", label: "Images without alt text", severity: "notice", why: "Alt text helps accessibility and image search.", fix: "Describe each meaningful image in its alt attribute." },
  {
    key: "thin_content", label: "Thin content (under 200 words)", severity: "notice", why: "Very short pages rarely satisfy what searchers want.", fix: "Expand them with useful detail, or merge them into stronger pages.",
    test: (p) => num(obj(obj(p.meta).content).plain_text_word_count) !== null && (num(obj(obj(p.meta).content).plain_text_word_count) as number) < 200 && num(p.status_code) === 200,
  },
];

/** The crawler reports duplicates on the page itself, as a flag or a list of the other pages. */
const flagged = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v === true);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

/** Turns the crawler's page list and summary into what the dashboard shows. */
export function analyse(task: AuditTask, summary: Json, items: Json[], prev: AuditResult | null): AuditResult {
  const pages = items.filter((p) => (str(p.resource_type) ?? "html") === "html");
  const issues: AuditIssue[] = [];
  const perPage = new Map<string, { errors: number; warnings: number }>();
  for (const c of CATALOG) {
    const hit = pages.filter((p) => (c.test ? c.test(p) : obj(p.checks)[c.key] === true));
    if (!hit.length) continue;
    issues.push({ key: c.key, label: c.label, severity: c.severity, count: hit.length, why: c.why, fix: c.fix, urls: hit.map((p) => str(p.url)).filter((u): u is string => Boolean(u)).slice(0, 10) });
    for (const p of hit) {
      const u = str(p.url) ?? "";
      const cur = perPage.get(u) ?? { errors: 0, warnings: 0 };
      if (c.severity === "error") cur.errors++; else if (c.severity === "warning") cur.warnings++;
      perPage.set(u, cur);
    }
  }
  const rows: AuditPage[] = pages.map((p) => {
    const u = str(p.url) ?? "";
    const m = obj(p.meta), t = obj(p.page_timing), f = perPage.get(u) ?? { errors: 0, warnings: 0 };
    return {
      url: u, status: num(p.status_code), title: str(m.title)?.slice(0, 140) ?? null, words: num(obj(m.content).plain_text_word_count), depth: num(p.click_depth),
      ms: num(t.duration_time), score: num(p.onpage_score) === null ? null : Math.round(num(p.onpage_score) as number), errors: f.errors, warnings: f.warnings,
    };
  }).sort((a, b) => (b.errors - a.errors) || (b.warnings - a.warnings)).slice(0, 500);
  const cleanPages = pages.filter((p) => { const f = perPage.get(str(p.url) ?? ""); return !f || (f.errors === 0 && f.warnings === 0); }).length;

  const dm = obj(summary.page_metrics), di = obj(summary.domain_info), dc = obj(di.checks);
  const errors = issues.filter((i) => i.severity === "error").reduce((a, i) => a + i.count, 0);
  const warnings = issues.filter((i) => i.severity === "warning").reduce((a, i) => a + i.count, 0);
  const finishedAt = new Date().toISOString();
  const score = num(dm.onpage_score) === null ? null : Math.round(num(dm.onpage_score) as number);
  const point: AuditPoint = { date: finishedAt.slice(0, 10), score, errors, warnings, pages: pages.length };
  return {
    domain: task.domain, startedAt: task.startedAt, finishedAt, pages: pages.length, maxPages: task.maxPages, score, render: task.render ?? "html",
    metrics: {
      internalLinks: num(dm.links_internal), externalLinks: num(dm.links_external), brokenLinks: num(dm.broken_links), duplicateTitle: num(dm.duplicate_title),
      duplicateDescription: num(dm.duplicate_description), duplicateContent: num(dm.duplicate_content), nonIndexable: num(dm.non_indexable),
    },
    site: { sitemap: bool(dc.sitemap), robots: bool(dc.robots_txt), ssl: bool(dc.ssl), http2: bool(dc.http2), wwwRedirect: bool(dc.test_www_redirect), cms: str(di.cms), server: str(di.server) },
    issues, rows, cleanPages,
    history: [...(prev?.history ?? []).filter((h) => h.date !== point.date), point].slice(-26),
    previous: prev ? { date: prev.finishedAt.slice(0, 10), score: prev.score, errors: prev.issues.filter((i) => i.severity === "error").reduce((a, i) => a + i.count, 0), warnings: prev.issues.filter((i) => i.severity === "warning").reduce((a, i) => a + i.count, 0), counts: Object.fromEntries(prev.issues.map((i) => [i.key, i.count])) } : null,
  };
}

/* ------------------------------------------------------------------ storage (dfs_cache, one row each per client) */
const save = (admin: SupabaseClient, clientId: string, endpoint: "audit" | "audit_task", data: unknown, cost = 0) =>
  admin.from("dfs_cache").upsert({ client_id: clientId, endpoint, params_hash: endpoint, params: {}, data, row_count: 1, cost, fetched_at: new Date().toISOString() }, { onConflict: "client_id,endpoint,params_hash" });
const read = async <T,>(admin: SupabaseClient, clientId: string, endpoint: "audit" | "audit_task") => {
  const { data } = await admin.from("dfs_cache").select("data, fetched_at").eq("client_id", clientId).eq("endpoint", endpoint).eq("params_hash", endpoint).maybeSingle();
  return data ? { data: data.data as T, fetchedAt: data.fetched_at as string } : null;
};

/** Starts a crawl (the only paid step). Refuses while one is already running. */
export async function startAudit(ctx: Ctx, target: Target, maxPages: number, render: RenderMode = "html"): Promise<{ id: string; cost: number }> {
  const pages = Math.min(Math.max(Math.round(maxPages), 10), 500);
  const existing = await read<AuditTask>(ctx.admin, ctx.clientId, "audit_task");
  if (existing?.data.status === "crawling" && Date.now() - Date.parse(existing.data.startedAt) < STALE_AFTER_MS) {
    throw new DfsError("An audit is already running for this site. Its results appear here when it finishes.", "bad_request");
  }
  await assertBudget(ctx.admin, ctx.clientId, auditEstimate(pages, render), ctx.source);
  const { id, cost } = await dfsTaskPost("/on_page/task_post", {
    target: target.domain, max_crawl_pages: pages, crawl_delay: 1000, respect_sitemap: true, enable_www_redirect_check: true, tag: ctx.clientId.slice(0, 8),
    ...(render === "js" ? { enable_javascript: true } : render === "browser" ? { enable_javascript: true, load_resources: true, enable_browser_rendering: true } : {}),
  });
  await recordSpend(ctx.admin, ctx.clientId, "audit", cost, ctx.source);
  const task: AuditTask = { id, domain: target.domain, maxPages: pages, startedAt: new Date().toISOString(), status: "crawling", source: ctx.source, checkedAt: new Date().toISOString(), render };
  await save(ctx.admin, ctx.clientId, "audit_task", task, cost);
  return { id, cost };
}

export type AuditState = { state: "none" } | { state: "crawling"; crawled: number; max: number } | { state: "done" } | { state: "failed"; error: string };

/** Free status check. When the crawl has finished, collects and stores the result. Safe to call as often as wanted. */
export async function pollAudit(admin: SupabaseClient, clientId: string): Promise<AuditState> {
  const t = await read<AuditTask>(admin, clientId, "audit_task");
  if (!t) return { state: "none" };
  const task = t.data;
  if (task.status === "done") return { state: "done" };
  if (task.status === "failed") return { state: "failed", error: task.error ?? "The crawl failed." };
  if (Date.now() - Date.parse(task.startedAt) > STALE_AFTER_MS) {
    await save(admin, clientId, "audit_task", { ...task, status: "failed", error: "The crawl didn't finish in time. Start a new audit." });
    return { state: "failed", error: "The crawl didn't finish in time. Start a new audit." };
  }
  const { status, result } = await dfsGet(`/on_page/summary/${task.id}`);
  if (status === 40401 || status === 40400) {
    await save(admin, clientId, "audit_task", { ...task, status: "failed", error: "DataForSEO no longer has this crawl. Start a new audit." });
    return { state: "failed", error: "DataForSEO no longer has this crawl. Start a new audit." };
  }
  const cs = obj(result?.crawl_status);
  const crawled = num(cs.pages_crawled) ?? 0;
  if (!result || result.crawl_progress !== "finished") {
    await save(admin, clientId, "audit_task", { ...task, crawled, queued: num(cs.pages_in_queue) ?? 0, checkedAt: new Date().toISOString() });
    return { state: "crawling", crawled, max: task.maxPages };
  }
  const { result: pageRes } = await dfsPost("/on_page/pages", { id: task.id, limit: 1000 }); // retrieval of a finished crawl is free
  const prev = (await read<AuditResult>(admin, clientId, "audit"))?.data ?? null;
  const out = analyse(task, result, arr(pageRes?.items), prev);
  await save(admin, clientId, "audit", out);
  await save(admin, clientId, "audit_task", { ...task, status: "done", crawled: out.pages, checkedAt: out.finishedAt });
  return { state: "done" };
}

/** The crawl mode an owner chose last (clients.settings.audit_render); the weekly automatic audit uses it too. */
export async function loadAuditRender(db: SupabaseClient, clientId: string): Promise<RenderMode> {
  const { data } = await db.from("clients").select("settings").eq("id", clientId).maybeSingle();
  return renderModeOf(obj(data?.settings).audit_render);
}

/** Everything the page and alerts read; no API calls. */
export async function loadAudit(supabase: SupabaseClient, clientId: string) {
  const [{ data: rows }] = await Promise.all([supabase.from("dfs_cache").select("endpoint, data, fetched_at").eq("client_id", clientId).in("endpoint", ["audit", "audit_task"])]);
  const get = <T,>(e: string) => { const r = rows?.find((x) => x.endpoint === e); return r ? { data: r.data as T, fetchedAt: r.fetched_at as string } : null; };
  return { result: get<AuditResult>("audit"), task: get<AuditTask>("audit_task") };
}
