import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, costUsd } from "@/lib/ai/claude";
import { recordClaudeUse } from "@/lib/ai/usage";
import { configForClient, type OrgConfig } from "@/lib/org/config";
import { FANOUT_MODEL } from "./method";

/**
 * Real AI search queries: asks each AI platform a keyword with web search on and records the web searches it
 * actually ran (the "queries" an SEO reads from ChatGPT's network tab), an excerpt of the answer and the sources it
 * cited. Each platform runs on the organization's own key (Settings → Organization → Integrations). Results differ
 * from the consumer apps (no memory or personalisation) and from run to run, so a keyword can be asked a few times.
 * Lives beside the simulated fan-out (method.ts), which is unchanged.
 */
export const LIVE_PLATFORMS = ["chatgpt", "claude", "gemini", "grok", "perplexity"] as const;
export type LivePlatform = (typeof LIVE_PLATFORMS)[number];
export const PLATFORM_LABEL: Record<LivePlatform, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", grok: "Grok", perplexity: "Perplexity" };
/** the key each platform needs, and the optional model setting with its default */
export const PLATFORM_KEYS: Record<LivePlatform, { key: string; modelKey?: string; model: string }> = {
  chatgpt: { key: "OPENAI_API_KEY", modelKey: "OPENAI_SEARCH_MODEL", model: "gpt-6.2-astra" },
  claude: { key: "ANTHROPIC_API_KEY", model: FANOUT_MODEL },
  gemini: { key: "GEMINI_API_KEY", modelKey: "GEMINI_SEARCH_MODEL", model: "gemini-4-hydrogen" },
  grok: { key: "XAI_API_KEY", modelKey: "XAI_SEARCH_MODEL", model: "grok-4.7" },
  perplexity: { key: "PERPLEXITY_API_KEY", modelKey: "PERPLEXITY_SEARCH_MODEL", model: "openai/gpt-5.6-luna" },
};
/** rough cost of one ask, for the estimate shown before a run (search fees + a short answer) */
export const EST_PER_ASK: Record<LivePlatform, number> = { chatgpt: 0.05, claude: 0.09, gemini: 0.03, grok: 0.05, perplexity: 0.03 };
export const MAX_LIVE_KEYWORDS = 10;
export const MAX_LIVE_ASKS = 30;

export interface Citation { url: string; title: string | null }
export interface LiveAnswer { queries: string[]; exposed: boolean; answer: string; citations: Citation[]; model: string; cost: number }

const TIMEOUT = 90_000;
const PROMPT = (k: string) => k; // asked as a person would type it: no instructions that change how the AI searches
const clean = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))];
const dedupeCites = (xs: Citation[]) => [...new Map(xs.filter((c) => /^https?:\/\//.test(c.url)).map((c) => [c.url, c])).values()].slice(0, 40);
const excerpt = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 1500);
type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** A provider's error as a short message for the table (the key is never included). */
async function httpFail(name: string, res: Response): Promise<never> {
  const t = (await res.text().catch(() => "")).replace(/(sk|xai|pplx|AIza)[-_A-Za-z0-9]{8,}/g, "[key]");
  const msg = (() => { try { const j = JSON.parse(t) as J; return str(obj(j.error).message) ?? str(j.error) ?? str(j.message) ?? t; } catch { return t; } })();
  if (res.status === 401 || res.status === 403) throw new Error(`${name} rejected the API key (${res.status}). Check it in Settings → Organization → Integrations.`);
  if (res.status === 429) throw new Error(`${name} is rate limiting or out of credit (429). ${String(msg).slice(0, 160)}`);
  throw new Error(`${name} answered ${res.status}: ${String(msg).slice(0, 200)}`);
}

/** The searches and sources in an OpenAI-style Responses API answer (also used for Grok and Perplexity's Agent API). */
export function parseResponses(j: J): { queries: string[]; citations: Citation[]; answer: string } {
  const queries: string[] = [], citations: Citation[] = [], text: string[] = [];
  for (const it of arr(j.output).map(obj)) {
    const type = str(it.type) ?? "";
    const action = obj(it.action);
    if (/search/i.test(type)) {
      queries.push(...[str(action.query), ...arr(action.queries).map(str), ...arr(it.queries).map(str), str(it.query)].filter((x): x is string => Boolean(x)));
      // a function-style call: {"arguments": "{\"query\": …}"}
      const args = str(it.arguments);
      if (args) { try { const a = JSON.parse(args) as J; queries.push(...[str(a.query), ...arr(a.queries).map(str)].filter((x): x is string => Boolean(x))); } catch { /* not JSON */ } }
      for (const s of [...arr(action.sources), ...arr(it.results)].map(obj)) if (str(s.url)) citations.push({ url: str(s.url)!, title: str(s.title) });
    }
    if (type === "message") {
      for (const c of arr(it.content).map(obj)) {
        if (str(c.text)) text.push(str(c.text)!);
        for (const a of arr(c.annotations).map(obj)) if (str(a.url)) citations.push({ url: str(a.url)!, title: str(a.title) });
      }
    }
  }
  if (!text.length && str(j.output_text)) text.push(str(j.output_text)!);
  for (const u of arr(j.citations)) { const o = obj(u); const url = str(u) ?? str(o.url); if (url) citations.push({ url, title: str(o.title) }); }
  return { queries: clean(queries), citations: dedupeCites(citations), answer: excerpt(text.join("\n")) };
}

/** Responses-style token cost estimate (providers price differently; shown as an estimate). */
const tokenCost = (u: J, inPerM: number, outPerM: number) => (Number(u.input_tokens ?? u.prompt_tokens ?? 0) * inPerM + Number(u.output_tokens ?? u.completion_tokens ?? 0) * outPerM) / 1e6;

async function post(url: string, headers: Record<string, string>, body: J, name: string): Promise<J> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT), cache: "no-store" });
  if (!res.ok) await httpFail(name, res);
  return (await res.json()) as J;
}

const ASK: Record<LivePlatform, (keyword: string, cfg: OrgConfig) => Promise<LiveAnswer>> = {
  /** OpenAI Responses API + web_search: each web_search_call carries action.query (or action.queries). */
  async chatgpt(keyword, cfg) {
    const model = cfg.get("OPENAI_SEARCH_MODEL") || PLATFORM_KEYS.chatgpt.model;
    const j = await post("https://api.openai.com/v1/responses", { authorization: `Bearer ${cfg.require("OPENAI_API_KEY")}` },
      { model, input: PROMPT(keyword), tools: [{ type: "web_search" }], include: ["web_search_call.action.sources"] }, "OpenAI");
    const p = parseResponses(j);
    const calls = arr(j.output).filter((x) => str(obj(x).type) === "web_search_call").length;
    return { ...p, exposed: true, model, cost: calls * 0.01 + tokenCost(obj(j.usage), 1.25, 10) };
  },

  /** Anthropic web search: every server_tool_use block of web_search carries input.query. */
  async claude(keyword, cfg) {
    const client = anthropic(cfg);
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: PROMPT(keyword) }];
    const queries: string[] = [], citations: Citation[] = [], text: string[] = [];
    let cost = 0;
    for (let turn = 0; turn < 3; turn++) {
      const res = await client.messages.create({
        model: FANOUT_MODEL, max_tokens: 3000, messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      });
      cost += costUsd(res.usage) + (res.usage.server_tool_use?.web_search_requests ?? 0) * 0.01;
      for (const b of res.content) {
        if (b.type === "server_tool_use" && b.name === "web_search") { const q = obj(b.input).query; if (typeof q === "string") queries.push(q); }
        if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.type === "web_search_result") citations.push({ url: r.url, title: r.title ?? null });
        if (b.type === "text") {
          text.push(b.text);
          for (const c of b.citations ?? []) if (c.type === "web_search_result_location") citations.unshift({ url: c.url, title: c.title ?? null });
        }
      }
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    return { queries: clean(queries), exposed: true, answer: excerpt(text.join("")), citations: dedupeCites(citations), model: FANOUT_MODEL, cost };
  },

  /** Gemini grounding with Google Search: candidates[0].groundingMetadata.webSearchQueries (the queries tied to cited sources). */
  async gemini(keyword, cfg) {
    const model = cfg.get("GEMINI_SEARCH_MODEL") || PLATFORM_KEYS.gemini.model;
    const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": cfg.require("GEMINI_API_KEY") },
      { contents: [{ role: "user", parts: [{ text: PROMPT(keyword) }] }], tools: [{ google_search: {} }] }, "Gemini");
    const c = obj(arr(j.candidates)[0]);
    const g = obj(c.groundingMetadata);
    const queries = clean(arr(g.webSearchQueries).map(str));
    const citations = arr(g.groundingChunks).map((x) => obj(obj(x).web)).filter((w) => str(w.uri)).map((w) => ({ url: str(w.uri)!, title: str(w.title) }));
    const text = arr(obj(c.content).parts).map((p) => str(obj(p).text) ?? "").join("");
    const u = obj(j.usageMetadata);
    return { queries, exposed: true, answer: excerpt(text), citations: dedupeCites(citations), model, cost: queries.length * 0.014 + (Number(u.promptTokenCount ?? 0) * 0.3 + Number(u.candidatesTokenCount ?? 0) * 2.5) / 1e6 };
  },

  /** xAI Responses API + web_search. xAI's docs don't show the searches it runs, so they're kept when present. */
  async grok(keyword, cfg) {
    const model = cfg.get("XAI_SEARCH_MODEL") || PLATFORM_KEYS.grok.model;
    const j = await post("https://api.x.ai/v1/responses", { authorization: `Bearer ${cfg.require("XAI_API_KEY")}` },
      { model, input: PROMPT(keyword), tools: [{ type: "web_search" }] }, "xAI");
    const p = parseResponses(j);
    return { ...p, exposed: p.queries.length > 0, model, cost: 0.025 + tokenCost(obj(j.usage), 3, 15) };
  },

  /** Perplexity Agent API + web_search: "search_results" output items carry queries and results. */
  async perplexity(keyword, cfg) {
    const model = cfg.get("PERPLEXITY_SEARCH_MODEL") || PLATFORM_KEYS.perplexity.model;
    const j = await post("https://api.perplexity.ai/v1/agent", { authorization: `Bearer ${cfg.require("PERPLEXITY_API_KEY")}` },
      { model, input: PROMPT(keyword), tools: [{ type: "web_search" }] }, "Perplexity");
    const p = parseResponses(j);
    return { ...p, exposed: p.queries.length > 0, model, cost: 0.0025 + tokenCost(obj(j.usage), 1.25, 10) };
  },
};

/**
 * Paste import (no API key): the text an SEO copies from ChatGPT's network tab (the conversation response: JSON,
 * streamed "data: …" lines, or a plain list). Returns every web search query found ("queries", "search_queries",
 * "query" inside search steps) and the cited URLs.
 */
export function parsePasted(text: string): { queries: string[]; citations: Citation[] } {
  const queries: string[] = [], citations: Citation[] = [];
  const walk = (v: unknown, inSearch: boolean, depth: number) => {
    if (depth > 60 || v == null) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, inSearch, depth + 1); return; }
    if (typeof v !== "object") return;
    const o = v as J;
    const searchy = inSearch || /search/i.test(String(o.type ?? o.name ?? o.recipient ?? ""));
    for (const [k, val] of Object.entries(o)) {
      if (/^(search_)?queries$/i.test(k) && Array.isArray(val)) {
        for (const q of val) { const s = typeof q === "string" ? q : str(obj(q).q) ?? str(obj(q).query); if (s) queries.push(s); }
      } else if (k === "query" && searchy && typeof val === "string") queries.push(val);
      else if (k === "url" && typeof val === "string" && /^https?:\/\//.test(val) && !/chatgpt\.com|openai\.com|oaiusercontent/.test(val)) citations.push({ url: val, title: str(o.title) });
      else walk(val, searchy || /search/i.test(k), depth + 1);
    }
  };
  const t = text.trim();
  let parsed = false;
  try { walk(JSON.parse(t), false, 0); parsed = true; } catch { /* not one JSON document */ }
  if (!parsed) {
    // streamed responses: one JSON object per "data:" line
    for (const line of t.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:data:\s*)?(\{.*\})\s*$/);
      if (m) { try { walk(JSON.parse(m[1]), false, 0); parsed = true; } catch { /* partial line */ } }
    }
  }
  if (!parsed) {
    // JSON fragments, or a plain list of queries (one per line)
    for (const m of t.matchAll(/"(?:search_)?queries"\s*:\s*\[([^\]]*)\]/g)) for (const q of m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) queries.push(q[1].replace(/\\"/g, '"'));
    if (!queries.length && !/[{}"]/.test(t)) queries.push(...t.split(/\r?\n/).map((l) => l.replace(/^[-*•\d.)\s]+/, "")));
  }
  return { queries: clean(queries).filter((q) => q.length <= 300 && !/^\[object \w+\]$/.test(q)).slice(0, 100), citations: dedupeCites(citations) };
}

/** Stores pasted ChatGPT searches for a keyword as one ChatGPT answer (free; no API call). */
export async function savePasted(admin: SupabaseClient, clientId: string, o: { keyword: string; text: string; userId: string | null; domain: string }): Promise<{ batchId: string; queries: number }> {
  const p = parsePasted(o.text);
  if (!p.queries.length) throw new Error("No search queries found in what you pasted. Copy the whole Response of the conversation request (it contains \"queries\").");
  const own = o.domain.replace(/^www\./, "").toLowerCase();
  const batchId = crypto.randomUUID();
  const { error } = await admin.from("fanout_live").insert({
    batch_id: batchId, client_id: clientId, seed: o.keyword, platform: "chatgpt", run_no: 1, model: "pasted from ChatGPT", queries: p.queries, queries_exposed: true,
    answer: null, citations: p.citations, client_cited: p.citations.some((c) => { const h = hostOf(c.url); return h === own || h.endsWith(`.${own}`); }), cost_usd: 0, created_by: o.userId,
  });
  if (error) throw new Error(/fanout_live/.test(error.message) ? "Storage isn't set up yet: apply migration 20261130000040_fanout_live.sql." : `Couldn't save: ${error.message}`);
  return { batchId, queries: p.queries.length };
}

/** Which platforms this organization can ask (its key is set). */
export function platformReady(cfg: OrgConfig): Record<LivePlatform, boolean> {
  return Object.fromEntries(LIVE_PLATFORMS.map((p) => [p, cfg.has(PLATFORM_KEYS[p].key)])) as Record<LivePlatform, boolean>;
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

export interface LiveRunInput { keywords: string[]; platforms: LivePlatform[]; runs: number; userId: string | null; domain: string }
export interface LiveRunOutcome { batchId: string; asked: number; failed: number; queries: number; cost: number; claudeCost: number }

/** Asks every keyword on every chosen platform (`runs` times), a few at a time, and stores each answer. */
export async function runLive(admin: SupabaseClient, clientId: string, o: LiveRunInput): Promise<LiveRunOutcome> {
  const cfg = await configForClient(clientId);
  const batchId = crypto.randomUUID();
  const own = o.domain.replace(/^www\./, "").toLowerCase();
  const jobs = o.keywords.flatMap((seed) => o.platforms.flatMap((platform) => Array.from({ length: o.runs }, (_, i) => ({ seed, platform, run_no: i + 1 }))));
  const rows: J[] = [];
  let cost = 0, claudeCost = 0, failed = 0, queries = 0;
  for (let i = 0; i < jobs.length; i += 6) {
    const done = await Promise.allSettled(jobs.slice(i, i + 6).map((j) => ASK[j.platform](j.seed, cfg)));
    done.forEach((d, k) => {
      const j = jobs[i + k];
      const base = { batch_id: batchId, client_id: clientId, seed: j.seed, platform: j.platform, run_no: j.run_no, created_by: o.userId };
      if (d.status === "rejected") {
        failed++;
        rows.push({ ...base, model: null, error: (d.reason instanceof Error ? d.reason.message : "Failed").slice(0, 400), queries: [], citations: [], queries_exposed: true });
        return;
      }
      const a = d.value;
      cost += a.cost; queries += a.queries.length;
      if (j.platform === "claude") claudeCost += a.cost;
      rows.push({
        ...base, model: a.model, queries: a.queries, queries_exposed: a.exposed, answer: a.answer, citations: a.citations,
        client_cited: a.citations.some((c) => { const h = hostOf(c.url); return h === own || h.endsWith(`.${own}`); }), cost_usd: Number(a.cost.toFixed(5)),
      });
    });
  }
  if (claudeCost > 0) await recordClaudeUse(admin, clientId, "fanout", FANOUT_MODEL, claudeCost, jobs.filter((j) => j.platform === "claude").length);
  const { error } = await admin.from("fanout_live").insert(rows);
  if (error) throw new Error(/fanout_live/.test(error.message) ? "Storage isn't set up yet: apply migration 20261130000040_fanout_live.sql." : `Couldn't save the results: ${error.message}`);
  return { batchId, asked: jobs.length, failed, queries, cost, claudeCost };
}

export interface LiveRow {
  batch_id: string; seed: string; platform: LivePlatform; run_no: number; model: string | null; queries: string[]; queries_exposed: boolean;
  answer: string | null; citations: Citation[]; client_cited: boolean; cost_usd: number; error: string | null; created_at: string;
}
export interface LiveBatch { id: string; at: string; seeds: string[]; platforms: LivePlatform[]; rows: LiveRow[] }

/** The latest batches (RLS client: members only), newest first. Empty when the table doesn't exist yet. */
export async function loadLive(db: SupabaseClient, clientId: string): Promise<{ batches: LiveBatch[]; ready: boolean }> {
  const { data, error } = await db.from("fanout_live").select("batch_id, seed, platform, run_no, model, queries, queries_exposed, answer, citations, client_cited, cost_usd, error, created_at")
    .eq("client_id", clientId).order("created_at", { ascending: false }).limit(600);
  if (error) return { batches: [], ready: false };
  const by = new Map<string, LiveBatch>();
  for (const r of (data ?? []) as LiveRow[]) {
    const b = by.get(r.batch_id) ?? { id: r.batch_id, at: r.created_at, seeds: [], platforms: [], rows: [] };
    b.rows.push({ ...r, cost_usd: Number(r.cost_usd) });
    if (!b.seeds.includes(r.seed)) b.seeds.push(r.seed);
    if (!b.platforms.includes(r.platform)) b.platforms.push(r.platform);
    by.set(r.batch_id, b);
  }
  return { batches: [...by.values()].slice(0, 20), ready: true };
}

/** One platform asked one keyword (no storage): for checks and tests. */
export const askPlatform = (platform: LivePlatform, keyword: string, cfg: OrgConfig) => ASK[platform](keyword, cfg);
