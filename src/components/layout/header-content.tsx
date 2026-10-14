import { LogOut, User } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function signOut() {
  "use server";
  await (await createClient()).auth.signOut();
  redirect("/login");
}

export function HeaderContent({
  clientName, email, lastSyncedAt,
}: { clientName: string; email: string; lastSyncedAt: string | null }) {
  return (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{clientName}</p>
        <p className="truncate text-xs text-muted">
          {lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : "Not synced yet"}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {/* Date range selector and Refresh button land with Phase 6 (URL-driven range state). */}
        <details className="relative">
          <summary
            aria-label="User menu"
            className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-surface-muted"
          >
            <User className="size-4" aria-hidden />
            <span className="hidden max-w-40 truncate sm:inline">{email}</span>
          </summary>
          <div className="absolute right-0 z-30 mt-2 w-48 rounded-lg border border-border bg-surface p-1 shadow-lg">
            <form action={signOut}>
              <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-surface-muted">
                <LogOut className="size-4" aria-hidden /> Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </>
  );
}
