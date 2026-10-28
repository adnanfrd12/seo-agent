"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { BudgetError, DEFAULT_DAILY_BUDGET } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { marketByCode } from "@/lib/dataforseo/locations";
import { runCompetitorAnalysis } from "@/lib/dataforseo/competitors";
import {
  ensure, estimate, hostOf, keywordResearch, refreshCore, refreshDeep, resolveTarget, SPECS, TIER1, TIER2, type KwKind, type RunReport,
} from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string; cost: number } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({
  ok: false,
  error: e instanceof BudgetError || e instanceof DfsError ? e.message : "Something went wrong. Nothing was charged twice; try again.",
});
const usd = (n: number) => `$${n.toFixed(2)}`;

async function admin() {
  const { client } = await getSession();
  if (!client) throw new Error("No client");
  if (!["owner", "admin"].includes(client.role)) return { allowed: false as const };
  if (!dfsConfigured()) return { allowed: false as const, notConfigured: true };
  return { allowed: true as const, client, db: createAdminClient() };
}
const denied = (a: { notConfigured?: boolean }): Result => ({
  ok: false, error: a.notConfigured ? "DataForSEO isn't configured on the server." : "Only owners and admins can run paid lookups.",
});
const refresh = () => ["/backlinks", "/organic-keywords", "/keyword-research", "/competitors", "/integrations", "/overview"].forEach((p) => revalidatePath(p));

function summarize(rep: RunReport, what: string): Result {
  if (rep.fetched.length === 0 && rep.errors.length) return { ok: false, error: rep.errors[0] };
  const parts = [
    rep.fetched.length ? `${what} updated (${rep.fetched.length} lookups, ${usd(rep.cost)})` : `${what} was already up to date`,
    rep.cached.length ? `${rep.cached.length} reused from storage` : "",
    rep.errors.length ? `Issues: ${rep.errors.join("; ")}` : "",
  ].filter(Boolean);
  return { ok: true, message: `${parts.join(". ")}.`, cost: rep.cost };
}

const domainSchema = z.string().trim().toLowerCase().transform((s) => hostOf(s) ?? "")
  .pipe(z.string().regex(/^(?!-)([a-z0-9-]+\.)+[a-z]{2,}$/, "Enter a domain like example.com"));

export async function saveResearchTarget(input: { domain: string; location: number; autoRefresh: boolean; competitors: string }): Promise<Result> {
  const a = await admin();
  if (!a.allowed) return denied(a);
  const domain = domainSchema.safeParse(input.domain);
  if (!domain.success) return { ok: false, error: domain.error.issues[0]?.message ?? "Invalid domain" };
  const market = marketByCode(input.location);
  if (!market) return { ok: false, error: "Choose a country from the list." };
  const competitors = [...new Set(input.competitors.split(/[\s,;]+/).map((c) => hostOf(c)).filter((c): c is string => Boolean(c) && c !== domain.data))].slice(0, 8);
  const { data: old } = await a.db.from("research_targets").select("domain, location_code").eq("client_id", a.client.id).maybeSingle();
  const { error } = await a.db.from("research_targets").upsert({
    client_id: a.client.id, domain: domain.data, location_code: market.code, language_code: market.lang, auto_refresh: Boolean(input.autoRefresh), competitors,
  }, { onConflict: "client_id" });
  if (error) return { ok: false, error: "Could not save (has migration 20261028000016 been applied?)." };
  // a different domain or market makes stored answers meaningless: drop them so nothing stale is shown
  if (old && (old.domain !== domain.data || old.location_code !== market.code)) {
    await a.db.from("dfs_cache").delete().eq("client_id", a.client.id);
    await a.db.from("dfs_snapshots").delete().eq("client_id", a.client.id);
  }
  refresh();
  return { ok: true, message: "Saved.", cost: 0 };
}

/** The cheap core set (summary, new/lost, rank overview, ranked keywords, history). Reuses anything still fresh. */
export async function runCoreRefresh(force = false): Promise<Result> {
  const a = await admin();
  if (!a.allowed) return denied(a);
  try {
    const target = await resolveTarget(a.db, a.client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const rep = await refreshCore({ admin: a.db, clientId: a.client.id, source: "manual" }, target, force);
    refresh();
    return summarize(rep, "Overview data");
  } catch (e) { return fail(e); }
}

/** Backlink lists, referring domains, anchors, pages and competitors. Stored for 14 days. */
export async function runDeepDive(force = false): Promise<Result> {
  const a = await admin();
  if (!a.allowed) return denied(a);
  try {
    const target = await resolveTarget(a.db, a.client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const rep = await refreshDeep({ admin: a.db, clientId: a.client.id, source: "manual" }, target, force);
    refresh();
    return summarize(rep, "Deep dive");
  } catch (e) { return fail(e); }
}

export async function runLinkGap(competitor: string, force = false): Promise<Result> {
  const a = await admin();
  if (!a.allowed) return denied(a);
  const c = domainSchema.safeParse(competitor);
  if (!c.success) return { ok: false, error: c.error.issues[0]?.message ?? "Invalid domain" };
  try {
    const target = await resolveTarget(a.db, a.client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    if (c.data === target.domain) return { ok: false, error: "Pick a competitor, not the client's own site." };
    const r = await ensure({ admin: a.db, clientId: a.client.id, source: "manual" }, SPECS.link_gap, target, { force, extra: c.data });
    refresh();
    return { ok: true, message: r.fromCache ? "Already stored; showing the saved result." : `Link gap found (${usd(r.cost)}).`, cost: r.cost };
  } catch (e) { return fail(e); }
}

export type KeywordRows = { rows: Record<string, unknown>[]; total: number; fetchedAt: string; fromCache: boolean; cost: number };
const seedSchema = z.string().trim().min(2, "Enter at least 2 characters").max(80).regex(/^[^<>{}\\]+$/, "Remove special characters");

export async function researchKeywords(kind: KwKind, seed: string, location: number, force = false)
  : Promise<{ ok: true; data: KeywordRows } | { ok: false; error: string }> {
  const a = await admin();
  if (!a.allowed) { const d = denied(a); return { ok: false, error: d.ok ? "Not allowed" : d.error }; }
  const s = seedSchema.safeParse(seed);
  if (!s.success) return { ok: false, error: s.error.issues[0]?.message ?? "Invalid keyword" };
  if (!["ideas", "suggestions", "related"].includes(kind)) return { ok: false, error: "Unknown lookup." };
  const market = marketByCode(location);
  if (!market) return { ok: false, error: "Choose a country from the list." };
  try {
    const data = await keywordResearch({ admin: a.db, clientId: a.client.id, source: "manual" }, kind, s.data, market.code, market.lang, force);
    revalidatePath("/integrations");
    return { ok: true, data };
  } catch (e) { return { ok: false, error: fail(e).error }; }
}

/** Re-runs the competitor analysis now (normally it runs automatically every 24 hours). Fresh answers are reused. */
export async function runCompetitorsNow(force = false): Promise<Result> {
  const a = await admin();
  if (!a.allowed) return denied(a);
  try {
    const target = await resolveTarget(a.db, a.client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const rep = await runCompetitorAnalysis({ admin: a.db, clientId: a.client.id, source: "manual" }, target, { force });
    refresh();
    if (rep.fetched === 0 && rep.errors.length) return { ok: false, error: rep.errors[0] };
    return {
      ok: true, cost: rep.cost,
      message: `${rep.fetched ? `Analysis updated (${rep.fetched} lookups, ${usd(rep.cost)})` : "Analysis was already up to date"}${rep.cached ? `; ${rep.cached} reused from storage` : ""}${rep.errors.length ? `. Issues: ${rep.errors.join("; ")}` : ""}.`,
    };
  } catch (e) { return fail(e); }
}

/** Competitor management: auto-pick or manual list, plus competitors to hide from the automatic picks. */
export async function saveCompetitors(input: { mode: "auto" | "manual"; competitors: string; excluded: string[] }): Promise<Result> {
  const a = await admin();
  if (!a.allowed) return denied(a);
  if (!["auto", "manual"].includes(input.mode)) return { ok: false, error: "Unknown mode." };
  const clean = (list: string[], self: string) => [...new Set(list.map((c) => hostOf(c)).filter((c): c is string => Boolean(c) && c !== self))];
  const target = await resolveTarget(a.db, a.client.id);
  if (!target) return { ok: false, error: "Set the client's website first." };
  const competitors = clean(input.competitors.split(/[\s,;]+/), target.domain).slice(0, 8);
  const excluded = clean(input.excluded, target.domain).slice(0, 50);
  const { error } = await a.db.from("research_targets").update({ competitor_mode: input.mode, competitors, competitors_excluded: excluded }).eq("client_id", a.client.id);
  if (error) return { ok: false, error: "Could not save (has migration 20261028000018 been applied?)." };
  refresh();
  return { ok: true, message: "Competitors saved. They'll be included in the next analysis (or run it now).", cost: 0 };
}

/** Marks the client's alerts as read. Membership is checked through the signed-in session first. */
export async function markAlertsSeen(): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client." };
  const { error } = await createAdminClient().from("client_alerts").update({ seen_at: new Date().toISOString() }).eq("client_id", client.id).is("seen_at", null);
  if (error) return { ok: false, error: "Could not update alerts." };
  revalidatePath("/overview");
  return { ok: true, message: "Marked as read.", cost: 0 };
}

/** Agency-wide spending settings: the daily limit and the automatic weekly refresh switch. */
export async function saveDfsSettings(input: { dailyBudget: number; autoRefresh: boolean }): Promise<Result> {
  const { client } = await getSession();
  if (!client || !["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can change the spending limit." };
  const parsed = z.object({ dailyBudget: z.number().min(0.1, "The limit must be at least $0.10").max(100, "The limit can't be more than $100"), autoRefresh: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings" };
  const { error } = await createAdminClient().from("dfs_settings").upsert(
    { id: 1, daily_budget: Math.round(parsed.data.dailyBudget * 100) / 100, auto_refresh: parsed.data.autoRefresh, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return { ok: false, error: "Could not save (has migration 20261028000017 been applied?)." };
  refresh();
  return { ok: true, message: `Saved: daily limit $${parsed.data.dailyBudget.toFixed(2)}${parsed.data.dailyBudget === DEFAULT_DAILY_BUDGET ? " (default)" : ""}.`, cost: 0 };
}

/** Estimated cost labels for the buttons (kept in one place with the real specs). */
export async function researchEstimates() {
  return { core: estimate(TIER1.filter((k) => k !== "history")), deep: estimate(TIER2) };
}
