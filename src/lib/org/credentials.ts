import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptSecret } from "@/lib/crypto";
import { invalidateOrgConfig } from "./config";
import { INTEGRATIONS, integrationById, KEY_OWNER } from "./registry";

/**
 * Storing, masking and deleting an organization's credentials. Values are encrypted (AES-GCM, master key in the
 * hosting environment) before they reach the database, and are never returned to the browser: listings give only
 * whether a key is set, a masked hint and who changed it when. Every change is written to the audit log without
 * the value. Callers must have checked that the user is an owner of the organization (requireOrgRole).
 */
export const CUSTOM_KEY = /^[A-Z][A-Z0-9_]{1,80}$/;
/** keys an organization may never store (platform infrastructure, see PLATFORM_ENV) */
const RESERVED = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TOKEN_ENCRYPTION_KEY", "CRON_SECRET", "NEXT_PUBLIC_APP_URL", "CHROME_EXECUTABLE_PATH", "RESEND_API_KEY", "ALERT_EMAIL_FROM", "ALERT_WEBHOOK_URL", "NODE_ENV", "VERCEL"]);

export interface MaskedCredential {
  key: string;
  integration: string;
  secret: boolean;
  /** "org": stored for this organization; "env": read from the server environment (first organization, until imported) */
  source: "org" | "env" | null;
  /** masked: ••••1234 for secrets, the value itself for non-secret fields (client IDs, logins) */
  display: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

const mask = (v: string, secret: boolean) => (!secret ? v : v.length >= 12 ? `••••${v.slice(-4)}` : "••••••••");

export async function audit(admin: SupabaseClient, orgId: string, actor: string | null, action: string, target: string | null, detail: Record<string, unknown> = {}) {
  await admin.from("organization_audit_log").insert({ organization_id: orgId, actor_user_id: actor, action, target, detail }).then(() => undefined, () => undefined);
}

export async function listCredentials(admin: SupabaseClient, orgId: string): Promise<MaskedCredential[]> {
  const [{ data: rows }, { data: org }] = await Promise.all([
    admin.from("organization_credentials").select("key, integration, is_secret, hint, updated_at, updated_by").eq("organization_id", orgId),
    admin.from("organizations").select("uses_env_fallback").eq("id", orgId).maybeSingle(),
  ]);
  const stored = new Map((rows ?? []).map((r) => [r.key as string, r]));
  const out: MaskedCredential[] = [];
  for (const i of INTEGRATIONS) for (const fld of i.fields) {
    const r = stored.get(fld.key);
    const env = org?.uses_env_fallback ? process.env[fld.key]?.trim() : undefined;
    out.push({ key: fld.key, integration: i.id, secret: fld.secret, source: r ? "org" : env ? "env" : null,
      display: r ? r.hint ?? "••••••••" : env ? mask(env, fld.secret) : null, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null });
  }
  for (const r of rows ?? []) if (!KEY_OWNER[r.key]) out.push({ key: r.key, integration: "custom", secret: r.is_secret, source: "org", display: r.hint ?? "••••••••", updatedAt: r.updated_at, updatedBy: r.updated_by });
  return out;
}

/** `actor`: the user making the change, or null for the system (e.g. a platform rotated a token during a sync). */
export async function setCredential(admin: SupabaseClient, orgId: string, actor: string | null, key: string, value: string, opts: { secret?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const k = key.trim().toUpperCase();
  const v = value.trim();
  if (!CUSTOM_KEY.test(k)) return { ok: false, error: "Names use capital letters, digits and underscores, e.g. MY_SETTING." };
  if (RESERVED.has(k)) return { ok: false, error: `${k} is a platform setting and stays in the hosting environment.` };
  if (!v) return { ok: false, error: "Enter a value." };
  if (v.length > 8000) return { ok: false, error: "That value is too long." };
  const integration = KEY_OWNER[k] ?? "custom";
  const def = integrationById(integration)?.fields.find((f) => f.key === k);
  const secret = def ? def.secret : opts.secret ?? true;
  const { data: before } = await admin.from("organization_credentials").select("key").eq("organization_id", orgId).eq("key", k).maybeSingle();
  const { error } = await admin.from("organization_credentials").upsert({
    organization_id: orgId, key: k, integration, value_encrypted: encryptSecret(v), is_secret: secret, hint: mask(v, secret), updated_by: actor, updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,key" });
  if (error) return { ok: false, error: "Couldn't save it. Try again." };
  invalidateOrgConfig(orgId);
  await audit(admin, orgId, actor, before ? "credential.update" : "credential.create", k, { integration });
  return { ok: true };
}

export async function deleteCredential(admin: SupabaseClient, orgId: string, actor: string, key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await admin.from("organization_credentials").delete().eq("organization_id", orgId).eq("key", key).select("key, integration");
  if (error) return { ok: false, error: "Couldn't delete it. Try again." };
  if (!data?.length) return { ok: false, error: "That credential isn't stored." };
  invalidateOrgConfig(orgId);
  await audit(admin, orgId, actor, "credential.delete", key, { integration: data[0].integration });
  return { ok: true };
}

/**
 * Copies the values this server reads from its environment into the organization (only keys it hasn't stored yet),
 * then stops the environment fallback. Only for the first organization (uses_env_fallback). The Vercel variables
 * themselves are left in place until everything has been verified.
 */
export async function importFromEnv(admin: SupabaseClient, orgId: string, actor: string): Promise<{ ok: true; imported: string[]; skipped: string[] } | { ok: false; error: string }> {
  const { data: org } = await admin.from("organizations").select("uses_env_fallback").eq("id", orgId).maybeSingle();
  if (!org?.uses_env_fallback) return { ok: false, error: "Only the first organization can import the server's environment variables." };
  const { data: rows } = await admin.from("organization_credentials").select("key").eq("organization_id", orgId);
  const have = new Set((rows ?? []).map((r) => r.key));
  const imported: string[] = [], skipped: string[] = [];
  for (const i of INTEGRATIONS) for (const fld of i.fields) {
    const v = process.env[fld.key]?.trim();
    if (!v) continue;
    if (have.has(fld.key)) { skipped.push(fld.key); continue; }
    const r = await setCredential(admin, orgId, actor, fld.key, v);
    if (r.ok) imported.push(fld.key); else return { ok: false, error: `Stopped at ${fld.key}: ${r.error}` };
  }
  await admin.from("organizations").update({ uses_env_fallback: false }).eq("id", orgId);
  invalidateOrgConfig(orgId);
  await audit(admin, orgId, actor, "credential.import_env", null, { imported, skipped });
  return { ok: true, imported, skipped };
}
