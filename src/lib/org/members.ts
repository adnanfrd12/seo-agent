import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./credentials";
import { guardMemberChange, type OrgRole } from "./permissions";

/**
 * Organization members: the directory (with sign-in emails), role and status changes, removal and per-client access.
 * Callers have checked that the actor may manage members (requireOrg(can.manageMembers)); the rules about owners
 * and oneself are enforced here through guardMemberChange. Every change is written to the audit log.
 *
 * Client roles (client_members) stay owner / admin / viewer. Organization owners and admins reach every client of
 * the organization anyway; team members and viewers reach the clients they're given, and viewers only ever as viewer.
 */
export type ClientRole = "owner" | "admin" | "viewer";
export const CLIENT_ROLES: ClientRole[] = ["owner", "admin", "viewer"];
export type MemberStatus = "active" | "deactivated";
export type Result = { ok: true; message?: string } | { ok: false; error: string };
export interface Actor { userId: string; role: OrgRole }

export interface DirectoryUser { userId: string; email: string; fullName: string | null; avatarUrl: string | null }
export interface OrgMember extends DirectoryUser {
  role: OrgRole;
  status: MemberStatus;
  joinedAt: string;
  lastSignInAt: string | null;
  /** explicit client access (owners and admins reach every client without it) */
  clients: { id: string; role: ClientRole }[];
}
export interface AccessEntry { clientId: string; role: ClientRole }

const fail = (error: string): Result => ({ ok: false, error });
/** splits long id lists so filters stay well inside URL limits */
export const chunks = <T,>(xs: T[], n = 100): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
export const reachesAllClients = (r: OrgRole | null | undefined) => r === "owner" || r === "admin";
/** viewers only view; the client "owner" role (it can delete the workspace) is granted by organization owners only */
export function allowedClientRole(want: ClientRole, memberRole: OrgRole, actorRole: OrgRole): ClientRole {
  if (memberRole === "viewer") return "viewer";
  if (want === "owner" && actorRole !== "owner") return "admin";
  return want;
}

/** Names and emails of users (audit actors, inviters), whether or not they're still members. */
export async function userDirectory(admin: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, DirectoryUser>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const { data, error } = await admin.rpc("user_directory", { p_ids: unique });
  if (error) throw new Error("Couldn't read the user directory.");
  return new Map((data ?? []).map((r: { user_id: string; email: string; full_name: string | null; avatar_url: string | null }) =>
    [r.user_id, { userId: r.user_id, email: r.email, fullName: r.full_name, avatarUrl: r.avatar_url }]));
}

type AccessRow = { client_id: string; user_id: string; role: ClientRole };

/** client_members rows of this organization's clients (optionally one user's), read in pages of 1,000. */
export async function orgClientAccess(admin: SupabaseClient, orgId: string, userId?: string): Promise<AccessRow[]> {
  const out: AccessRow[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from("client_members").select("client_id, user_id, role, clients!inner(organization_id)").eq("clients.organization_id", orgId);
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q.order("client_id").order("user_id").range(from, from + 999);
    if (error) throw new Error("Couldn't read client access.");
    out.push(...(data ?? []).map((r) => ({ client_id: r.client_id as string, user_id: r.user_id as string, role: r.role as ClientRole })));
    if (!data || data.length < 1000) return out;
  }
}

export async function listMembers(admin: SupabaseClient, orgId: string): Promise<OrgMember[]> {
  const [{ data, error }, access] = await Promise.all([admin.rpc("org_member_directory", { p_org: orgId }), orgClientAccess(admin, orgId)]);
  if (error) throw new Error("Couldn't read the members of this organization.");
  const byUser = new Map<string, { id: string; role: ClientRole }[]>();
  for (const a of access) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), { id: a.client_id, role: a.role }]);
  return (data ?? []).map((r: { user_id: string; email: string; full_name: string | null; avatar_url: string | null; role: OrgRole; status: MemberStatus; created_at: string; last_sign_in_at: string | null }) => ({
    userId: r.user_id, email: r.email, fullName: r.full_name, avatarUrl: r.avatar_url, role: r.role, status: r.status,
    joinedAt: r.created_at, lastSignInAt: r.last_sign_in_at, clients: byUser.get(r.user_id) ?? [],
  }));
}

/** Ids of every client of the organization (archived ones too), read in pages of 1,000. */
export async function orgClientIds(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("clients").select("id").eq("organization_id", orgId).order("id").range(from, from + 999);
    if (error) throw new Error("Couldn't read the clients of this organization.");
    for (const r of data ?? []) out.add(r.id as string);
    if (!data || data.length < 1000) return out;
  }
}

async function memberRow(admin: SupabaseClient, orgId: string, userId: string) {
  const { data } = await admin.from("organization_members").select("role, status").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  return data as { role: OrgRole; status: MemberStatus } | null;
}
async function emailOf(admin: SupabaseClient, userId: string) {
  return (await userDirectory(admin, [userId])).get(userId)?.email ?? null;
}

export async function changeMemberRole(admin: SupabaseClient, orgId: string, actor: Actor, userId: string, role: OrgRole): Promise<Result> {
  const row = await memberRow(admin, orgId, userId);
  if (!row) return fail("That person isn't a member of this organization.");
  if (row.role === role) return { ok: true, message: "Nothing changed." };
  const blocked = await guardMemberChange(admin, orgId, actor, userId, { role });
  if (blocked) return fail(blocked);
  const { error } = await admin.from("organization_members").update({ role }).eq("organization_id", orgId).eq("user_id", userId);
  if (error) return fail("Couldn't change the role. Try again.");
  if (role === "viewer") {
    // a viewer only views: their client roles in this organization become viewer
    const ids = (await orgClientAccess(admin, orgId, userId)).filter((a) => a.role !== "viewer").map((a) => a.client_id);
    for (const part of chunks(ids)) await admin.from("client_members").update({ role: "viewer" }).eq("user_id", userId).in("client_id", part);
  }
  await audit(admin, orgId, actor.userId, "member.role", await emailOf(admin, userId), { user_id: userId, from: row.role, to: role });
  return { ok: true, message: "Role changed." };
}

export async function setMemberStatus(admin: SupabaseClient, orgId: string, actor: Actor, userId: string, status: MemberStatus): Promise<Result> {
  const row = await memberRow(admin, orgId, userId);
  if (!row) return fail("That person isn't a member of this organization.");
  if (row.status === status) return { ok: true, message: "Nothing changed." };
  const blocked = await guardMemberChange(admin, orgId, actor, userId, status === "deactivated" ? { deactivate: true } : {});
  if (blocked) return fail(blocked);
  if (userId === actor.userId) return fail("You can't change your own access. Ask another owner.");
  const { error } = await admin.from("organization_members").update({ status }).eq("organization_id", orgId).eq("user_id", userId);
  if (error) return fail("Couldn't change their access. Try again.");
  await audit(admin, orgId, actor.userId, status === "deactivated" ? "member.deactivate" : "member.activate", await emailOf(admin, userId), { user_id: userId });
  return { ok: true, message: status === "deactivated" ? "Deactivated: they can't open this organization's clients until reactivated." : "Reactivated." };
}

/** Removes someone from the organization and from its clients. Their account and other organizations are untouched. */
export async function removeMember(admin: SupabaseClient, orgId: string, actor: Actor, userId: string): Promise<Result> {
  const row = await memberRow(admin, orgId, userId);
  if (!row) return fail("That person isn't a member of this organization.");
  const blocked = await guardMemberChange(admin, orgId, actor, userId, { remove: true });
  if (blocked) return fail(blocked);
  const email = await emailOf(admin, userId);
  // client access first: a client_members row alone would still grant access to that client
  const ids = (await orgClientAccess(admin, orgId, userId)).map((a) => a.client_id);
  for (const part of chunks(ids)) {
    const { error } = await admin.from("client_members").delete().eq("user_id", userId).in("client_id", part);
    if (error) return fail("Couldn't remove their client access. Try again.");
  }
  const { error } = await admin.from("organization_members").delete().eq("organization_id", orgId).eq("user_id", userId);
  if (error) return fail("Couldn't remove them. Try again.");
  await audit(admin, orgId, actor.userId, "member.remove", email, { user_id: userId, role: row.role, clients: ids.length });
  return { ok: true, message: "Removed from the organization." };
}

/** Sets exactly which of this organization's clients a team member or viewer can open, and with which client role. */
export async function setMemberClientAccess(admin: SupabaseClient, orgId: string, actor: Actor, userId: string, entries: AccessEntry[]): Promise<Result> {
  const row = await memberRow(admin, orgId, userId);
  if (!row) return fail("That person isn't a member of this organization.");
  if (reachesAllClients(row.role)) return fail("Owners and admins reach every client of the organization.");
  const inOrg = await orgClientIds(admin, orgId);
  if (entries.some((e) => !inOrg.has(e.clientId))) return fail("Some of those clients aren't in this organization.");
  const want = new Map(entries.map((e) => [e.clientId, allowedClientRole(e.role, row.role, actor.role)]));
  const have = new Map((await orgClientAccess(admin, orgId, userId)).map((a) => [a.client_id, a.role]));
  // a client owner role is kept as it is unless an organization owner changes it
  const removed = [...have.keys()].filter((id) => !want.has(id) && (have.get(id) !== "owner" || actor.role === "owner"));
  const upserts = [...want].filter(([id, r]) => have.get(id) !== r && (have.get(id) !== "owner" || actor.role === "owner"))
    .map(([client_id, role]) => ({ client_id, user_id: userId, role }));
  for (const part of chunks(removed)) {
    const { error } = await admin.from("client_members").delete().eq("user_id", userId).in("client_id", part);
    if (error) return fail("Couldn't update their client access. Try again.");
  }
  if (upserts.length) {
    const { error } = await admin.from("client_members").upsert(upserts, { onConflict: "client_id,user_id" });
    if (error) return fail("Couldn't update their client access. Try again.");
  }
  if (!removed.length && !upserts.length) return { ok: true, message: "Nothing changed." };
  const added = upserts.filter((u) => !have.has(u.client_id)).length;
  await audit(admin, orgId, actor.userId, "member.client_access", await emailOf(admin, userId), { user_id: userId, added, changed: upserts.length - added, removed: removed.length });
  return { ok: true, message: "Client access saved." };
}

/* ------------------------------------------------------------------ adding people directly (email + password) */
export interface AddMemberInput { email: string; password: string; fullName: string; role: OrgRole; clientAccess: AccessEntry[] }

/**
 * Adds someone to the organization straight away, without an invitation: a new address gets an account with the
 * password given here (the person can change it under Settings → My account); an existing account is added as it
 * is and keeps its own password. `actor.platform`: a platform super-admin (may add any role to any organization).
 * Callers check the actor's permission first; the role rules (only owners add owners) are checked here too.
 */
export async function addMemberDirect(admin: SupabaseClient, orgId: string, actor: { userId: string; role: OrgRole | null; platform?: boolean }, input: AddMemberInput): Promise<Result> {
  const email = input.email.trim().toLowerCase();
  const actorRole: OrgRole = actor.platform ? "owner" : actor.role ?? "viewer";
  if (!actor.platform && !reachesAllClients(actor.role)) return fail("Only owners and admins can add people.");
  if (input.role === "owner" && actorRole !== "owner") return fail("Only an owner can add another owner.");

  let access: { client_id: string; role: ClientRole }[] = [];
  if (!reachesAllClients(input.role) && input.clientAccess.length) {
    const inOrg = await orgClientIds(admin, orgId);
    if (input.clientAccess.some((a) => !inOrg.has(a.clientId))) return fail("Some of those clients aren't in this organization.");
    access = [...new Map(input.clientAccess.map((a) => [a.clientId, allowedClientRole(a.role, input.role, actorRole)]))].map(([client_id, role]) => ({ client_id, role }));
  }

  const { data: found } = await admin.rpc("find_user_id_by_email", { p_email: email });
  let userId = (found as string | null) ?? null;
  const existed = Boolean(userId);
  if (userId) {
    const { data: m } = await admin.from("organization_members").select("status").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
    if (m?.status === "active") return fail(`${email} is already a member. Change their role or client access in the list.`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password: input.password, email_confirm: true, user_metadata: input.fullName ? { full_name: input.fullName } : undefined });
    if (error || !data.user) return fail(error && /password/i.test(error.message) ? error.message : "Couldn't create the account. Try again.");
    userId = data.user.id;
    if (input.fullName) await admin.from("profiles").upsert({ user_id: userId, full_name: input.fullName }, { onConflict: "user_id" });
  }

  const { error: memberError } = await admin.from("organization_members")
    .upsert({ organization_id: orgId, user_id: userId, role: input.role, status: "active" }, { onConflict: "organization_id,user_id" });
  if (memberError) return fail("Couldn't add them to the organization. Try again.");
  if (access.length) {
    await admin.from("client_members").upsert(access.map((a) => ({ ...a, user_id: userId, role: input.role === "viewer" ? "viewer" : a.role })), { onConflict: "client_id,user_id" });
  }
  await audit(admin, orgId, actor.userId, "member.add", email, { role: input.role, clients: access.length, new_account: !existed, ...(actor.platform && !actor.role ? { by: "platform" } : {}) });
  return {
    ok: true,
    message: existed
      ? `${email} already had an account: they're added as ${input.role} and sign in with their existing password.`
      : `${email} added as ${input.role}. They can sign in now with the password you set.`,
  };
}
