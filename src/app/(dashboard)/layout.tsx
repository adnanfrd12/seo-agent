import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { touchClient } from "@/lib/activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { HeaderContent } from "@/components/layout/header-content";

async function createFirstClient(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { error } = await (await createClient()).rpc("create_client", { p_name: name });
  if (error) throw new Error("Could not create client");
  revalidatePath("/", "layout");
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, client, clients } = await getSession();

  if (!client) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <form action={createFirstClient} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6">
          <h1 className="text-xl font-semibold">Create your client</h1>
          <p className="text-sm text-muted">Name the client whose analytics you will track.</p>
          <input
            name="name" required placeholder="Client name"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-accent-foreground hover:opacity-90">
            Create
          </button>
        </form>
      </main>
    );
  }

  // remember that this client is in use, so daily competitor analysis is spent on clients people actually open
  after(() => touchClient(createAdminClient(), client.id));

  const supabase = await createClient();
  const { data: lastSync } = await supabase
    .from("integration_connections")
    .select("last_synced_at")
    .eq("client_id", client.id)
    .not("last_synced_at", "is", null)
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <AppShell
      header={<HeaderContent client={client} clients={clients} user={user} lastSyncedAt={lastSync?.last_synced_at ?? null} />}
    >
      {children}
    </AppShell>
  );
}
