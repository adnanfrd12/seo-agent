import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuditLog } from "@/components/org/audit-log";
import { BrandingSettings } from "@/components/org/branding/branding-settings";
import { ClientsManager } from "@/components/org/clients-manager";
import { GeneralForm } from "@/components/org/general-form";
import { IntegrationsSummary } from "@/components/org/integrations-summary";
import { ORG_TABS, OrgNav } from "@/components/org/org-nav";
import { OrgSwitcher } from "@/components/org/org-switcher";
import { OrgCredentialsView } from "../../../integrations/org-credentials-view";
import { PreferencesForm } from "@/components/org/preferences-form";
import { RolesMatrix } from "@/components/org/roles-matrix";
import { Note } from "@/components/org/section";
import { SecurityPanel } from "@/components/org/security-panel";
import { AiSpend } from "@/components/org/spend/ai-spend";
import { ToolsSpend } from "@/components/org/spend/tools-spend";
import { TeamManager } from "@/components/org/team-manager";
import { getSession } from "@/lib/analytics/client-context";
import { emailConfigured } from "@/lib/notify";
import { listOrgClients } from "@/lib/org/clients";
import { listInvitations } from "@/lib/org/invitations";
import { listMembers, userDirectory } from "@/lib/org/members";
import { can, roleIn } from "@/lib/org/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Organization settings" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Settings → Organization → one tab. The organization is the active one (the active client's), or `?org=` for
 * another organization the user belongs to. Every tab re-checks the user's role on the server; the actions do too.
 */
export default async function OrganizationSettingsPage({ params, searchParams }: { params: Promise<{ tab: string }>; searchParams: Promise<SP> }) {
  const [{ tab: tabId }, sp] = await Promise.all([params, searchParams]);
  const tab = ORG_TABS.find((t) => t.id === tabId);
  if (!tab) notFound();

  const { user, client, organizations, organization } = await getSession();
  const wanted = one(sp.org);
  const current = (wanted && organizations.find((o) => o.id === wanted)) || organization || organizations[0];
  if (!current) {
    return <Note>You aren&apos;t a member of an organization. Ask an organization owner to invite you.</Note>;
  }
  const admin = createAdminClient();
  // the live role (the session's list is cached for a minute)
  const role = await roleIn(admin, current.id, user.id);
  if (!role) return <Note tone="warn">You no longer have access to {current.name}.</Note>;
  const isAdmin = can.manageSettings(role);
  const orgParam = current.id !== organization?.id ? current.id : null;
  const href = (t: string) => `/settings/organization/${t}${orgParam ? `?org=${orgParam}` : ""}`;
  const { data: org } = await admin.from("organizations").select("id, name, description, website, email, phone, address, timezone, language, currency, preferences").eq("id", current.id).single();
  if (!org) notFound();
  const prefs = (org.preferences ?? {}) as Record<string, unknown>;
  const timezones = () => Intl.supportedValuesOf("timeZone");

  let content: React.ReactNode;
  if (tab.who === "admins" && !isAdmin) {
    content = <Note>Only organization owners and admins can open {tab.label}.</Note>;
  } else switch (tab.id) {
    case "general": {
      const a = (org.address ?? {}) as Record<string, unknown>;
      content = (
        <GeneralForm orgId={org.id} canEdit={isAdmin} timezones={timezones()} initial={{
          name: org.name, description: str(org.description), website: str(org.website), email: str(org.email), phone: str(org.phone),
          address: { line1: str(a.line1), line2: str(a.line2), city: str(a.city), region: str(a.region), postal_code: str(a.postal_code), country: str(a.country) },
          timezone: org.timezone, language: org.language, currency: org.currency,
        }} />
      );
      break;
    }
    case "branding":
      content = <BrandingSettings orgId={org.id} canEdit={isAdmin} />;
      break;
    case "team": {
      const [members, invitations, clients] = await Promise.all([listMembers(admin, org.id), listInvitations(admin, org.id), listOrgClients(admin, org.id)]);
      const inviters = await userDirectory(admin, invitations.map((i) => i.invitedBy));
      content = (
        <TeamManager orgId={org.id} me={{ userId: user.id, role }} emailEnabled={emailConfigured()}
          members={members}
          invitations={invitations.map((i) => {
            const by = i.invitedBy ? inviters.get(i.invitedBy) : undefined;
            return { id: i.id, email: i.email, role: i.role, clients: i.clientAccess.length, invitedBy: by ? by.fullName || by.email : null, expiresAt: i.expiresAt, expired: i.expired };
          })}
          clients={clients.map((c) => ({ id: c.id, name: c.name, archived: Boolean(c.archivedAt) }))} />
      );
      break;
    }
    case "roles":
      content = <RolesMatrix />;
      break;
    case "clients": {
      const [clients, members] = await Promise.all([listOrgClients(admin, org.id), listMembers(admin, org.id)]);
      content = (
        <ClientsManager orgId={org.id} canEdit={can.manageClients(role)} myRole={role} activeClientId={client?.id ?? null} timezones={timezones()}
          defaults={{ timezone: org.timezone, rangeDays: [7, 30, 90].includes(Number(prefs.default_range_days)) ? Number(prefs.default_range_days) : 30 }}
          clients={clients.map((c) => ({ id: c.id, name: c.name, timezone: c.timezone, defaultRangeDays: c.defaultRangeDays, createdAt: c.createdAt, archivedAt: c.archivedAt,
            integrations: c.integrations.map((i) => ({ provider: i.provider, status: i.status })), access: c.access }))}
          people={members.map((m) => ({ userId: m.userId, name: m.fullName || m.email, email: m.email, role: m.role, status: m.status }))} />
      );
      break;
    }
    case "integrations": {
      const clients = (await listOrgClients(admin, org.id)).filter((c) => !c.archivedAt);
      const connected: Record<string, number> = {};
      for (const c of clients) for (const i of c.integrations) if (i.status === "connected") connected[i.provider] = (connected[i.provider] ?? 0) + 1;
      content = (
        <>
          <IntegrationsSummary orgId={org.id} canManageCredentials={can.manageCredentials(role)} connected={connected} clientCount={clients.length} />
          <OrgCredentialsView orgId={org.id} orgName={org.name} role={role} sp={{ q: one(sp.q), category: one(sp.category), status: one(sp.status) }} />
        </>
      );
      break;
    }
    case "preferences":
      content = <PreferencesForm orgId={org.id} canEdit={isAdmin} initial={{
        defaultRangeDays: [7, 30, 90].includes(Number(prefs.default_range_days)) ? Number(prefs.default_range_days) : 30,
        weekStart: ["monday", "sunday", "saturday"].includes(str(prefs.week_start)) ? str(prefs.week_start) : "monday",
      }} />;
      break;
    case "security": {
      const [members, invitations] = await Promise.all([listMembers(admin, org.id), listInvitations(admin, org.id)]);
      const active = members.filter((m) => m.status === "active");
      content = (
        <SecurityPanel tabHref={href} owners={active.filter((m) => m.role === "owner")} admins={active.filter((m) => m.role === "admin")}
          deactivated={members.length - active.length} openInvites={invitations.filter((i) => !i.expired).length} expiredInvites={invitations.filter((i) => i.expired).length} />
      );
      break;
    }
    case "activity": {
      const members = await listMembers(admin, org.id);
      content = (
        <AuditLog orgId={org.id} timeZone={org.timezone} basePath="/settings/organization/activity" orgParam={orgParam}
          people={members.map((m) => ({ userId: m.userId, label: m.fullName ? `${m.fullName} (${m.email})` : m.email }))}
          params={{ who: one(sp.who), kind: one(sp.kind), from: one(sp.from), to: one(sp.to), page: one(sp.page) }} />
      );
      break;
    }
    case "ai-spend":
      content = <AiSpend orgId={org.id} />;
      break;
    case "tools-spend":
      content = <ToolsSpend orgId={org.id} />;
      break;
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* the organization switcher lives here (not in the sidebar): switching opens that organization */}
        <OrgSwitcher organizations={organizations} activeId={current.id} redirectTo={`/settings/organization/${tab.id}`}
          className="w-full max-w-xs rounded-lg border border-border bg-surface" />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <OrgNav active={tab.id} isAdmin={isAdmin} href={href} />
        <div className="min-w-0 space-y-6">{content}</div>
      </div>
    </div>
  );
}
