import "server-only";
import { decryptSecret } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { integrationById, KEY_OWNER } from "./registry";

/**
 * Runtime configuration per organization: the credentials an organization saved in Settings → Integrations,
 * decrypted on the server only, never sent to the browser or logged.
 *
 * - Every feature asks for the configuration of the client's organization (configForClient) and uses only that.
 * - A missing credential is a ConfigError with instructions; there is NO fallback to another organization.
 * - The one exception is the first organization while `uses_env_fallback` is on: until its owner imports the old
 *   Vercel variables (Integrations → "Import from server environment"), a key it hasn't stored is read from the
 *   environment so nothing stops working during the migration.
 * - Values are cached for 30 seconds per server instance (and dropped at once on this instance when they change),
 *   so a change applies within half a minute without a redeploy.
 */
export class ConfigError extends Error {
  constructor(readonly integration: string, readonly keys: string[], message: string) { super(message); this.name = "ConfigError"; }
}

export interface OrgConfig {
  orgId: string;
  /** the value, or undefined when it isn't set */
  get(key: string): string | undefined;
  /** the value, or a ConfigError telling the user what to add where */
  require(key: string): string;
  has(...keys: string[]): boolean;
}

type Snapshot = { at: number; values: Map<string, string>; fallback: boolean };
const TTL_MS = 30_000;
const cache = new Map<string, Snapshot>();
const clientOrg = new Map<string, { at: number; orgId: string }>();

export function invalidateOrgConfig(orgId: string) { cache.delete(orgId); }

async function load(orgId: string): Promise<Snapshot> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const admin = createAdminClient();
  const [{ data: rows, error }, { data: org }] = await Promise.all([
    admin.from("organization_credentials").select("key, value_encrypted").eq("organization_id", orgId),
    admin.from("organizations").select("uses_env_fallback").eq("id", orgId).maybeSingle(),
  ]);
  if (error) throw new Error(`Couldn't read this organization's settings (${error.message}).`);
  const values = new Map<string, string>();
  for (const r of rows ?? []) {
    try { values.set(r.key, decryptSecret(r.value_encrypted)); } catch { /* a value that can't be decrypted counts as missing */ }
  }
  const snap = { at: Date.now(), values, fallback: Boolean(org?.uses_env_fallback) };
  cache.set(orgId, snap);
  return snap;
}

export function missingMessage(key: string): string {
  const owner = integrationById(KEY_OWNER[key] ?? "custom");
  const field = owner?.fields.find((f) => f.key === key);
  return `${owner?.name ?? "This integration"} isn't set up for this organization: an owner needs to add the ${field?.label ?? key} in Settings → Integrations.`;
}

export async function orgConfig(orgId: string): Promise<OrgConfig> {
  const snap = await load(orgId);
  const get = (key: string) => {
    const v = snap.values.get(key)?.trim();
    if (v) return v;
    if (snap.fallback) { const e = process.env[key]?.trim(); if (e) return e; }
    return undefined;
  };
  return {
    orgId,
    get,
    require(key) {
      const v = get(key);
      if (!v) throw new ConfigError(KEY_OWNER[key] ?? "custom", [key], missingMessage(key));
      return v;
    },
    has: (...keys) => keys.every((k) => Boolean(get(k))),
  };
}

/** The organization a client belongs to (cached 5 minutes; clients don't move between organizations). */
export async function clientOrgId(clientId: string): Promise<string> {
  const hit = clientOrg.get(clientId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.orgId;
  const { data, error } = await createAdminClient().from("clients").select("organization_id").eq("id", clientId).maybeSingle();
  if (error || !data?.organization_id) throw new Error("This client doesn't belong to an organization.");
  clientOrg.set(clientId, { at: Date.now(), orgId: data.organization_id });
  return data.organization_id;
}

export async function configForClient(clientId: string): Promise<OrgConfig> {
  return orgConfig(await clientOrgId(clientId));
}

/** For tests and one-off scripts: a configuration from fixed values (never touches the database). */
export function staticConfig(orgId: string, values: Record<string, string>): OrgConfig {
  const get = (k: string) => values[k]?.trim() || undefined;
  return { orgId, get, require: (k) => { const v = get(k); if (!v) throw new ConfigError(KEY_OWNER[k] ?? "custom", [k], missingMessage(k)); return v; }, has: (...ks) => ks.every((k) => Boolean(get(k))) };
}
