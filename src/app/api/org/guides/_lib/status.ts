import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuideStatus } from "@/components/org/guides/pdf-document";
import { listCredentials } from "@/lib/org/credentials";
import { INTEGRATIONS } from "@/lib/org/registry";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * Whether each integration is set up for an organization, for the guides: a state and a label, never a value.
 * Same rules as the Integrations tab: an organization credential is configured when every required field has a
 * value (saved, or for the first organization still read from the server environment), partly configured when
 * only some do; a per-client integration counts the organization's clients connected to it.
 */
export async function guideStatuses(admin: SupabaseClient, orgId: string): Promise<Record<string, GuideStatus>> {
  const perClient = INTEGRATIONS.filter((i) => i.perClient).map((i) => i.id);
  const connections = (provider: string) =>
    admin.from("integration_connections").select("id, clients!inner(organization_id, archived_at)", { count: "exact", head: true })
      .eq("clients.organization_id", orgId).is("clients.archived_at", null).eq("provider", provider).eq("status", "connected");
  const [creds, clients, ...counts] = await Promise.all([
    listCredentials(admin, orgId),
    admin.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("archived_at", null),
    ...perClient.map((p) => connections(p)),
  ]);
  // only whether a key has a value: the masked hints listCredentials also returns are never used here
  const isSet = new Map(creds.map((c) => [c.key, Boolean(c.source)]));
  const connected = new Map(perClient.map((p, i) => [p, counts[i]?.count ?? 0]));
  const total = clients.count ?? 0;

  const out: Record<string, GuideStatus> = {};
  for (const def of INTEGRATIONS) {
    if (def.id === "custom") {
      const n = creds.filter((c) => c.integration === "custom" && c.source === "org").length;
      out[def.id] = n ? { state: "configured", label: `${plural(n, "variable")} saved` } : { state: "missing", label: "None saved" };
    } else if (def.perClient) {
      const n = connected.get(def.id) ?? 0;
      out[def.id] = n
        ? { state: "connected", label: `Connected for ${n} of ${plural(total, "client")}` }
        : { state: "not_connected", label: "Not connected for any client" };
    } else {
      const set = def.fields.filter((f) => isSet.get(f.key));
      const complete = def.fields.every((f) => !f.required || isSet.get(f.key));
      out[def.id] = !set.length ? { state: "missing", label: "Not configured" }
        : complete ? { state: "configured", label: "Configured" } : { state: "partial", label: "Partly configured" };
    }
  }
  return out;
}
