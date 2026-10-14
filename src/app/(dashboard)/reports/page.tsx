import { PageHeader, EmptyState } from "@/components/dashboard/page-header";

export default function Page() {
  return (
    <>
      <PageHeader title="Monthly Reports" description="Month-over-month and year-over-year reporting." />
      <EmptyState
        title="Not built yet"
        body="This page is scaffolded. It will show real data from Supabase once data is synced (Phase 8)."
        action={{ href: "/integrations", label: "Go to Integrations" }}
      />
    </>
  );
}
