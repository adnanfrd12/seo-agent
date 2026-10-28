import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultBrandTerms, normalizeTerm, normalizeTerms } from "@/lib/brand";
import { aiErrorMessage, anthropic } from "./claude";

/**
 * AI visibility: when someone asks an AI assistant the questions customers ask, is the business named
 * or cited? The question is sent to Claude (your own Anthropic key, Sonnet 5.5) with web search on, the
 * way an assistant with live search would answer it, and the answer is checked for the brand and the
 * website. Results are stored per day; nothing runs when a page is opened.
 *
 * Reading the numbers: "mentioned" = the name is in the answer, "cited" = the website is one of the
 * sources the answer links to, "seen" = the website was among the search results Claude read. This
 * measures Claude's answers only; other assistants may answer differently.
 */
export const VIS_MODEL = "claude-sonnet-5-5";
// $ per million tokens for claude-sonnet-5-5, and $ per web search (Anthropic first-party pricing)
const PRICE = { input: 2, output: 10, cacheRead: 0.2, search: 0.01 };
export const PROMPT_EST = 0.05; // measured on real checks; shown as an estimate in the UI
export const MAX_PROMPTS = 15;
export const AI_EVERY_DAYS = 7;
const RUN_COST_LIMIT = 1.5; // a single run never spends more than this per client
const SYSTEM = "You are a helpful assistant answering a consumer's question. Answer the way you normally would: if the question is about finding or choosing a business or service, recommend specific, real businesses and say why. Keep the answer under 250 words.";

export interface AiPrompt { id: string; prompt: string; created_at: string }
export interface AiSource { domain: string; url: string; title: string | null }
export interface AiCheck {
  prompt_id: string; checked_on: string; model: string; used_search: boolean; mentioned: boolean; cited: boolean; seen: boolean;
  sources: AiSource[]; competitors: string[]; answer: string | null; cost: number;
}

const host = (u: string | null | undefined) => { try { return new URL(u ?? "").hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const sameSite = (h: string, site: string) => h === site || h.endsWith(`.${site}`);

type Block = Anthropic.Messages.ContentBlock;

/** Reads the answer text, the cited sources and the search results out of a response. Pure, so it is easy to test. */
export function parseAnswer(content: Block[], site: string, terms: string[]) {
  let text = "";
  const sources = new Map<string, AiSource>();
  const seenHosts = new Set<string>();
  for (const b of content) {
    if (b.type === "text") {
      text += b.text;
      for (const c of b.citations ?? []) {
        if (c.type !== "web_search_result_location") continue;
        const h = host(c.url);
        if (h && !sources.has(h)) sources.set(h, { domain: h, url: c.url, title: c.title ?? null });
      }
    } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) { const h = host(r.url); if (h) seenHosts.add(h); }
    }
  }
  const flat = normalizeTerm(text);
  const mentioned = terms.some((t) => flat.includes(t)) || flat.includes(normalizeTerm(site));
  const cited = [...sources.keys()].some((h) => sameSite(h, site));
  const seen = [...seenHosts].some((h) => sameSite(h, site));
  return {
    text: text.trim(), mentioned, cited, seen: seen || cited,
    sources: [...sources.values()].slice(0, 8),
    competitors: [...sources.keys()].filter((h) => !sameSite(h, site)).slice(0, 6),
  };
}

export async function checkPrompt(
  admin: SupabaseClient, clientId: string, p: AiPrompt, o: { site: string; terms: string[]; search: boolean },
): Promise<{ check: AiCheck; cost: number }> {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: p.prompt }];
  const content: Block[] = [];
  let searches = 0, input = 0, output = 0, cached = 0;
  for (let turn = 0; turn < 3; turn++) { // a long search turn can pause; continue it
    const res = await anthropic().messages.create({
      model: VIS_MODEL, max_tokens: 2500, system: SYSTEM, output_config: { effort: "low" }, messages,
      ...(o.search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }] } : {}),
    });
    content.push(...res.content);
    input += res.usage.input_tokens; output += res.usage.output_tokens; cached += res.usage.cache_read_input_tokens ?? 0;
    searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    if (res.stop_reason === "refusal") throw new Error("The AI declined to answer this question.");
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  const parsed = parseAnswer(content, o.site, o.terms);
  const cost = Number(((input * PRICE.input + cached * PRICE.cacheRead + output * PRICE.output) / 1_000_000 + searches * PRICE.search).toFixed(5));
  const check: AiCheck = {
    prompt_id: p.id, checked_on: new Date().toISOString().slice(0, 10), model: VIS_MODEL, used_search: o.search,
    mentioned: parsed.mentioned, cited: parsed.cited, seen: parsed.seen, sources: parsed.sources, competitors: parsed.competitors,
    answer: parsed.text.slice(0, 1800) || null, cost,
  };
  await admin.from("ai_checks").upsert({ client_id: clientId, ...check }, { onConflict: "prompt_id,checked_on" });
  return { check, cost };
}

/** Brand words for a client: the saved ones (shared with the Search Console brand split) or derived from name and website. */
export async function brandTermsFor(admin: SupabaseClient, clientId: string, site: string): Promise<string[]> {
  const { data } = await admin.from("clients").select("name, settings").eq("id", clientId).maybeSingle();
  const saved = (data?.settings as { brand_terms?: string[] } | null)?.brand_terms;
  return saved?.length ? normalizeTerms(saved) : defaultBrandTerms((data?.name as string) ?? "", [site]);
}

export interface AiRun { checked: number; skipped: number; cost: number; errors: string[]; stopped: string | null }

export async function runAiChecks(admin: SupabaseClient, clientId: string, site: string, opts: { force?: boolean; deadline?: number; search?: boolean } = {}): Promise<AiRun> {
  const run: AiRun = { checked: 0, skipped: 0, cost: 0, errors: [], stopped: null };
  const { data: prompts } = await admin.from("ai_prompts").select("id, prompt, created_at").eq("client_id", clientId).order("created_at").limit(MAX_PROMPTS);
  const { data: last } = await admin.from("ai_checks").select("prompt_id, checked_on").eq("client_id", clientId).order("checked_on", { ascending: false }).limit(1000);
  const lastOn = new Map<string, string>();
  for (const r of last ?? []) if (!lastOn.has(r.prompt_id as string)) lastOn.set(r.prompt_id as string, r.checked_on as string);
  const cutoff = new Date(Date.now() - (AI_EVERY_DAYS - 0.5) * 86_400_000).toISOString().slice(0, 10);
  const terms = await brandTermsFor(admin, clientId, site);
  const due = ((prompts ?? []) as AiPrompt[]).filter((p) => opts.force || !lastOn.get(p.id) || (lastOn.get(p.id) as string) <= cutoff);
  run.skipped = (prompts?.length ?? 0) - due.length;
  for (const p of due) {
    if (opts.deadline && Date.now() > opts.deadline) { run.stopped = "time"; break; }
    if (run.cost >= RUN_COST_LIMIT) { run.stopped = "cost limit"; break; }
    try {
      const r = await checkPrompt(admin, clientId, p, { site, terms, search: opts.search !== false });
      run.checked++; run.cost += r.cost;
    } catch (e) {
      run.errors.push(aiErrorMessage(e));
      if (/key was rejected|Missing or invalid environment/.test(run.errors.at(-1) ?? "")) { run.stopped = "provider"; break; }
    }
  }
  return run;
}

/* ------------------------------------------------------------------ reading (no API calls) */
export interface AiRow { id: string; prompt: string; latest: AiCheck | null; history: { date: string; visible: boolean }[] }
export interface AiSummary {
  ok: boolean; rows: AiRow[]; lastChecked: string | null;
  /** share of prompts where the brand was mentioned or cited in the latest check, 0-100 */
  score: number | null; previousScore: number | null;
  /** websites cited most often across the latest answers, ours excluded */
  topSources: { domain: string; count: number }[];
  trend: { date: string; score: number }[];
}

export async function loadAi(supabase: SupabaseClient, clientId: string): Promise<AiSummary> {
  const [p, c] = await Promise.all([
    supabase.from("ai_prompts").select("id, prompt").eq("client_id", clientId).order("created_at"),
    supabase.from("ai_checks").select("prompt_id, checked_on, model, used_search, mentioned, cited, seen, sources, competitors, answer, cost").eq("client_id", clientId).order("checked_on", { ascending: false }).limit(2000),
  ]);
  const empty: AiSummary = { ok: false, rows: [], lastChecked: null, score: null, previousScore: null, topSources: [], trend: [] };
  if (p.error || c.error) return empty;
  const by = new Map<string, AiCheck[]>();
  for (const x of (c.data ?? []) as AiCheck[]) { const l = by.get(x.prompt_id) ?? []; l.push(x); by.set(x.prompt_id, l); }
  const visible = (x: AiCheck) => x.mentioned || x.cited;
  const rows: AiRow[] = (p.data ?? []).map((r) => {
    const h = by.get(r.id as string) ?? [];
    return { id: r.id as string, prompt: r.prompt as string, latest: h[0] ?? null, history: [...h].reverse().map((x) => ({ date: x.checked_on, visible: visible(x) })) };
  });
  const withData = rows.filter((r) => r.latest);
  const pct = (list: boolean[]) => (list.length ? Math.round((list.filter(Boolean).length / list.length) * 100) : null);
  // weekly trend: for each check date, the share of prompts visible among the checks made that day
  const days = new Map<string, boolean[]>();
  for (const x of (c.data ?? []) as AiCheck[]) { const l = days.get(x.checked_on) ?? []; l.push(visible(x)); days.set(x.checked_on, l); }
  const trend = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, l]) => ({ date, score: pct(l) as number }));
  const counts = new Map<string, number>();
  for (const r of withData) for (const d of r.latest!.competitors) counts.set(d, (counts.get(d) ?? 0) + 1);
  return {
    ok: true, rows, lastChecked: withData.reduce<string | null>((a, r) => (!a || r.latest!.checked_on > a ? r.latest!.checked_on : a), null),
    score: pct(withData.map((r) => visible(r.latest!))), previousScore: trend.length >= 2 ? trend[trend.length - 2].score : null,
    topSources: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([domain, count]) => ({ domain, count })), trend,
  };
}

/** Starter prompts built from keywords the site already ranks for, in the way customers phrase questions. */
export function suggestPrompts(keywords: string[], existing: string[]): string[] {
  const have = new Set(existing.map((e) => e.toLowerCase()));
  const out: string[] = [];
  for (const k of keywords) {
    const kw = k.trim().toLowerCase();
    if (kw.length < 4 || kw.length > 60) continue;
    const q = /\b(near me|in [a-z ]+|best|how|what|why|cost|price)\b/.test(kw) ? `${kw[0].toUpperCase()}${kw.slice(1)}${/\?$/.test(kw) ? "" : "?"}` : `What are the best ${kw}? Recommend specific companies.`;
    if (!have.has(q.toLowerCase()) && !out.includes(q)) out.push(q);
    if (out.length >= 8) break;
  }
  return out;
}
