import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { memo } from "@/lib/memo";
import { firstAllowedHref, pageAllowed } from "@/lib/org/pages";
import { createClient } from "@/lib/supabase/server";

export const ACTIVE_CLIENT_COOKIE = "sa_client";
/** The path being rendered, set by the proxy on every request (so pages can be gated on soft navigations too). */
export const PATH_HEADER = "x-sa-path";

export interface CurrentClient {
  id: string;
  name: string;
  timezone: string;
  defaultRangeDays: number;
  /** owner | admin | viewer for this client (an organization owner/admin is owner/admin of every client in it) */
  role: string;
  organizationId: string;
}

export interface CurrentOrganization {
  id: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
  /** dashboard pages this organization may use, set by platform super-admins (null = every page) */
  enabledPages: string[] | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

type ClientRow = { id: string; name: string; timezone: string; default_range_days: number; organization_id: string };
const RANK: Record<string, number> = { viewer: 1, admin: 2, owner: 3 };

/**
 * The signed-in user (with profile), every client they belong to, and the active client: the one
 * named by the sa_client cookie if the user is still a member of it, otherwise their first.
 * The cookie is only a preference; membership is always re-checked here (and by RLS).
 */
export const getSession = cache(async () => {
  const supabase = await createClient();
  // getClaims verifies the signed session token locally (the proxy already refreshed it), so no round trip to Supabase Auth
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) redirect("/login");
  const user = { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };

  // memberships and profile change rarely: reused for a minute (RLS still checks every data read)
  const [{ memberships, orgs, visible, profile }, cookieStore] = await Promise.all([
    memo(`session|${user.id}`, 60_000, async () => {
      const [m, o, v, p] = await Promise.all([
        supabase.from("client_members").select("client_id, role, created_at").eq("user_id", user.id).order("created_at"),
        supabase.from("organization_members").select("role, status, organizations(id, name, enabled_pages)").eq("user_id", user.id).eq("status", "active"),
        // every client the user can reach (RLS: organization owner/admin, or a client_members row), not archived
        supabase.from("clients").select("id, name, timezone, default_range_days, organization_id, created_at").is("archived_at", null).order("created_at"),
        supabase.from("profiles").select("full_name, avatar_url").eq("user_id", user.id).maybeSingle(),
      ]);
      if (m.error) throw m.error;
      if (v.error) throw v.error;
      return { memberships: m.data, orgs: o.data ?? [], visible: v.data as (ClientRow & { created_at: string })[], profile: p.data };
    }),
    cookies(),
  ]);

  const organizations: CurrentOrganization[] = orgs.flatMap((r) => {
    const o = (Array.isArray(r.organizations) ? r.organizations[0] : r.organizations) as { id: string; name: string; enabled_pages: string[] | null } | null;
    return o ? [{ id: o.id, name: o.name, role: r.role as CurrentOrganization["role"], enabledPages: o.enabled_pages ?? null }] : [];
  });
  const orgRole = new Map(organizations.map((o) => [o.id, o.role]));
  const clientRole = new Map((memberships ?? []).map((m) => [m.client_id as string, m.role as string]));
  const clients: CurrentClient[] = visible.flatMap((c) => {
    // the higher of the organization-wide role (owner/admin) and the client's own role
    const viaOrg = orgRole.get(c.organization_id);
    const candidates = [viaOrg === "owner" || viaOrg === "admin" ? viaOrg : null, clientRole.get(c.id) ?? null].filter((r): r is string => Boolean(r));
    const role = candidates.sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0];
    return role ? [{ id: c.id, name: c.name, timezone: c.timezone, defaultRangeDays: c.default_range_days, role, organizationId: c.organization_id }] : [];
  });
  const wanted = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value;
  const client = clients.find((c) => c.id === wanted) ?? clients[0] ?? null;

  const me: CurrentUser = {
    id: user.id,
    email: user.email,
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
  };
  const organization = client ? organizations.find((o) => o.id === client.organizationId) ?? null : organizations[0] ?? null;

  // Pages the organization can't use (platform super-admins decide, Settings → Platform): every dashboard page,
  // and every server action posted from one, reads the session here, so a turned-off page sends people to the
  // first page they may use, on full loads and soft navigations alike (layouts don't re-render on navigation).
  if (organization?.enabledPages) {
    const path = (await headers()).get(PATH_HEADER);
    if (path && !pageAllowed(organization.enabledPages, path)) redirect(firstAllowedHref(organization.enabledPages));
  }
  return { user: me, client, clients, organizations, organization };
});
