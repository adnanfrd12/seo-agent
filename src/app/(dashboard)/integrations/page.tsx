import { PageHeader } from "@/components/dashboard/page-header";
import { IntegrationCard, type ProviderStatus } from "@/components/integrations/integration-card";
import { getSession } from "@/lib/analytics/client-context";
import { gbpConfigured } from "@/lib/google/oauth";
import { ConnectClarity, ReviewForm } from "../clarity/clarity-forms";
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
  const { data: clarity } = await supabase.from("integration_connections").select("status, last_synced_at, last_error")
    .eq("client_id", client.id).eq("provider", "clarity").maybeSingle();
  const clarityConnected = clarity?.status === "connected";

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
          <IntegrationCard key={p} provider={p} status={status[p] ?? EMPTY} canEdit={canEdit} available={p !== "gbp" || gbpConfigured()} />
        ))}
      </div>
      <section className="mt-4 rounded-xl border border-border bg-surface p-5" aria-labelledby="clarity-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="clarity-title" className="text-base font-semibold">Microsoft Clarity</h2>
          <span className={clarityConnected ? "text-sm font-medium text-positive" : "text-sm text-muted"}>{clarityConnected ? "Connected" : "Not connected"}</span>
        </div>
        {clarity?.last_synced_at && <p className="mt-1 text-xs text-muted">Last synced {new Date(clarity.last_synced_at).toLocaleString()}</p>}
        {clarity?.last_error && <p role="alert" className="mt-1 text-sm text-negative">{clarity.last_error}</p>}
        <div className="mt-3"><ConnectClarity connected={clarityConnected} canEdit={canEdit} /></div>
        <p className="mt-3 text-xs text-muted">
          Clarity&apos;s official Data Export API returns only the last 1–3 days (10 requests per project per day), so the dashboard stores one day per
          daily sync and builds history over time. There is no official API for session recordings, so recording insights come from the reviewer
          observations below. Data is shown on the <a href="/clarity" className="text-accent hover:underline">Microsoft Clarity</a> page.
        </p>
      </section>
      <section className="mt-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-base font-semibold">Clarity recording reviews</h2>
        <p className="mt-1 text-sm text-muted">
          Watch recordings in Clarity (filter by rage or dead clicks), then log what you saw. The AI analysis uses these as human observations;
          it never claims to have watched a recording itself.
        </p>
        <div className="mt-4"><ReviewForm /></div>
      </section>
    </>
  );
}
