import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CLIENT_ROLE_LABEL, ROLE_LABEL, type ClientRoleId, type OrgRoleId } from "@/components/org/labels";
import { getSession } from "@/lib/analytics/client-context";
import { userDirectory } from "@/lib/org/members";
import { can } from "@/lib/org/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { DeleteWorkspace } from "./delete-workspace";
import { Card, ClientForm, ClientTeam, PasswordForm, ProfileForm, type TeamRow } from "./settings-forms";

/** Settings → My account: your profile and password, and the settings of the client you have open. */
export default async function SettingsPage() {
  const { user, client, organization } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const timezones = Intl.supportedValuesOf("timeZone");
  const team = await clientTeam(client.id, client.organizationId);
  const manage = organization && organization.id === client.organizationId && can.manageMembers(organization.role);

  return (
    // two columns on wide screens: your account on the left, the open client on the right
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-6">
        <Card title="Profile">
          <ProfileForm userId={user.id} email={user.email} fullName={user.fullName} avatarUrl={user.avatarUrl} />
        </Card>
        <Card title="Password">
          <PasswordForm email={user.email} />
        </Card>
        {organization && (
          <Card title="Organization" description={`${organization.name} · your role: ${ROLE_LABEL[organization.role]}.`}>
            <Link href="/settings/organization/general" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              Organization settings <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Card>
        )}
      </div>
      <div className="min-w-0 space-y-6">
        <Card title="Client" description={`Settings for ${client.name}.`}>
          <ClientForm name={client.name} timezone={client.timezone} defaultRangeDays={client.defaultRangeDays}
            canEdit={canEdit} timezones={timezones} />
        </Card>
        <Card title="Team" description={`People who can open ${client.name}.`}>
          <ClientTeam rows={team} meId={user.id} manageHref={manage ? "/settings/organization/clients" : null} />
        </Card>
        {client.role === "owner" && (
          <Card title="Delete workspace" description="Close this client's workspace and delete its data (Privacy Policy, section 7).">
            <DeleteWorkspace name={client.name} />
          </Card>
        )}
      </div>
    </div>
  );
}

/** Everyone who can open the client: the organization's owners and admins, then the people given this client. */
async function clientTeam(clientId: string, orgId: string): Promise<TeamRow[]> {
  const admin = createAdminClient();
  const [{ data: dir }, { data: rows }] = await Promise.all([
    admin.rpc("org_member_directory", { p_org: orgId }),
    admin.from("client_members").select("user_id, role").eq("client_id", clientId).order("created_at"),
  ]);
  type Dir = { user_id: string; email: string; full_name: string | null; avatar_url: string | null; role: OrgRoleId; status: "active" | "deactivated" };
  const members = new Map(((dir ?? []) as Dir[]).map((m) => [m.user_id, m]));
  const out: TeamRow[] = [];
  for (const m of members.values()) {
    if (m.status === "active" && (m.role === "owner" || m.role === "admin")) {
      out.push({ userId: m.user_id, email: m.email, fullName: m.full_name, avatarUrl: m.avatar_url, label: `${ROLE_LABEL[m.role]} · all clients`, inactive: false });
    }
  }
  const listed = new Set(out.map((r) => r.userId));
  const others = (rows ?? []).filter((r) => !listed.has(r.user_id as string));
  const outside = await userDirectory(admin, others.filter((r) => !members.has(r.user_id as string)).map((r) => r.user_id as string));
  for (const r of others) {
    const m = members.get(r.user_id as string);
    const person = m ? { email: m.email, fullName: m.full_name, avatarUrl: m.avatar_url } : outside.get(r.user_id as string);
    if (!person) continue;
    const role = CLIENT_ROLE_LABEL[r.role as ClientRoleId] ?? r.role;
    out.push({
      userId: r.user_id as string, email: person.email, fullName: person.fullName, avatarUrl: person.avatarUrl,
      label: m ? `${ROLE_LABEL[m.role]} · ${role}` : role, inactive: m?.status === "deactivated",
    });
  }
  return out;
}
