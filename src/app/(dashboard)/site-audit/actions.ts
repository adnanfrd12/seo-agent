"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { auditEstimate, pollAudit, RENDER_MODES, renderModeOf, startAudit, type AuditState } from "@/lib/dataforseo/audit";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { lighthouseUrls, refreshCrux, runLighthouse } from "@/lib/dataforseo/lighthouse";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Starts a crawl of the client's website. Owners and admins only, because it spends API credit. */
export async function runSiteAudit(maxPages: number, renderMode: string = "html"): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can start an audit." };
  if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured on the server." };
  if (!Number.isFinite(maxPages)) return { ok: false, error: "Choose how many pages to crawl." };
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const render = renderModeOf(renderMode);
    const { cost } = await startAudit({ admin: db, clientId: client.id, source: "manual" }, target, maxPages, render);
    // the weekly automatic audit keeps using the mode chosen here
    const { data: c } = await db.from("clients").select("settings").eq("id", client.id).maybeSingle();
    await db.from("clients").update({ settings: { ...((c?.settings as Record<string, unknown>) ?? {}), audit_render: render } }).eq("id", client.id);
    revalidatePath("/site-audit");
    return { ok: true, message: `Audit started for ${target.domain} (${RENDER_MODES[render].label.toLowerCase()}, $${(cost || auditEstimate(maxPages, render)).toFixed(3)}). Results appear here in a few minutes.` };
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
    // real-user data (free) for the same pages, so INP sits next to the lab scores
    try { await refreshCrux(db, client.id, urls); } catch { /* shown as not refreshed; the weekly job retries */ }
    revalidatePath("/site-audit");
    const failed = run.rows.filter((r) => r.error).length;
    return { ok: true, message: `Lighthouse tested ${urls.length} page${urls.length > 1 ? "s" : ""} on mobile and desktop ($${run.cost.toFixed(3)})${failed ? `; ${failed} test${failed > 1 ? "s" : ""} failed` : ""}.` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError ? e.message : "Lighthouse couldn't run. Try again." };
  }
}

/** Real-user Core Web Vitals (incl. INP) from Google's Chrome UX Report for the pages Lighthouse tested. Free. */
export async function refreshCruxNow(): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can refresh this." };
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    const tested = await lighthouseUrls(db, client.id);
    const urls = tested.length ? tested : target ? [`https://${target.domain}/`] : [];
    if (!urls.length) return { ok: false, error: "Set the client's website first." };
    const run = await refreshCrux(db, client.id, urls);
    revalidatePath("/site-audit");
    if (!run.source) return { ok: false, error: "Google didn't return real-user data; the reason is shown in the panel." };
    const pages = run.pages.filter((p) => p.page).length;
    return { ok: true, message: `Real-user data read for ${urls.length} page${urls.length > 1 ? "s" : ""}: ${pages} page/device record${pages === 1 ? "" : "s"}${run.origin.mobile || run.origin.desktop ? " plus the whole-site record" : ""}.` };
  } catch {
    return { ok: false, error: "Couldn't reach Google. Try again." };
  }
}
