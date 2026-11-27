import { CredentialsPanel } from "@/components/integrations/org/credentials-panel";
import { ImportEnvBanner } from "@/components/integrations/org/import-env-banner";
import { appUrl } from "@/lib/app-url";
import { brandName, getBranding } from "@/lib/org/branding";
import type { GuideContext } from "@/lib/org/guides";
import { can, type OrgRole } from "@/lib/org/permissions";
import { PLATFORM_ENV } from "@/lib/org/registry";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrgIntegrations } from "./org-data";

/** setup guides as PDF (built by /api/org/guides; owners and admins of that organization) */
const pdfFor = (id: string, orgId: string) => `/api/org/guides/${id}.pdf?org=${encodeURIComponent(orgId)}`;

/**
 * Settings → Organization → Integrations: the organization's API keys and app credentials (used for every client of
 * it), custom variables and the setup guides, as compact collapsible sections where every credential is entered and
 * saved on its own. Owners (and platform super-admins) edit; admins see status and can run tests. Each client's
 * own account connections stay on the Integrations page in the sidebar.
 */
export async function OrgCredentialsView({ orgId, orgName, role, platformAdmin = false }: {
  orgId: string; orgName: string; role: OrgRole | null; platformAdmin?: boolean; sp?: { q?: string; category?: string; status?: string };
}) {
  const owner = can.manageCredentials(role) || platformAdmin;
  if (!can.manageSettings(role) && !platformAdmin) return null;
  const admin = createAdminClient();
  const [orgData, branding] = await Promise.all([loadOrgIntegrations(admin, orgId, { owner }), getBranding(orgId).catch(() => null)]);
  const guideContext: GuideContext = { appUrl: appUrl() || undefined, appName: branding ? brandName(branding) : undefined, orgName };
  const pdfs = Object.fromEntries([["all", pdfFor("all", orgId)], ...orgData.integrations.map((i) => [i.id, pdfFor(i.id, orgId)])]) as Record<string, string> & { all: string };
  const clientConnections = orgData.integrations.filter((i) => i.perClient).map((i) => ({ id: i.id, name: i.name, connected: i.connectedClients ?? 0 }));

  return (
    <>
      <CredentialsPanel orgId={orgId} integrations={orgData.integrations} custom={orgData.custom} canEdit={owner} canTest
        guideContext={guideContext} pdfFor={pdfs} clientConnections={clientConnections}
        banner={owner && orgData.usesEnvFallback ? <ImportEnvBanner orgId={orgId} envKeys={orgData.envKeys} /> : undefined} />
      {owner && (
        <details className="mt-5 rounded-[10px] border border-border bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">Settings that stay with the platform</summary>
          <p className="mt-2 text-secondary">These aren&apos;t per organization, so they&apos;re never entered here:</p>
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {PLATFORM_ENV.map((p) => (
              <li key={p.key} className="min-w-0"><code className="break-all font-mono text-[12px] text-foreground">{p.key}</code><span className="block text-xs text-muted">{p.why}</span></li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
