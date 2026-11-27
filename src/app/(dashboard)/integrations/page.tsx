import { KeyRound } from "lucide-react";
import { Freshness, type FreshRow } from "@/components/charts/ops-charts";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConsentPanel } from "@/components/integrations/consent-panel";
import { IntegrationCard, type ProviderStatus } from "@/components/integrations/integration-card";
import { CredentialCard } from "@/components/integrations/org/credential-card";
import { CustomVariables } from "@/components/integrations/org/custom-variables";
import { Filterable, FilterEmpty, IntegrationsFilterProvider, IntegrationsToolbar, type ToolbarCount } from "@/components/integrations/org/filter";
import { ImportEnvBanner } from "@/components/integrations/org/import-env-banner";
import { filterStatusOf, type FilterItem, type FilterStatus } from "@/components/integrations/org/types";
import { platformById } from "@/config/platforms";
import { getSession } from "@/lib/analytics/client-context";
import { PROVIDER_META, type ProviderId } from "@/lib/integrations/providers";
import { connectReadiness } from "@/lib/integrations/service";
import { brandName, getBranding } from "@/lib/org/branding";
import { orgConfig } from "@/lib/org/config";
import type { GuideContext } from "@/lib/org/guides";
import { can, isPlatformAdmin, roleIn } from "@/lib/org/permissions";
import { CATEGORIES, PLATFORM_ENV, type IntegrationCategory } from "@/lib/org/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ConnectClarity, ReviewForm } from "../clarity/clarity-forms";
import { BingPanel } from "./bing-panel";
import { ClaudeCard } from "./claude-card";
import { DataForSeoCard } from "./dataforseo-card";
import { LbmBulkSetup } from "./lbm-bulk";
import { LbmPanel } from "./lbm-panel";
import { loadOrgIntegrations } from "./org-data";
import { ScheduledJobs } from "./scheduled-jobs";

// bulk client setup runs inside a server action on this page
export const maxDuration = 300;

const ORDER: ProviderId[] = ["ga4", "gsc", "gbp"];
const EMPTY: ProviderStatus = { connection: null, resources: [], last_job: null, syncing: false };
const hoursSince = (iso: string | null | undefined) => (iso ? Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000) : null);
const link = "text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground";

/** setup guides as PDF (built by /api/org/guides; owners and admins of that organization) */
const pdfFor = (id: string, orgId: string) => `/api/org/guides/${id}.pdf?org=${encodeURIComponent(orgId)}`;
const FILTER_STATUSES: FilterStatus[] = ["configured", "partial", "missing"];
/** a client connection's state as the status filter sees it */
const connStatus = (s: string | null | undefined): FilterStatus => (s === "connected" ? "configured" : s === "error" ? "partial" : "missing");

/** Search text and category for the blocks that aren't registry cards (registry id → category for the chip counts). */
const BLOCKS = {
  ga4: { id: "ga4", category: "google", search: "google analytics 4 ga4 traffic leads engagement composio property" },
  gsc: { id: "gsc", category: "google", search: "google search console gsc clicks queries pages indexing composio site" },
  gbp: { id: "google_oauth", category: "google", search: "google business profile gbp oauth reviews posts locations maps performance" },
  bing: { id: "bing", category: "analytics", search: "bing webmaster tools api key crawl search performance keywords" },
  lbm: { id: "lbm", category: "seo", search: "local brand manager lbm business profile geogrid rankings reviews locations bulk" },
  clarity: { id: "clarity", category: "analytics", search: "microsoft clarity recordings rage clicks dead clicks javascript errors recording reviews" },
  freshness: { id: null, category: null, search: "data freshness last sync updated" },
  dataforseo: { id: "dataforseo", category: "seo", search: "dataforseo backlinks keywords research spend budget balance daily limit automatic refresh" },
  anthropic: { id: "anthropic", category: "ai", search: "anthropic claude ai nova spend budget model usage" },
  jobs: { id: null, category: null, search: "automatic updates scheduled jobs sync queue cron" },
} satisfies Record<string, FilterItem & { id: string | null }>;

function SectionHeading({ id, title, sub, children }: { id: string; title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
        {sub && <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-secondary">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: { searchParams: Promise<{ connected?: string; error?: string; notice?: string; provider?: string; q?: string; category?: string; status?: string }> }) {
  const { client, user, organization } = await getSession();
  const sp = await searchParams;
  if (!client) return null;

  const orgId = client.organizationId;
  const orgName = organization?.id === orgId ? organization.name : "this organization";
  const admin = createAdminClient();
  const supabase = await createClient();
  const connection = (provider: string) => supabase.from("integration_connections").select("id, status, last_synced_at, last_error")
    .eq("client_id", client.id).eq("provider", provider).maybeSingle();
  // the organization role is read fresh here (the session's copy can be a minute old); every action checks it again
  const [orgRole, platformAdmin, cfg, { data, error }, { data: clarity }, { data: lbm }, { data: bing }, readiness] = await Promise.all([
    roleIn(admin, orgId, user.id),
    isPlatformAdmin(admin, user.id),
    orgConfig(orgId).catch(() => null),
    supabase.rpc("get_integration_status", { p_client_id: client.id }),
    connection("clarity"),
    // Local Brand Manager: Business Profile locations synced through LBM's API instead of Google OAuth
    connection("lbm"),
    // Bing Webmaster Tools (API key)
    connection("bing"),
    // whether Connect can start for each Google provider, from the organization's settings (and what's missing if not)
    connectReadiness(client.id).catch(() => null),
  ]);
  const owner = can.manageCredentials(orgRole);
  const showOrg = can.manageSettings(orgRole);
  const has = (...keys: string[]) => Boolean(cfg?.has(...keys));
  const [orgData, branding, { data: lbmResources }, { data: bingResources }] = await Promise.all([
    showOrg ? loadOrgIntegrations(admin, orgId, { owner }) : null,
    showOrg ? getBranding(orgId).catch(() => null) : null,
    lbm ? supabase.from("integration_resources").select("id, external_id, display_name, is_selected, metadata").eq("connection_id", lbm.id) : { data: [] },
    bing ? supabase.from("integration_resources").select("external_id, is_selected").eq("connection_id", bing.id) : { data: [] },
  ]);

  const status = (data ?? {}) as Partial<Record<ProviderId, ProviderStatus>>;
  const canEdit = ["owner", "admin"].includes(client.role);
  // bulk client setup creates clients for the organization: its owners and admins, whatever their client role
  const orgManager = organization?.id === orgId && ["owner", "admin"].includes(organization.role);
  const guideContext: GuideContext = {
    appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "") || undefined,
    appName: branding ? brandName(branding) : undefined,
    orgName,
  };
  const clarityConnected = clarity?.status === "connected";
  const lbmConnected = lbm?.status === "connected";
  const lbmSelected = (lbmResources ?? []).filter((r) => r.is_selected)
    .map((r) => ({ lbmId: String((r.metadata as { lbm_id?: string })?.lbm_id ?? ""), name: r.display_name ?? "" }));
  const bingConnected = bing?.status === "connected";
  const bingSelected = (bingResources ?? []).filter((r) => r.is_selected).map((r) => r.external_id);
  const siteHints = [...(status.gsc?.resources ?? []).map((r) => r.external_id.replace(/^sc-domain:/, "")), ...(status.ga4?.resources ?? []).map((r) => r.display_name ?? "")];

  // keep LBM-sourced locations out of the Google OAuth card
  const lbmIds = new Set((lbmResources ?? []).map((r) => r.id));
  if (status.gbp) status.gbp = { ...status.gbp, resources: status.gbp.resources.filter((r) => !lbmIds.has(r.id)) };
  // Google locations also tracked through LBM: the Google data is used once it arrives (one source per location)
  const locId = (ext: string) => ext.replace(/^.*locations\//, "");
  const lbmTracked = new Set((lbmResources ?? []).filter((r) => r.is_selected).map((r) => locId(r.external_id)));
  const gbpNotes = Object.fromEntries((status.gbp?.resources ?? []).filter((r) => lbmTracked.has(locId(r.external_id)))
    .map((r) => [r.id, "Also tracked via Local Brand Manager"]));
  // a connection that already exists stays manageable (disconnect, sync) whatever the settings say
  const ready = (p: ProviderId) => readiness?.[p].ready !== false || Boolean(status[p]?.connection && status[p]!.connection!.status !== "disconnected");
  // Business Profile connects with the organization's own Google Cloud OAuth client
  const gbpApp = has("GOOGLE_GBP_CLIENT_ID", "GOOGLE_GBP_CLIENT_SECRET");

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

  /* ---------------------------------------------------------------- toolbar: counts, categories, status, links */
  // what each block is filtered as: client connections by their state, usage cards by the organization's credentials
  const orgStatus = (id: string, keys: string[]): FilterStatus => {
    const v = orgData?.integrations.find((i) => i.id === id);
    return v ? filterStatusOf(v.status) : has(...keys) ? "configured" : "missing";
  };
  const blocks: Record<keyof typeof BLOCKS, FilterItem> = {
    ga4: { ...BLOCKS.ga4, status: connStatus(status.ga4?.connection?.status) },
    gsc: { ...BLOCKS.gsc, status: connStatus(status.gsc?.connection?.status) },
    gbp: { ...BLOCKS.gbp, status: connStatus(status.gbp?.connection?.status) },
    bing: { ...BLOCKS.bing, status: connStatus(bing?.status) },
    lbm: { ...BLOCKS.lbm, status: connStatus(lbm?.status) },
    clarity: { ...BLOCKS.clarity, status: connStatus(clarity?.status) },
    freshness: { ...BLOCKS.freshness, status: null },
    dataforseo: { ...BLOCKS.dataforseo, status: orgStatus("dataforseo", ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"]) },
    anthropic: { ...BLOCKS.anthropic, status: orgStatus("anthropic", ["ANTHROPIC_API_KEY"]) },
    jobs: { ...BLOCKS.jobs, status: null },
  };
  const clientConnected = [...ORDER.map((p) => status[p]?.connection?.status === "connected"), bingConnected, lbmConnected, clarityConnected];
  const orgCount = (st: FilterStatus) => orgData?.integrations.filter((i) => filterStatusOf(i.status) === st).length ?? 0;
  const counts: ToolbarCount[] = orgData
    ? ([
        { label: "configured", n: orgCount("configured"), tone: "positive", status: "configured" },
        { label: "partly configured", n: orgCount("partial"), tone: "warn", status: "partial" },
        { label: "not configured", n: orgCount("missing"), tone: "muted", status: "missing" },
      ] satisfies ToolbarCount[]).filter((c) => c.n > 0 || c.tone !== "warn")
    : [
        { label: `connected for ${client.name}`, n: clientConnected.filter(Boolean).length, tone: "positive", status: "configured" },
        { label: "not connected", n: clientConnected.filter((x) => !x).length, tone: "muted", status: "missing" },
      ];
  const present = new Map<string, IntegrationCategory>();
  for (const b of Object.values(BLOCKS)) if (b.id && b.category) present.set(b.id, b.category);
  for (const i of orgData?.integrations ?? []) present.set(i.id, i.category);
  if (orgData) present.set("custom", "other");
  const categories = CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: [...present.values()].filter((v) => v === c.id).length }));
  const initialCategory = CATEGORIES.some((c) => c.id === sp.category) ? (sp.category as IntegrationCategory) : "all";
  const initialStatus = FILTER_STATUSES.includes(sp.status as FilterStatus) ? (sp.status as FilterStatus) : "all";
  const links = [
    { href: "#client-connections", label: "Client connections" },
    ...(orgData ? [{ href: "#credentials", label: "Organization credentials" }] : []),
    { href: "#usage", label: "Usage and automation" },
  ];
  const nothingConfigured = orgData ? !orgData.integrations.some((i) => !i.perClient && (i.status === "configured" || i.status === "partial")) : false;
  const customItem: FilterItem = {
    category: "other", search: "custom variables configuration values settings other",
    status: orgData?.custom.length ? "configured" : "missing",
  };
  const credentialItem = (v: { category: IntegrationCategory; search: string; status: Parameters<typeof filterStatusOf>[0] }): FilterItem =>
    ({ category: v.category, search: v.search, status: filterStatusOf(v.status) });

  return (
    <>
      <PageHeader title="Integrations" description="Connect each client's accounts and manage your organization's API credentials. Data then syncs automatically; access is read-only." />
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

      <IntegrationsFilterProvider initialQ={(sp.q ?? "").slice(0, 100)} initialCategory={initialCategory} initialStatus={initialStatus}>
        <IntegrationsToolbar categories={categories} counts={counts} links={links} pdfHref={showOrg ? pdfFor("all", orgId) : undefined} />

        {owner && nothingConfigured && (
          <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-border bg-surface px-4 py-3 text-sm text-secondary">
            <KeyRound className="size-4 text-muted" aria-hidden />
            <span><span className="font-medium text-foreground">Start with {orgName}&apos;s credentials.</span> Clients connect through them (Composio for Google Analytics and Search Console, Anthropic for AI, DataForSEO for research).</span>
            <a href="#credentials" className={link}>Add credentials</a>
          </p>
        )}

        {/* ------------------------------------------------------------ client connections */}
        <section id="client-connections" aria-labelledby="client-connections-title" className="scroll-mt-4">
          <SectionHeading id="client-connections-title" title="Client connections"
            sub={<>Accounts connected for <span className="font-medium text-foreground">{client.name}</span>. Pick another client at the top of the page to connect theirs.</>} />
          <div className="grid gap-4 lg:grid-cols-3">
            {ORDER.map((p) => (
              <Filterable key={p} item={blocks[p]} className="min-w-0 [&>*]:h-full">
                <IntegrationCard provider={p} status={status[p] ?? EMPTY} canEdit={canEdit}
                  available={ready(p)} unavailableMessage={readiness?.[p].message}
                  notes={p === "gbp" ? gbpNotes : undefined}
                  extra={p === "gbp" && (gbpApp || owner) ? (
                    <p className="flex items-start gap-1.5 text-[13px] leading-relaxed text-secondary">
                      <KeyRound className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
                      <span>
                        {gbpApp && <>Connects with {orgName}&apos;s Google Cloud OAuth client. </>}
                        {owner ? <a href="#credential-google_oauth" className={link}>{gbpApp ? "Manage it" : "Add the OAuth client"} under Organization credentials</a> : "An organization owner manages it."}
                      </span>
                    </p>
                  ) : undefined} />
              </Filterable>
            ))}
          </div>
          {fresh.length > 0 && (
            <Filterable item={blocks.freshness} className="mt-4">
              <Freshness title="Data freshness" sub="Search Console and Business Profile data lag a few days" rows={fresh} />
            </Filterable>
          )}

          <Filterable item={blocks.bing}>
            <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="bing-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="bing-title" className="text-base font-semibold">Bing Webmaster Tools</h3>
                  <p className="text-sm text-muted">Bing search performance, crawl health and keyword volumes.</p>
                </div>
                <span className={bingConnected ? "text-sm font-medium text-positive" : "text-sm text-muted"}>{bingConnected ? "Connected" : "Not connected"}</span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Tracking</dt><dd className="truncate">{bingSelected.length ? bingSelected.join(", ") : "Nothing selected"}</dd>
                <dt className="text-muted">Last sync</dt><dd>{bing?.last_synced_at ? new Date(bing.last_synced_at).toLocaleString() : "Never"}</dd>
              </dl>
              {bing?.last_error && bingConnected && <p role="alert" className="mt-2 text-sm text-negative">{bing.last_error}</p>}
              {!bingConnected && <ConsentPanel p={platformById("bing_webmaster")!} className="mt-3" />}
              <div className="mt-3">
                <BingPanel connected={bingConnected} canEdit={canEdit} hasEnvKey={has("BING_WEBMASTER_API_KEY")} selected={bingSelected} suggest={siteHints} />
              </div>
              <p className="mt-3 text-xs text-muted">
                Bing serves about 16 months of history, refreshed daily. See the <a href="/bing" className={link}>Bing Webmaster</a> page.
              </p>
            </section>
          </Filterable>

          <Filterable item={blocks.lbm}>
            <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="lbm-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="lbm-title" className="text-base font-semibold">Local Brand Manager</h3>
                  <p className="text-sm text-muted">Business Profile performance, keywords, reviews and geogrid rankings.</p>
                </div>
                <span className={lbmConnected ? "text-sm font-medium text-positive" : "text-sm text-muted"}>{lbmConnected ? "Connected" : "Not connected"}</span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Tracking</dt><dd className="truncate">{lbmSelected.length ? lbmSelected.map((s) => s.name).join(", ") : "Nothing selected"}</dd>
                <dt className="text-muted">Last sync</dt><dd>{lbm?.last_synced_at ? new Date(lbm.last_synced_at).toLocaleString() : "Never"}</dd>
              </dl>
              {lbm?.last_error && lbmConnected && <p role="alert" className="mt-2 text-sm text-negative">{lbm.last_error}</p>}
              <div className="mt-3">
                <LbmPanel connected={lbmConnected} canEdit={canEdit} hasEnvToken={has("LOCAL_BRAND_MANAGER_API_TOKEN")} selected={lbmSelected} />
              </div>
              {orgManager && (lbmConnected || has("LOCAL_BRAND_MANAGER_API_TOKEN")) && (
                <div className="mt-4 border-t border-border pt-4"><LbmBulkSetup /></div>
              )}
              <p className="mt-3 text-xs text-muted">
                Only the last ~25 days of daily metrics are available, so history builds up with each daily sync. See the <a href="/business-profile" className={link}>Google Business Profile</a> page.
              </p>
            </section>
          </Filterable>

          <Filterable item={blocks.clarity}>
            <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="clarity-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 id="clarity-title" className="text-base font-semibold">Microsoft Clarity</h3>
                <span className={clarityConnected ? "text-sm font-medium text-positive" : "text-sm text-muted"}>{clarityConnected ? "Connected" : "Not connected"}</span>
              </div>
              {clarity?.last_synced_at && <p className="mt-1 text-xs text-muted">Last synced {new Date(clarity.last_synced_at).toLocaleString()}</p>}
              {clarity?.last_error && <p role="alert" className="mt-1 text-sm text-negative">{clarity.last_error}</p>}
              {!clarityConnected && <ConsentPanel p={platformById("microsoft_clarity")!} className="mt-3" />}
              <div className="mt-3"><ConnectClarity connected={clarityConnected} canEdit={canEdit} /></div>
              <p className="mt-3 text-xs text-muted">
                Clarity&apos;s API returns only the last 1–3 days, so history builds up with each daily sync. See the <a href="/clarity" className={link}>Microsoft Clarity</a> page.
              </p>
            </section>
            <section className="mt-4 rounded-[10px] border border-border bg-surface p-5" aria-labelledby="clarity-reviews-title">
              <h3 id="clarity-reviews-title" className="text-base font-semibold">Clarity recording reviews</h3>
              <p className="mt-1 text-sm text-muted">Log what you see in Clarity recordings; the AI analysis uses these notes.</p>
              <div className="mt-4"><ReviewForm /></div>
            </section>
          </Filterable>
          <FilterEmpty className="mt-4" items={[blocks.ga4, blocks.gsc, blocks.gbp, blocks.bing, blocks.lbm, blocks.clarity]} what="client connections" />
        </section>

        {/* ------------------------------------------------------------ organization credentials (owners edit, admins view) */}
        {orgData && (
          <section id="credentials" aria-labelledby="credentials-title" className="mt-10 scroll-mt-4">
            <SectionHeading id="credentials-title" title="Organization credentials"
              sub={owner
                ? <>API keys and app credentials used for every client of <span className="font-medium text-foreground">{orgName}</span>. Values are encrypted and never shown again; only owners can see or change them.</>
                : <>The integrations <span className="font-medium text-foreground">{orgName}</span> has set up. Only organization owners can see or change the credentials.</>} />
            {owner && orgData.usesEnvFallback && <ImportEnvBanner orgId={orgId} envKeys={orgData.envKeys} />}
            <div className="grid gap-4 lg:grid-cols-2">
              {orgData.integrations.map((v) => (
                <Filterable key={v.id} item={credentialItem(v)} className="min-w-0 scroll-mt-4">
                  <div id={`credential-${v.id}`} className="h-full scroll-mt-4">
                    <CredentialCard view={v} orgId={orgId} orgName={orgName} canEdit={owner} canTest={showOrg}
                      guideContext={guideContext} pdfHref={pdfFor(v.id, orgId)} />
                  </div>
                </Filterable>
              ))}
              <Filterable item={customItem} className="min-w-0">
                <CustomVariables orgId={orgId} vars={orgData.custom} canEdit={owner} />
              </Filterable>
            </div>
            <FilterEmpty className="mt-4" items={[...orgData.integrations.map(credentialItem), customItem]} what="organization credentials" />
            {owner && (
              <details className="mt-4 rounded-[10px] border border-border bg-surface px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium text-foreground">Settings that stay with the platform</summary>
                <p className="mt-2 text-secondary">These aren&apos;t per organization, so they&apos;re never entered here:</p>
                <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {PLATFORM_ENV.map((p) => (
                    <li key={p.key} className="min-w-0"><code className="break-all font-mono text-[12px] text-foreground">{p.key}</code><span className="block text-xs text-muted">{p.why}</span></li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {/* ------------------------------------------------------------ usage and automation */}
        <section id="usage" aria-labelledby="usage-title" className="mt-10 scroll-mt-4">
          <SectionHeading id="usage-title" title="Usage and automation" sub="What the paid services cost and what runs on its own." />
          <Filterable item={blocks.dataforseo}><DataForSeoCard canEdit={canEdit} clientId={client.id} /></Filterable>
          <Filterable item={blocks.anthropic}><ClaudeCard canEdit={canEdit} clientId={client.id} timezone={client.timezone} /></Filterable>
          {/* platform-wide job status: only for the platform's own admins */}
          {canEdit && platformAdmin && <Filterable item={blocks.jobs}><ScheduledJobs /></Filterable>}
          <FilterEmpty className="mt-4" items={[blocks.dataforseo, blocks.anthropic, ...(canEdit && platformAdmin ? [blocks.jobs] : [])]} what="usage cards" />
        </section>
      </IntegrationsFilterProvider>
    </>
  );
}
