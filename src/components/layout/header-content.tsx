import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrgSwitcher } from "@/components/org/org-switcher";
import { getSession, type CurrentClient, type CurrentOrganization, type CurrentUser } from "@/lib/analytics/client-context";
import { getPublicBranding } from "@/lib/org/branding";
import { ClientSwitcher } from "./client-switcher";
import { SyncStatus } from "./sync-status";
import { TopRange } from "./top-range";
import { UserMenu } from "./user-menu";

async function signOut() {
  "use server";
  // people of an organization with a branded sign-in page land back on it
  let to = "/login";
  try {
    const { client, organization } = await getSession();
    const orgId = client?.organizationId ?? organization?.id;
    if (orgId && (await getPublicBranding(orgId)).custom) to = `/login?org=${orgId}`;
  } catch { /* already signed out: the plain sign-in page */ }
  await (await createClient()).auth.signOut();
  redirect(to);
}

/**
 * Top of the sidebar: the organization you're working in (switcher; nothing without an organization), then the
 * client you're looking at and its switcher (the clients of every organization you can reach).
 */
export function SidebarClient({ client, clients, lastSyncedAt, organizations = [], organizationId = null }: {
  client: CurrentClient; clients: CurrentClient[]; lastSyncedAt: string | null; organizations?: CurrentOrganization[]; organizationId?: string | null;
}) {
  return (
    <div className="space-y-1">
      <OrgSwitcher organizations={organizations} activeId={organizationId} />
      <ClientSwitcher
        // the active organization's clients (the organization switcher above changes organization)
        clients={clients.filter((c) => c.organizationId === client.organizationId).map((c) => ({ id: c.id, name: c.name, role: c.role }))}
        activeId={client.id}
        lastSyncedAt={lastSyncedAt}
      />
    </div>
  );
}

/** Right side of the top bar: the shared date range (date-driven pages only), sync status, account. */
export function HeaderContent({ client, user, lastSyncedAt }: { client: CurrentClient; user: CurrentUser; lastSyncedAt: string | null }) {
  return (
    <>
      <Suspense fallback={null}><TopRange timeZone={client.timezone} defaultDays={client.defaultRangeDays} /></Suspense>
      <SyncStatus lastSyncedAt={lastSyncedAt} />
      <UserMenu name={user.fullName} email={user.email} avatarUrl={user.avatarUrl} signOut={signOut} />
    </>
  );
}
