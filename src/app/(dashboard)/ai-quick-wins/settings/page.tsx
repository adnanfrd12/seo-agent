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
      <PageHeader title="AI and data settings" description="Claude model, effort and budgets, the nightly run, DataForSEO features and the business facts Claude writes with. API keys stay in the server's environment, never in the browser or the database." />
      <Grid>
        <Card title="Test connections" sub="Every data source, the DataForSEO login and a tiny Claude request that must answer “ok”." span={7}><TestConnections canEdit={canEdit} /></Card>
        <Card title="Import data" sub="Re-sync Search Console and GA4 now and queue Bing, Clarity and Business Profile; then regenerate quick wins." span={5}><ImportData canEdit={canEdit} /></Card>
        <Card title="AI and data" sub={`Settings for ${client.name}.`}><AiSettingsForm initial={settings} canEdit={canEdit} defaults={{ name: nap?.name ?? "", phone: nap?.phone ?? "", towns: [nap?.city, nap?.state].filter(Boolean).join(", ") }} /></Card>
      </Grid>
    </>
  );
}
