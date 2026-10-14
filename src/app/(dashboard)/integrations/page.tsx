import { PageHeader } from "@/components/dashboard/page-header";
import { IntegrationCard, type ProviderStatus } from "@/components/integrations/integration-card";
import { getSession } from "@/lib/analytics/client-context";
import { PROVIDER_META, type ProviderId } from "@/lib/integrations/providers";
import { createClient } from "@/lib/supabase/server";

const ORDER: ProviderId[] = ["ga4", "gsc", "gbp"];
const EMPTY: ProviderStatus = { connection: null, resources: [], last_job: null, syncing: false };

export default async function IntegrationsPage({
  searchParams,
}: { searchParams: Promise<{ connected?: string; error?: string; notice?: string; provider?: string }> }) {
  const { client } = await getSession();
  const sp = await searchParams;
  if (!client) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_integration_status", { p_client_id: client.id });
  const status = (data ?? {}) as Partial<Record<ProviderId, ProviderStatus>>;
  const canEdit = ["owner", "admin"].includes(client.role);

  return (
    <>
      <PageHeader title="Integrations" description="Connect Google accounts once; data then syncs automatically." />
      {sp.connected && sp.connected in PROVIDER_META && (
        <p role="status" className="mb-4 rounded-lg bg-surface p-3 text-sm text-positive ring-1 ring-border">
          {PROVIDER_META[sp.connected as ProviderId].label} connected. Choose what to track below.
        </p>
      )}
      {sp.notice && (
        <p role="status" className="mb-4 rounded-lg bg-surface p-3 text-sm text-foreground ring-1 ring-border">
          {sp.notice.slice(0, 300)}
        </p>
      )}
      {sp.error && (
        <p role="alert" className="mb-4 rounded-lg bg-accent-soft p-3 text-sm text-negative">{sp.error.slice(0, 200)}</p>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-accent-soft p-3 text-sm text-negative">
          Could not load integration status.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {ORDER.map((p) => (
          <IntegrationCard key={p} provider={p} status={status[p] ?? EMPTY} canEdit={canEdit} />
        ))}
      </div>
    </>
  );
}
