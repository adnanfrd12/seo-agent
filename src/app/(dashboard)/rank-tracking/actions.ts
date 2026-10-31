"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { BudgetError } from "@/lib/dataforseo/budget";
import { DfsError, dfsConfigured } from "@/lib/dataforseo/client";
import { MAX_RANK_KEYWORDS, RANK_SCHEDULES, rankEstimate, rankSettingsOf, runRankChecks, type RankSchedule } from "@/lib/dataforseo/rank";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function guard() {
  const { client } = await getSession();
  if (!client) return { error: "No client selected." } as const;
  if (!["owner", "admin"].includes(client.role)) return { error: "Only owners and admins can change tracked keywords." } as const;
  return { client, db: createAdminClient() } as const;
}

/** Adds keywords (one per line or comma separated) to track. They are checked at the next run or with "Check now". */
export async function addRankKeywords(input: string, device: "desktop" | "mobile" | "both"): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const list = [...new Set(input.split(/[\n,;]+/).map((k) => k.trim().toLowerCase().replace(/\s+/g, " ")).filter((k) => k.length >= 2 && k.length <= 120))];
  if (!list.length) return { ok: false, error: "Enter at least one keyword." };
  const { count, error: cErr } = await g.db.from("rank_keywords").select("id", { count: "exact", head: true }).eq("client_id", g.client.id);
  if (cErr) return { ok: false, error: "Rank tracking isn't set up yet: apply the latest database migration (20261030000020)." };
  const room = MAX_RANK_KEYWORDS - (count ?? 0);
  if (room <= 0) return { ok: false, error: `You can track up to ${MAX_RANK_KEYWORDS} keywords. Remove some first.` };
  const target = await resolveTarget(g.db, g.client.id);
  const devices = device === "both" ? (["desktop", "mobile"] as const) : [device];
  const rows = list.slice(0, Math.max(1, Math.floor(room / devices.length))).flatMap((keyword) => devices.map((d) => ({ client_id: g.client.id, keyword, device: d, location_code: target?.location_code ?? 2840, language_code: target?.language_code ?? "en" })));
  const { error } = await g.db.from("rank_keywords").upsert(rows, { onConflict: "client_id,keyword,device,location_code", ignoreDuplicates: true });
  if (error) return { ok: false, error: "Could not save the keywords." };
  revalidatePath("/rank-tracking");
  return { ok: true, message: `Added ${rows.length} keyword${rows.length > 1 ? "s" : ""}${list.length > room ? ` (limit of ${MAX_RANK_KEYWORDS} reached)` : ""}. Use "Check now" to get their first positions (about $${rankEstimate(rows.length).toFixed(3)}).` };
}

export async function removeRankKeyword(id: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const { error } = await g.db.from("rank_keywords").delete().eq("id", id).eq("client_id", g.client.id);
  if (error) return { ok: false, error: "Could not remove the keyword." };
  revalidatePath("/rank-tracking");
  return { ok: true, message: "Removed." };
}

/** Looks up today's Google positions. Only keywords without a recent check are looked up, unless `force`. */
export async function checkRanksNow(force: boolean): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  if (!dfsConfigured()) return { ok: false, error: "DataForSEO isn't configured on the server." };
  try {
    const target = await resolveTarget(g.db, g.client.id);
    if (!target) return { ok: false, error: "Set the client's website first." };
    const r = await runRankChecks({ admin: g.db, clientId: g.client.id, source: "manual" }, target, { force, deadline: Date.now() + 50_000 });
    revalidatePath("/rank-tracking");
    if (r.checked === 0 && r.errors.length) return { ok: false, error: r.errors[0] };
    const bits = [r.checked ? `Checked ${r.checked} keyword${r.checked > 1 ? "s" : ""} ($${r.cost.toFixed(3)})` : "Nothing needed checking", r.skipped ? `${r.skipped} already checked recently` : "", r.stopped === "budget" ? "stopped at the daily spend limit" : r.stopped === "time" ? "ran out of time; press again to continue" : ""].filter(Boolean);
    return { ok: true, message: `${bits.join(". ")}.` };
  } catch (e) {
    return { ok: false, error: e instanceof BudgetError || e instanceof DfsError ? e.message : "Couldn't check rankings. Try again." };
  }
}

/** Merges keys into clients.settings (other settings are kept). */
async function patchSettings(db: ReturnType<typeof createAdminClient>, clientId: string, patch: (cur: Record<string, unknown>) => Record<string, unknown>) {
  const { data } = await db.from("clients").select("settings").eq("id", clientId).maybeSingle();
  const cur = (data?.settings as Record<string, unknown>) ?? {};
  return db.from("clients").update({ settings: { ...cur, ...patch(cur) } }).eq("id", clientId);
}

/** How often the automatic job re-checks this client's keywords: daily, weekly or monthly. */
export async function setRankSchedule(schedule: RankSchedule): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  if (!(schedule in RANK_SCHEDULES)) return { ok: false, error: "Choose daily, weekly or monthly." };
  const { error } = await patchSettings(g.db, g.client.id, () => ({ rank_schedule: schedule }));
  if (error) return { ok: false, error: "Could not save the schedule." };
  revalidatePath("/rank-tracking");
  return { ok: true, message: `Positions are now checked ${schedule}.` };
}

/** Pins or unpins a tracked keyword; pinned keywords are shown first. */
export async function toggleRankPin(id: string): Promise<Result> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: String(g.error) };
  const { data: kw } = await g.db.from("rank_keywords").select("id, keyword").eq("id", id).eq("client_id", g.client.id).maybeSingle();
  if (!kw) return { ok: false, error: "That keyword isn't tracked any more." };
  let pinned = false;
  const { error } = await patchSettings(g.db, g.client.id, (cur) => {
    const list = rankSettingsOf(cur).pinned;
    pinned = !list.includes(id);
    return { rank_pinned: pinned ? [...list, id].slice(-MAX_RANK_KEYWORDS) : list.filter((x) => x !== id) };
  });
  if (error) return { ok: false, error: "Could not save the pin." };
  revalidatePath("/rank-tracking");
  return { ok: true, message: `${pinned ? "Pinned" : "Unpinned"} “${kw.keyword as string}”.` };
}
