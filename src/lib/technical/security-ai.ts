import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, anthropicFor, costUsd } from "@/lib/ai/claude";
import { recordClaudeUse } from "@/lib/ai/usage";
import { SEC_ENDPOINT, type SecAi, type SecAudit } from "./security";

export const SEC_AI_MODEL = AI_MODEL;

const SYSTEM = "You are a senior website security auditor writing for the owner of a small business website and the person who maintains it. " +
  "You get (1) the results of automated passive checks of their site and (2) raw evidence of what a browser sees on the home page: response headers, " +
  "every script and stylesheet address (WordPress plugin and theme versions appear as ?ver= and in /wp-content/plugins/<name>/ paths), third-party hosts, iframes, forms and the start of each inline script. " +
  "Do a real security audit from this: confirm or qualify each failing check, and look in the raw evidence for what the automated checks can't judge: " +
  "plugins, themes or libraries with versions that have known vulnerabilities (say which and why, and only when you are confident), abandoned or risky plugins, " +
  "third-party scripts from unknown, suspicious or unnecessary domains, forms that post insecurely or to other sites, signs of spam injection, malware or cryptominers, " +
  "redirect tricks, exposed admin or login paths, and information leaks in headers. " +
  "Reply in Markdown with exactly these sections: " +
  "'## Overall risk' (one of Low / Medium / High / Critical, then 2 sentences why), " +
  "'## Findings' (one '### [High|Medium|Low] <title>' per finding, each with **Evidence:** quoting the exact header, address or check result, and **Fix:** numbered steps naming the menu path, plugin setting or config line, tailored to the detected server/CDN and to WordPress when it is WordPress), " +
  "'## Fix order' (a short numbered list: what to do first, then, and when there's time), " +
  "'## What looks good' (2-4 bullets). " +
  "Base every finding on the evidence given and say how sure you are when it depends on a version you can't confirm. Never invent findings, " +
  "never suggest attacking, exploiting or aggressively testing the site. Under 900 words.";

/** The user message: every check (failing ones in full) plus the raw home-page evidence. */
export function buildSecurityPrompt(a: SecAudit, clientName: string): string {
  const bad = a.checks.filter((c) => c.status === "fail" || c.status === "warn");
  const ok = a.checks.filter((c) => c.status === "pass").map((c) => c.title);
  const r = a.raw;
  const block = (title: string, xs: string[] | undefined) => (xs?.length ? [`${title}:`, ...xs.map((x) => `- ${x}`)] : [`${title}: none`]);
  return [
    `Business: ${clientName}`, `Website: ${a.finalUrl ?? a.domain}`,
    `Platform: ${a.wordpress ? `WordPress${a.wpVersion ? ` ${a.wpVersion}` : ""}` : "not WordPress"}; server headers: ${a.server ?? "not shown"}${r?.generator ? `; generator: ${r.generator}` : ""}`,
    `Automated score ${a.score}/100; ${a.passed} of ${a.total} checks pass.`, "",
    "FAILING OR WARNING CHECKS:",
    ...bad.map((c) => `- [${c.severity}/${c.status}] ${c.group} · ${c.title}: ${c.evidence}`),
    "", `PASSING CHECKS: ${ok.join("; ")}`, "",
    ...(r ? [
      "RAW EVIDENCE FROM THE HOME PAGE:",
      "Response headers:", ...Object.entries(r.headers).map(([k, v]) => `- ${k}: ${v}`),
      ...block("Scripts and stylesheets", r.assets),
      ...block("Third-party hosts", r.thirdParty),
      ...block("Iframes", r.iframes),
      ...block("Forms (method → action)", r.forms),
      ...block("Inline scripts (start)", r.inlineScripts),
    ] : ["(No raw evidence stored for this audit: run the audit again for a full review.)"]),
  ].join("\n").slice(0, 60_000);
}

/** The text of a Messages API reply, or an error for a refusal / empty answer. */
export function planText(res: Pick<Anthropic.Message, "content" | "stop_reason">): string {
  if (res.stop_reason === "refusal") throw new Error("The AI declined to write this plan. The fixes listed next to each issue still apply.");
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!text) throw new Error("The AI returned an empty answer. Try again.");
  return text;
}

/** Writes (and stores) a site-specific fix plan on the organization's Anthropic key. The caller checks the Claude budget first. */
export async function explainSecurity(admin: SupabaseClient, clientId: string, clientName: string, audit: SecAudit): Promise<SecAi> {
  const claude = await anthropicFor(clientId);
  const res = await claude.messages.create({
    model: SEC_AI_MODEL, max_tokens: 8000, output_config: { effort: "medium" }, system: SYSTEM,
    messages: [{ role: "user", content: buildSecurityPrompt(audit, clientName) }],
  });
  const cost = Number(costUsd(res.usage).toFixed(5));
  await recordClaudeUse(admin, clientId, "security_ai", SEC_AI_MODEL, cost);
  const text = planText(res);
  const ai: SecAi = { at: new Date().toISOString(), auditAt: audit.checkedAt, text, model: SEC_AI_MODEL, cost };
  await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: SEC_ENDPOINT, params_hash: "ai", params: {}, data: ai, row_count: 1, cost, fetched_at: ai.at }, { onConflict: "client_id,endpoint,params_hash" });
  return ai;
}
