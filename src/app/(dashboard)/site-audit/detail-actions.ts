"use server";

import { getSession } from "@/lib/analytics/client-context";
import { aiErrorMessage } from "@/lib/ai/claude";
import { budgetMessage, claudeBudget, recordClaudeUse } from "@/lib/ai/usage";
import { altCandidates, runAlt, runFix } from "@/lib/audit/ai";
import { auditDetail, readDetail, saveDetail, type AuditDetail } from "@/lib/audit/details";
import { estimateAltCost, estimateFixCost } from "@/lib/audit/guide";
import { dfsConfigured } from "@/lib/dataforseo/client";
import type { AuditResult } from "@/lib/dataforseo/audit";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type DetailResponse = { ok: true; detail: AuditDetail; fromCache: boolean } | { ok: false; error: string; sample?: string[] };
type AiResponse = { ok: true; detail: AuditDetail; message: string } | { ok: false; error: string };

const KEY = /^[a-z0-9_]{2,40}$/;

/**
 * What one issue affects. Stored details open instantly; otherwise they are read from the finished crawl
 * (free DataForSEO reads), so any member may open a panel. Re-reading on request is for owners and admins.
 */
export async function loadAuditDetail(key: string, force = false): Promise<DetailResponse> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!KEY.test(key)) return { ok: false, error: "Unknown issue." };
  const canEdit = ["owner", "admin"].includes(client.role);
  if (force && !canEdit) return { ok: false, error: "Only owners and admins can refresh details." };
  const db = await createClient();
  const cached = await readDetail(db, client.id, key);
  if (!cached && !dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured on the server." };
  return auditDetail(db, createAdminClient(), client.id, key, force);
}

async function owner() {
  const { client } = await getSession();
  if (!client) return { error: "No client selected." } as const;
  if (!["owner", "admin"].includes(client.role)) return { error: "Only owners and admins can run AI fixes." } as const;
  return { client } as const;
}

/** Claude writes the exact fix for the affected items (at most 30 per run). Owners and admins; counts toward the Claude budget. */
export async function fixAuditIssue(key: string): Promise<AiResponse> {
  const o = await owner();
  if ("error" in o) return { ok: false, error: o.error! };
  const { client } = o;
  if (!KEY.test(key)) return { ok: false, error: "Unknown issue." };
  const admin = createAdminClient();
  const detail = await readDetail(admin, client.id, key);
  if (!detail) return { ok: false, error: "Open the details first." };
  const items = detail.kind === "groups" ? detail.groups?.length ?? 0 : detail.rows.length;
  if (!items) return { ok: false, error: "Nothing to fix here." };
  const b = await claudeBudget(admin, client.id);
  if (b.left < estimateFixCost(items)) return { ok: false, error: b.left <= 0 ? budgetMessage(b.budget) : `About $${estimateFixCost(items).toFixed(2)} is needed, but only $${b.left.toFixed(2)} of this month's Claude budget is left.` };
  try {
    const target = await resolveTarget(admin, client.id);
    const { data: a } = await admin.from("dfs_cache").select("data").eq("client_id", client.id).eq("endpoint", "audit").maybeSingle();
    const livePages = ((a?.data as AuditResult | undefined)?.rows ?? []).filter((r) => r.status === 200).map((r) => r.url);
    const r = await runFix(detail, { domain: target?.domain ?? "", livePages });
    await recordClaudeUse(admin, client.id, "site_audit_ai", r.model, r.cost);
    const next: AuditDetail = { ...detail, ai: { at: new Date().toISOString(), cost: r.cost, model: r.model, summary: r.summary, fixes: r.fixes } };
    await saveDetail(admin, client.id, next);
    return { ok: true, detail: next, message: `${r.fixes.length} fix${r.fixes.length === 1 ? "" : "es"} written ($${r.cost.toFixed(3)}).` };
  } catch (e) {
    return { ok: false, error: aiErrorMessage(e) };
  }
}

/** Claude looks at the next batch of images (up to 10) and suggests alt text and a title for each. Owners and admins. */
export async function suggestAltText(key: string): Promise<AiResponse> {
  const o = await owner();
  if ("error" in o) return { ok: false, error: o.error! };
  const { client } = o;
  if (key !== "no_image_alt" && key !== "no_image_title") return { ok: false, error: "Unknown issue." };
  const admin = createAdminClient();
  const detail = await readDetail(admin, client.id, key);
  if (!detail?.images?.length) return { ok: false, error: "Open the image list first." };
  const batch = altCandidates(detail.images, detail.alt, detail.altSkipped);
  if (!batch.length) return { ok: false, error: "Every listed image already has a suggestion." };
  const b = await claudeBudget(admin, client.id);
  if (b.left < estimateAltCost(batch.length)) return { ok: false, error: b.left <= 0 ? budgetMessage(b.budget) : `About $${estimateAltCost(batch.length).toFixed(2)} is needed, but only $${b.left.toFixed(2)} of this month's Claude budget is left.` };
  try {
    const target = await resolveTarget(admin, client.id);
    const r = await runAlt(target?.domain ?? "", batch);
    await recordClaudeUse(admin, client.id, "alt_text", r.model, r.cost);
    const next: AuditDetail = { ...detail, alt: { ...(detail.alt ?? {}), ...r.suggestions }, altSkipped: [...new Set([...(detail.altSkipped ?? []), ...r.skipped])] };
    await saveDetail(admin, client.id, next);
    const n = Object.keys(r.suggestions).length;
    return { ok: true, detail: next, message: `${n} image${n === 1 ? "" : "s"} described ($${r.cost.toFixed(3)})${r.skipped.length ? `; ${r.skipped.length} couldn't be downloaded or aren't JPEG/PNG/GIF/WebP` : ""}.` };
  } catch (e) {
    return { ok: false, error: aiErrorMessage(e) };
  }
}
