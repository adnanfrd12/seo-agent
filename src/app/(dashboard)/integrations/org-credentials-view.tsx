import Link from "next/link";
import { CredentialCard } from "@/components/integrations/org/credential-card";
import { CustomVariables } from "@/components/integrations/org/custom-variables";
import { Filterable, FilterEmpty, IntegrationsFilterProvider, IntegrationsToolbar, type ToolbarCount } from "@/components/integrations/org/filter";
import { ImportEnvBanner } from "@/components/integrations/org/import-env-banner";
import { filterStatusOf, type FilterItem, type FilterStatus } from "@/components/integrations/org/types";
import { brandName, getBranding } from "@/lib/org/branding";
import type { GuideContext } from "@/lib/org/guides";
import { can, type OrgRole } from "@/lib/org/permissions";
import { CATEGORIES, PLATFORM_ENV, type IntegrationCategory } from "@/lib/org/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrgIntegrations } from "./org-data";

/** setup guides as PDF (built by /api/org/guides; owners and admins of that organization) */
const pdfFor = (id: string, orgId: string) => `/api/org/guides/${id}.pdf?org=${encodeURIComponent(orgId)}`;
const FILTER_STATUSES: FilterStatus[] = ["configured", "partial", "missing"];

/**
 * Settings → Organization → Integrations: the organization's API keys and app credentials (used for every client of
 * it), custom variables and the setup guides. Owners edit; admins see status and can run tests. The client
 * connections stay on the Integrations page in the sidebar.
 */
export async function OrgCredentialsView({ orgId, orgName, role, platformAdmin = false, sp }: {
  orgId: string; orgName: string; role: OrgRole | null; platformAdmin?: boolean; sp: { q?: string; category?: string; status?: string };
}) {
  // owners, and platform super-admins for any organization, manage the credentials; admins view and test
  const owner = can.manageCredentials(role) || platformAdmin;
  if (!can.manageSettings(role) && !platformAdmin) return null;
  const admin = createAdminClient();
  const [orgData, branding] = await Promise.all([loadOrgIntegrations(admin, orgId, { owner }), getBranding(orgId).catch(() => null)]);
  const guideContext: GuideContext = {
    appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "") || undefined,
    appName: branding ? brandName(branding) : undefined,
    orgName,
  };

  const count = (st: FilterStatus) => orgData.integrations.filter((i) => filterStatusOf(i.status) === st).length;
  const counts: ToolbarCount[] = ([
    { label: "configured", n: count("configured"), tone: "positive", status: "configured" },
    { label: "partly configured", n: count("partial"), tone: "warn", status: "partial" },
    { label: "not configured", n: count("missing"), tone: "muted", status: "missing" },
  ] satisfies ToolbarCount[]).filter((c) => c.n > 0 || c.tone !== "warn");
  const present = new Map<string, IntegrationCategory>(orgData.integrations.map((i) => [i.id, i.category]));
  present.set("custom", "other");
  const categories = CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: [...present.values()].filter((v) => v === c.id).length }));
  const initialCategory = CATEGORIES.some((c) => c.id === sp.category) ? (sp.category as IntegrationCategory) : "all";
  const initialStatus = FILTER_STATUSES.includes(sp.status as FilterStatus) ? (sp.status as FilterStatus) : "all";
  const customItem: FilterItem = { category: "other", search: "custom variables configuration values settings other", status: orgData.custom.length ? "configured" : "missing" };
  const credentialItem = (v: { category: IntegrationCategory; search: string; status: Parameters<typeof filterStatusOf>[0] }): FilterItem =>
    ({ category: v.category, search: v.search, status: filterStatusOf(v.status) });

  return (
    <IntegrationsFilterProvider initialQ={(sp.q ?? "").slice(0, 100)} initialCategory={initialCategory} initialStatus={initialStatus}>
      <section id="credentials" aria-labelledby="credentials-title" className="scroll-mt-4">
        <div className="mb-4">
          <h2 id="credentials-title" className="text-lg font-semibold tracking-[-0.01em]">Organization credentials</h2>
          <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-secondary">
            {owner
              ? <>API keys and app credentials used for every client of <span className="font-medium text-foreground">{orgName}</span>. Values are encrypted and never shown again; only owners (and platform administrators) can see or change them.</>
              : <>The integrations <span className="font-medium text-foreground">{orgName}</span> has set up. Only organization owners can see or change the credentials.</>}
            {" "}Each client&apos;s own accounts are connected on the <Link href="/integrations" className="text-foreground underline decoration-border-strong underline-offset-2 hover:decoration-foreground">Integrations</Link> page.
          </p>
        </div>
        <IntegrationsToolbar categories={categories} counts={counts} links={[]} pdfHref={pdfFor("all", orgId)} />
        {owner && orgData.usesEnvFallback && <ImportEnvBanner orgId={orgId} envKeys={orgData.envKeys} />}
        <div className="grid gap-4 xl:grid-cols-2">
          {orgData.integrations.map((v) => (
            <Filterable key={v.id} item={credentialItem(v)} className="min-w-0 scroll-mt-4">
              <div id={`credential-${v.id}`} className="h-full scroll-mt-4">
                <CredentialCard view={v} orgId={orgId} orgName={orgName} canEdit={owner} canTest guideContext={guideContext} pdfHref={pdfFor(v.id, orgId)} />
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
    </IntegrationsFilterProvider>
  );
}
