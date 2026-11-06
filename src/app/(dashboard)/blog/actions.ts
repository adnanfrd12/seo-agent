"use server";

import { getSession } from "@/lib/analytics/client-context";
import { refreshPostKeywords } from "@/lib/blog/keywords";
import { syncBlog } from "@/lib/blog/sync";
import { auditEstimate, DEFAULT_AUDIT_PAGES, loadAudit, pollAudit, startAudit } from "@/lib/dataforseo/audit";
import { dfsConfigured } from "@/lib/dataforseo/client";
import { resolveTarget } from "@/lib/dataforseo/research";
import { revalidatePath } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function guard() {
  const { client } = await getSession();
  if (!client) return { error: "No client selected." } as const;
  if (!["owner", "admin"].includes(client.role)) return { error: "Only owners and admins can refresh blog content." } as const;
  return { client, db: createAdminClient() } as const;
}

/** Reads the client's blog now: new and changed posts, plus places and keywords for posts not read yet. */
export async function syncBlogNow(): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const r = await syncBlog(g.db, g.client.id, { deadline: Date.now() + 220_000 });
  if (r.stopped === "setup" || r.stopped === "source" || r.stopped === "storage") return { ok: false, error: r.errors[0] ?? "Couldn't read the blog." };
  // free: match the stored DataForSEO domain keywords to the posts
  const k = await refreshPostKeywords(g.db, g.client.id, { paid: "none", source: "manual" }).catch(() => null);
  revalidatePath("/blog");
  const parts = [
    `${r.listed} posts on the site (${r.source === "wordpress" ? "WordPress" : r.source === "crawler" ? "site crawler" : "sitemap"})`,
    r.fetched ? `${r.fetched} read` : "nothing new",
    r.geoRead ? `places and keywords for ${r.geoRead} ($${r.cost.toFixed(3)})` : "",
    r.removed ? `${r.removed} removed` : "",
    k?.matched ? `DataForSEO keywords matched to ${k.matched}` : "",
    r.geoPending > 0 || r.stopped === "time" || r.stopped === "cost limit" ? "more to read: press again to continue" : "",
  ].filter(Boolean);
  return { ok: true, message: `${parts.join(" · ")}.${r.errors.length ? ` Some posts couldn't be read: ${r.errors[0]}` : ""}` };
}

/** DataForSEO keywords for each post's own address: "new" = posts from the last 60 days, "all" = every post. */
export async function fetchBlogKeywordsNow(scope: "new" | "all"): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured (Integrations)." };
  const r = await refreshPostKeywords(g.db, g.client.id, { paid: scope, source: "manual", deadline: Date.now() + 220_000, maxPaid: 400 });
  revalidatePath("/blog");
  if (!r.paid && r.errors.length) return { ok: false, error: r.errors[0] };
  const more = r.stopped === "time" ? " Ran out of time: press again to continue." : r.stopped === "budget" ? ` Stopped at the daily budget: ${r.errors[0] ?? ""}` : "";
  return { ok: true, message: `Keywords fetched for ${r.paid} post${r.paid === 1 ? "" : "s"} ($${r.cost.toFixed(2)})${r.matched ? `, ${r.matched} more matched from stored data` : ""}.${more}` };
}

/** Posts found by DataForSEO's site crawler (adds posts only). Starts a crawl when there's no recent one. */
export async function crawlBlogNow(): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const state = await pollAudit(g.db, g.client.id).catch(() => ({ state: "none" as const }));
  if (state.state === "crawling") return { ok: true, message: `The site crawler is running (${state.crawled} of up to ${state.max} pages). Press again when it finishes.` };
  const { result } = await loadAudit(g.db, g.client.id);
  const recent = result && Date.now() - Date.parse(result.data.finishedAt) < 14 * 86_400_000;
  if (!recent) {
    if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured (Integrations)." };
    const target = await resolveTarget(g.db, g.client.id);
    if (!target) return { ok: false, error: "No website is known for this client yet." };
    try {
      const { cost } = await startAudit({ admin: g.db, clientId: g.client.id, source: "manual" }, target, DEFAULT_AUDIT_PAGES);
      revalidatePath("/blog");
      return { ok: true, message: `Started a DataForSEO crawl of up to ${DEFAULT_AUDIT_PAGES} pages (about $${(cost || auditEstimate(DEFAULT_AUDIT_PAGES)).toFixed(3)}). Press again in a few minutes to read the posts it finds; the daily run also picks them up.` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't start the crawl." };
    }
  }
  const r = await syncBlog(g.db, g.client.id, { via: "crawler", deadline: Date.now() + 220_000 });
  revalidatePath("/blog");
  if (r.stopped === "setup" || r.stopped === "source" || r.stopped === "storage") return { ok: false, error: r.errors[0] ?? "Couldn't read the crawl." };
  return { ok: true, message: `Checked ${r.listed} crawled page${r.listed === 1 ? "" : "s"} not stored yet: ${r.fetched} blog post${r.fetched === 1 ? "" : "s"} added${r.geoRead ? ` (places and keywords read, $${r.cost.toFixed(3)})` : ""}. Crawl from ${result!.data.finishedAt.slice(0, 10)}.` };
}
