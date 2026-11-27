"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DFS_NOT_CONFIGURED, DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { pollReviews } from "@/lib/dataforseo/local";
import { platformOf, pollPlatforms, refreshAll, refreshListings, saveProfiles, type PlatformKey } from "@/lib/reviews/platforms";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };
const PATH = "/reviews";

async function owner() {
  const { client } = await getSession();
  if (!client) return { error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { error: "Only owners and admins can do this." };
  return { client };
}

/** Saves the client's listing links per platform (clients.settings.review_profiles). */
export async function saveReviewProfiles(input: Record<string, string>): Promise<Result> {
  const a = await owner();
  if (!a.client) return { ok: false, error: a.error };
  try {
    const saved = await saveProfiles(createAdminClient(), a.client.id, input);
    revalidatePath(PATH);
    return { ok: true, message: `Saved ${Object.keys(saved).length} listing link${Object.keys(saved).length === 1 ? "" : "s"}.` };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not save." }; }
}

/** Starts a fresh collection on every platform that can be read (always, even when fresh). */
export async function refreshPlatformReviews(): Promise<Result> {
  const a = await owner();
  if (!a.client) return { ok: false, error: a.error };
  if (!(await dfsConfigured(a.client.id))) return { ok: false, error: DFS_NOT_CONFIGURED };
  try {
    const r = await refreshAll({ admin: createAdminClient(), clientId: a.client.id, source: "manual" });
    revalidatePath(PATH);
    if (!r.started.length && r.errors.length) return { ok: false, error: r.errors.join(" · ") };
    const names = (l: string[]) => l.map((k) => platformOf(k as PlatformKey)?.label ?? k).join(", ");
    return { ok: true, message: `${r.found.length ? `Found listings on ${names(r.found)}. ` : ""}${r.started.length ? `Updated / collecting ${names(r.started)}; DataForSEO reviews appear within a few minutes.` : "Nothing to start (a collection is already running)."}${r.errors.length ? ` Issues: ${r.errors.join(" · ")}` : ""}` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError || e instanceof Error ? e.message : "Something went wrong." };
  }
}

/**
 * Searches the sites without a reviews API (YellowPages, Nextdoor, Yelp, BBB, Angi, Houzz, Thumbtack) for the
 * business by its name, address and phone, then reads the listings it finds (≈$0.04 + ≈$0.006 a page).
 */
export async function findReviewListings(): Promise<Result> {
  const a = await owner();
  if (!a.client) return { ok: false, error: a.error };
  if (!(await dfsConfigured(a.client.id))) return { ok: false, error: DFS_NOT_CONFIGURED };
  try {
    const r = await refreshListings({ admin: createAdminClient(), clientId: a.client.id, source: "manual" }, { maxAgeMs: 0, discover: "force" });
    revalidatePath(PATH);
    if (r.napMissing || !r.discovery) return { ok: false, error: "The business's name, address and phone aren't known: connect its Google Business Profile first." };
    const label = (k: string) => platformOf(k as PlatformKey)?.label ?? k;
    const missing = r.discovery.checked.filter((k) => !r.discovery!.links[k]).map(label);
    return {
      ok: true,
      message: `${r.found.length ? `Found ${r.found.map(label).join(", ")}` : "No listings found"}${missing.length ? `; not found on ${missing.join(", ")}` : ""}.`
        + `${r.read.length ? ` Read ${r.read.map(label).join(", ")}.` : ""}${r.errors.length ? ` Notes: ${r.errors.slice(0, 4).join(" · ")}` : ""}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError || e instanceof Error ? e.message : "Something went wrong." };
  }
}

/** Free: collects finished review tasks (Google and the other platforms). */
export async function checkPlatformReviews(): Promise<{ pending: number; done: number }> {
  const { client } = await getSession();
  if (!client || !(await dfsConfigured(client.id))) return { pending: 0, done: 0 };
  try {
    const db = createAdminClient();
    const [g, p] = await Promise.all([pollReviews(db, client.id), pollPlatforms(db, client.id)]);
    if (g.done + p.done) revalidatePath(PATH);
    return { pending: g.pending + p.pending, done: g.done + p.done };
  } catch { return { pending: 0, done: 0 }; }
}
