import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayIn } from "@/lib/analytics/range";

/**
 * Claude spend for one client, from every place the dashboard records it: Nova messages, roadmap generations,
 * AI quick wins runs, AI insights / 30-day strategy runs and SEO Coach analyses. Each record keeps its own
 * time and cost, so totals by day, month, feature and model are exact for these features.
 */
export interface UsageEvent { at: string; feature: string; model: string | null; cost: number }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dayIn = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export async function claudeUsage(admin: SupabaseClient, clientId: string, timezone: string) {
  const [nova, roadmap, aiqw, runs, coach] = await Promise.all([
    admin.from("nova_messages").select("created_at, cost_usd").eq("client_id", clientId).eq("role", "assistant").gt("cost_usd", 0).limit(5000),
    admin.from("roadmap_changes").select("created_at, after").eq("client_id", clientId).eq("action", "month.generate").limit(1000),
    admin.from("dfs_cache").select("data, cost, fetched_at").eq("client_id", clientId).eq("endpoint", "aiqw").like("params_hash", "run:%").limit(1000),
    admin.from("ai_analysis_runs").select("created_at, kind, model, cost_usd").eq("client_id", clientId).not("cost_usd", "is", null).limit(2000),
    admin.from("dfs_cache").select("endpoint, data, cost, fetched_at").eq("client_id", clientId).like("endpoint", "coach_%").limit(20),
  ]);
  const events: UsageEvent[] = [
    ...(nova.data ?? []).map((r) => ({ at: r.created_at, feature: "Nova chat", model: null, cost: num(r.cost_usd) })),
    ...(roadmap.data ?? []).map((r) => { const a = (r.after ?? {}) as { cost_usd?: unknown; model?: string }; return { at: r.created_at, feature: "SEO Roadmap", model: a.model ?? null, cost: num(a.cost_usd) }; }),
    ...(aiqw.data ?? []).map((r) => { const d = (r.data ?? {}) as { startedAt?: string; usage?: { cost?: number; model?: string } }; return { at: d.startedAt ?? r.fetched_at, feature: "AI Quick Wins", model: d.usage?.model ?? null, cost: num(d.usage?.cost ?? r.cost) }; }),
    ...(runs.data ?? []).map((r) => ({ at: r.created_at, feature: r.kind === "strategy" ? "30-Day Strategy" : r.kind === "insights" ? "AI SEO Insights" : "PDF import", model: r.model ?? null, cost: num(r.cost_usd) })),
    ...(coach.data ?? []).map((r) => { const d = (r.data ?? {}) as { generatedAt?: string; model?: string; cost?: number }; return { at: d.generatedAt ?? r.fetched_at, feature: "SEO Coach", model: d.model ?? null, cost: num(d.cost ?? r.cost) }; }),
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
