import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { defaultBrandTerms, normalizeTerm, normalizeTerms } from "@/lib/brand";
import { assertBudget, BudgetError, recordSpend, type SpendSource } from "@/lib/dataforseo/budget";
import { dfsConfigured, dfsPost } from "@/lib/dataforseo/client";
import { aiErrorMessage, anthropic } from "./claude";

/**
 * AI visibility: when someone asks an AI assistant the questions customers ask, is the business named,
 * where in the answer, how is it described, and is its website cited? Each tracked question is asked to:
 *   - Claude (your own Anthropic key, Sonnet 5.5, live web search)
 *   - ChatGPT, Perplexity and Gemini (their real models with web search, through DataForSEO's
 *     AI Optimization API, billed to DataForSEO and kept inside the daily DataForSEO budget)
 *   - Google AI Mode (the real Google answer, through DataForSEO's SERP API, about $0.004)
 * Claude Sonnet then reads every answer and lists the businesses named, in order, with a 0-100 sentiment
 * for each, plus a short description and what is praised or criticised. Results are stored per question,
 * engine and day; nothing runs when a page is opened.
 */
export const VIS_MODEL = "claude-sonnet-5-5";
// $ per million tokens for claude-sonnet-5-5, and $ per web search (Anthropic first-party pricing)
const PRICE = { input: 2, output: 10, cacheRead: 0.2, search: 0.01 };
export const MAX_PROMPTS = 15;
export const AI_EVERY_DAYS = 7;
const RUN_COST_LIMIT = 1.5; // a single run never spends more than this per client (both providers together)
const SYSTEM = "You are a helpful assistant answering a consumer's question. Answer the way you normally would: if the question is about finding or choosing a business or service, recommend specific, real businesses and say why. Keep the answer under 250 words.";

export type EngineKey = "claude" | "chatgpt" | "perplexity" | "gemini" | "ai_mode";
/** Measured per-answer costs (October 2026): ChatGPT $0.030, Perplexity $0.006, Gemini $0.033, AI Mode $0.004, Claude ~$0.05 incl. search. */
export const ENGINES: Record<EngineKey, { label: string; model: string; est: number; via: "anthropic" | "dataforseo"; path?: string }> = {
  claude: { label: "Claude", model: VIS_MODEL, est: 0.05, via: "anthropic" },
  chatgpt: { label: "ChatGPT", model: "gpt-5.4-mini", est: 0.035, via: "dataforseo", path: "chat_gpt" },
  perplexity: { label: "Perplexity", model: "sonar", est: 0.008, via: "dataforseo", path: "perplexity" },
  gemini: { label: "Gemini", model: "gemini-3.5-flash", est: 0.04, via: "dataforseo", path: "gemini" },
  ai_mode: { label: "Google AI Mode", model: "google-ai-mode", est: 0.006, via: "dataforseo" },
};
export const ENGINE_KEYS = Object.keys(ENGINES) as EngineKey[];
const EXTRACT_EST = 0.02;
/** Estimated cost of one question across the chosen engines, including the brand/sentiment reading. */
export const promptEstimate = (engines: EngineKey[]) => Number((engines.reduce((a, e) => a + ENGINES[e].est, 0) + EXTRACT_EST).toFixed(3));
export const PROMPT_EST = promptEstimate(ENGINE_KEYS);

export interface AiPrompt { id: string; prompt: string; created_at: string }
export interface AiSource { domain: string; url: string; title: string | null }
export interface AiBrand {
  name: string; domain: string | null; position: number; sentiment: number | null; own: boolean; cited: boolean;
  /** how the answer describes the brand, a few words (answers read before November 2026 have none) */
  note?: string | null; praised?: string[]; criticised?: string[];
}
export interface AiCheck {
  prompt_id: string; checked_on: string; model: string; used_search: boolean; mentioned: boolean; cited: boolean; seen: boolean;
  sources: AiSource[]; competitors: string[]; answer: string | null; cost: number;
  engine: EngineKey; brands: AiBrand[]; position: number | null; sentiment: number | null;
}

const host = (u: string | null | undefined) => { try { return new URL(u ?? "").hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const sameSite = (h: string, site: string) => !!h && (h === site || h.endsWith(`.${site}`));
const cleanUrl = (u: string) => u.replace(/[?&]utm_source=openai$/, "").replace(/\?utm_source=openai&/, "?");

type Block = Anthropic.Messages.ContentBlock;
interface Answer { engine: EngineKey; text: string; sources: AiSource[]; seenHosts: string[]; model: string; usedSearch: boolean; cost: number; provider: "anthropic" | "dataforseo" }

/** Reads the answer text, the cited sources and the search results out of a Claude response. Pure, so it is easy to test. */
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
        if (h && !sources.has(c.url)) sources.set(c.url, { domain: h, url: c.url, title: c.title ?? null });
      }
    } else if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) { const h = host(r.url); if (h) seenHosts.add(h); }
    }
  }
  const flat = normalizeTerm(text);
  const list = [...sources.values()];
  return {
    text: text.trim(), mentioned: terms.some((t) => flat.includes(t)) || flat.includes(normalizeTerm(site)),
    cited: list.some((s) => sameSite(s.domain, site)), seen: [...seenHosts].some((h) => sameSite(h, site)),
    sources: list.slice(0, 12), seenHosts: [...seenHosts],
  };
}

async function askClaude(prompt: string, search: boolean): Promise<Answer> {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
  const content: Block[] = [];
  let searches = 0, input = 0, output = 0, cached = 0;
  for (let turn = 0; turn < 3; turn++) { // a long search turn can pause; continue it
    const res = await anthropic().messages.create({
      model: VIS_MODEL, max_tokens: 2500, system: SYSTEM, output_config: { effort: "low" }, messages,
      ...(search ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }] } : {}),
    });
    content.push(...res.content);
    input += res.usage.input_tokens; output += res.usage.output_tokens; cached += res.usage.cache_read_input_tokens ?? 0;
    searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    if (res.stop_reason === "refusal") throw new Error("Claude declined to answer this question.");
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  const p = parseAnswer(content, "", []);
  const cost = Number(((input * PRICE.input + cached * PRICE.cacheRead + output * PRICE.output) / 1_000_000 + searches * PRICE.search).toFixed(5));
  return { engine: "claude", text: p.text, sources: p.sources, seenHosts: p.seenHosts, model: VIS_MODEL, usedSearch: search, cost, provider: "anthropic" };
}

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);

/** ChatGPT, Perplexity or Gemini through DataForSEO LLM Responses (live, with web search). */
async function askDfs(engine: Exclude<EngineKey, "claude" | "ai_mode">, prompt: string, city: string | null): Promise<Answer> {
  const e = ENGINES[engine];
  const body: J = { user_prompt: prompt.slice(0, 500), model_name: e.model, system_message: SYSTEM.slice(0, 500), max_output_tokens: 2048 };
  if (engine === "chatgpt") Object.assign(body, { web_search: true, web_search_country_iso_code: "US", ...(city ? { web_search_city: city } : {}) });
  if (engine === "perplexity") Object.assign(body, { web_search_country_iso_code: "US" });
  if (engine === "gemini") Object.assign(body, { web_search: true });
  const { result, cost } = await dfsPost(`/ai_optimization/${e.path}/llm_responses/live`, body, { timeoutMs: 120_000, attempts: 1 });
  const items = arr(result?.items);
  const msg = items.find((i) => i.type === "message") ?? items[0];
  const sections = arr(msg?.sections);
  const text = sections.map((s) => (typeof s.text === "string" ? s.text : "")).join("\n").trim();
  const sources = new Map<string, AiSource>();
  for (const a of sections.flatMap((s) => arr(s.annotations))) {
    const raw = String(a.direct_url ?? a.url ?? "");
    // Gemini links through a Google redirect; its title carries the real domain
    const redirect = /vertexaisearch\.cloud\.google\.com/.test(raw);
    const domain = redirect ? String(a.title ?? "").replace(/^www\./, "").toLowerCase() : host(raw);
    const url = redirect ? `https://${domain}/` : cleanUrl(raw);
    if (domain && !sources.has(url)) sources.set(url, { domain, url, title: typeof a.title === "string" ? a.title.slice(0, 160) : null });
  }
  return { engine, text, sources: [...sources.values()].slice(0, 12), seenHosts: [], model: String(result?.model_name ?? e.model), usedSearch: result?.web_search !== false, cost, provider: "dataforseo" };
}

/** Google's own pages, image hosts and DataForSEO's image CDN: links in an AI Mode answer that are not sources */
const isGoogle = (h: string) => /(^|\.)google\.[a-z.]+$|(^|\.)(gstatic|googleusercontent|ggpht|dataforseo)\.com$/.test(h);

/** Google AI Mode through DataForSEO's SERP API: the answer text, and the websites it links to. */
async function askAiMode(prompt: string): Promise<Answer> {
  const { result, cost } = await dfsPost("/serp/google/ai_mode/live/advanced", { keyword: prompt.slice(0, 700), location_code: 2840, language_code: "en" }, { timeoutMs: 120_000, attempts: 1 });
  const ov = arr(result?.items).find((i) => i.type === "ai_overview");
  const parts = arr(ov?.items);
  const text = (parts.length ? parts.map((e) => [e.title, e.text].filter((x) => typeof x === "string").join("\n")).join("\n\n") : String(ov?.markdown ?? ""))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
  const sources = new Map<string, AiSource>();
  const add = (url: string, title: string | null) => { const h = host(url); if (h && !isGoogle(h) && !sources.has(url)) sources.set(url, { domain: h, url, title }); };
  for (const m of String(ov?.markdown ?? "").matchAll(/(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) add(m[2], m[1] && m[1] !== "Website" ? m[1].slice(0, 160) : null);
  for (const r of [...arr(ov?.references), ...parts.flatMap((e) => arr(e.references))]) add(String(r.url ?? ""), typeof r.title === "string" ? r.title.slice(0, 160) : null);
  return { engine: "ai_mode", text, sources: [...sources.values()].slice(0, 12), seenHosts: [], model: ENGINES.ai_mode.model, usedSearch: true, cost, provider: "dataforseo" };
}

/* ------------------------------------------------------------------ reading the answers (Claude Sonnet) */
const brandSchema = z.object({
  answers: z.array(z.object({
    engine: z.string(),
    brands: z.array(z.object({
      name: z.string(), domain: z.string().nullable(), position: z.number().int(), sentiment: z.number().int(), is_client: z.boolean(),
      note: z.string(), praised: z.array(z.string()), criticised: z.array(z.string()),
    })),
  })),
});

/**
 * One Claude call per question reads all engines' answers and lists every business named, in order of
 * first mention, with a 0-100 sentiment (50 neutral) for how the answer describes it.
 */
async function extractBrands(answers: Answer[], client: { name: string; site: string; terms: string[] }): Promise<{ map: Map<EngineKey, AiBrand[]>; cost: number }> {
  const map = new Map<EngineKey, AiBrand[]>();
  const usable = answers.filter((a) => a.text);
  if (!usable.length) return { map, cost: 0 };
  const doc = usable.map((a) => `<answer engine="${a.engine}">\n${a.text.slice(0, 6000)}\n</answer>`).join("\n\n");
  const res = await anthropic().beta.messages.parse({
    model: VIS_MODEL, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(brandSchema) },
    system: "You analyse AI assistant answers for brand visibility. For each answer, list every business, brand or company the answer names or recommends (not directories or websites used only as sources, unless the answer recommends them as a business), in order of first appearance (position 1 = named first). Give each a sentiment from 0 to 100 for how favourably the answer describes it (50 = neutral mention, 75+ = recommended/praised, below 40 = criticised or warned against), its website domain if the answer states or links it (else null), is_client = true only if it is the client business, note = how the answer describes it in at most 12 words, and praised / criticised = up to 3 short themes each (2-3 words, lower case, e.g. 'fast turnaround', 'high prices'; empty when none).",
    messages: [{ role: "user", content: `Client business: ${client.name}\nClient website: ${client.site}\nClient brand words: ${client.terms.join(", ") || "-"}\n\n${doc}\n\nReturn one entry per answer, using the engine names given.` }],
  });
  const u = res.usage;
  const cost = Number(((u.input_tokens * PRICE.input + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + u.output_tokens * PRICE.output) / 1_000_000).toFixed(5));
  for (const a of (res.parsed_output?.answers ?? [])) {
    if (!ENGINE_KEYS.includes(a.engine as EngineKey)) continue;
    const src = usable.find((x) => x.engine === a.engine);
    const citedHosts = new Set((src?.sources ?? []).map((s) => s.domain));
    map.set(a.engine as EngineKey, a.brands.slice(0, 20).map((b, i) => {
      const d = b.domain ? b.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() : null;
      return {
        name: b.name.slice(0, 100), domain: d, position: b.position > 0 ? b.position : i + 1, sentiment: Math.max(0, Math.min(100, b.sentiment)),
        own: b.is_client || (!!d && sameSite(d, client.site)), cited: !!d && [...citedHosts].some((h) => sameSite(h, d)),
        note: b.note.slice(0, 140) || null, praised: b.praised.slice(0, 3).map((x) => x.slice(0, 40)), criticised: b.criticised.slice(0, 3).map((x) => x.slice(0, 40)),
      };
    }));
  }
  return { map, cost };
}

/* ------------------------------------------------------------------ one question, every engine */
export interface Opts { site: string; terms: string[]; name: string; search: boolean; engines: EngineKey[]; city: string | null; source: SpendSource }

export async function checkPrompt(admin: SupabaseClient, clientId: string, p: AiPrompt, o: Opts): Promise<{ checks: AiCheck[]; cost: number; errors: string[] }> {
  const errors: string[] = [];
  // several answers per question and day need migration 21; until it is applied only Claude is asked, so nothing paid is lost
  const multi = !(await admin.from("ai_checks").select("engine").limit(1)).error;
  if (!multi && o.engines.some((e) => e !== "claude")) errors.push("ChatGPT, Perplexity and Gemini start once the latest database migration (20261030000021) is applied.");
  const dfsEngines = (multi ? o.engines : []).filter((e) => e !== "claude" && dfsConfigured()) as Exclude<EngineKey, "claude">[];
  if (dfsEngines.length) {
    try { await assertBudget(admin, clientId, dfsEngines.reduce((a, e) => a + ENGINES[e].est, 0), o.source); }
    catch (e) { if (e instanceof BudgetError) { errors.push(e.message); dfsEngines.length = 0; } else throw e; }
  }
  const jobs: Promise<Answer>[] = [
    ...(o.engines.includes("claude") && process.env.ANTHROPIC_API_KEY ? [askClaude(p.prompt, o.search)] : []),
    ...dfsEngines.map((e) => (e === "ai_mode" ? askAiMode(p.prompt) : askDfs(e, p.prompt, o.city))),
  ];
  const settled = await Promise.allSettled(jobs);
  const answers: Answer[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") answers.push(s.value);
    else errors.push(aiErrorMessage(s.reason));
  }
  const dfsCost = answers.filter((a) => a.provider === "dataforseo").reduce((a, x) => a + x.cost, 0);
  if (dfsCost > 0) await recordSpend(admin, clientId, "ai_visibility", dfsCost, o.source);

  let brands = new Map<EngineKey, AiBrand[]>(), extractCost = 0;
  try { const r = await extractBrands(answers, { name: o.name, site: o.site, terms: o.terms }); brands = r.map; extractCost = r.cost; }
  catch (e) { errors.push(`brand reading: ${aiErrorMessage(e)}`); }

  const today = new Date().toISOString().slice(0, 10);
  const checks: AiCheck[] = answers.map((a) => {
    const flat = normalizeTerm(a.text);
    const list = brands.get(a.engine) ?? [];
    const own = list.find((b) => b.own);
    const mentioned = !!own || o.terms.some((t) => flat.includes(t)) || flat.includes(normalizeTerm(o.site));
    const cited = a.sources.some((s) => sameSite(s.domain, o.site));
    return {
      prompt_id: p.id, checked_on: today, model: a.model, used_search: a.usedSearch, mentioned, cited,
      seen: cited || a.seenHosts.some((h) => sameSite(h, o.site)), sources: a.sources,
      competitors: [...new Set(a.sources.map((s) => s.domain).filter((h) => !sameSite(h, o.site)))].slice(0, 8),
      answer: a.text.slice(0, 4000) || null,
      // the reading call is shared by the question's answers, so its cost is split between them
      cost: Number((a.cost + extractCost / Math.max(1, answers.length)).toFixed(5)),
      engine: a.engine, brands: list, position: own?.position ?? null, sentiment: own?.sentiment ?? null,
    };
  });
  for (const c of checks) {
    const { error } = await admin.from("ai_checks").upsert({ client_id: clientId, ...c }, { onConflict: "prompt_id,checked_on,engine" });
    // before migration 21 only one (Claude) answer per question and day can be stored
    if (error && c.engine === "claude") {
      const legacy = { prompt_id: c.prompt_id, checked_on: c.checked_on, model: c.model, used_search: c.used_search, mentioned: c.mentioned, cited: c.cited, seen: c.seen, sources: c.sources, competitors: c.competitors, answer: c.answer, cost: c.cost };
      await admin.from("ai_checks").upsert({ client_id: clientId, ...legacy }, { onConflict: "prompt_id,checked_on" });
    }
  }
  return { checks, cost: checks.reduce((a, c) => a + c.cost, 0), errors };
}

/** Brand words for a client: the saved ones (shared with the Search Console brand split) or derived from name and website. */
export async function brandTermsFor(admin: SupabaseClient, clientId: string, site: string): Promise<string[]> {
  const { data } = await admin.from("clients").select("name, settings").eq("id", clientId).maybeSingle();
  const saved = (data?.settings as { brand_terms?: string[] } | null)?.brand_terms;
  return saved?.length ? normalizeTerms(saved) : defaultBrandTerms((data?.name as string) ?? "", [site]);
}

/** The engines a client checks (saved on the AI Visibility page; all four by default). */
export function enginesFrom(settings: unknown): EngineKey[] {
  const saved = (settings as { ai_engines?: string[] } | null)?.ai_engines;
  const list = (saved ?? ENGINE_KEYS).filter((e): e is EngineKey => ENGINE_KEYS.includes(e as EngineKey));
  return list.length ? list : ["claude"];
}

export interface AiRun { checked: number; skipped: number; cost: number; errors: string[]; stopped: string | null }

export async function runAiChecks(admin: SupabaseClient, clientId: string, site: string, opts: { force?: boolean; deadline?: number; search?: boolean; source?: SpendSource } = {}): Promise<AiRun> {
  const run: AiRun = { checked: 0, skipped: 0, cost: 0, errors: [], stopped: null };
  const [{ data: prompts }, { data: last }, { data: client }, { data: gbp }] = await Promise.all([
    admin.from("ai_prompts").select("id, prompt, created_at").eq("client_id", clientId).order("created_at").limit(MAX_PROMPTS),
    admin.from("ai_checks").select("prompt_id, checked_on").eq("client_id", clientId).order("checked_on", { ascending: false }).limit(2000),
    admin.from("clients").select("name, settings").eq("id", clientId).maybeSingle(),
    admin.from("integration_resources").select("display_name, metadata").eq("client_id", clientId).eq("provider", "gbp").eq("is_selected", true).limit(1).maybeSingle(),
  ]);
  const lastOn = new Map<string, string>();
  for (const r of last ?? []) if (!lastOn.has(r.prompt_id as string)) lastOn.set(r.prompt_id as string, r.checked_on as string);
  const cutoff = new Date(Date.now() - (AI_EVERY_DAYS - 0.5) * 86_400_000).toISOString().slice(0, 10);
  const terms = await brandTermsFor(admin, clientId, site);
  const engines = enginesFrom(client?.settings);
  const meta = (gbp?.metadata ?? {}) as { lbm_location?: { city?: string; name?: string } };
  const name = meta.lbm_location?.name ?? (gbp?.display_name as string | undefined) ?? (client?.name as string) ?? site;
  const due = ((prompts ?? []) as AiPrompt[]).filter((p) => opts.force || !lastOn.get(p.id) || (lastOn.get(p.id) as string) <= cutoff);
  run.skipped = (prompts?.length ?? 0) - due.length;
  for (const p of due) {
    if (opts.deadline && Date.now() > opts.deadline) { run.stopped = "time"; break; }
    if (run.cost >= RUN_COST_LIMIT) { run.stopped = "cost limit"; break; }
    try {
      const r = await checkPrompt(admin, clientId, p, { site, terms, name, search: opts.search !== false, engines, city: meta.lbm_location?.city ?? null, source: opts.source ?? "auto" });
      if (r.checks.length) run.checked++;
      run.cost += r.cost;
      run.errors.push(...r.errors);
      if (r.errors.some((e) => /budget|daily API limit/i.test(e)) && !r.checks.length) { run.stopped = "budget"; break; }
    } catch (e) {
      run.errors.push(aiErrorMessage(e));
      if (/key was rejected|Missing or invalid environment/.test(run.errors.at(-1) ?? "")) { run.stopped = "provider"; break; }
    }
  }
  return run;
}

/* ------------------------------------------------------------------ reading (no API calls) */
export interface AiRow { id: string; prompt: string; latest: AiCheck | null; byEngine: Partial<Record<EngineKey, AiCheck>>; history: { date: string; visible: boolean }[] }
export interface AiSummary {
  ok: boolean; rows: AiRow[]; lastChecked: string | null;
  /** share of the latest answers (question x engine) that name or cite the business, 0-100 */
  score: number | null; previousScore: number | null;
  /** websites cited most often across the latest answers, ours excluded */
  topSources: { domain: string; count: number }[];
  trend: { date: string; score: number }[];
  /** every stored answer, newest first */
  checks: AiCheck[];
  /** the newest answer per question and engine */
  latest: AiCheck[];
}

const normalise = (x: Record<string, unknown>): AiCheck => ({
  ...(x as unknown as AiCheck), engine: ((x.engine as EngineKey) ?? "claude"), brands: (x.brands as AiBrand[]) ?? [],
  // image links stored by the first Google AI Mode checks are not sources
  sources: ((x.sources as AiSource[]) ?? []).filter((s) => !isGoogle(s.domain)), competitors: ((x.competitors as string[]) ?? []).filter((d) => !isGoogle(d)),
  position: (x.position as number | null) ?? null, sentiment: x.sentiment == null ? null : Number(x.sentiment), cost: Number(x.cost ?? 0),
});

export async function loadAi(supabase: SupabaseClient, clientId: string): Promise<AiSummary> {
  const [p, c] = await Promise.all([
    supabase.from("ai_prompts").select("id, prompt").eq("client_id", clientId).order("created_at"),
    supabase.from("ai_checks").select("*").eq("client_id", clientId).order("checked_on", { ascending: false }).limit(3000),
  ]);
  const empty: AiSummary = { ok: false, rows: [], lastChecked: null, score: null, previousScore: null, topSources: [], trend: [], checks: [], latest: [] };
  if (p.error || c.error) return empty;
  const checks = (c.data ?? []).map((x) => normalise(x as Record<string, unknown>));
  const visible = (x: AiCheck) => x.mentioned || x.cited;
  const latestMap = new Map<string, AiCheck>();
  for (const x of checks) { const k = `${x.prompt_id}|${x.engine}`; if (!latestMap.has(k)) latestMap.set(k, x); }
  const latest = [...latestMap.values()];
  const rows: AiRow[] = (p.data ?? []).map((r) => {
    const mine = checks.filter((x) => x.prompt_id === r.id);
    const byEngine: Partial<Record<EngineKey, AiCheck>> = {};
    for (const x of latest.filter((l) => l.prompt_id === r.id)) byEngine[x.engine] = x;
    const days = new Map<string, boolean>();
    for (const x of mine) days.set(x.checked_on, (days.get(x.checked_on) ?? false) || visible(x));
    return { id: r.id as string, prompt: r.prompt as string, latest: byEngine.claude ?? mine[0] ?? null, byEngine, history: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, visible: v })) };
  });
  const pct = (list: boolean[]) => (list.length ? Math.round((list.filter(Boolean).length / list.length) * 100) : null);
  const days = new Map<string, boolean[]>();
  for (const x of checks) { const l = days.get(x.checked_on) ?? []; l.push(visible(x)); days.set(x.checked_on, l); }
  const trend = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, l]) => ({ date, score: pct(l) as number }));
  const counts = new Map<string, number>();
  for (const x of latest) for (const d of x.competitors) counts.set(d, (counts.get(d) ?? 0) + 1);
  return {
    ok: true, rows, checks, latest,
    lastChecked: latest.reduce<string | null>((a, x) => (!a || x.checked_on > a ? x.checked_on : a), null),
    score: pct(latest.map(visible)), previousScore: trend.length >= 2 ? trend[trend.length - 2].score : null,
    topSources: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([domain, count]) => ({ domain, count })), trend,
  };
}

/* ------------------------------------------------------------------ analytics for the tabs (pure) */
export interface BrandStat {
  name: string; own: boolean; domain: string | null; mentions: number; answers: number; detection: number; top3: number;
  avgPosition: number | null; latestPosition: number | null; avgSentiment: number | null; citations: number;
  positive: number; neutral: number; negative: number; engines: Partial<Record<EngineKey, { mentions: number; sentiment: number | null }>>;
}

export const brandKey = (b: Pick<AiBrand, "name">) => normalizeTerm(b.name).replace(/(inc|llc|co|company|corp)$/, "") || b.name.toLowerCase();

/** Per-brand share of voice, position, citations and sentiment across the latest answers (history for averages). */
export function brandStats(s: AiSummary, site: string): BrandStat[] {
  const total = s.latest.length;
  const map = new Map<string, BrandStat & { posSum: number; posN: number; sentSum: number; sentN: number; histPos: number[] }>();
  const get = (b: AiBrand) => {
    const k = b.own ? "__client__" : brandKey(b);
    let x = map.get(k);
    if (!x) {
      x = { name: b.name, own: b.own, domain: b.domain, mentions: 0, answers: total, detection: 0, top3: 0, avgPosition: null, latestPosition: null, avgSentiment: null, citations: 0, positive: 0, neutral: 0, negative: 0, engines: {}, posSum: 0, posN: 0, sentSum: 0, sentN: 0, histPos: [] };
      map.set(k, x);
    }
    if (!x.domain && b.domain) x.domain = b.domain;
    return x;
  };
  for (const c of s.latest) {
    for (const b of c.brands) {
      const x = get(b);
      x.mentions++; x.posSum += b.position; x.posN++;
      if (b.position <= 3) x.top3++;
      if (b.sentiment != null) {
        x.sentSum += b.sentiment; x.sentN++;
        if (b.sentiment >= 60) x.positive++; else if (b.sentiment >= 40) x.neutral++; else x.negative++;
      }
      const e = x.engines[c.engine] ?? { mentions: 0, sentiment: null };
      e.sentiment = b.sentiment == null ? e.sentiment : e.sentiment == null ? b.sentiment : Math.round((e.sentiment * e.mentions + b.sentiment) / (e.mentions + 1));
      e.mentions++;
      x.engines[c.engine] = e;
    }
  }
  for (const c of s.checks) for (const b of c.brands) map.get(b.own ? "__client__" : brandKey(b))?.histPos.push(b.position);
  const cites = new Map<string, number>();
  for (const c of s.latest) for (const src of c.sources) cites.set(src.domain, (cites.get(src.domain) ?? 0) + 1);
  const site0 = site.replace(/^www\./, "");
  return [...map.values()].map((x) => {
    const dom = x.own ? site0 : x.domain;
    return {
      name: x.name, own: x.own, domain: dom, mentions: x.mentions, answers: total, detection: total ? Math.round((x.mentions / total) * 100) : 0,
      top3: x.mentions ? Math.round((x.top3 / total) * 100) : 0, latestPosition: x.posN ? Number((x.posSum / x.posN).toFixed(1)) : null,
      avgPosition: x.histPos.length ? Number((x.histPos.reduce((a, b) => a + b, 0) / x.histPos.length).toFixed(1)) : null,
      avgSentiment: x.sentN ? Math.round(x.sentSum / x.sentN) : null,
      citations: dom ? [...cites.entries()].filter(([h]) => sameSite(h, dom)).reduce((a, [, n]) => a + n, 0) : 0,
      positive: x.positive, neutral: x.neutral, negative: x.negative, engines: x.engines,
    };
  }).sort((a, b) => Number(b.own) - Number(a.own) || b.mentions - a.mentions);
}

/** Starter prompts built from keywords the site already ranks for, in the way customers phrase questions. */
export function suggestPrompts(keywords: string[], existing: string[], city?: string | null): string[] {
  const have = new Set(existing.map((e) => e.toLowerCase()));
  const out: string[] = [];
  const where = (kw: string) => (city && !kw.includes(city.toLowerCase()) && !/near me/.test(kw) ? ` in ${city}` : "");
  for (const k of keywords) {
    const kw = k.trim().toLowerCase();
    if (kw.length < 4 || kw.length > 60) continue;
    // phrased the way people ask an assistant: price questions as "How much...", the rest as "Who offers the best..."
    const q = /^(how|what|why|where|who|which|can|do|does|is)\b/.test(kw)
      ? `${kw[0].toUpperCase()}${kw.slice(1)}${/\?$/.test(kw) ? "" : "?"}`
      : /\b(cost|price|prices|pricing)\b/.test(kw)
        ? `How much does ${kw.replace(/\b(cost|price|prices|pricing)\b/, "").trim() || kw} cost${where(kw)}?`
        : `Who offers the best ${kw.replace(/\bnear me\b/, "").trim()}${where(kw)}${/near me/.test(kw) ? " near me" : ""}? Recommend specific businesses.`;
    if (!have.has(q.toLowerCase()) && !out.includes(q)) out.push(q);
    if (out.length >= 8) break;
  }
  return out;
}
