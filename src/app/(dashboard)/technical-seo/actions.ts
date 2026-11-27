"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTechnicalChecks } from "@/lib/technical/checks";
import { explainCheck, fixKey, loadCheckFixes, type CheckFix } from "@/lib/technical/check-ai";
import { loadTechnical } from "@/lib/technical/load";
import { loadSecurity, runSecurityAudit, siteDomain } from "@/lib/technical/security";
import { explainSecurity } from "@/lib/technical/security-ai";
import { aiErrorMessage, aiUnavailable } from "@/lib/ai/claude";
import { budgetMessage, claudeBudget } from "@/lib/ai/usage";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Reads robots.txt, the sitemaps and up to 25 pages from the client's own website. Free; owners and admins only. */
export async function runTechnicalChecksNow(): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run the technical checks." };
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const r = await runTechnicalChecks(db, client.id, target.domain);
    revalidatePath("/technical-seo");
    return { ok: true, message: `Checked robots.txt, ${r.sitemaps.length} sitemap file${r.sitemaps.length === 1 ? "" : "s"} and ${r.pages.length} pages on ${r.domain} (free).` };
  } catch {
    return { ok: false, error: "The website couldn't be checked. Try again in a few minutes." };
  }
}

/**
 * Security audit of the client's website: the passive checks (free, about 20 seconds), then Claude audits the
 * results and the raw evidence (counts toward the monthly Claude budget; skipped with a note when AI isn't set up
 * or the budget is used up). Owners and admins only.
 */
export async function runSecurityAuditNow(): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run the security audit." };
  let base = "";
  try {
    const db = createAdminClient();
    const domain = await siteDomain(db, client.id);
    if (!domain) return { ok: false, error: "Set the client's website first." };
    const a = await runSecurityAudit(db, client.id, domain);
    revalidatePath("/technical-seo"); revalidatePath("/security-audit");
    if (a.error) return { ok: false, error: a.error };
    const issues = a.counts.high + a.counts.medium + a.counts.low + a.counts.info;
    base = `Security audit of ${a.domain}: score ${a.score}/100, ${issues} issue${issues === 1 ? "" : "s"}.`;
    const noAi = await aiUnavailable(client.id);
    if (noAi) return { ok: true, message: `${base} Claude's review was skipped: ${noAi}` };
    const b = await claudeBudget(db, client.id);
    if (b.left <= 0) return { ok: true, message: `${base} Claude's review was skipped: ${budgetMessage(b.budget)}` };
    const r = await explainSecurity(db, client.id, client.name, a);
    revalidatePath("/security-audit");
    return { ok: true, message: `${base} Claude audited it (AI cost $${r.cost.toFixed(3)}).` };
  } catch (e) {
    if (base) return { ok: true, message: `${base} Claude's review failed: ${aiErrorMessage(e)}` };
    return { ok: false, error: "The security audit couldn't run. Try again in a few minutes." };
  }
}

/** Claude writes a site-specific fix plan from the newest audit's failing checks (counts toward the monthly Claude budget). */
export async function explainSecurityAi(): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can use the AI fix plan." };
  try {
    const db = createAdminClient();
    const { audit } = await loadSecurity(db, client.id);
    if (!audit || audit.error) return { ok: false, error: "Run the security audit first." };
    const b = await claudeBudget(db, client.id);
    if (b.left <= 0) return { ok: false, error: budgetMessage(b.budget) };
    const r = await explainSecurity(db, client.id, client.name, audit);
    revalidatePath("/technical-seo"); revalidatePath("/security-audit");
    return { ok: true, message: `Claude security audit written (AI cost $${r.cost.toFixed(3)}).` };
  } catch (e) {
    return { ok: false, error: aiErrorMessage(e) };
  }
}

/**
 * The popup on a Technical SEO check: Claude's exact problem and fix for that check (stored; written again only when
 * the check's result changes). Anyone on the client reads a stored one; owners and admins write a new one (counts
 * toward the monthly Claude budget).
 */
export async function explainTechnicalCheck(checkId: string, regenerate = false): Promise<{ ok: true; fix: CheckFix } | { ok: false; error: string }> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  try {
    const db = createAdminClient();
    const { score, checks } = await loadTechnical(db, client.id);
    const check = score.categories.flatMap((c) => c.checks).find((c) => c.id === checkId);
    if (!check) return { ok: false, error: "That check isn't in the latest results. Reload the page." };
    if (!regenerate) {
      const stored = (await loadCheckFixes(db, client.id))[fixKey(check)];
      if (stored) return { ok: true, fix: stored };
    }
    if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "No AI explanation yet: an owner or admin opens this check to create one." };
    const b = await claudeBudget(db, client.id);
    if (b.left <= 0) return { ok: false, error: budgetMessage(b.budget) };
    const target = await resolveTarget(db, client.id);
    const fix = await explainCheck(db, client.id, { name: client.name, domain: target?.domain ?? "unknown" }, check, score, checks);
    return { ok: true, fix };
  } catch (e) {
    return { ok: false, error: aiErrorMessage(e) };
  }
}
