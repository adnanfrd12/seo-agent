import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CurrentClient, CurrentUser } from "@/lib/analytics/client-context";
import { ClientSwitcher } from "./client-switcher";
import { UserMenu } from "./user-menu";

async function signOut() {
  "use server";
  await (await createClient()).auth.signOut();
  redirect("/login");
}

export function HeaderContent({
  client, clients, user, lastSyncedAt,
}: { client: CurrentClient; clients: CurrentClient[]; user: CurrentUser; lastSyncedAt: string | null }) {
  return (
    <>
      <ClientSwitcher
        clients={clients.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
        activeId={client.id}
        lastSyncedAt={lastSyncedAt}
      />
      <div className="ml-auto flex items-center gap-2">
        <UserMenu name={user.fullName} email={user.email} avatarUrl={user.avatarUrl} signOut={signOut} />
      </div>
    </>
  );
}
