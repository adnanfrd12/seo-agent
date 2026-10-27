import "server-only";
import { createClient } from "@/lib/supabase/server";
import { first, type SearchParams } from "./url";

export interface TrackedResource {
  id: string;
  provider: "ga4" | "gsc" | "gbp" | "bing";
  display_name: string | null;
  timezone: string | null;
}

/** URL param per provider: ?property=<id> for GA4, ?site=<id> for Search Console, ?location=<id> for Business Profile. */
export const RESOURCE_PARAM = { ga4: "property", gsc: "site", gbp: "location", bing: "bsite" } as const;

/**
 * Resolves the property/site picks in the URL against this client's tracked resources (unknown
 * ids are ignored) and returns a Supabase client whose RPCs are scoped to those picks.
 */
export async function resourceScope(clientId: string, sp: SearchParams) {
  const base = await createClient();
  const { data } = await base
    .from("integration_resources")
    .select("id, provider, display_name, timezone")
    .eq("client_id", clientId)
    .eq("is_selected", true)
    .order("display_name");
  const all = (data ?? []) as TrackedResource[];
  const ga4 = all.filter((r) => r.provider === "ga4");
  const gsc = all.filter((r) => r.provider === "gsc");
  const gbp = all.filter((r) => r.provider === "gbp");
  const bing = all.filter((r) => r.provider === "bing");

  const pick = (list: TrackedResource[], raw: string | undefined) => list.find((r) => r.id === raw) ?? null;
  const ga4Pick = pick(ga4, first(sp[RESOURCE_PARAM.ga4]));
  const gscPick = pick(gsc, first(sp[RESOURCE_PARAM.gsc]));
  const gbpPick = pick(gbp, first(sp[RESOURCE_PARAM.gbp]));
  const bingPick = pick(bing, first(sp[RESOURCE_PARAM.bing]));

  const headers: Record<string, string> = {};
  if (ga4Pick) headers["x-resource-ga4"] = ga4Pick.id;
  if (gscPick) headers["x-resource-gsc"] = gscPick.id;
  if (gbpPick) headers["x-resource-gbp"] = gbpPick.id;
  if (bingPick) headers["x-resource-bing"] = bingPick.id;
  const supabase = Object.keys(headers).length ? await createClient(headers) : base;

  /** Human label for page headers: the picked one, or all tracked ones. */
  const label = (list: TrackedResource[], picked: TrackedResource | null) =>
    picked ? (picked.display_name ?? "") : list.map((r) => r.display_name).join(", ");

  return { supabase, ga4, gsc, gbp, bing, ga4Pick, gscPick, gbpPick, bingPick, label };
}

/** Options for a property/site <FilterSelect>; null when there is nothing to choose between. */
export function resourceOptions(list: TrackedResource[], allLabel: string) {
  if (list.length < 2) return null;
  return [{ value: "", label: allLabel }, ...list.map((r) => ({ value: r.id, label: r.display_name ?? r.id }))];
}
