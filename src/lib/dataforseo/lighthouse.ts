import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertBudget, recordSpend } from "./budget";
import { dfsPost } from "./client";
import { num, obj, str, type Ctx } from "./research";

/**
 * Lighthouse (Google's page-quality test) through DataForSEO On-Page, run on a small sample of pages,
 * mobile and desktop. Measured: $0.005 per page per device. On demand only; results stored per run.
 */
export const LH_EST = 0.005;
export interface LhRow {
  url: string; device: "mobile" | "desktop";
  performance: number | null; accessibility: number | null; best_practices: number | null; seo: number | null;
  lcp_ms: number | null; cls: number | null; tbt_ms: number | null; ttfb_ms: number | null; fcp_ms: number | null; speed_index_ms: number | null;
  error?: string;
}
export interface LhRun { checkedAt: string; cost: number; rows: LhRow[] }

const pct = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : null);

export async function runLighthouse(ctx: Ctx, urls: string[], devices: ("mobile" | "desktop")[]): Promise<LhRun> {
  const jobs = urls.flatMap((url) => devices.map((device) => ({ url, device })));
  await assertBudget(ctx.admin, ctx.clientId, jobs.length * LH_EST, ctx.source);
  let cost = 0;
  const rows: LhRow[] = [];
  // Lighthouse runs take 10-60 s each; three at a time keeps the request inside the server time limit
  for (let i = 0; i < jobs.length; i += 3) {
    const done = await Promise.all(jobs.slice(i, i + 3).map(async ({ url, device }): Promise<LhRow> => {
      try {
        // a slow page can take over a minute; one attempt only, so a timeout never bills twice
        const r = await dfsPost("/on_page/lighthouse/live/json", { url, for_mobile: device === "mobile" }, { timeoutMs: 125_000, attempts: 1 });
        cost += r.cost;
        const res = obj(r.result), cat = obj(res.categories), au = obj(res.audits);
        const a = (k: string) => num(obj(au[k]).numericValue);
        return {
          url: str(res.finalUrl) ?? url, device,
          performance: pct(obj(cat.performance).score), accessibility: pct(obj(cat.accessibility).score),
          best_practices: pct(obj(cat["best-practices"]).score), seo: pct(obj(cat.seo).score),
          lcp_ms: a("largest-contentful-paint"), cls: a("cumulative-layout-shift"), tbt_ms: a("total-blocking-time"),
          ttfb_ms: a("server-response-time"), fcp_ms: a("first-contentful-paint"), speed_index_ms: a("speed-index"),
        };
      } catch (e) {
        return { url, device, performance: null, accessibility: null, best_practices: null, seo: null, lcp_ms: null, cls: null, tbt_ms: null, ttfb_ms: null, fcp_ms: null, speed_index_ms: null, error: e instanceof Error ? e.message : "failed" };
      }
    }));
    rows.push(...done);
  }
  await recordSpend(ctx.admin, ctx.clientId, "lighthouse", cost, ctx.source);
  const run: LhRun = { checkedAt: new Date().toISOString(), cost, rows };
  await ctx.admin.from("dfs_cache").upsert(
    { client_id: ctx.clientId, endpoint: "lighthouse", params_hash: run.checkedAt.slice(0, 10), params: { urls, devices }, data: run, row_count: rows.length, cost, fetched_at: run.checkedAt },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  return run;
}

/** Every stored run, newest first. */
export async function loadLighthouse(supabase: SupabaseClient, clientId: string): Promise<LhRun[]> {
  const { data } = await supabase.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "lighthouse").order("fetched_at", { ascending: false }).limit(20);
  return (data ?? []).map((r) => r.data as LhRun);
}

/* ------------------------------------------------------------------ real-user data (Chrome UX Report) */
/**
 * Lighthouse is a lab test: it can't measure INP (Interaction to Next Paint) because nobody interacts with
 * the page. Google's Chrome UX Report (CrUX) has what real Chrome users experienced over the last 28 days,
 * per page when a page has enough visits, else for the whole site (origin). Free: the CrUX API (needs an API
 * key with "Chrome UX Report API" allowed), falling back to PageSpeed Insights v5, which carries the same
 * field data. Stored in dfs_cache (endpoint "crux", one row per day, cost 0) and refreshed weekly.
 */
export type CruxKey = "inp" | "lcp" | "cls" | "ttfb" | "fcp";
/** p75 in ms (CLS unitless); good / ni / poor are shares 0-1 of page loads */
export interface CruxMetric { p75: number | null; good: number; ni: number; poor: number }
export interface CruxRecord { scope: "url" | "origin"; key: string; metrics: Partial<Record<CruxKey, CruxMetric>>; period: string | null }
export interface CruxEntry { url: string; device: "mobile" | "desktop"; page: CruxRecord | null }
export interface CruxRun {
  checkedAt: string; source: "crux_api" | "pagespeed" | null; error: string | null;
  origin: { mobile: CruxRecord | null; desktop: CruxRecord | null }; pages: CruxEntry[];
}
/** Google's thresholds: good up to the first value, poor above the second. */
export const CRUX_THRESHOLDS: Record<CruxKey, [number, number]> = { inp: [200, 500], lcp: [2500, 4000], cls: [0.1, 0.25], ttfb: [800, 1800], fcp: [1800, 3000] };
export const CRUX_EVERY_DAYS = 7;

const CRUX_API: Record<string, CruxKey> = {
  interaction_to_next_paint: "inp", largest_contentful_paint: "lcp", cumulative_layout_shift: "cls",
  experimental_time_to_first_byte: "ttfb", time_to_first_byte: "ttfb", first_contentful_paint: "fcp",
};
const PSI: Record<string, CruxKey> = {
  INTERACTION_TO_NEXT_PAINT: "inp", LARGEST_CONTENTFUL_PAINT_MS: "lcp", CUMULATIVE_LAYOUT_SHIFT_SCORE: "cls",
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: "ttfb", FIRST_CONTENTFUL_PAINT_MS: "fcp",
};
const shares = (list: unknown, key: "density" | "proportion") => {
  const v = (Array.isArray(list) ? list : []).map((x) => num(obj(x)[key]) ?? 0);
  return { good: v[0] ?? 0, ni: v[1] ?? 0, poor: v[2] ?? 0 };
};
class GoogleRefused extends Error {}

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000), cache: "no-store" });
  return { status: res.status, body: obj(await res.json().catch(() => ({}))) };
}
const refusal = (status: number, body: Record<string, unknown>) => {
  const e = obj(body.error);
  return `Google answered ${status} ${str(e.status) ?? ""}: ${(str(e.message) ?? "").slice(0, 160)}`;
};

/** CrUX API: one record for a page or the whole site; null when Google has too few visits (404). */
async function cruxApi(key: string, what: { url: string } | { origin: string }, device: "mobile" | "desktop"): Promise<CruxRecord | null> {
  const r = await getJson(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...what, formFactor: device === "mobile" ? "PHONE" : "DESKTOP" }),
  });
  if (r.status === 404) return null;
  if (r.status !== 200) throw new GoogleRefused(refusal(r.status, r.body));
  const rec = obj(r.body.record), metrics: CruxRecord["metrics"] = {};
  for (const [name, m] of Object.entries(obj(rec.metrics))) {
    const k = CRUX_API[name];
    if (!k) continue;
    const p = obj(obj(m).percentiles).p75;
    metrics[k] = { p75: typeof p === "string" ? Number(p) : num(p), ...shares(obj(m).histogram, "density") };
  }
  const end = obj(obj(rec.collectionPeriod).lastDate);
  return {
    scope: "url" in what ? "url" : "origin", key: "url" in what ? what.url : what.origin, metrics,
    period: num(end.year) ? `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}` : null,
  };
}

const psiRecord = (le: Record<string, unknown>, scope: "url" | "origin"): CruxRecord | null => {
  const metrics: CruxRecord["metrics"] = {};
  for (const [name, m] of Object.entries(obj(le.metrics))) {
    const k = PSI[name];
    if (!k) continue;
    const p = num(obj(m).percentile);
    // PageSpeed reports CLS x100 (5 = 0.05)
    metrics[k] = { p75: p == null ? null : k === "cls" ? p / 100 : p, ...shares(obj(m).distributions, "proportion") };
  }
  return Object.keys(metrics).length ? { scope, key: str(le.id) ?? "", metrics, period: null } : null;
};

/** PageSpeed Insights v5: page-level field data when it exists (not an origin fallback), plus the origin's. */
async function pageSpeed(key: string | null, url: string, device: "mobile" | "desktop") {
  const r = await getJson(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${device}&category=performance${key ? `&key=${encodeURIComponent(key)}` : ""}`);
  if (r.status !== 200) throw new GoogleRefused(refusal(r.status, r.body));
  const le = obj(r.body.loadingExperience);
  return { page: le.origin_fallback === true ? null : psiRecord(le, "url"), origin: psiRecord(obj(r.body.originLoadingExperience), "origin") };
}

/** Reads real-user data for these pages (mobile and desktop) and the whole site, and stores it. Never charged. */
export async function refreshCrux(admin: SupabaseClient, clientId: string, urls: string[]): Promise<CruxRun> {
  const key = process.env.PAGESPEED_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
  const devices = ["mobile", "desktop"] as const;
  const list = [...new Set(urls)].slice(0, 5);
  let origin = "";
  try { origin = new URL(list[0]).origin; } catch { /* no pages */ }
  const run: CruxRun = { checkedAt: new Date().toISOString(), source: null, error: null, origin: { mobile: null, desktop: null }, pages: [] };
  const errors: string[] = [];
  // 1. the CrUX API: fast, one small request per page and device
  if (key && origin) {
    try {
      const [om, od, ...pages] = await Promise.all([
        cruxApi(key, { origin }, "mobile"), cruxApi(key, { origin }, "desktop"),
        ...list.flatMap((url) => devices.map((d) => cruxApi(key, { url }, d))),
      ]);
      run.origin = { mobile: om, desktop: od };
      run.pages = list.flatMap((url, i) => devices.map((device, j) => ({ url, device, page: pages[i * 2 + j] })));
      run.source = "crux_api";
    } catch (e) { errors.push(`Chrome UX Report API: ${e instanceof Error ? e.message : "failed"}`); }
  }
  // 2. PageSpeed Insights (it also runs a lab test, so 10-40 s a call): with the key, then without one
  if (!run.source && origin) {
    for (const k of key ? [key, null] : [null]) {
      try {
        const res = await Promise.all(list.flatMap((url) => devices.map(async (device) => ({ url, device, ...(await pageSpeed(k, url, device)) }))));
        run.pages = res.map((r) => ({ url: r.url, device: r.device, page: r.page }));
        run.origin = { mobile: res.find((r) => r.device === "mobile" && r.origin)?.origin ?? null, desktop: res.find((r) => r.device === "desktop" && r.origin)?.origin ?? null };
        run.source = "pagespeed";
        break;
      } catch (e) { errors.push(`PageSpeed Insights${k ? "" : " without a key"}: ${e instanceof Error ? e.message : "failed"}`); }
    }
  }
  if (!run.source) run.error = errors.join(" · ") || "No pages to look up.";
  const rows = run.pages.filter((p) => p.page).length + (run.origin.mobile ? 1 : 0) + (run.origin.desktop ? 1 : 0);
  await admin.from("dfs_cache").upsert(
    { client_id: clientId, endpoint: "crux", params_hash: run.checkedAt.slice(0, 10), params: { urls: list }, data: run, row_count: rows, cost: 0, fetched_at: run.checkedAt },
    { onConflict: "client_id,endpoint,params_hash" },
  );
  return run;
}

/** The newest stored lookup and the newest one Google answered (they differ after a failed lookup). */
export async function loadCrux(supabase: SupabaseClient, clientId: string): Promise<{ latest: CruxRun | null; good: CruxRun | null }> {
  const { data } = await supabase.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "crux").order("fetched_at", { ascending: false }).limit(10);
  const runs = (data ?? []).map((r) => r.data as CruxRun);
  return { latest: runs[0] ?? null, good: runs.find((r) => r.source) ?? null };
}

/** The pages Lighthouse tested (newest runs first); the real-user lookup uses the same ones. */
export async function lighthouseUrls(supabase: SupabaseClient, clientId: string): Promise<string[]> {
  const runs = await loadLighthouse(supabase, clientId);
  return [...new Set(runs.flatMap((r) => r.rows.map((x) => x.url)))].slice(0, 5);
}
