"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { auditEstimate, pollAudit, startAudit, type AuditState } from "@/lib/dataforseo/audit";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { runLighthouse } from "@/lib/dataforseo/lighthouse";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Starts a crawl of the client's website. Owners and admins only, because it spends API credit. */
export async function runSiteAudit(maxPages: number): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can start an audit." };
  if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured on the server." };
  if (!Number.isFinite(maxPages)) return { ok: false, error: "Choose how many pages to crawl." };
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const { cost } = await startAudit({ admin: db, clientId: client.id, source: "manual" }, target, maxPages);
    revalidatePath("/site-audit");
    return { ok: true, message: `Audit started for ${target.domain} ($${(cost || auditEstimate(maxPages)).toFixed(3)}). Results appear here in a few minutes.` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError ? e.message : "Couldn't start the audit. Nothing was charged; try again." };
  }
}

/** Free progress check used by the page while a crawl is running; any member may call it. */
export async function checkSiteAudit(): Promise<AuditState> {
  const { client } = await getSession();
  if (!client || !dfsConfigured()) return { state: "none" };
  try {
    const state = await pollAudit(createAdminClient(), client.id);
    if (state.state === "done") revalidatePath("/site-audit");
    return state;
  } catch { return { state: "none" }; }
}

/** Lighthouse on the home page plus the most important pages, mobile and desktop ($0.005 per page per device). */
export async function runLighthouseNow(pages: number): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run Lighthouse." };
  if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured on the server." };
  const n = Math.min(3, Math.max(1, Math.round(pages)));
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    // home page first, then the pages that earn the most organic traffic, then the shallowest crawled pages
    const { data: cached } = await db.from("dfs_cache").select("endpoint, data").eq("client_id", client.id).in("endpoint", ["relevant_pages", "audit"]);
    const rel = ((cached ?? []).find((r) => r.endpoint === "relevant_pages")?.data ?? []) as { page: string | null; traffic: number | null }[];
    const audit = (cached ?? []).find((r) => r.endpoint === "audit")?.data as { rows?: { url: string; status: number | null; depth: number | null }[] } | undefined;
    const urls = [...new Set([
      `https://${target.domain}/`,
      ...rel.filter((r) => r.page).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0)).map((r) => (r.page!.startsWith("http") ? r.page! : `https://${r.page}`)),
      ...(audit?.rows ?? []).filter((r) => r.status === 200).sort((a, b) => (a.depth ?? 9) - (b.depth ?? 9)).map((r) => r.url),
    ])].slice(0, n);
    const run = await runLighthouse({ admin: db, clientId: client.id, source: "manual" }, urls, ["mobile", "desktop"]);
    revalidatePath("/site-audit");
    const failed = run.rows.filter((r) => r.error).length;
    return { ok: true, message: `Lighthouse tested ${urls.length} page${urls.length > 1 ? "s" : ""} on mobile and desktop ($${run.cost.toFixed(3)})${failed ? `; ${failed} test${failed > 1 ? "s" : ""} failed` : ""}.` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError ? e.message : "Lighthouse couldn't run. Try again." };
  }
}
