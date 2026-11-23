"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncGscx } from "@/lib/gscx/sync";

type Result = { ok: boolean; message: string };
async function owner() {
  const { client } = await getSession();
  return client && ["owner", "admin"].includes(client.role) ? client : null;
}

/** Reads Search Console again now (performance, sitemaps, crawl and a round of URL inspections). */
export async function syncGscxNow(): Promise<Result> {
  const c = await owner();
  if (!c) return { ok: false, message: "Only an owner or admin can sync." };
  try {
    const meta = await syncGscx(createAdminClient(), c.id, null, { inspectBudget: 60 });
    revalidatePath("/search-console", "layout");
    if (!meta) return { ok: false, message: "Search Console isn't connected for this client." };
    const failed = Object.keys(meta.errors);
    return { ok: true, message: failed.length ? `Synced. ${failed.length} report(s) failed: ${failed.join(", ")}.` : "Synced just now." };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : "Search Console couldn't be read.").slice(0, 200) };
  }
}

/** Brand terms, competitors, cities and services (one per line each); an empty list goes back to automatic. */
export async function saveGscSettings(input: { brand: string; competitors: string; cities: string; services: string }): Promise<Result> {
  const c = await owner();
  if (!c) return { ok: false, message: "Only an owner or admin can change settings." };
  const list = (t: string) => [...new Set(t.split(/[\n,]/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  const admin = createAdminClient();
  const { data } = await admin.from("clients").select("settings").eq("id", c.id).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  await admin.from("clients").update({ settings: { ...settings, gsc_settings: { brand: list(input.brand), competitors: list(input.competitors), cities: list(input.cities), services: list(input.services) } } }).eq("id", c.id);
  revalidatePath("/search-console", "layout");
  return { ok: true, message: "Saved. Every Search Console screen now uses these lists." };
}
