"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { fetchProfile, gridRivals, localIdentity, pollReviews, runGrid, startReviews, type Grid, type Profile } from "@/lib/dataforseo/local";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };
const PATH = "/local-seo";

async function guard() {
  const { client } = await getSession();
  if (!client) return { error: "No client selected." } as const;
  if (!["owner", "admin"].includes(client.role)) return { error: "Only owners and admins can run paid checks." } as const;
  if (!dfsConfigured()) return { error: "DataForSEO isn't configured on the server." } as const;
  return { client, db: createAdminClient() } as const;
}
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof BudgetError || e instanceof DfsError ? e.message : e instanceof Error ? e.message : "Something went wrong; try again." });

/** Business profile (about half a cent) plus a fresh collection of the newest 100 reviews (under a cent). */
export async function refreshLocal(): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  try {
    const me = await localIdentity(g.db, g.client.id);
    if (!me) return { ok: false, error: "Connect Google Business Profile for this client first (Integrations)." };
    const ctx = { admin: g.db, clientId: g.client.id, source: "manual" as const };
    const p = await fetchProfile(ctx, me);
    await startReviews(ctx, { ...me, cid: me.cid ?? p?.cid ?? null });
    revalidatePath(PATH);
    return { ok: true, message: `Profile updated${p?.votes != null ? ` (${p.votes} reviews on Google)` : ""}. Reviews are being collected and appear here within a few minutes.` };
  } catch (e) { return fail(e); }
}

/** Free: collects finished review tasks. Any member may call it (the page polls while a task is running). */
export async function checkReviews(): Promise<{ pending: number; done: number }> {
  const { client } = await getSession();
  if (!client || !dfsConfigured()) return { pending: 0, done: 0 };
  try {
    const r = await pollReviews(createAdminClient(), client.id);
    if (r.done) revalidatePath(PATH);
    return r;
  } catch { return { pending: 0, done: 0 }; }
}

/** Google Maps rank grid for one keyword: 9 searches (3x3) or 25 (5x5) around the business. */
export async function runMapsGrid(keyword: string, size: 3 | 5, spacingKm: number): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const kw = keyword.trim().toLowerCase().replace(/\s+/g, " ");
  if (kw.length < 2 || kw.length > 80) return { ok: false, error: "Enter a keyword (2-80 characters)." };
  if (![3, 5].includes(size) || !(spacingKm >= 0.25 && spacingKm <= 10)) return { ok: false, error: "Choose a grid size and spacing." };
  try {
    const me = await localIdentity(g.db, g.client.id);
    if (!me) return { ok: false, error: "Connect Google Business Profile for this client first (Integrations)." };
    const grid = await runGrid({ admin: g.db, clientId: g.client.id, source: "manual" }, me, kw, size, spacingKm);
    revalidatePath(PATH);
    return { ok: true, message: `Found at ${grid.summary.found} of ${grid.summary.searched} points${grid.summary.average != null ? `, average position ${grid.summary.average}` : ""} ($${grid.cost.toFixed(3)}).` };
  } catch (e) { return fail(e); }
}

/** Profiles and the newest 50 reviews of up to 3 competing businesses (about 1.2 cents each). */
export async function compareRivals(input: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const names = [...new Set(input.split(/[\n;]+/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 120))].slice(0, 3);
  if (!names.length) return { ok: false, error: "Enter at least one business name (one per line)." };
  try {
    const ctx = { admin: g.db, clientId: g.client.id, source: "manual" as const };
    const { data: self } = await g.db.from("dfs_cache").select("data").eq("client_id", g.client.id).eq("endpoint", "gbp_profile").eq("params_hash", "self").maybeSingle();
    const also = ((self?.data as Profile | null)?.alsoSearch ?? []);
    const me = await localIdentity(g.db, g.client.id);
    const done: string[] = [];
    const { data: gridRows } = await g.db.from("dfs_cache").select("data").eq("client_id", g.client.id).eq("endpoint", "maps_grid").order("fetched_at", { ascending: false }).limit(20);
    const fromGrid = gridRivals((gridRows ?? []).map((r) => r.data as Grid), me?.name ?? "");
    for (const name of names) {
      // a "people also search" or map-grid pick carries its Google id; a typed name is looked up near the business
      const cid = also.find((a) => a.title.toLowerCase() === name.toLowerCase())?.cid ?? fromGrid.find((r) => r.name.toLowerCase() === name.toLowerCase())?.cid ?? null;
      const key = cid ? `cid:${cid}` : `name:${name.toLowerCase()}`;
      const p = await fetchProfile(ctx, { name, cid, placeId: null }, key, me ?? undefined);
      if (!p) { done.push(`${name}: not found`); continue; }
      await startReviews(ctx, { name: p.title ?? name, cid: p.cid, placeId: p.placeId }, key, 50);
      done.push(p.title ?? name);
    }
    revalidatePath(PATH);
    return { ok: true, message: `Fetched ${done.join(", ")}. Their reviews arrive within a few minutes.` };
  } catch (e) { return fail(e); }
}
