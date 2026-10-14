import { PageHeader, EmptyState } from "@/components/dashboard/page-header";

export default function Page() {
  return (
    <>
      <PageHeader title="Google Search Console" description="Organic search performance." />
      <EmptyState
        title="Not built yet"
        body="This page is scaffolded. It will show real data from Supabase once Search Console is connected and synced (Phase 7)."
        action={{ href: "/integrations", label: "Go to Integrations" }}
      />
    </>
  );
}
