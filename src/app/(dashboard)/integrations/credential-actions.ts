"use server";

import { z } from "zod";
import { checkCustomKey, checkCustomValue, checkValue, normalizeValue } from "@/components/integrations/org/field-rules";
import { deleteCredential, importFromEnv, listCredentials, setCredential } from "@/lib/org/credentials";
import { can, PermissionError, requireOrg, type OrgContext, type OrgRole } from "@/lib/org/permissions";
import { integrationById, isRegisteredKey } from "@/lib/org/registry";
import { testIntegration, type TestStatus } from "@/lib/org/tests";
import { revalidatePath } from "@/lib/revalidate";

/**
 * Organization credentials on the Integrations tab. Every action checks the signed-in user's role in the given
 * organization on the server (owners for anything that reads or changes credentials, owners and admins for a
 * connection test) and never returns a credential value: only key names, labels and messages.
 */
export type ActionResult = { ok: true; message: string } | { ok: false; error: string; fields?: Record<string, string> };

const OWNERS_ONLY = "Only organization owners can change integration credentials.";
const MAX_CUSTOM = 100;
const orgIdSchema = z.uuid();

async function context(orgId: unknown, check: (r: OrgRole | null) => boolean, message: string): Promise<OrgContext | { error: string }> {
  const id = orgIdSchema.safeParse(orgId);
  if (!id.success) return { error: "Choose an organization first." };
  try {
    return await requireOrg(check, id.data, message);
  } catch (e) {
    if (e instanceof PermissionError) return { error: e.message };
    throw e;
  }
}

const refresh = () => revalidatePath("/integrations");

/**
 * Saves an integration's fields in one go. `changes` maps a field key to a new value, or to null to remove a
 * saved optional value; an empty string keeps what is saved. Everything is checked before anything is written,
 * and after the save every required field must be set.
 */
export async function saveIntegrationCredentials(orgId: string, integrationId: string, changes: Record<string, string | null>): Promise<ActionResult> {
  const c = await context(orgId, can.manageCredentials, OWNERS_ONLY);
  if ("error" in c) return { ok: false, error: c.error };
  const def = typeof integrationId === "string" ? integrationById(integrationId) : undefined;
  if (!def || !def.fields.length) return { ok: false, error: "This integration has no credentials to save." };
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return { ok: false, error: "Nothing to save." };

  const byKey = new Map(def.fields.map((f) => [f.key, f]));
  const writes: [string, string][] = [];
  const removals: string[] = [];
  const fields: Record<string, string> = {};
  for (const [key, raw] of Object.entries(changes)) {
    const field = byKey.get(key);
    if (!field) return { ok: false, error: "That field doesn't belong to this integration." };
    if (raw === null) {
      if (field.required) fields[key] = "This field is required: enter a new value instead.";
      else removals.push(key);
      continue;
    }
    if (typeof raw !== "string") return { ok: false, error: "Nothing to save." };
    const value = normalizeValue(key, raw);
    if (!value) continue;
    const problem = checkValue(key, value);
    if (problem) fields[key] = problem;
    else writes.push([key, value]);
  }
  if (Object.keys(fields).length) return { ok: false, error: "Check the highlighted fields.", fields };
  if (!writes.length && !removals.length) return { ok: false, error: "Nothing changed: enter a new value, or close." };

  const current = (await listCredentials(c.admin, c.orgId)).filter((x) => x.integration === def.id);
  const stored = new Set(current.filter((x) => x.source === "org").map((x) => x.key));
  // only values saved here can be removed (a value read from the server environment isn't stored)
  const deletes = removals.filter((k) => stored.has(k));
  if (!writes.length && !deletes.length) return { ok: false, error: "Nothing changed: enter a new value, or close." };
  const willBeSet = new Set(current.filter((x) => x.source !== null && !deletes.includes(x.key)).map((x) => x.key));
  for (const [k] of writes) willBeSet.add(k);
  for (const f of def.fields) if (f.required && !willBeSet.has(f.key)) fields[f.key] = "Required.";
  if (Object.keys(fields).length) return { ok: false, error: "Fill in the required fields.", fields };

  for (const [key, value] of writes) {
    const r = await setCredential(c.admin, c.orgId, c.userId, key, value);
    if (!r.ok) { refresh(); return { ok: false, error: `${byKey.get(key)!.label}: ${r.error}` }; }
  }
  for (const key of deletes) {
    const r = await deleteCredential(c.admin, c.orgId, c.userId, key);
    if (!r.ok) { refresh(); return { ok: false, error: `${byKey.get(key)!.label}: ${r.error}` }; }
  }
  refresh();
  const n = writes.length + deletes.length;
  return { ok: true, message: `${def.name} saved (${n} ${n === 1 ? "value" : "values"} updated). Changes apply within 30 seconds.` };
}

/** Deletes every value this organization stored for an integration (values from the server environment stay). */
export async function deleteIntegrationCredentials(orgId: string, integrationId: string): Promise<ActionResult> {
  const c = await context(orgId, can.manageCredentials, OWNERS_ONLY);
  if ("error" in c) return { ok: false, error: c.error };
  const def = typeof integrationId === "string" ? integrationById(integrationId) : undefined;
  if (!def || !def.fields.length) return { ok: false, error: "This integration has no credentials to delete." };
  const all = await listCredentials(c.admin, c.orgId);
  const stored = all.filter((x) => x.integration === def.id && x.source === "org");
  if (!stored.length) return { ok: false, error: "Nothing is saved for this integration in this organization." };
  for (const s of stored) {
    const r = await deleteCredential(c.admin, c.orgId, c.userId, s.key);
    if (!r.ok) { refresh(); return { ok: false, error: r.error }; }
  }
  refresh();
  const { data: org } = await c.admin.from("organizations").select("uses_env_fallback").eq("id", c.orgId).maybeSingle();
  const envLeft = org?.uses_env_fallback && def.fields.some((f) => process.env[f.key]?.trim());
  return {
    ok: true,
    message: `${def.name} credentials deleted.${envLeft ? " The server environment's values are used again until they're removed there." : ""}`,
  };
}

/** Adds or replaces a custom variable (an UPPER_SNAKE name that no integration uses). */
export async function saveCustomVariable(orgId: string, key: string, value: string, secret: boolean): Promise<ActionResult> {
  const c = await context(orgId, can.manageCredentials, OWNERS_ONLY);
  if ("error" in c) return { ok: false, error: c.error };
  const k = String(key ?? "").trim().toUpperCase();
  const v = String(value ?? "").trim();
  const keyProblem = checkCustomKey(k);
  const valueProblem = checkCustomValue(v);
  if (keyProblem || valueProblem) return { ok: false, error: "Check the highlighted fields.", fields: { ...(keyProblem ? { key: keyProblem } : {}), ...(valueProblem ? { value: valueProblem } : {}) } };
  const custom = (await listCredentials(c.admin, c.orgId)).filter((x) => x.integration === "custom");
  const exists = custom.some((x) => x.key === k);
  if (!exists && custom.length >= MAX_CUSTOM) return { ok: false, error: `An organization can keep up to ${MAX_CUSTOM} custom variables. Delete one first.` };
  const r = await setCredential(c.admin, c.orgId, c.userId, k, v, { secret: secret !== false });
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: `${k} ${exists ? "updated" : "added"}.` };
}

export async function deleteCustomVariable(orgId: string, key: string): Promise<ActionResult> {
  const c = await context(orgId, can.manageCredentials, OWNERS_ONLY);
  if ("error" in c) return { ok: false, error: c.error };
  const k = String(key ?? "").trim();
  if (!k || isRegisteredKey(k)) return { ok: false, error: "That isn't a custom variable." };
  const r = await deleteCredential(c.admin, c.orgId, c.userId, k);
  if (!r.ok) return { ok: false, error: r.error };
  refresh();
  return { ok: true, message: `${k} deleted.` };
}

/** Runs the integration's connection test with this organization's configuration (owners and admins). */
export async function testIntegrationConnection(orgId: string, integrationId: string): Promise<{ status: TestStatus; message: string }> {
  const c = await context(orgId, can.manageSettings, "Only organization owners and admins can test connections.");
  if ("error" in c) return { status: "error", message: c.error };
  if (typeof integrationId !== "string" || !integrationById(integrationId)) return { status: "error", message: "Unknown integration." };
  const r = await testIntegration(c.orgId, integrationId);
  return { status: r.status, message: r.message };
}

/**
 * Copies the server environment's values into the organization (first organization only) and stops the fallback.
 * Returns the imported key names, never values.
 */
export async function importServerEnvironment(orgId: string): Promise<{ ok: true; imported: string[]; skipped: string[] } | { ok: false; error: string }> {
  const c = await context(orgId, can.manageCredentials, OWNERS_ONLY);
  if ("error" in c) return { ok: false, error: c.error };
  const r = await importFromEnv(c.admin, c.orgId, c.userId);
  refresh();
  return r.ok ? { ok: true, imported: r.imported, skipped: r.skipped } : { ok: false, error: r.error };
}
