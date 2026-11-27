import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, anthropicFor, costUsd } from "@/lib/ai/claude";
import { briefForChat, briefText, pageData } from "@/lib/ai/intelligence";
import { recordClaudeUse } from "@/lib/ai/usage";
import { planText } from "@/lib/technical/security-ai";

/**
 * The popup on an error or warning anywhere in the dashboard ("What stands out", alerts, audit findings): Claude's
 * explanation and fix for that one item, from the item itself, the data of the page it's on and the client's
 * evidence brief. Stored per page, item and wording, so it's paid once and written again only when the item changes.
 */
export const ISSUE_ENDPOINT = "issue_fix";
export interface IssueInput { path: string; title: string; detail: string }
export interface IssueFix { at: string; text: string; model: string; cost: number }

export const issueKey = (i: IssueInput) => createHash("sha256").update(`${i.path}|${i.title}|${i.detail}`).digest("hex").slice(0, 32);

const SYSTEM = "You are a senior SEO and analytics consultant writing for the owner of a small business website and the person who maintains it. " +
  "You get ONE problem shown on a dashboard page, the data of that page and a brief of the client's other data. Reply in Markdown with exactly these sections: " +
  "'## The exact problem' (restate precisely what is wrong with the actual numbers, pages, queries or items from the data), " +
  "'## Likely cause' (the most probable reasons, from the data; say what would confirm each), " +
  "'## How to fix it' (numbered, specific steps: which page, setting, tool or content change; WordPress-specific when the site is WordPress; code in fenced blocks when it helps), " +
  "'## Check it worked' (what to watch and when). " +
  "Use only the data given; never invent numbers, pages or findings, and say plainly when the data can't show the cause. Under 400 words.";

export async function storedIssueFix(admin: SupabaseClient, clientId: string, input: IssueInput): Promise<IssueFix | null> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", ISSUE_ENDPOINT).eq("params_hash", issueKey(input)).maybeSingle();
  return (data?.data as IssueFix | undefined) ?? null;
}

/** Writes (and stores) the explanation on the organization's Anthropic key. The caller checks role and budget. */
export async function explainIssue(admin: SupabaseClient, client: { id: string; name: string; timezone: string }, input: IssueInput): Promise<IssueFix> {
  const claude = await anthropicFor(client.id);
  const { brief } = await briefForChat(admin, client.id, client.timezone);
  const onPage = await pageData(admin, client.id, brief, input.path).catch(() => "");
  const prompt = [
    `Business: ${client.name}`, `Dashboard page: ${input.path}`, "",
    `PROBLEM SHOWN: ${input.title}`, input.detail ? `Details shown with it: ${input.detail}` : "", "",
    `DATA OF THIS PAGE:\n${onPage.slice(0, 12000)}`, "",
    `CLIENT DATA BRIEF:\n${briefText(brief, 120).slice(0, 10000)}`,
  ].join("\n");
  const res = await claude.messages.create({ model: AI_MODEL, max_tokens: 3000, output_config: { effort: "low" }, system: SYSTEM, messages: [{ role: "user", content: prompt }] });
  const cost = Number(costUsd(res.usage).toFixed(5));
  await recordClaudeUse(admin, client.id, "site_audit_ai", AI_MODEL, cost);
  const fix: IssueFix = { at: new Date().toISOString(), text: planText(res), model: AI_MODEL, cost };
  await admin.from("dfs_cache").upsert({ client_id: client.id, endpoint: ISSUE_ENDPOINT, params_hash: issueKey(input), params: { path: input.path, title: input.title.slice(0, 300) }, data: fix, row_count: 1, cost, fetched_at: fix.at }, { onConflict: "client_id,endpoint,params_hash" });
  return fix;
}
