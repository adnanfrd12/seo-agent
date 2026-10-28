"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/analytics/client-context";
import { auditEstimate, pollAudit, startAudit, type AuditState } from "@/lib/dataforseo/audit";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** Starts a crawl of the client's website. Owners and admins only, because it spends API credit. */
export async function runSiteAudit(maxPages: number): Promise<Result> {
  const { client } = await getSession();
  if (!client) return { ok: false, error: "No client selected." };
  if (!["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can start an audit." };
  if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured on the server." };
  if (!Number.isFinite(maxPages)) return { ok: false, error: "Choose how many pages to crawl." };
  try {
    const db = createAdminClient();
    const target = await resolveTarget(db, client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const { cost } = await startAudit({ admin: db, clientId: client.id, source: "manual" }, target, maxPages);
    revalidatePath("/site-audit");
    return { ok: true, message: `Audit started for ${target.domain} ($${(cost || auditEstimate(maxPages)).toFixed(3)}). Results appear here in a few minutes.` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError ? e.message : "Couldn't start the audit. Nothing was charged; try again." };
  }
}

/** Free progress check used by the page while a crawl is running; any member may call it. */
export async function checkSiteAudit(): Promise<AuditState> {
  const { client } = await getSession();
  if (!client || !dfsConfigured()) return { state: "none" };
  try {
    const state = await pollAudit(createAdminClient(), client.id);
    if (state.state === "done") revalidatePath("/site-audit");
    return state;
  } catch { return { state: "none" }; }
}
