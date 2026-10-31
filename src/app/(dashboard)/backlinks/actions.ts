"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { ensure, resolveTarget, SPECS } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Backlinks that point at pages which no longer exist (one call, about 3 cents; stored for a week). */
export async function checkBrokenBacklinks(force: boolean): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can run paid lookups." };
  if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured on the server." };
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const r = await ensure({ admin: db, clientId: client.id, source: "manual" }, SPECS.broken_backlinks, target, { force });
    revalidatePath("/backlinks");
    const total = (r.data as { total?: number } | null)?.total ?? 0;
    return { ok: true, message: r.fromCache ? `Already checked ${r.fetchedAt.slice(0, 10)} (${total} found); it refreshes weekly.` : `Found ${total} link${total === 1 ? "" : "s"} pointing at missing pages ($${r.cost.toFixed(3)}).` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError ? e.message : "Couldn't check. Nothing was charged; try again." };
  }
}
