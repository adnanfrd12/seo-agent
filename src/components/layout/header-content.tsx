import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/analytics/client-context";
import { UserMenu } from "./user-menu";

async function signOut() {
  "use server";
  await (await createClient()).auth.signOut();
  redirect("/login");
}

export function HeaderContent({
  clientName, user, lastSyncedAt,
}: { clientName: string; user: CurrentUser; lastSyncedAt: string | null }) {
  return (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{clientName}</p>
        <p className="truncate text-xs text-muted">
          {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : "Not synced yet"}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <UserMenu name={user.fullName} email={user.email} avatarUrl={user.avatarUrl} signOut={signOut} />
      </div>
    </>
  );
}
