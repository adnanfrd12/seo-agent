import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./credentials";
import { allowedClientRole, chunks, reachesAllClients, type Actor, type ClientRole, type Result } from "./members";
import type { OrgRole } from "./permissions";

/**
 * An organization's clients: list (with connected integrations and explicit access), create, edit, archive / restore
 * and who can open each one. Callers have checked requireOrg(can.manageClients). Archiving only sets archived_at:
 * the client disappears from switchers while every row of its data stays. Every change is written to the audit log.
 */
export const RANGE_DAYS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_DAYS)[number];
export function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export interface OrgClient {
  id: string;
  name: string;
  timezone: string;
  defaultRangeDays: number;
  createdAt: string;
  archivedAt: string | null;
  integrations: { provider: string; status: string; lastSyncedAt: string | null }[];
  /** explicit client_members rows (organization owners and admins reach every client without one) */
  access: { userId: string; role: ClientRole }[];
}
export interface ClientInput { name: string; timezone: string; defaultRangeDays: RangeDays }

const fail = (error: string): Result => ({ ok: false, error });

type Row = {
  id: string; name: string; timezone: string; default_range_days: number; created_at: string; archived_at: string | null;
  integration_connections: { provider: string; status: string; last_synced_at: string | null }[] | null;
  client_members: { user_id: string; role: ClientRole }[] | null;
};

export async function listOrgClients(admin: SupabaseClient, orgId: string): Promise<OrgClient[]> {
  const out: OrgClient[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("clients")
      .select("id, name, timezone, default_range_days, created_at, archived_at, integration_connections(provider, status, last_synced_at), client_members(user_id, role)")
      .eq("organization_id", orgId).order("name").order("id").range(from, from + 999);
    if (error) throw new Error("Couldn't read the clients of this organization.");
    for (const r of (data ?? []) as Row[]) out.push({
      id: r.id, name: r.name, timezone: r.timezone, defaultRangeDays: r.default_range_days, createdAt: r.created_at, archivedAt: r.archived_at,
      integrations: (r.integration_connections ?? []).map((i) => ({ provider: i.provider, status: i.status, lastSyncedAt: i.last_synced_at })),
      access: (r.client_members ?? []).map((m) => ({ userId: m.user_id, role: m.role })),
    });
    if (!data || data.length < 1000) return out;
  }
}

async function clientRow(admin: SupabaseClient, orgId: string, clientId: string) {
  const { data } = await admin.from("clients").select("id, name, timezone, default_range_days, archived_at").eq("id", clientId).eq("organization_id", orgId).maybeSingle();
  return data as { id: string; name: string; timezone: string; default_range_days: number; archived_at: string | null } | null;
}

/** A new client's defaults from its organization: the organization's time zone and default date range (Preferences). */
export async function orgClientDefaults(admin: SupabaseClient, orgId: string): Promise<{ timezone: string; defaultRangeDays: RangeDays }> {
  const { data } = await admin.from("organizations").select("timezone, preferences").eq("id", orgId).maybeSingle();
  const days = Number(((data?.preferences ?? {}) as Record<string, unknown>).default_range_days);
  return {
    timezone: typeof data?.timezone === "string" && data.timezone ? data.timezone : "UTC",
    defaultRangeDays: (RANGE_DAYS as readonly number[]).includes(days) ? (days as RangeDays) : 30,
  };
}

/**
 * Creates a client in the organization through create_client (run as the signed-in user, who becomes its owner or
 * admin), then applies the default date range. `userDb` is the user's own Supabase client.
 */
export async function createOrgClient(userDb: SupabaseClient, admin: SupabaseClient, orgId: string, actor: Actor, input: ClientInput): Promise<{ ok: true; id: string; message: string } | { ok: false; error: string }> {
  const { data, error } = await userDb.rpc("create_client", { p_name: input.name, p_timezone: input.timezone, p_organization: orgId });
  if (error || !data) return { ok: false, error: error?.code === "42501" ? "Only organization owners and admins can create clients." : "Couldn't create the client. Try again." };
  const id = String(data);
  if (input.defaultRangeDays !== 30) await admin.from("clients").update({ default_range_days: input.defaultRangeDays }).eq("id", id).eq("organization_id", orgId);
  await audit(admin, orgId, actor.userId, "client.create", input.name, { client_id: id });
  return { ok: true, id, message: `${input.name} created.` };
}

export async function updateOrgClient(admin: SupabaseClient, orgId: string, actor: Actor, clientId: string, input: ClientInput): Promise<Result> {
  const c = await clientRow(admin, orgId, clientId);
  if (!c) return fail("That client isn't in this organization.");
  const patch: Record<string, unknown> = {};
  if (input.name !== c.name) patch.name = input.name;
  if (input.timezone !== c.timezone) patch.timezone = input.timezone;
  if (input.defaultRangeDays !== c.default_range_days) patch.default_range_days = input.defaultRangeDays;
  if (!Object.keys(patch).length) return { ok: true, message: "Nothing changed." };
  const { error } = await admin.from("clients").update(patch).eq("id", clientId).eq("organization_id", orgId);
  if (error) return fail("Couldn't save the client. Try again.");
  await audit(admin, orgId, actor.userId, "client.update", input.name, { client_id: clientId, fields: Object.keys(patch) });
  return { ok: true, message: "Client saved." };
}

export async function setClientArchived(admin: SupabaseClient, orgId: string, actor: Actor, clientId: string, archived: boolean): Promise<Result> {
  const c = await clientRow(admin, orgId, clientId);
  if (!c) return fail("That client isn't in this organization.");
  if (Boolean(c.archived_at) === archived) return { ok: true, message: "Nothing changed." };
  const { error } = await admin.from("clients").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", clientId).eq("organization_id", orgId);
  if (error) return fail("Couldn't change the client. Try again.");
  await audit(admin, orgId, actor.userId, archived ? "client.archive" : "client.restore", c.name, { client_id: clientId });
  return { ok: true, message: archived ? `${c.name} archived. Its data is kept; restore it any time.` : `${c.name} restored.` };
}

/**
 * Sets which team members and viewers can open a client (and their client role). Organization owners and admins
 * aren't listed: they reach every client. A client owner role is changed or removed by organization owners only.
 */
export async function setClientAccess(admin: SupabaseClient, orgId: string, actor: Actor, clientId: string, entries: { userId: string; role: ClientRole }[]): Promise<Result> {
  const c = await clientRow(admin, orgId, clientId);
  if (!c) return fail("That client isn't in this organization.");
  const { data: members, error: mErr } = await admin.from("organization_members").select("user_id, role").eq("organization_id", orgId);
  if (mErr) return fail("Couldn't read the members of this organization.");
  const orgRole = new Map((members ?? []).map((m) => [m.user_id as string, m.role as OrgRole]));
  if (entries.some((e) => !orgRole.has(e.userId) || reachesAllClients(orgRole.get(e.userId)))) return fail("Only team members and viewers of this organization can be given access to a client.");
  const { data: rows, error: rErr } = await admin.from("client_members").select("user_id, role").eq("client_id", clientId);
  if (rErr) return fail("Couldn't read who can open this client.");
  // only team members' and viewers' rows are managed here
  const have = new Map((rows ?? []).filter((r) => { const o = orgRole.get(r.user_id as string); return o === "member" || o === "viewer"; })
    .map((r) => [r.user_id as string, r.role as ClientRole]));
  const want = new Map(entries.map((e) => [e.userId, allowedClientRole(e.role, orgRole.get(e.userId)!, actor.role)]));
  const ownerLocked = (id: string) => have.get(id) === "owner" && actor.role !== "owner";
  const removed = [...have.keys()].filter((id) => !want.has(id) && !ownerLocked(id));
  const upserts = [...want].filter(([id, r]) => have.get(id) !== r && !ownerLocked(id)).map(([user_id, role]) => ({ client_id: clientId, user_id, role }));
  for (const part of chunks(removed)) {
    const { error } = await admin.from("client_members").delete().eq("client_id", clientId).in("user_id", part);
    if (error) return fail("Couldn't save who can open this client. Try again.");
  }
  if (upserts.length) {
    const { error } = await admin.from("client_members").upsert(upserts, { onConflict: "client_id,user_id" });
    if (error) return fail("Couldn't save who can open this client. Try again.");
  }
  if (!removed.length && !upserts.length) return { ok: true, message: "Nothing changed." };
  const added = upserts.filter((u) => !have.has(u.user_id)).length;
  await audit(admin, orgId, actor.userId, "client.access", c.name, { client_id: clientId, added, changed: upserts.length - added, removed: removed.length });
  return { ok: true, message: "Access saved." };
}
