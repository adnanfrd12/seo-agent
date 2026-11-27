import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, anthropicFor, costUsd } from "@/lib/ai/claude";
import { recordClaudeUse } from "@/lib/ai/usage";
import type { TechChecks } from "./checks";
import type { Check, TechScore } from "./score";
import { planText } from "./security-ai";

/**
 * Technical SEO: Claude's explanation and fix for ONE check (the popup on each check). Built from the check's own
 * evidence plus the data behind it (sampled pages, Lighthouse runs, robots/sitemaps), stored per check and evidence,
 * so it's paid once and written again only when the evidence changes.
 */
export const FIX_ENDPOINT = "tech_fix";
export interface CheckFix { at: string; text: string; model: string; cost: number }

/** Stored per check and evidence: a new result of the check gets a new explanation. */
export const fixKey = (c: Pick<Check, "id" | "evidence" | "status">) => `${c.id}:${createHash("sha256").update(`${c.status}|${c.evidence}`).digest("hex").slice(0, 16)}`;

const SYSTEM = "You are a senior technical SEO consultant writing for the owner of a small business website and the person who maintains it. " +
  "You get ONE result from a technical SEO audit of their site, plus the raw data behind it. Reply in Markdown with exactly these sections: " +
  "'## The exact problem' (restate precisely what is wrong, with the actual numbers, URLs and values from the data; list every affected page or item, up to 25), " +
  "'## Why it matters' (2-3 sentences on the effect on Google, users or rankings), " +
  "'## How to fix it' (numbered steps naming the exact change: page, setting, plugin option, server or config line, or the code/markup to add, in a fenced code block when code helps; tailor to WordPress when the site is WordPress), " +
  "'## Check it worked' (how to confirm, and when to re-run the check). " +
  "Use only the given evidence and data; never invent pages, numbers or findings. If the check passes, say briefly that nothing needs fixing and how to keep it that way. Under 450 words.";

const clip = (v: unknown, n: number) => { const s = JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}…` : s; };

/** The data a check is based on, trimmed (pages for on-page/schema/index/links/mobile/images; Lighthouse for speed). */
function contextFor(c: Check, score: TechScore, checks: TechChecks | null): string {
  const parts: string[] = [];
  const pageCats = ["onpage", "schema", "index", "links", "mobile", "images", "url", "security", "crawl"];
  if (checks && pageCats.includes(c.cat)) {
    parts.push(`Sampled pages (${checks.pages.length}): ${clip(checks.pages, 9000)}`);
    if (["crawl", "index"].includes(c.cat)) parts.push(`robots.txt: ${clip(checks.robots, 1500)}`, `Sitemaps: ${clip(checks.sitemaps, 1500)}`);
    if (c.cat === "security") parts.push(`HTTPS: ${clip(checks.https, 1000)}`);
  }
  if (c.cat === "speed") parts.push(`Lighthouse runs: ${clip(score.speed, 4000)}`, `Real-user data: ${score.sources.crux}`);
  return parts.join("\n");
}

export async function loadCheckFixes(admin: SupabaseClient, clientId: string): Promise<Record<string, CheckFix>> {
  const { data } = await admin.from("dfs_cache").select("params_hash, data").eq("client_id", clientId).eq("endpoint", FIX_ENDPOINT).limit(500);
  return Object.fromEntries((data ?? []).map((r) => [r.params_hash as string, r.data as CheckFix]));
}

/** Writes (and stores) the explanation and fix for one check on the organization's Anthropic key. The caller checks the budget. */
export async function explainCheck(admin: SupabaseClient, clientId: string, site: { name: string; domain: string }, c: Check, score: TechScore, checks: TechChecks | null): Promise<CheckFix> {
  const claude = await anthropicFor(clientId);
  const cat = score.categories.find((x) => x.key === c.cat);
  const prompt = [
    `Business: ${site.name}`, `Website: ${site.domain}`,
    `Check: ${c.label} (category: ${cat?.label ?? c.cat}; status: ${c.status}; points lost: ${c.deduct}; source: ${c.source})`,
    `Evidence: ${c.evidence}`, "", contextFor(c, score, checks),
  ].join("\n");
  const res = await claude.messages.create({ model: AI_MODEL, max_tokens: 3000, output_config: { effort: "low" }, system: SYSTEM, messages: [{ role: "user", content: prompt }] });
  const cost = Number(costUsd(res.usage).toFixed(5));
  await recordClaudeUse(admin, clientId, "site_audit_ai", AI_MODEL, cost);
  const fix: CheckFix = { at: new Date().toISOString(), text: planText(res), model: AI_MODEL, cost };
  await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: FIX_ENDPOINT, params_hash: fixKey(c), params: { check: c.id }, data: fix, row_count: 1, cost, fetched_at: fix.at }, { onConflict: "client_id,endpoint,params_hash" });
  return fix;
}
