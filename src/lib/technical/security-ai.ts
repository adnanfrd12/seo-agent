import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, anthropic, costUsd } from "@/lib/ai/claude";
import { recordClaudeUse } from "@/lib/ai/usage";
import { SEC_ENDPOINT, type SecAi, type SecAudit } from "./security";

export const SEC_AI_MODEL = AI_MODEL;

const SYSTEM = "You are a web security consultant writing for the owner of a small business website and the person who maintains it. " +
  "You get the results of a passive security check of their site. Write a short, prioritised fix plan in Markdown: " +
  "a 2-sentence summary, then '## Fix first' / '## Then' / '## When you have time' sections with numbered steps. " +
  "Each step names the issue, the exact change (menu path, plugin setting, or config line) and how to confirm it worked. " +
  "Use the evidence given; tailor steps to the detected server/CDN and to WordPress when it is WordPress. " +
  "Never invent findings that are not in the input and do not suggest attacking or testing the site aggressively. Under 450 words.";

/** The user message for the fix plan, built from the failing and warning checks only. */
export function buildSecurityPrompt(a: SecAudit, clientName: string): string {
  const bad = a.checks.filter((c) => c.status === "fail" || c.status === "warn");
  return [
    `Business: ${clientName}`, `Website: ${a.finalUrl ?? a.domain}`,
    `Platform: ${a.wordpress ? `WordPress${a.wpVersion ? ` ${a.wpVersion}` : ""}` : "not WordPress"}; server headers: ${a.server ?? "not shown"}`,
    `Score ${a.score}/100; ${a.passed} of ${a.total} checks pass.`, "",
    "Issues found:",
    ...bad.map((c) => `- [${c.severity}/${c.status}] ${c.title}: ${c.evidence}`),
  ].join("\n");
}

/** The text of a Messages API reply, or an error for a refusal / empty answer. */
export function planText(res: Pick<Anthropic.Message, "content" | "stop_reason">): string {
  if (res.stop_reason === "refusal") throw new Error("The AI declined to write this plan. The fixes listed next to each issue still apply.");
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("The AI returned an empty answer. Try again.");
  return text;
}

/** Writes (and stores) a site-specific fix plan. The caller checks the Claude budget first. */
export async function explainSecurity(admin: SupabaseClient, clientId: string, clientName: string, audit: SecAudit): Promise<SecAi> {
  const res = await anthropic().messages.create({
    model: SEC_AI_MODEL, max_tokens: 4000, output_config: { effort: "low" }, system: SYSTEM,
    messages: [{ role: "user", content: buildSecurityPrompt(audit, clientName) }],
  });
  const cost = Number(costUsd(res.usage).toFixed(5));
  await recordClaudeUse(admin, clientId, "security_ai", SEC_AI_MODEL, cost);
  const text = planText(res);
  const ai: SecAi = { at: new Date().toISOString(), auditAt: audit.checkedAt, text, model: SEC_AI_MODEL, cost };
  await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: SEC_ENDPOINT, params_hash: "ai", params: {}, data: ai, row_count: 1, cost, fetched_at: ai.at }, { onConflict: "client_id,endpoint,params_hash" });
  return ai;
}
