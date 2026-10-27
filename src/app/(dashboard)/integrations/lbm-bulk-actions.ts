"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/analytics/client-context";
import { BingError, userSites } from "@/lib/bing/api";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { LbmError, listLocations } from "@/lib/lbm/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { processQueue } from "@/lib/sync/worker";

export type BulkLocation = {
  id: string; gbpId: string; name: string; address: string | null; website: string | null; enabled: boolean; status: string;
  timezone: string; existingClient: string | null; bingSite: string | null;
};

/** US state (name or code) -> IANA time zone; the dashboard's dates follow the client's zone. */
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York",
  LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago",
  TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles",
  WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver",
};
const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
function timezoneFor(area: string | null | undefined, address: string | null, fallback: string) {
  const fromArea = area ? (STATE_NAMES[area.trim().toLowerCase()] ?? area.trim().toUpperCase()) : null;
  const fromAddress = address?.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] ?? null;
  return STATE_TZ[fromArea ?? ""] ?? STATE_TZ[fromAddress ?? ""] ?? fallback;
}
const domain = (u: string | null | undefined) => {
  if (!u) return null;
  try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
};

async function context() {
  const { user, client } = await getSession();
  if (!client || !user) throw new Error("No client");
  if (!["owner", "admin"].includes(client.role)) return { allowed: false as const };
  const admin = createAdminClient();
  // the active client's stored keys, falling back to the server-wide ones
  const stored = async (provider: string) => {
    const { data: conn } = await admin.from("integration_connections").select("id").eq("client_id", client.id).eq("provider", provider).eq("status", "connected").maybeSingle();
    if (!conn) return null;
    const { data } = await admin.from("integration_secrets").select("refresh_token_encrypted").eq("connection_id", conn.id).maybeSingle();
    return data?.refresh_token_encrypted ? decryptSecret(data.refresh_token_encrypted) : null;
  };
  const lbmToken = (await stored("lbm")) ?? process.env.LOCAL_BRAND_MANAGER_API_TOKEN?.trim() ?? null;
  const bingKey = (await stored("bing")) ?? process.env.BING_WEBMASTER_API_KEY?.trim() ?? null;
  return { allowed: true as const, user, client, admin, lbmToken, bingKey };
}

/** Every LBM location, which dashboard client already uses it, and the Bing site matching its website. */
export async function lbmBulkPreview(): Promise<{ ok: true; locations: BulkLocation[]; bingAvailable: boolean } | { ok: false; error: string }> {
  const ctx = await context();
  if (!ctx.allowed) return { ok: false, error: "Only owners and admins can run the bulk setup." };
  if (!ctx.lbmToken) return { ok: false, error: "Connect Local Brand Manager (or set LOCAL_BRAND_MANAGER_API_TOKEN) first." };
  let locations;
  try { locations = await listLocations(ctx.lbmToken); } catch (e) {
    return { ok: false, error: e instanceof LbmError ? e.message : "Couldn't load Local Brand Manager locations." };
  }
  let bing: { url: string; domain: string | null }[] = [];
  if (ctx.bingKey) {
    try { bing = ((await userSites(ctx.bingKey)) ?? []).filter((s) => s.IsVerified).map((s) => ({ url: s.Url, domain: domain(s.Url) })); }
    catch (e) { if (!(e instanceof BingError)) throw e; }
  }
  const { data: used } = await ctx.admin.from("integration_resources").select("metadata, clients(name)")
    .eq("provider", "gbp").eq("is_selected", true).filter("metadata->>source", "eq", "lbm");
  const usedBy = new Map((used ?? []).map((r) => [String((r.metadata as { lbm_id?: string })?.lbm_id), (r.clients as unknown as { name: string } | null)?.name ?? "another client"]));

  return {
    ok: true,
    bingAvailable: bing.length > 0,
    locations: locations.filter((l) => l.gbp_id).map((l) => {
      const d = domain(l.website_url);
      return {
        id: l.id, gbpId: l.gbp_id!, name: l.name, address: l.address, website: l.website_url ?? null, enabled: l.enabled,
        status: l.states.filter((s) => !s.startsWith("can_")).join(", ") || "—",
        timezone: timezoneFor(l.administrative_area, l.address, ctx.client.timezone),
        existingClient: usedBy.get(l.id) ?? null,
        bingSite: d ? bing.find((b) => b.domain === d)?.url ?? null : null,
      };
    }).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const pickSchema = z.array(z.object({
  id: z.string().min(1).max(40), gbpId: z.string().regex(/^\d+$/), name: z.string().trim().min(1).max(120),
  timezone: z.string().min(1).max(64), bingSite: z.url().max(500).nullable(),
})).min(1).max(100);

/**
 * Creates one dashboard client per picked location (the caller becomes owner), connects Local
 * Brand Manager and, where a Bing site matches, Bing; optionally copies this client's team; then
 * queues the first imports. Locations already used by a client are skipped server-side too.
 */
export async function lbmBulkCreate(picks: z.input<typeof pickSchema>, copyTeam: boolean)
  : Promise<{ ok: true; created: { name: string; id: string; bing: boolean }[]; skipped: string[]; failed: string[] } | { ok: false; error: string }> {
  const parsed = pickSchema.safeParse(picks);
  if (!parsed.success) return { ok: false, error: "Invalid selection (max 100 locations per run)." };
  const ctx = await context();
  if (!ctx.allowed) return { ok: false, error: "Only owners and admins can run the bulk setup." };
  if (!ctx.lbmToken) return { ok: false, error: "No Local Brand Manager token available." };
  const { admin, user } = ctx;
  const lbmSecret = encryptSecret(ctx.lbmToken);
  const bingSecret = ctx.bingKey ? encryptSecret(ctx.bingKey) : null;
  const supabase = await createClient();

  const { data: used } = await admin.from("integration_resources").select("metadata").eq("provider", "gbp").eq("is_selected", true).filter("metadata->>source", "eq", "lbm");
  const taken = new Set((used ?? []).map((r) => String((r.metadata as { lbm_id?: string })?.lbm_id)));
  const { data: team } = copyTeam
    ? await admin.from("client_members").select("user_id, role").eq("client_id", ctx.client.id).neq("user_id", user.id)
    : { data: [] };

  const created: { name: string; id: string; bing: boolean }[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const p of parsed.data) {
    if (taken.has(p.id)) { skipped.push(p.name); continue; }
    try {
      const { data: clientId, error } = await supabase.rpc("create_client", { p_name: p.name, p_timezone: p.timezone });
      if (error || !clientId) throw new Error("create_client failed");
      const cid = String(clientId);
      if (team?.length) await admin.from("client_members").upsert(team.map((m) => ({ client_id: cid, user_id: m.user_id, role: m.role })), { onConflict: "client_id,user_id" });

      const { data: lconn, error: lerr } = await admin.from("integration_connections")
        .insert({ client_id: cid, provider: "lbm", auth_method: "api_token", status: "connected" }).select("id").single();
      if (lerr || !lconn) throw new Error("lbm connection failed");
      await admin.from("integration_secrets").insert({ connection_id: lconn.id, refresh_token_encrypted: lbmSecret });
      const { data: lres, error: rerr } = await admin.from("integration_resources").insert({
        client_id: cid, connection_id: lconn.id, provider: "gbp", external_id: `locations/${p.gbpId}`, display_name: p.name,
        is_selected: true, metadata: { source: "lbm", lbm_id: p.id },
      }).select("id").single();
      if (rerr || !lres) throw new Error("lbm resource failed");
      await admin.from("analytics_sync_jobs").insert({ client_id: cid, connection_id: lconn.id, resource_id: lres.id, provider: "gbp", job_type: "initial" });

      let bing = false;
      if (p.bingSite && bingSecret) {
        const { data: bconn } = await admin.from("integration_connections")
          .insert({ client_id: cid, provider: "bing", auth_method: "api_token", status: "connected" }).select("id").single();
        if (bconn) {
          await admin.from("integration_secrets").insert({ connection_id: bconn.id, refresh_token_encrypted: bingSecret });
          const { data: bres } = await admin.from("integration_resources").insert({
            client_id: cid, connection_id: bconn.id, provider: "bing", external_id: p.bingSite,
            display_name: p.bingSite.replace(/^https?:\/\//, "").replace(/\/$/, ""), is_selected: true,
          }).select("id").single();
          if (bres) {
            await admin.from("analytics_sync_jobs").insert({ client_id: cid, connection_id: bconn.id, resource_id: bres.id, provider: "bing", job_type: "initial" });
            bing = true;
          }
        }
      }
      taken.add(p.id);
      created.push({ name: p.name, id: cid, bing });
    } catch {
      failed.push(p.name);
    }
  }
  if (created.length) after(() => processQueue().catch(() => {}));
  revalidatePath("/", "layout");
  return { ok: true, created, skipped, failed };
}
