"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { pollPosts, postTargets, startPosts } from "@/lib/dataforseo/gbp-posts";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };
const PATH = "/local-seo";

/** Starts a collection of the newest Business Profile posts for the client and up to 3 competitors (≈0.3¢ each). */
export async function refreshPosts(): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run paid checks." };
  if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured on the server." };
  const db = createAdminClient();
  try {
    const targets = await postTargets(db, client.id);
    if (!targets.length) return { ok: false, error: "Connect Google Business Profile for this client first (Integrations)." };
    const ctx = { admin: db, clientId: client.id, source: "manual" as const };
    for (const t of targets) await startPosts(ctx, t.who, t.key, t.own);
    revalidatePath(PATH);
    return { ok: true, message: `Collecting posts for ${targets.length} business${targets.length > 1 ? "es" : ""}. They appear here within a few minutes.` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError || e instanceof Error ? e.message : "Something went wrong; try again." };
  }
}

/** Free: collects finished posts tasks (the page calls it while a collection is running). */
export async function checkPosts(): Promise<{ pending: number; done: number }> {
  const { client } = await getSession();
  if (!client || !dfsConfigured()) return { pending: 0, done: 0 };
  try {
    const r = await pollPosts(createAdminClient(), client.id);
    if (r.done) revalidatePath(PATH);
    return r;
  } catch { return { pending: 0, done: 0 }; }
}
