import { PageHeader } from "@/components/dashboard/page-header";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import { Card, ClientForm, PasswordForm, ProfileForm, TeamManager, type Member } from "./settings-forms";

export default async function SettingsPage() {
  const { user, client } = await getSession();
  if (!client) return null;
  const supabase = await createClient();
  const { data: members } = await supabase.rpc("get_client_members", { p_client_id: client.id });
  const canEdit = ["owner", "admin"].includes(client.role);
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Settings" description="Your profile, security, client preferences and team." />
      <div className="space-y-6">
        <Card title="Profile" description="Your name and photo appear in the header and team list.">
          <ProfileForm userId={user.id} email={user.email} fullName={user.fullName} avatarUrl={user.avatarUrl} />
        </Card>
        <Card title="Password" description="Confirm your current password to set a new one.">
          <PasswordForm email={user.email} />
        </Card>
        <Card title="Client" description={`Settings for ${client.name}.`}>
          <ClientForm name={client.name} timezone={client.timezone} defaultRangeDays={client.defaultRangeDays}
            canEdit={canEdit} timezones={timezones} />
        </Card>
        <Card title="Team" description="People who can sign in and see this client's analytics.">
          <TeamManager members={(members ?? []) as Member[]} meId={user.id} myRole={client.role} />
        </Card>
      </div>
    </div>
  );
}
