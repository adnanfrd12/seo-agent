import { PageHeader } from "@/components/dashboard/page-header";
import { AiSettingsForm, ImportData, TestConnections } from "@/components/aiqw/settings-form";
import { Card, Grid } from "@/components/ga4x/ui";
import { getSession } from "@/lib/analytics/client-context";
import { clientNap } from "@/lib/reviews/listings";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSettings } from "@/lib/aiqw/settings";

export const maxDuration = 120;

export default async function AiQwSettingsPage() {
  const { client } = await getSession();
  if (!client) return null;
  const admin = createAdminClient();
  const [{ data }, nap] = await Promise.all([admin.from("clients").select("settings").eq("id", client.id).maybeSingle(), clientNap(admin, client.id).catch(() => null)]);
  const settings = readSettings(((data?.settings ?? {}) as Record<string, unknown>).ai_qw);
  const canEdit = ["owner", "admin"].includes(client.role);
  return (
    <>
      <PageHeader title="AI and data settings" description="Claude model, budgets, the nightly run and your business facts." />
      <Grid>
        <Card title="Test connections" sub="Checks every data source, DataForSEO and Claude." span={7}><TestConnections canEdit={canEdit} /></Card>
        <Card title="Import data" sub="Re-sync every source now, then regenerate quick wins." span={5}><ImportData canEdit={canEdit} /></Card>
        <Card title="AI and data" sub={`Settings for ${client.name}.`}><AiSettingsForm initial={settings} canEdit={canEdit} defaults={{ name: nap?.name ?? "", phone: nap?.phone ?? "", towns: [nap?.city, nap?.state].filter(Boolean).join(", ") }} /></Card>
      </Grid>
    </>
  );
}
