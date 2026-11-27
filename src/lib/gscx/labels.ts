import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, anthropicFor } from "@/lib/ai/claude";

/**
 * Topic labels for queries (LLM), cached per client by normalised query so each query is labelled once.
 * The LLM only names the topic of each query; every number stays computed in code.
 */
const schema = z.object({ labels: z.array(z.object({ query: z.string(), topic: z.string() })) });
const KEY = "labels";
const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

export async function loadLabels(admin: SupabaseClient, clientId: string): Promise<Record<string, string>> {
  const { data } = await admin.from("dfs_cache").select("data").eq("client_id", clientId).eq("endpoint", "gscx").eq("params_hash", KEY).maybeSingle();
  return (data?.data as Record<string, string> | undefined) ?? {};
}

/** Labels any queries not labelled yet (batches of 100, at most `max` per run). */
export async function labelQueries(admin: SupabaseClient, clientId: string, queries: string[], business: string, max = 300): Promise<Record<string, string>> {
  const known = await loadLabels(admin, clientId);
  // labels use the client's organization's own Anthropic key; without one the queries simply stay unlabelled
  const ai = await anthropicFor(clientId).catch(() => null);
  if (!ai) return known;
  const todo = [...new Set(queries.map(norm))].filter((q) => !(q in known)).slice(0, max);
  const existing = [...new Set(Object.values(known))].slice(0, 40);
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    try {
      const res = await ai.beta.messages.parse({
        model: AI_MODEL, max_tokens: 6000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        system: `You group Google search queries for ${business} into short topics (2-4 words, Title Case, e.g. "Sign Costs", "Neon Sign Care", "Business Hours"). Reuse an existing topic when it fits: ${existing.join(", ") || "none yet"}. Return every query exactly as given.`,
        output_config: { effort: "low", format: betaZodOutputFormat(schema) },
        messages: [{ role: "user", content: batch.join("\n") }],
      });
      for (const l of res.parsed_output?.labels ?? []) if (batch.includes(norm(l.query))) known[norm(l.query)] = l.topic.slice(0, 40);
    } catch { break; }
  }
  if (todo.length) await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: "gscx", params_hash: KEY, params: { model: AI_MODEL }, data: known, row_count: Object.keys(known).length, cost: 0, fetched_at: new Date().toISOString() }, { onConflict: "client_id,endpoint,params_hash" });
  return known;
}
export const labelOf = (labels: Record<string, string>, q: string) => labels[norm(q)] ?? null;
