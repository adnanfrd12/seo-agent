import { PageHeader, EmptyState } from "@/components/dashboard/page-header";

export default function Page() {
  return (
    <>
      <PageHeader title="Historical Performance" description="Compare periods and analyze long-term trends." />
      <EmptyState
        title="Not built yet"
        body="This page is scaffolded. It will show real data from Supabase once data is synced (Phase 8)."
        action={{ href: "/integrations", label: "Go to Integrations" }}
      />
    </>
  );
}
