"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { marketByCode } from "@/lib/dataforseo/locations";
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
const refresh = () => ["/backlinks", "/organic-keywords", "/keyword-research", "/integrations", "/overview"].forEach((p) => revalidatePath(p));

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

/** Estimated cost labels for the buttons (kept in one place with the real specs). */
export async function researchEstimates() {
  return { core: estimate(TIER1.filter((k) => k !== "history")), deep: estimate(TIER2) };
}
