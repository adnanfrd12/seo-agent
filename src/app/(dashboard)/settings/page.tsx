import { PageHeader } from "@/components/dashboard/page-header";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import { DeleteWorkspace } from "./delete-workspace";
import { Card, ClientForm, PasswordForm, ProfileForm, TeamManager, type Member } from "./settings-forms";

export default async function SettingsPage() {
  const { user, client } = await getSession();
  if (!client) return null;
  const supabase = await createClient();
  const { data: members } = await supabase.rpc("get_client_members", { p_client_id: client.id });
  const canEdit = ["owner", "admin"].includes(client.role);
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <div>
      <PageHeader title="Settings" />
      {/* two columns on wide screens: your account on the left, the team and client on the right */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="min-w-0 space-y-6">
        <Card title="Profile">
          <ProfileForm userId={user.id} email={user.email} fullName={user.fullName} avatarUrl={user.avatarUrl} />
        </Card>
        <Card title="Password">
          <PasswordForm email={user.email} />
        </Card>
        </div>
        <div className="min-w-0 space-y-6">
        <Card title="Team" description="People with access to this client.">
          <TeamManager members={(members ?? []) as Member[]} meId={user.id} myRole={client.role} />
        </Card>
        <Card title="Client" description={`Settings for ${client.name}.`}>
          <ClientForm name={client.name} timezone={client.timezone} defaultRangeDays={client.defaultRangeDays}
            canEdit={canEdit} timezones={timezones} />
        </Card>
        {client.role === "owner" && (
          <Card title="Delete workspace" description="Close this client's workspace and delete its data (Privacy Policy, section 7).">
            <DeleteWorkspace name={client.name} />
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
