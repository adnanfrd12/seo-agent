import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PlatformConsole, type PlatformOrg } from "@/components/org/platform-console";
import { Note } from "@/components/org/section";
import { getSession } from "@/lib/analytics/client-context";
import { pageOptions } from "@/lib/org/pages";
import { isPlatformAdmin } from "@/lib/org/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Platform" };

/** Every row of a small platform table, read in pages of 1,000. */
async function all<T>(admin: SupabaseClient, table: string, cols: string, open = false): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from(table).select(cols);
    if (open) q = q.is("accepted_at", null).is("revoked_at", null);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`Couldn't read ${table}.`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

type OrgRow = { id: string; name: string; created_at: string; enabled_pages: string[] | null };
type MemberRow = { organization_id: string; role: string; status: string };
type ClientRow = { organization_id: string; archived_at: string | null };
type InviteRow = { id: string; organization_id: string; email: string; role: string; expires_at: string };

/** One line per organization: members, owners, clients, page access and open owner invitations. */
function summarize(orgs: OrgRow[], members: MemberRow[], clients: ClientRow[], invites: InviteRow[]): PlatformOrg[] {
  const now = Date.now();
  return [...orgs].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((o) => {
    const m = members.filter((x) => x.organization_id === o.id && x.status === "active");
    const c = clients.filter((x) => x.organization_id === o.id);
    return {
      id: o.id, name: o.name, createdAt: o.created_at, enabledPages: o.enabled_pages ?? null,
      members: m.length, owners: m.filter((x) => x.role === "owner").length,
      clients: c.filter((x) => !x.archived_at).length, archived: c.filter((x) => x.archived_at).length,
      ownerInvites: invites.filter((i) => i.organization_id === o.id && i.role === "owner")
        .map((i) => ({ id: i.id, email: i.email, expiresAt: i.expires_at, expired: Date.parse(i.expires_at) <= now })),
    };
  });
}

/** Settings → Platform: platform administrators only (platform_admins), whatever their organization role. */
export default async function PlatformPage() {
  const { user } = await getSession();
  const admin = createAdminClient();
  if (!(await isPlatformAdmin(admin, user.id))) return <Note>Only platform administrators can open this page.</Note>;

  const [orgs, members, clients, invites] = await Promise.all([
    all<OrgRow>(admin, "organizations", "id, name, created_at, enabled_pages"),
    all<MemberRow>(admin, "organization_members", "organization_id, role, status"),
    all<ClientRow>(admin, "clients", "organization_id, archived_at"),
    all<InviteRow>(admin, "organization_invitations", "id, organization_id, email, role, expires_at", true),
  ]);
  const rows = summarize(orgs, members, clients, invites);
  return <PlatformConsole orgs={rows} options={pageOptions()} />;
}
