import { Freshness, type FreshRow } from "@/components/charts/ops-charts";
import { PageHeader } from "@/components/dashboard/page-header";
import { IntegrationCard, type ProviderStatus } from "@/components/integrations/integration-card";
import { getSession } from "@/lib/analytics/client-context";
import { gbpConfigured } from "@/lib/google/oauth";
import { ConnectClarity, ReviewForm } from "../clarity/clarity-forms";
import { LbmPanel } from "./lbm-panel";
import { LbmBulkSetup } from "./lbm-bulk";
import { BingPanel } from "./bing-panel";
import { DataForSeoCard } from "./dataforseo-card";
import { ScheduledJobs } from "./scheduled-jobs";
import { PROVIDER_META, type ProviderId } from "@/lib/integrations/providers";
import { createClient } from "@/lib/supabase/server";

// bulk client setup runs inside a server action on this page
export const maxDuration = 300;

const ORDER: ProviderId[] = ["ga4", "gsc", "gbp"];
const EMPTY: ProviderStatus = { connection: null, resources: [], last_job: null, syncing: false };
const hoursSince = (iso: string | null | undefined) => (iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000) : null);

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

  // Local Brand Manager: Business Profile locations synced through LBM's API instead of Google OAuth
  const { data: lbm } = await supabase.from("integration_connections").select("id, status, last_synced_at, last_error")
    .eq("client_id", client.id).eq("provider", "lbm").maybeSingle();
  const lbmConnected = lbm?.status === "connected";
  const { data: lbmResources } = lbm
    ? await supabase.from("integration_resources").select("id, display_name, is_selected, metadata").eq("connection_id", lbm.id)
    : { data: [] };
  const lbmSelected = (lbmResources ?? []).filter((r) => r.is_selected)
    .map((r) => ({ lbmId: String((r.metadata as { lbm_id?: string })?.lbm_id ?? ""), name: r.display_name ?? "" }));
  // Bing Webmaster Tools (API key)
  const { data: bing } = await supabase.from("integration_connections").select("id, status, last_synced_at, last_error")
    .eq("client_id", client.id).eq("provider", "bing").maybeSingle();
  const bingConnected = bing?.status === "connected";
  const { data: bingResources } = bing
    ? await supabase.from("integration_resources").select("external_id, is_selected").eq("connection_id", bing.id)
    : { data: [] };
  const bingSelected = (bingResources ?? []).filter((r) => r.is_selected).map((r) => r.external_id);
  const siteHints = [...(status.gsc?.resources ?? []).map((r) => r.external_id.replace(/^sc-domain:/, "")), ...(status.ga4?.resources ?? []).map((r) => r.display_name ?? "")];

  // keep LBM-sourced locations out of the Google OAuth card
  const lbmIds = new Set((lbmResources ?? []).map((r) => r.id));
  if (status.gbp) status.gbp = { ...status.gbp, resources: status.gbp.resources.filter((r) => !lbmIds.has(r.id)) };

  // how fresh each connected source is (connected or failing; never-connected sources are left out)
  const fresh: FreshRow[] = [
    ...ORDER.filter((p) => status[p]?.connection && status[p]!.connection!.status !== "disconnected").map((p) => {
      const c = status[p]!.connection!;
      return { label: PROVIDER_META[p].label, hours: hoursSince(c.last_synced_at), failed: c.status === "error" || status[p]!.last_job?.status === "failed", detail: c.last_error ?? undefined };
    }),
    ...([["Bing Webmaster Tools", bing], ["Local Brand Manager", lbm], ["Microsoft Clarity", clarity]] as const)
      .filter(([, c]) => c && c.status !== "disconnected")
      .map(([label, c]) => ({ label, hours: hoursSince(c!.last_synced_at), failed: c!.status === "error", detail: c!.last_error ?? undefined })),
  ];

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
      {fresh.length > 0 && <div className="mt-4"><Freshness title="Data freshness" sub="Time since each connected source last synced · Search Console and Business Profile data itself lags a few days" rows={fresh} /></div>}
      {canEdit && <ScheduledJobs />}
      <DataForSeoCard canEdit={canEdit} clientId={client.id} />
      <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="bing-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="bing-title" className="text-base font-semibold">Bing Webmaster Tools</h2>
            <p className="text-sm text-muted">Bing search clicks, impressions, queries, pages, positions, crawl health, sitemaps and keyword volumes.</p>
          </div>
          <span className={bingConnected ? "text-sm font-medium text-positive" : "text-sm text-muted"}>{bingConnected ? "Connected" : "Not connected"}</span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Tracking</dt><dd className="truncate">{bingSelected.length ? bingSelected.join(", ") : "Nothing selected"}</dd>
          <dt className="text-muted">Last sync</dt><dd>{bing?.last_synced_at ? new Date(bing.last_synced_at).toLocaleString() : "Never"}</dd>
        </dl>
        {bing?.last_error && bingConnected && <p role="alert" className="mt-2 text-sm text-negative">{bing.last_error}</p>}
        <div className="mt-3">
          <BingPanel connected={bingConnected} canEdit={canEdit} hasEnvKey={Boolean(process.env.BING_WEBMASTER_API_KEY?.trim())} selected={bingSelected} suggest={siteHints} />
        </div>
        <p className="mt-3 text-xs text-muted">
          Bing serves about 16 months of daily clicks and impressions and weekly query and page statistics; each daily sync refreshes all of it.
          Data appears on the <a href="/bing" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Bing Webmaster</a> page, the Overview and the PDF report.
        </p>
      </section>
      <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="lbm-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="lbm-title" className="text-base font-semibold">Local Brand Manager</h2>
            <p className="text-sm text-muted">Google Business Profile performance, search keywords, reviews and geogrid rankings through Local Brand Manager&apos;s API.</p>
          </div>
          <span className={lbmConnected ? "text-sm font-medium text-positive" : "text-sm text-muted"}>{lbmConnected ? "Connected" : "Not connected"}</span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Tracking</dt><dd className="truncate">{lbmSelected.length ? lbmSelected.map((s) => s.name).join(", ") : "Nothing selected"}</dd>
          <dt className="text-muted">Last sync</dt><dd>{lbm?.last_synced_at ? new Date(lbm.last_synced_at).toLocaleString() : "Never"}</dd>
        </dl>
        {lbm?.last_error && lbmConnected && <p role="alert" className="mt-2 text-sm text-negative">{lbm.last_error}</p>}
        <div className="mt-3">
          <LbmPanel connected={lbmConnected} canEdit={canEdit} hasEnvToken={Boolean(process.env.LOCAL_BRAND_MANAGER_API_TOKEN?.trim())} selected={lbmSelected} />
        </div>
        {canEdit && (lbmConnected || process.env.LOCAL_BRAND_MANAGER_API_TOKEN?.trim()) && (
          <div className="mt-4 border-t border-border pt-4"><LbmBulkSetup /></div>
        )}
        <p className="mt-3 text-xs text-muted">
          Local Brand Manager serves the most recent ~25 days of daily metrics and the latest months of keywords, so history builds up with each daily sync.
          Data appears on the <a href="/business-profile" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Google Business Profile</a> page, the Overview and the PDF report.
        </p>
      </section>
      <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="clarity-title">
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
          observations below. Data is shown on the <a href="/clarity" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Microsoft Clarity</a> page.
        </p>
      </section>
      <section className="mt-4 rounded-[10px] border border-border bg-surface p-5">
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
