import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { shiftDays, todayIn } from "@/lib/analytics/range";
import { loadRanks } from "@/lib/dataforseo/rank";
import { loadAudit } from "@/lib/dataforseo/audit";
import { loadReportData } from "@/lib/report/data";
import { aiErrorMessage, anthropic } from "./claude";
import { buildEvidence, evidenceText, type EvidenceItem } from "./evidence";
import { loadAi } from "./visibility";

/**
 * Four guided analyses over the client's stored data, written by Claude Sonnet 5.5 on the owner's
 * Anthropic key. Each one is generated on request (never when a page is opened), validated against a
 * schema, checked against the evidence ids it may cite, and stored so everyone reads the same answer.
 */
export const COACH_MODEL = "claude-sonnet-5-5";
const PRICE = { input: 2, output: 10, cacheRead: 0.2 }; // $ per million tokens
export const COACH_MODES = ["coach", "priorities", "topics", "competitors"] as const;
export type CoachMode = (typeof COACH_MODES)[number];
export const COACH_COOLDOWN_HOURS = 12;

const list = z.array(z.string());
export const schemas = {
  coach: z.object({
    where_you_stand: z.string(),
    steps: z.array(z.object({ title: z.string(), why: z.string(), how: list, time_estimate: z.string() })),
    terms: z.array(z.object({ term: z.string(), meaning: z.string() })),
  }),
  priorities: z.object({
    summary: z.string(),
    actions: z.array(z.object({ title: z.string(), why_it_matters: z.string(), steps: list, expected_effect_hypothesis: z.string(), effort: z.enum(["low", "medium", "high"]), evidence_references: list })),
    not_now: list,
  }),
  topics: z.object({
    summary: z.string(),
    topics: z.array(z.object({
      title: z.string(), target_keyword: z.string().nullable(), search_intent: z.string(), why: z.string(),
      action: z.enum(["new_page", "improve_existing_page"]), target_url: z.string().nullable(), outline: list, evidence_references: list,
    })),
  }),
  competitors: z.object({
    summary: z.string(),
    competitors: z.array(z.object({ domain: z.string(), what_they_do_well: z.string(), where_they_beat_you: z.string(), where_you_can_win: z.string(), evidence_references: list })),
    plays: z.array(z.object({ title: z.string(), steps: list, evidence_references: list })),
  }),
};
export type CoachOutput<M extends CoachMode> = z.infer<(typeof schemas)[M]>;
export interface CoachResult<M extends CoachMode = CoachMode> { mode: M; generatedAt: string; model: string; cost: number; period: { start: string; end: string }; output: CoachOutput<M>; evidenceCount: number }

const SYSTEM = `You are a senior SEO consultant advising a small-business owner through their own marketing dashboard.

Rules:
- Use ONLY the evidence package provided. Never invent numbers, pages, queries or competitors. Cite evidence ids exactly as written in "evidence_references" when a field asks for them.
- Plain language, no jargon without a short explanation. Short sentences. Be specific to THIS website; generic advice that would fit any site is a failure.
- Data is often small: a handful of clicks is noise; say so instead of drawing conclusions. Never guarantee rankings, traffic or revenue; effects are hypotheses.
- Third-party figures (DataForSEO) are estimates; say so when you rely on them. Local map rankings and reviews come from Business Profile.
- If the evidence doesn't support an answer, say what is missing and what to connect or run next instead of guessing.
- Prefer improving an existing page over creating a new one unless no existing page fits the search intent.`;

const TASK: Record<CoachMode, string> = {
  coach: `The reader is new to SEO. In "where_you_stand", explain in 3-4 plain sentences where this website is today (traffic, search visibility, what is working, what is missing), using the evidence. Then give exactly 5 "steps": the order a beginner should tackle SEO for THIS site, each with why it matters, 2-4 concrete "how" actions, and a realistic time estimate. Then 4-6 "terms" the reader will meet in this dashboard (e.g. impressions, position, backlinks), explained in one sentence using this site's own situation where possible.`,
  priorities: `Answer one question: "What 1-2 things will drive the most additional traffic?". Return exactly 1 or 2 "actions" (never more), the ones with the best mix of impact, confidence and low effort given the evidence. Each needs why it matters (with the numbers), concrete steps, a testable expected effect (a hypothesis, not a promise), the effort, and evidence ids. In "not_now" list 2-4 tempting things the reader should ignore for now and why (one short line each).`,
  topics: `Find topics worth writing about. Return 5-8 "topics": content the site should publish or improve, drawn from its own search data (queries it nearly ranks for, impressions without clicks, keyword gaps vs competitors, tracked keywords outside the top 10, questions AI assistants answer without naming the site). For each: a working title, the target keyword if the evidence has one, the search intent, why this topic (with numbers), whether to create a new page or improve an existing one (with its URL if the evidence names it), a 3-6 point outline, and evidence ids. Order by expected value.`,
  competitors: `Explain the competitors' strategy and where this site can win. Use the competitor snapshots, keyword gaps, head-to-head rankings, link gaps, rank-tracking top-10 leaders and AI-assistant sources in the evidence. For each of the 2-4 most relevant competitors: what they do well, where they beat this site, and where this site can realistically win. Then 3-5 "plays": concrete actions to take against them, with steps and evidence ids. If the evidence has no competitor data, say exactly what to run first (Competitors tab analysis, Rank Tracking).`,
};

const f = (n: number | null | undefined) => (n == null ? "unavailable" : String(n));

/** The standard evidence package plus rank tracking, site audit and AI visibility, which the dashboard stores separately. */
export async function coachEvidence(admin: SupabaseClient, clientId: string, range: { start: string; end: string }) {
  const data = await loadReportData(admin, clientId, range, false);
  const base = await buildEvidence(admin, clientId, data);
  const items: EvidenceItem[] = [...base.items];
  const add = (id: string, source: string, label: string, value: string, detail?: string) => items.push({ id, source, label, value, detail });
  const unavailable = [...base.unavailable];

  const ranks = await loadRanks(admin, clientId);
  if (ranks.ok && ranks.lastChecked) {
    for (const r of ranks.rows.slice(0, 25)) add(`rank.${r.id.slice(0, 8)}`, "Rank tracking", `Google position for "${r.keyword}" (${r.device})`, r.position === null ? "not in the top 30" : `#${r.position}`, `previous check ${r.previous === null ? "n/a or not in top 30" : `#${r.previous}`}; ranking page ${r.url ?? "none"}; top 3: ${r.top.slice(0, 3).map((t) => t.domain).join(", ")}`);
  } else unavailable.push("Rank tracking (no tracked keywords checked yet)");

  const { result } = await loadAudit(admin, clientId);
  const au = result?.data;
  if (au) {
    add("audit.score", "Site audit", "On-page score (0-100)", f(au.score), `crawled ${au.pages} pages on ${au.finishedAt.slice(0, 10)}`);
    for (const i of au.issues.slice(0, 8)) add(`audit.${i.key}`, "Site audit", `${i.label} (${i.severity})`, `${i.count} pages`, i.urls.slice(0, 3).join(", "));
  } else unavailable.push("Site audit (no crawl yet)");

  const ai = await loadAi(admin, clientId);
  if (ai.ok && ai.lastChecked) {
    add("ai.score", "AI visibility", "Share of tracked questions where the business is named or cited by Claude", `${f(ai.score)}%`);
    for (const r of ai.rows.filter((x) => x.latest).slice(0, 10)) add(`ai.${r.id.slice(0, 8)}`, "AI visibility", `Question "${r.prompt}"`, r.latest!.mentioned ? "named" : r.latest!.cited ? "cited" : r.latest!.seen ? "found by search but not used" : "not visible", `sources the answer cited: ${r.latest!.competitors.slice(0, 5).join(", ") || "none"}`);
  } else unavailable.push("AI visibility (no questions checked yet)");

  return { items, unavailable, text: evidenceText({ period: { start: range.start, end: range.end, comparison: "n/a" }, items, unavailable }) };
}

export async function generateCoach<M extends CoachMode>(admin: SupabaseClient, clientId: string, timezone: string, mode: M): Promise<{ ok: true; result: CoachResult<M> } | { ok: false; error: string }> {
  const end = shiftDays(todayIn(timezone), -3), range = { start: shiftDays(end, -27), end };
  let ev;
  try { ev = await coachEvidence(admin, clientId, range); } catch { return { ok: false, error: "Could not load this site's data. Apply the latest database migrations and try again." }; }
  if (ev.items.length < 5) return { ok: false, error: "Not enough connected data yet. Connect and sync Search Console or Google Analytics first." };
  try {
    const res = await anthropic().beta.messages.parse({
      model: COACH_MODEL, max_tokens: 8000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: SYSTEM, output_config: { effort: "medium", format: betaZodOutputFormat(schemas[mode]) },
      messages: [{ role: "user", content: `${ev.text}\n\nTASK:\n${TASK[mode]}` }],
    });
    if (res.stop_reason === "refusal") return { ok: false, error: "The AI declined this request." };
    if (res.stop_reason === "max_tokens") return { ok: false, error: "The answer was too long and got cut off. Try again." };
    const out = res.parsed_output as CoachOutput<CoachMode> | null;
    if (!out) return { ok: false, error: "The AI answer didn't match the expected structure. Try again." };
    const known = new Set(ev.items.map((i) => i.id));
    const keep = (refs: string[]) => refs.filter((r) => known.has(r));
    // answers that cite nothing the dashboard holds are dropped, so the reader never gets unsupported advice
    if (mode === "priorities") { const o = out as CoachOutput<"priorities">; o.actions = o.actions.map((a) => ({ ...a, evidence_references: keep(a.evidence_references) })).filter((a) => a.evidence_references.length).slice(0, 2); }
    if (mode === "topics") { const o = out as CoachOutput<"topics">; o.topics = o.topics.map((t) => ({ ...t, evidence_references: keep(t.evidence_references) })).filter((t) => t.evidence_references.length); }
    if (mode === "competitors") { const o = out as CoachOutput<"competitors">; o.competitors = o.competitors.map((c) => ({ ...c, evidence_references: keep(c.evidence_references) })); o.plays = o.plays.map((p) => ({ ...p, evidence_references: keep(p.evidence_references) })).filter((p) => p.evidence_references.length); }
    const u = res.usage;
    const cost = Number(((u.input_tokens * PRICE.input + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + u.output_tokens * PRICE.output) / 1_000_000).toFixed(4));
    const result = { mode, generatedAt: new Date().toISOString(), model: COACH_MODEL, cost, period: range, output: out, evidenceCount: ev.items.length } as CoachResult<M>;
    await admin.from("dfs_cache").upsert({ client_id: clientId, endpoint: `coach_${mode}`, params_hash: `coach_${mode}`, params: {}, data: result, row_count: 1, cost, fetched_at: result.generatedAt }, { onConflict: "client_id,endpoint,params_hash" });
    return { ok: true, result };
  } catch (e) { return { ok: false, error: aiErrorMessage(e) }; }
}

export async function loadCoach(supabase: SupabaseClient, clientId: string): Promise<Partial<Record<CoachMode, CoachResult>>> {
  const { data } = await supabase.from("dfs_cache").select("endpoint, data").eq("client_id", clientId).in("endpoint", COACH_MODES.map((m) => `coach_${m}`));
  return Object.fromEntries((data ?? []).map((r) => [(r.endpoint as string).replace("coach_", ""), r.data as CoachResult]));
}
