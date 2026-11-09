import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAudit } from "@/lib/dataforseo/audit";
import { loadCrux, loadLighthouse } from "@/lib/dataforseo/lighthouse";
import { loadTechChecks, type TechChecks } from "./checks";
import { computeTechnical, type TechScore } from "./score";

/** Everything the Technical SEO view needs, from stored data only (no paid calls); missing pieces are tolerated. */
export async function loadTechnical(supabase: SupabaseClient, clientId: string): Promise<{ score: TechScore; checks: TechChecks | null }> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10);
  const safe = <T,>(p: PromiseLike<T>, fallback: T) => Promise.resolve(p).catch(() => fallback);
  const [audit, lighthouse, crux, checks, bing, blog] = await Promise.all([
    safe(loadAudit(supabase, clientId), { result: null, task: null }),
    safe(loadLighthouse(supabase, clientId), []),
    safe(loadCrux(supabase, clientId), { latest: null, good: null }),
    safe(loadTechChecks(supabase, clientId), null),
    safe(supabase.rpc("get_bing_summary", { p_client_id: clientId, p_start: start, p_end: end }).then((r) => r.data as { crawl?: Record<string, unknown>[] } | null), null),
    safe(supabase.from("blog_posts").select("url").eq("client_id", clientId).limit(2000).then((r) => (r.data ?? []) as { url: string | null }[]), []),
  ]);
  const crawl = bing?.crawl ?? [];
  const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : 0);
  const bingCrawl = crawl.length ? { crawled: crawl.reduce((s, c) => s + n(c.crawled_pages), 0), errors: crawl.reduce((s, c) => s + n(c.crawl_errors), 0), inIndex: n(crawl.at(-1)?.in_index) || null } : null;
  const score = computeTechnical({
    audit: audit.result?.data ?? null, lighthouse, crux: crux.latest, checks, bingCrawl,
    blogUrls: blog.map((b) => b.url).filter((u): u is string => Boolean(u)),
  });
  return { score, checks };
}
