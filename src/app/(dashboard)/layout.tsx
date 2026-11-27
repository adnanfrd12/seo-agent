import type { Metadata } from "next";
import { createAndSwitchClient } from "./client-actions";
import { Suspense } from "react";
import { after } from "next/server";
import { RangeMemory } from "@/components/layout/range-memory";
import { NavProgress } from "@/components/layout/nav-progress";
import { touchClient } from "@/lib/activity";
import { memo } from "@/lib/memo";
import { brandName, getBranding, shellBrand } from "@/lib/org/branding";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { HeaderContent, SidebarClient } from "@/components/layout/header-content";
import { BrandStyle } from "@/components/org/branding/brand-style";
import { Nova } from "@/components/nova/nova";

/** The active organization's display name and favicon in the browser tab (nothing set: SEO Insights). */
export async function generateMetadata(): Promise<Metadata> {
  const { client, organization } = await getSession();
  const b = await getBranding(client?.organizationId ?? organization?.id);
  const name = brandName(b);
  return {
    ...(b.displayName ? { title: { default: name, template: `%s · ${name}` } } : {}),
    ...(b.favicon ? { icons: { icon: [{ url: b.favicon.url }], apple: [{ url: b.favicon.url }] } } : {}),
  };
}

async function createFirstClient(formData: FormData) {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // in the user's organization, with its time zone and default date range (owners and admins only)
  const r = await createAndSwitchClient(name);
  if (!r.ok) throw new Error(r.error ?? "Could not create client");
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, client, clients, organizations, organization } = await getSession();

  if (!client && !(organization && (organization.role === "owner" || organization.role === "admin"))) {
    // members and viewers can't create clients: they wait for access to one
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <span hidden className="dash-fonts" />
        <div className="w-full max-w-sm space-y-2 rounded-[10px] border border-border bg-surface p-6">
          <h1 className="text-xl font-semibold">No client yet</h1>
          <p className="text-sm text-muted">You don&apos;t have access to a client yet. Ask an owner or admin of your organization to give you access.</p>
        </div>
      </main>
    );
  }
  if (!client) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <span hidden className="dash-fonts" />
        <form action={createFirstClient} className="w-full max-w-sm space-y-4 rounded-[10px] border border-border bg-surface p-6">
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
  // read on every page view; the time only moves when a sync finishes, so it is reused for a minute
  const [lastSync, branding] = await Promise.all([
    memo(`last-sync|${user.id}|${client.id}`, 60_000, async () => (await supabase
      .from("integration_connections")
      .select("last_synced_at")
      .eq("client_id", client.id)
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle()).data),
    // the organization of the client being viewed: its logo, name, favicon and colours (cached briefly)
    getBranding(client.organizationId),
  ]);

  return (
    <>
    <span hidden className="dash-fonts" />
    <BrandStyle colors={branding.colors} />
    <AppShell
      brand={shellBrand(branding)}
      enabledPages={organization?.enabledPages ?? null}
      sidebarTop={<SidebarClient client={client} clients={clients} lastSyncedAt={lastSync?.last_synced_at ?? null}
        organizations={organizations} organizationId={organization?.id ?? null} />}
      header={<HeaderContent client={client} user={user} lastSyncedAt={lastSync?.last_synced_at ?? null} />}
    >
      <Suspense fallback={null}><RangeMemory /><NavProgress /></Suspense>
      {children}
    </AppShell>
    <Nova firstName={user.fullName?.split(" ")[0] ?? null} clientName={client.name} canEdit={["owner", "admin"].includes(client.role)} />
    </>
  );
}
