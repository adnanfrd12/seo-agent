"use server";

import { revalidatePath } from "@/lib/revalidate";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncGa4x } from "@/lib/ga4x/sync";
import { LEAD_TYPES } from "@/lib/ga4x/model";

type Result = { ok: boolean; message: string };

async function owner() {
  const { client } = await getSession();
  if (!client) return null;
  if (!["owner", "admin"].includes(client.role)) return null;
  return client;
}

/** Reads every GA4 report again now (it also refreshes by itself once a day). */
export async function syncGa4xNow(): Promise<Result> {
  const c = await owner();
  if (!c) return { ok: false, message: "Only an owner or admin can sync." };
  try {
    const meta = await syncGa4x(createAdminClient(), c.id);
    revalidatePath("/analytics", "layout");
    if (!meta) return { ok: false, message: "GA4 isn't connected for this client." };
    const failed = Object.keys(meta.errors);
    return { ok: true, message: failed.length ? `Synced. ${failed.length} report(s) failed: ${failed.join(", ")}.` : "Synced just now." };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : "GA4 couldn't be read.").slice(0, 200) };
  }
}

/** Sets (or resets with null) the lead type of one event. "" = not a lead. */
export async function setLeadType(event: string, type: string | null): Promise<Result> {
  const c = await owner();
  if (!c) return { ok: false, message: "Only an owner or admin can change lead types." };
  if (type && type !== "" && !(LEAD_TYPES as readonly string[]).includes(type) && type !== "Form start") return { ok: false, message: "Unknown lead type." };
  const admin = createAdminClient();
  const { data } = await admin.from("clients").select("settings").eq("id", c.id).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const map = { ...((settings.ga4_lead_map ?? {}) as Record<string, string>) };
  if (type === null) delete map[event]; else map[event] = type;
  await admin.from("clients").update({ settings: { ...settings, ga4_lead_map: map } }).eq("id", c.id);
  revalidatePath("/analytics", "layout");
  return { ok: true, message: type === null ? `${event} uses the automatic type again.` : `${event} saved as ${type || "not a lead"}.` };
}

/** The cities the business serves (one per line); empty = automatic. */
export async function setServiceArea(text: string): Promise<Result> {
  const c = await owner();
  if (!c) return { ok: false, message: "Only an owner or admin can change the service area." };
  const cities = [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))].slice(0, 300);
  const admin = createAdminClient();
  const { data } = await admin.from("clients").select("settings").eq("id", c.id).maybeSingle();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  await admin.from("clients").update({ settings: { ...settings, ga4_service_area: cities } }).eq("id", c.id);
  revalidatePath("/analytics", "layout");
  return { ok: true, message: cities.length ? `Service area saved (${cities.length} cities).` : "Service area set back to automatic." };
}
