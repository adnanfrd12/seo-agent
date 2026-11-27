import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession } from "@/lib/analytics/client-context";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Organization permissions, checked on the server for every organization action (row-level security checks reads
 * as well). Roles, highest first: owner, admin, member, viewer.
 *  - owner: everything, including credentials (integration secrets), owners and deleting the organization
 *  - admin: settings, branding, members (not owners), clients and client access; never credentials
 *  - member: the clients they're given (client role decides edit or view)
 *  - viewer: read-only on the clients they're given
 */
export type OrgRole = "owner" | "admin" | "member" | "viewer";
export const ORG_ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];
const RANK: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };
export const outranks = (a: OrgRole, b: OrgRole) => RANK[a] > RANK[b];

export const can = {
  manageCredentials: (r: OrgRole | null) => r === "owner",
  manageSettings: (r: OrgRole | null) => r === "owner" || r === "admin",
  manageMembers: (r: OrgRole | null) => r === "owner" || r === "admin",
  manageClients: (r: OrgRole | null) => r === "owner" || r === "admin",
  viewAudit: (r: OrgRole | null) => r === "owner" || r === "admin",
};

export interface OrgContext { admin: SupabaseClient; userId: string; orgId: string; role: OrgRole; isPlatformAdmin: boolean }

export class PermissionError extends Error { constructor(message: string) { super(message); this.name = "PermissionError"; } }

/** The signed-in user's active role in an organization (null if not an active member). */
export async function roleIn(admin: SupabaseClient, orgId: string, userId: string): Promise<OrgRole | null> {
  const { data } = await admin.from("organization_members").select("role, status").eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  return data && data.status === "active" ? (data.role as OrgRole) : null;
}

export async function isPlatformAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

/**
 * Resolves the organization for an action and checks the user's role there. `orgId` defaults to the organization
 * of the active client. Throws PermissionError with a user-facing message.
 */
export async function requireOrg(check: (r: OrgRole | null) => boolean, orgId?: string, message = "You don't have permission to do that in this organization."): Promise<OrgContext> {
  const { user, organization } = await getSession();
  const id = orgId ?? organization?.id;
  if (!id) throw new PermissionError("Choose an organization first.");
  const admin = createAdminClient();
  const [role, platform] = await Promise.all([roleIn(admin, id, user.id), isPlatformAdmin(admin, user.id)]);
  if (!check(role)) throw new PermissionError(message);
  return { admin, userId: user.id, orgId: id, role: role!, isPlatformAdmin: platform };
}

/**
 * Guards a role change or removal by `actor` on `target`:
 * - nobody changes their own role (no self-escalation or accidental self-demotion)
 * - only owners grant or take away the owner role, or change/remove an owner
 * - an admin can't make anyone admin above themselves… admins may assign admin/member/viewer only
 * - the last active owner can't be demoted, deactivated or removed
 */
export async function guardMemberChange(admin: SupabaseClient, orgId: string, actor: { userId: string; role: OrgRole }, targetUserId: string, next: { role?: OrgRole; remove?: boolean; deactivate?: boolean }): Promise<string | null> {
  if (targetUserId === actor.userId && (next.role || next.remove || next.deactivate)) return "You can't change your own role or access. Ask another owner.";
  const targetRole = await roleIn(admin, orgId, targetUserId);
  const { data: row } = await admin.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", targetUserId).maybeSingle();
  const current = (targetRole ?? row?.role ?? null) as OrgRole | null;
  if (actor.role !== "owner") {
    if (current === "owner") return "Only an owner can change or remove another owner.";
    if (next.role === "owner") return "Only an owner can make someone an owner.";
  }
  // only an ACTIVE owner counts towards "the last owner" (removing a deactivated owner leaves the active ones)
  if (targetRole === "owner" && (next.remove || next.deactivate || (next.role && next.role !== "owner"))) {
    const { count } = await admin.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", orgId).eq("role", "owner").eq("status", "active");
    if ((count ?? 0) <= 1) return "An organization needs at least one owner. Make someone else an owner first.";
  }
  return null;
}
