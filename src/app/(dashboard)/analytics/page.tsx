import { PageHeader, EmptyState } from "@/components/dashboard/page-header";

export default function Page() {
  return (
    <>
      <PageHeader title="Google Analytics 4" description="Traffic, engagement and key events." />
      <EmptyState
        title="Not built yet"
        body="This page is scaffolded. It will show real data from Supabase once GA4 is connected and synced (Phase 7)."
        action={{ href: "/integrations", label: "Go to Integrations" }}
      />
    </>
  );
}
