import { PageHeader, EmptyState } from "@/components/dashboard/page-header";

export default function Page() {
  return (
    <>
      <PageHeader title="Overview" description="Consolidated performance across GA4, Search Console and Business Profile." />
      <EmptyState
        title="Not built yet"
        body="This page is scaffolded. It will show real data from Supabase once the integrations are connected and synced (Phases 2-7)."
        action={{ href: "/integrations", label: "Go to Integrations" }}
      />
    </>
  );
}
