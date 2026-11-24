import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "@/lib/ai/claude";
import { userContent } from "./prompt";
import { QuickWinsSchema, RepairSchema, type QuickWinItem, type QuickWinsOutput } from "./schema";
import { callCost, type AiQwSettings } from "./settings";
import type { CallLog, Candidate } from "./types";

/**
 * Claude calls of the quick wins engine. The system prompt (rules + business profile) is the same for every chunk and
 * run, so it carries cache_control; everything that varies (candidates) is in the user message. Claude Opus 5.5 always
 * thinks adaptively: no thinking parameter is sent, only output_config.effort.
 */
const MAX_TOKENS = 16000;
/** About 12 candidates per request keeps an answer (about 900 output tokens per kept item) well under max_tokens. */
export const CHUNK = 12;
export const CONCURRENCY = 10;

type Sys = Anthropic.TextBlockParam[];
export const systemBlocks = (text: string): Sys => [{ type: "text", text, cache_control: { type: "ephemeral" } }];

/** Candidate as Claude sees it (no internal fields). */
export const forClaude = (c: Candidate) => ({
  candidate_id: c.candidate_id, rule: c.rule, page_url: c.page_url, facts: c.facts, queries: c.queries, page_context: c.page_context,
  computed_gain: c.computed_gain, gain_unit: c.gain_unit, effort_hint: c.effort_hint, draft: c.draft,
});

/** Chunks of about 25, keeping a page's candidates together. */
export function chunkCandidates(cands: Candidate[], size = CHUNK): Candidate[][] {
  const byPage = new Map<string, Candidate[]>();
  for (const c of cands) byPage.set(c.page_url, [...(byPage.get(c.page_url) ?? []), c]);
  const chunks: Candidate[][] = [];
  let cur: Candidate[] = [];
  for (const group of byPage.values()) {
    for (let i = 0; i < group.length; i += size) {
      const part = group.slice(i, i + size);
      if (cur.length + part.length > size && cur.length) { chunks.push(cur); cur = []; }
      cur.push(...part);
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export interface ChunkResult { output: QuickWinsOutput | null; logs: CallLog[]; error: string | null }

async function once(s: AiQwSettings, system: Sys, chunk: Candidate[], idx: number): Promise<{ out: QuickWinsOutput | null; stop: string | null; log: CallLog; refusal?: string }> {
  const t0 = Date.now();
  const res = await anthropic().messages.parse({
    model: s.model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: s.effort, format: zodOutputFormat(QuickWinsSchema) },
    system,
    messages: [{ role: "user", content: userContent(chunk.map(forClaude)) }],
  });
  const u = res.usage;
  const log: CallLog = { chunk: idx, model: s.model, input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cost: callCost(s.model, u), ms: Date.now() - t0, stop: res.stop_reason };
  return { out: res.stop_reason === "end_turn" ? res.parsed_output : null, stop: res.stop_reason, log, refusal: res.stop_reason === "refusal" ? JSON.stringify((res as { stop_details?: unknown }).stop_details ?? null) : undefined };
}

/** One chunk: retried once when the JSON doesn't parse, split in two when it hits max_tokens, skipped on a refusal. */
export async function runChunk(s: AiQwSettings, system: Sys, chunk: Candidate[], idx: number, depth = 0): Promise<ChunkResult> {
  const logs: CallLog[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try { r = await once(s, system, chunk, idx); }
    catch (e) {
      // the SDK already retried 429/5xx twice; one more slow retry for rate limits, then give up on this chunk
      if (e instanceof Anthropic.RateLimitError && attempt === 0) { await new Promise((ok) => setTimeout(ok, 20_000)); continue; }
      return { output: null, logs, error: e instanceof Anthropic.APIError ? `Claude API error ${e.status ?? ""}: ${e.message.slice(0, 160)}` : (e instanceof Error ? e.message : "failed").slice(0, 200) };
    }
    logs.push(r.log);
    if (r.stop === "refusal") { console.warn("[aiqw] refusal", idx, r.refusal); return { output: null, logs, error: "Claude declined this chunk." }; }
    if (r.stop === "max_tokens") {
      if (chunk.length < 2 || depth > 2) return { output: null, logs, error: "The answer for this chunk was too long." };
      const half = Math.ceil(chunk.length / 2);
      const [a, b] = await Promise.all([runChunk(s, system, chunk.slice(0, half), idx, depth + 1), runChunk(s, system, chunk.slice(half), idx, depth + 1)]);
      const items = [...(a.output?.items ?? []), ...(b.output?.items ?? [])], merged = [...(a.output?.merged ?? []), ...(b.output?.merged ?? [])];
      return { output: items.length ? { items, merged } : null, logs: [...logs, ...a.logs, ...b.logs], error: a.error ?? b.error };
    }
    if (r.out) return { output: r.out, logs, error: null };
  }
  return { output: null, logs, error: "Claude's answer didn't match the expected structure twice." };
}

/** Re-asks Claude for one item with the validation errors. */
export async function repairItem(s: AiQwSettings, system: Sys, c: Candidate, item: QuickWinItem, errors: string[]): Promise<{ item: QuickWinItem | null; log: CallLog | null }> {
  const t0 = Date.now();
  try {
    const res = await anthropic().messages.parse({
      model: s.model, max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(RepairSchema) },
      system,
      messages: [{ role: "user", content: `${userContent([forClaude(c)], "Fix this one quick win. Your previous answer is below, followed by what was wrong with it. Return the corrected item (same candidate_id, keep true).")}\n\nPrevious answer:\n${JSON.stringify(item)}\n\nProblems:\n- ${errors.join("\n- ")}` }],
    });
    const u = res.usage;
    return { item: res.stop_reason === "end_turn" ? res.parsed_output?.item ?? null : null, log: { chunk: -1, model: s.model, input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cost: callCost(s.model, u), ms: Date.now() - t0, stop: res.stop_reason } };
  } catch { return { item: null, log: null }; }
}

/** Runs async jobs with a concurrency limit, calling onDone after each. */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>, onDone?: (r: R, i: number) => Promise<void> | void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); await onDone?.(out[i], i); }
  }));
  return out;
}

/* ------------------------------------------------------------------ Message Batches (nightly, half price) */

/** Batch custom_id for one chunk: the API accepts only [a-zA-Z0-9_-]{1,64}, so "-" separates run id and chunk index. */
export const batchCustomId = (runId: string, chunk: number) => `${runId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 56)}-${chunk}`;

/** One batch request per chunk; custom_id = batchCustomId(runId, chunkIndex) (the API allows only letters, digits, "_" and "-"). Batch requests don't stream. */
export async function submitBatch(s: AiQwSettings, systemText: string, runId: string, chunks: Candidate[][]): Promise<string> {
  const fmt = zodOutputFormat(QuickWinsSchema);
  const batch = await anthropic().messages.batches.create({
    requests: chunks.map((chunk, i) => ({
      custom_id: batchCustomId(runId, i),
      params: {
        model: s.model, max_tokens: MAX_TOKENS,
        output_config: { effort: s.effort, format: { type: "json_schema", schema: fmt.schema } },
        system: systemBlocks(systemText),
        messages: [{ role: "user", content: userContent(chunk.map(forClaude)) }],
      },
    })),
  });
  return batch.id;
}

/** null while still processing; else each chunk's output by custom_id (never by position). */
export async function collectBatch(s: AiQwSettings, batchId: string): Promise<Map<string, ChunkResult> | null> {
  const b = await anthropic().messages.batches.retrieve(batchId);
  if (b.processing_status !== "ended") return null;
  const out = new Map<string, ChunkResult>();
  for await (const r of await anthropic().messages.batches.results(batchId)) {
    const idx = Number(r.custom_id.split("-").pop());
    if (r.result.type !== "succeeded") { out.set(r.custom_id, { output: null, logs: [], error: `Batch request ${r.result.type}` }); continue; }
    const m = r.result.message, u = m.usage;
    const log: CallLog = { chunk: idx, model: m.model, input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cost: callCost(s.model, u, true), ms: 0, stop: m.stop_reason };
    if (m.stop_reason !== "end_turn") { out.set(r.custom_id, { output: null, logs: [log], error: `Stopped: ${m.stop_reason}` }); continue; }
    const text = m.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("");
    let parsed: QuickWinsOutput | null = null;
    try { const p = QuickWinsSchema.safeParse(JSON.parse(text)); parsed = p.success ? p.data : null; } catch { parsed = null; }
    out.set(r.custom_id, { output: parsed, logs: [log], error: parsed ? null : "The answer didn't match the expected structure." });
  }
  return out;
}

/** "ok" test for the Settings page. */
export async function pingClaude(s: AiQwSettings): Promise<string> {
  const res = await anthropic().messages.create({ model: s.model, max_tokens: 1000, output_config: { effort: "low" }, messages: [{ role: "user", content: "Reply with the single word: ok" }] });
  return res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("").trim();
}
