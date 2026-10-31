import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CurrentClient, CurrentUser } from "@/lib/analytics/client-context";
import { ClientSwitcher } from "./client-switcher";
import { SyncStatus } from "./sync-status";
import { TopRange } from "./top-range";
import { UserMenu } from "./user-menu";

async function signOut() {
  "use server";
  await (await createClient()).auth.signOut();
  redirect("/login");
}

/** Top of the sidebar: which client you are looking at, and the switcher. */
export function SidebarClient({ client, clients, lastSyncedAt }: { client: CurrentClient; clients: CurrentClient[]; lastSyncedAt: string | null }) {
  return (
    <ClientSwitcher
      clients={clients.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
      activeId={client.id}
      lastSyncedAt={lastSyncedAt}
    />
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
