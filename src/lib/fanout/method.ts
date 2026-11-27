import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropic } from "@/lib/ai/claude";
import type { OrgConfig } from "@/lib/org/config";
import { FANOUT_TYPES, QUERIES_PER, type FanoutMode, type FanoutQuery } from "./shared";

/**
 * THE GENERATION METHOD. Everything else (actions, storage, volumes, UI) only talks to the `FanoutMethod`
 * interface below, so a different technique (for example a browser-based extraction of the queries Google AI Mode
 * or ChatGPT actually run) is added as another object implementing it and selected in `METHOD` at the bottom.
 *
 * Current method: the open-source "Qforia" approach (iPullRank): an LLM simulates the query fan-out of Google
 * AI Mode / AI Overviews, returning each synthetic query with its type, the user intent and why it would be run.
 * Here the LLM is Claude Sonnet 5.5 with structured outputs.
 */
/** `cfg`: the client's organization's configuration; a method takes its credentials (e.g. the Anthropic key) from it. */
export interface MethodContext { site: string; business: string; cfg: OrgConfig }
export interface KeywordFanout { queries: FanoutQuery[]; cost: number; model: string }
export interface PageInput { url: string; title: string | null; headings: string[]; text: string }
export interface PageFanout { topic: string; mainQuery: string; queries: FanoutQuery[]; cost: number; model: string }

export interface FanoutMethod {
  /** stored with every run so results from different methods can be told apart */
  id: string;
  label: string;
  /** model name used for the usage log, or null when the method doesn't use Claude */
  model: string | null;
  keyword(keyword: string, mode: FanoutMode, ctx: MethodContext): Promise<KeywordFanout>;
  page(page: PageInput, mode: FanoutMode, ctx: MethodContext): Promise<PageFanout>;
}

/* ------------------------------------------------------------------ Qforia method on Claude */
export const FANOUT_MODEL = "claude-sonnet-5-5";
const PRICE = { input: 2, output: 10, cacheRead: 0.1 }; // $ per million tokens, claude-sonnet-5-5
const PAGE_CHARS = 24_000; // about 6,000 tokens of page text

const item = {
  query: z.string(),
  type: z.enum(FANOUT_TYPES),
  user_intent: z.string(),
  reasoning: z.string(),
};
const keywordSchema = z.object({ queries: z.array(z.object(item)) });
const pageSchema = z.object({
  topic: z.string(), main_query: z.string(),
  queries: z.array(z.object({ ...item, coverage: z.enum(["covered", "partial", "missing"]), suggestion: z.string() })),
});

const TYPES_GUIDE = `Query types (use each where it fits, spread across them):
- reformulation: the same need phrased differently
- related: adjacent topics the searcher will also care about
- implicit: the unstated need behind the query (costs, permits, timelines, risks)
- comparative: X vs Y, best options, alternatives
- entity: expansions on the brands, products, materials, standards, places or people involved
- personalised: versions shaped by the searcher's situation (location, budget, business type, use case)
- recent: freshness and follow-up questions (this year's prices, new rules, what to do next)`;

const SYSTEM = `You simulate the query fan-out of AI search engines (Google AI Mode and AI Overviews, ChatGPT search, Perplexity). Before answering, these engines expand a user's query into many sub-queries, retrieve passages for each and compose an answer from them. Reproduce the sub-queries such an engine would most plausibly run.
${TYPES_GUIDE}
Rules: write every query the way it would be typed or spoken into a search box, in the language of the original query. Each query must be distinct (no near-duplicates) and useful for retrieving content. user_intent is a short phrase. reasoning is one short sentence on why the engine would run that query.`;

const count = (mode: FanoutMode) => (mode === "ai_mode" ? "between 18 and 25 queries, going deep: multi-step, comparative and personalised angles" : "between 10 and 12 queries, the essentials an AI Overview would need");

function cost(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }) {
  return Number(((u.input_tokens * PRICE.input + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + u.output_tokens * PRICE.output) / 1_000_000).toFixed(5));
}

const clean = (q: z.infer<z.ZodObject<typeof item>>): FanoutQuery => ({ query: q.query.trim().replace(/\s+/g, " ").slice(0, 200), type: q.type, intent: q.user_intent.trim().slice(0, 200), reasoning: q.reasoning.trim().slice(0, 400) });
const dedupe = <T extends { query: string }>(qs: T[]) => { const seen = new Set<string>(); return qs.filter((q) => { const k = q.query.toLowerCase(); return q.query && !seen.has(k) && (seen.add(k), true); }); };

async function ask<S extends z.ZodType>(ai: Anthropic, schema: S, user: string) {
  const res = await ai.beta.messages.parse({
    model: FANOUT_MODEL, max_tokens: 8000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("The AI declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("The answer was cut off. Try the AI Overview mode.");
  if (!res.parsed_output) throw new Error("The AI didn't return fan-out queries. Try again.");
  return { out: res.parsed_output as z.infer<S>, cost: cost(res.usage) };
}

export const qforiaClaude: FanoutMethod = {
  id: "qforia_claude",
  label: "Qforia method (Claude simulation)",
  model: FANOUT_MODEL,
  async keyword(keyword, mode, ctx) {
    const { out, cost: c } = await ask(anthropic(ctx.cfg), keywordSchema, `Original query: ${keyword}\nAudience context (only for personalised queries): searchers who might find ${ctx.business} (${ctx.site}).\nReturn ${count(mode)}.`);
    return { queries: dedupe(out.queries.map(clean)).slice(0, QUERIES_PER[mode] + 8), cost: c, model: FANOUT_MODEL };
  },
  async page(page, mode, ctx) {
    const body = page.text.length > PAGE_CHARS ? `${page.text.slice(0, PAGE_CHARS)}\n[page text cut here]` : page.text;
    const { out, cost: c } = await ask(anthropic(ctx.cfg), pageSchema, `A page on ${ctx.site} (${ctx.business}).
URL: ${page.url}
Title: ${page.title ?? "(none)"}
Headings: ${page.headings.slice(0, 40).join(" | ") || "(none)"}

Page text:
"""
${body}
"""

Task: name the page's main topic and the main search query it targets. Then list the fan-out queries an AI search engine would run for that main query (${count(mode)}). For each, judge from the page text whether the page already answers it: covered (answered clearly), partial (mentioned without a usable answer) or missing. suggestion: one short line on what to add or change; for covered queries say what makes the answer good or "No change needed".`);
    const queries = dedupe(out.queries.map((q) => ({ ...clean(q), coverage: q.coverage, suggestion: q.suggestion.trim().slice(0, 300) })));
    return { topic: out.topic.trim().slice(0, 200), mainQuery: out.main_query.trim().slice(0, 200), queries: queries.slice(0, QUERIES_PER[mode] + 8), cost: c, model: FANOUT_MODEL };
  },
};

/** The method every run uses. Swap this for the client's technique when it arrives. */
export const METHOD: FanoutMethod = qforiaClaude;
