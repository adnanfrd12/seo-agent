import "server-only";
import { appUrl as deploymentUrl } from "@/lib/app-url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CredentialStatus, CustomVarView, FieldView, IntegrationView } from "@/components/integrations/org/types";
import { gbpRedirectUri } from "@/lib/google/oauth";
import { memo } from "@/lib/memo";
import { orgConfig, type OrgConfig } from "@/lib/org/config";
import { listCredentials, type MaskedCredential } from "@/lib/org/credentials";
import { CATEGORIES, INTEGRATIONS, type IntegrationDef } from "@/lib/org/registry";
import { hasTest } from "@/lib/org/tests";

/**
 * Everything the Integrations tab shows about an organization's integrations: status per registry entry, masked
 * values for owners (status only for admins), who changed what when, and what relies on each integration (so
 * Delete can warn). Counts are scoped to the organization's own clients.
 */
export interface OrgIntegrations {
  integrations: IntegrationView[];
  custom: CustomVarView[];
  usesEnvFallback: boolean;
  /** registry keys this organization currently reads from the server environment (names only) */
  envKeys: string[];
  totalClients: number;
}

type Usage = {
  clients: number;
  connected: Record<"ga4" | "gsc" | "gbp" | "bing" | "lbm" | "clarity", number>;
  /** Business Profile connections made with the organization's (not a person's) OAuth app */
  gbpOrgApp: number;
  aiCalls: number;
  dfsRequests: number;
  autoRefresh: number;
  seosignalx: number;
};

const DAY = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Counts are a minute old at most (they only feed status lines and Delete warnings). */
function usage(admin: SupabaseClient, orgId: string): Promise<Usage> {
  return memo(`org-integration-usage|${orgId}`, 60_000, async () => {
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    const inOrg = "clients!inner(organization_id, archived_at)";
    const connections = (provider: string) =>
      admin.from("integration_connections").select(`id, ${inOrg}`, { count: "exact", head: true })
        .eq("clients.organization_id", orgId).is("clients.archived_at", null).eq("provider", provider).eq("status", "connected");
    const [clients, ga4, gsc, gbp, bing, lbm, clarity, gbpOrgApp, ai, dfs, auto, sx] = await Promise.all([
      admin.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("archived_at", null),
      connections("ga4"), connections("gsc"), connections("gbp"), connections("bing"), connections("lbm"), connections("clarity"),
      connections("gbp").is("oauth_app_owner", null),
      admin.from("ai_usage_events").select(`calls, ${inOrg}`).eq("clients.organization_id", orgId).gte("created_at", since).limit(5000),
      admin.from("dfs_spend").select(`id, ${inOrg}`, { count: "exact", head: true }).eq("clients.organization_id", orgId).gte("created_at", since),
      admin.from("research_targets").select(`client_id, ${inOrg}`, { count: "exact", head: true }).eq("clients.organization_id", orgId).is("clients.archived_at", null).eq("auto_refresh", true),
      admin.from("dfs_cache").select(`client_id, ${inOrg}`, { count: "exact", head: true }).eq("clients.organization_id", orgId).eq("endpoint", "seosignalx").gte("fetched_at", since),
    ]);
    return {
      clients: clients.count ?? 0,
      connected: { ga4: ga4.count ?? 0, gsc: gsc.count ?? 0, gbp: gbp.count ?? 0, bing: bing.count ?? 0, lbm: lbm.count ?? 0, clarity: clarity.count ?? 0 },
      gbpOrgApp: gbpOrgApp.count ?? 0,
      aiCalls: (ai.data ?? []).reduce((s, r) => s + (Number((r as { calls?: number }).calls) || 0), 0),
      dfsRequests: dfs.count ?? 0,
      autoRefresh: auto.count ?? 0,
      seosignalx: sx.count ?? 0,
    };
  });
}

function inUse(id: string, u: Usage): string[] {
  const lines: (string | false)[] = [];
  switch (id) {
    case "anthropic": lines.push(u.aiCalls > 0 && `${plural(u.aiCalls, "AI request")} in the last 30 days`); break;
    case "dataforseo":
      lines.push(u.dfsRequests > 0 && `${plural(u.dfsRequests, "paid request")} in the last 30 days`);
      lines.push(u.autoRefresh > 0 && `${plural(u.autoRefresh, "client")} on automatic weekly refresh`);
      break;
    case "google_oauth": lines.push(u.gbpOrgApp > 0 && `${plural(u.gbpOrgApp, "Business Profile connection")} made with this OAuth app`); break;
    case "composio": lines.push(u.connected.ga4 + u.connected.gsc > 0 && `${plural(u.connected.ga4, "Google Analytics connection")} and ${plural(u.connected.gsc, "Search Console connection")}`); break;
    case "bing": lines.push(u.connected.bing > 0 && `${plural(u.connected.bing, "Bing connection")} (each keeps its own copy of a key; new connections use this one)`); break;
    case "lbm": lines.push(u.connected.lbm > 0 && `${plural(u.connected.lbm, "Local Brand Manager connection")} (each keeps its own copy of a token; new connections and bulk setup use this one)`); break;
    case "seosignalx": lines.push(u.seosignalx > 0 && `${plural(u.seosignalx, "client")} with SEOSignalX data from the last 30 days`); break;
  }
  return lines.filter((l): l is string => Boolean(l));
}

function statusOf(def: IntegrationDef, fields: FieldView[], u: Usage): { status: CredentialStatus; label: string; connected?: number } {
  if (def.perClient) {
    const n = u.connected[def.id as keyof Usage["connected"]] ?? 0;
    return n > 0
      ? { status: "connected", label: `Connected for ${n} of ${u.clients} ${u.clients === 1 ? "client" : "clients"}`, connected: n }
      : { status: "not_connected", label: "Not connected for any client", connected: 0 };
  }
  const set = fields.filter((f) => f.set);
  if (!set.length) return { status: "missing", label: "Not configured" };
  return fields.every((f) => !f.required || f.set) ? { status: "configured", label: "Configured" } : { status: "partial", label: "Partly configured" };
}

/** The redirect URI to register on an OAuth client: the organization's override when valid, else this deployment's. */
function redirectFor(def: IntegrationDef, cfg: OrgConfig | null, appUrl: string): string | undefined {
  if (!def.redirectPath) return undefined;
  if (def.id === "google_oauth") {
    try { return gbpRedirectUri(cfg ?? undefined); } catch { /* an invalid override: show the default to register */ }
    try { return gbpRedirectUri(); } catch { /* no app URL on this deployment */ }
  }
  return appUrl ? `${appUrl}${def.redirectPath}` : undefined;
}

export async function loadOrgIntegrations(admin: SupabaseClient, orgId: string, viewer: { owner: boolean }): Promise<OrgIntegrations> {
  const [creds, org, u, cfg] = await Promise.all([
    listCredentials(admin, orgId),
    admin.from("organizations").select("uses_env_fallback, timezone").eq("id", orgId).maybeSingle(),
    usage(admin, orgId),
    orgConfig(orgId).catch(() => null),
  ]);
  const usesEnvFallback = Boolean(org.data?.uses_env_fallback);
  const byKey = new Map<string, MaskedCredential>(creds.map((c) => [c.key, c]));
  const people = [...new Set(creds.map((c) => c.updatedBy).filter((x): x is string => Boolean(x)))];
  const { data: profiles } = people.length
    ? await admin.from("profiles").select("user_id, full_name").in("user_id", people)
    : { data: [] as { user_id: string; full_name: string | null }[] };
  const nameOf = (id: string | null) => (id ? profiles?.find((p) => p.user_id === id)?.full_name ?? "a former member" : null);
  const timeZone = validZone(org.data?.timezone);
  const updated = (at: string | null, by: string | null) => {
    if (!at) return null;
    const day = new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
    return by ? `${day} by ${by}` : day;
  };
  const appUrl = deploymentUrl();
  const categoryLabel = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

  const integrations: IntegrationView[] = INTEGRATIONS.filter((d) => d.id !== "custom").map((def) => {
    const fields: FieldView[] = def.fields.map((f) => {
      const c = byKey.get(f.key);
      return {
        key: f.key, label: f.label, secret: f.secret, required: f.required, placeholder: f.placeholder, help: f.help,
        set: Boolean(c?.source), source: c?.source ?? null, display: viewer.owner ? c?.display ?? null : null,
      };
    });
    const stored = def.fields.map((f) => byKey.get(f.key)).filter((c): c is MaskedCredential => c?.source === "org");
    const latest = stored.reduce<MaskedCredential | null>((a, c) => (!a || (c.updatedAt ?? "") > (a.updatedAt ?? "") ? c : a), null);
    const s = statusOf(def, fields, u);
    const by = nameOf(latest?.updatedBy ?? null);
    return {
      id: def.id, name: def.name, category: def.category, categoryLabel: categoryLabel[def.category] ?? def.category,
      description: def.description, features: def.features, fields,
      status: s.status, statusLabel: s.label, connectedClients: s.connected,
      missing: fields.filter((f) => f.required && !f.set).map((f) => f.label),
      fromEnv: fields.some((f) => f.source === "env"),
      stored: stored.length,
      envBackup: usesEnvFallback && def.fields.some((f) => Boolean(process.env[f.key]?.trim())),
      updatedAt: latest?.updatedAt ?? null, updatedBy: by, updated: updated(latest?.updatedAt ?? null, by),
      consoleUrl: def.consoleUrl, docsUrl: def.docsUrl,
      redirectUri: redirectFor(def, cfg, appUrl),
      perClient: def.perClient,
      testable: Boolean(def.testable) && hasTest(def.id),
      inUse: inUse(def.id, u),
      search: [def.name, def.description, categoryLabel[def.category], ...def.features, ...def.fields.flatMap((f) => [f.label, f.key])].join(" ").toLowerCase(),
    };
  });

  const custom: CustomVarView[] = creds.filter((c) => c.integration === "custom" && c.source === "org")
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((c) => {
      const by = nameOf(c.updatedBy);
      return { key: c.key, secret: c.secret, display: viewer.owner ? c.display : null, updatedAt: c.updatedAt, updatedBy: by, updated: updated(c.updatedAt, by) };
    });

  return {
    integrations, custom, usesEnvFallback,
    envKeys: creds.filter((c) => c.source === "env").map((c) => c.key),
    totalClients: u.clients,
  };
}

function validZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}
