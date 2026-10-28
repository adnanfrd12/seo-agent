"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/analytics/client-context";
import { normalizeTerms } from "@/lib/brand";
import { createAdminClient } from "@/lib/supabase/admin";

/** Saves the brand terms used for the branded vs non-branded split (owners and admins). */
export async function saveBrandTerms(input: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { client } = await getSession();
  if (!client || !["owner", "admin"].includes(client.role)) return { ok: false, error: "Only owners and admins can change brand terms." };
  const terms = normalizeTerms(input.split(/[,\n;]+/));
  if (terms.length === 0) return { ok: false, error: "Enter at least one brand name of 4 or more letters (e.g. your company or website name)." };
  const admin = createAdminClient();
  const { data } = await admin.from("clients").select("settings").eq("id", client.id).maybeSingle();
  const { error } = await admin.from("clients").update({ settings: { ...((data?.settings as Record<string, unknown>) ?? {}), brand_terms: terms } }).eq("id", client.id);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath("/search-console");
  return { ok: true, message: `Saved ${terms.length} brand term${terms.length > 1 ? "s" : ""}.` };
}
