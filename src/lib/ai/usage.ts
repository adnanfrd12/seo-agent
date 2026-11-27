import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIn } from "@/lib/analytics/range";
import { readSettings } from "@/lib/aiqw/settings";
import { claudeMonthSpend } from "@/lib/aiqw/store";
import { pagedRows } from "@/lib/db/paged";

/**
 * Claude spend for one client, from every place the dashboard records it: Nova messages, roadmap generations,
 * AI quick wins runs, AI insights / 30-day strategy / PDF import runs, SEO Coach analyses, and the usage log
 * (ai_usage_events) for blog post reading and the SEO Toolkit. Each record keeps its own
 * time and cost, so totals by day, month, feature and model are exact for these features.
 */
export interface UsageEvent { at: string; feature: string; model: string | null; cost: number }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dayIn = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export type UsageFeature = "blog_geo" | "toolkit_content" | "toolkit_brief" | "toolkit_comparison" | "gsc_indexing" | "site_audit_ai" | "alt_text" | "security_ai" | "fanout" | "gbp_ai";
/** Names of the ai_usage_events features (also used by the organization spend tab, lib/org/spend.ts). */
export const FEATURE_LABEL: Record<string, string> = {
  blog_geo: "Blog post reading", toolkit_content: "SEO Toolkit", toolkit_brief: "SEO Toolkit", toolkit_comparison: "SEO Toolkit",
  gsc_indexing: "Indexing diagnosis", site_audit_ai: "Site audit fixes", alt_text: "Image alt text", security_ai: "Security audit", fanout: "Fan-out queries", gbp_ai: "Business Profile insights",
};

/** The client's monthly Claude budget (AI settings) and what is left of it this month (UTC). */
export async function claudeBudget(admin: SupabaseClient, clientId: string) {
  const [{ data }, spent] = await Promise.all([admin.from("clients").select("settings").eq("id", clientId).maybeSingle(), claudeMonthSpend(admin, clientId)]);
  const budget = readSettings(((data?.settings ?? {}) as Record<string, unknown>).ai_qw).monthlyBudget;
  return { budget, spent, left: Math.max(0, budget - spent) };
}

export const budgetMessage = (budget: number) => `The monthly Claude budget ($${budget}) is used up. An owner can raise it in AI Quick Wins → Settings.`;

/** Logs one run's Claude cost (features without a run table of their own). Never throws: a failed log must not fail the run. */
export async function recordClaudeUse(admin: SupabaseClient, clientId: string, feature: UsageFeature, model: string, cost: number, calls = 1) {
  if (!(cost > 0)) return;
  try {
    const { error } = await admin.from("ai_usage_events").insert({ client_id: clientId, feature, model, calls, cost_usd: Number(cost.toFixed(5)) });
    if (error) console.error(`ai_usage_events: ${error.message}`);
  } catch (e) { console.error("ai_usage_events", e); }
}

export async function claudeUsage(admin: SupabaseClient, clientId: string, timezone: string) {
  const [nova, roadmap, aiqw, runs, coach, logged] = await Promise.all([
    // paged: the database API returns at most 1,000 rows per request whatever .limit() asks for
    pagedRows<{ created_at: string; cost_usd: unknown }>((from, to) => admin.from("nova_messages").select("created_at, cost_usd").eq("client_id", clientId).eq("role", "assistant").gt("cost_usd", 0).order("id").range(from, to)),
    admin.from("roadmap_changes").select("created_at, after").eq("client_id", clientId).eq("action", "month.generate").limit(1000),
    admin.from("dfs_cache").select("data, cost, fetched_at").eq("client_id", clientId).eq("endpoint", "aiqw").like("params_hash", "run:%").limit(1000),
    pagedRows<{ created_at: string; kind: string; model: string | null; cost_usd: unknown }>((from, to) => admin.from("ai_analysis_runs").select("created_at, kind, model, cost_usd").eq("client_id", clientId).not("cost_usd", "is", null).order("id").range(from, to)),
    admin.from("dfs_cache").select("endpoint, data, cost, fetched_at").eq("client_id", clientId).like("endpoint", "coach_%").limit(20),
    // before migration 20261125000026 is applied this returns an error and simply adds nothing
    pagedRows<{ created_at: string; feature: string; model: string | null; calls: number; cost_usd: unknown }>((from, to) => admin.from("ai_usage_events").select("created_at, feature, model, calls, cost_usd").eq("client_id", clientId).order("id").range(from, to)),
  ]);
  const events: UsageEvent[] = [
    ...(nova.data ?? []).map((r) => ({ at: r.created_at, feature: "Nova chat", model: null, cost: num(r.cost_usd) })),
    ...(roadmap.data ?? []).map((r) => { const a = (r.after ?? {}) as { cost_usd?: unknown; model?: string }; return { at: r.created_at, feature: "SEO Roadmap", model: a.model ?? null, cost: num(a.cost_usd) }; }),
    ...(aiqw.data ?? []).map((r) => { const d = (r.data ?? {}) as { startedAt?: string; usage?: { cost?: number; model?: string } }; return { at: d.startedAt ?? r.fetched_at, feature: "AI Quick Wins", model: d.usage?.model ?? null, cost: num(d.usage?.cost ?? r.cost) }; }),
    ...(runs.data ?? []).map((r) => ({ at: r.created_at, feature: r.kind === "strategy" ? "30-Day Strategy" : r.kind === "insights" ? "AI SEO Insights" : "PDF report reading", model: r.model ?? null, cost: num(r.cost_usd) })),
    ...(coach.data ?? []).map((r) => { const d = (r.data ?? {}) as { generatedAt?: string; model?: string; cost?: number }; return { at: d.generatedAt ?? r.fetched_at, feature: "SEO Coach", model: d.model ?? null, cost: num(d.cost ?? r.cost) }; }),
    ...(logged.data ?? []).map((r) => ({ at: r.created_at as string, feature: FEATURE_LABEL[r.feature as string] ?? String(r.feature), model: (r.model as string) ?? null, cost: num(r.cost_usd) })),
  ].filter((e) => e.cost > 0 && e.at);

  const today = todayIn(timezone), month = today.slice(0, 7);
  const sum = (xs: UsageEvent[]) => xs.reduce((a, e) => a + e.cost, 0);
  const withDay = events.map((e) => ({ ...e, day: dayIn(e.at, timezone) }));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (6 - i)); return d.toISOString().slice(0, 10); });
  const group = (key: (e: UsageEvent) => string) => [...withDay.reduce((m, e) => m.set(key(e), (m.get(key(e)) ?? 0) + e.cost), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  return {
    total: sum(events),
    month: sum(withDay.filter((e) => e.day.startsWith(month))),
    today: sum(withDay.filter((e) => e.day === today)),
    calls: events.length,
    since: events.map((e) => e.at).sort()[0] ?? null,
    perDay: days.map((d) => ({ day: d, cost: sum(withDay.filter((e) => e.day === d)) })),
    byFeature: group((e) => e.feature),
    byModel: group((e) => e.model ?? "Model from AI settings"),
  };
}
