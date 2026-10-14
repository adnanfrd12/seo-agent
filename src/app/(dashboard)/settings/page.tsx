import { PageHeader, EmptyState } from "@/components/dashboard/page-header";

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" description="Client, time zone and reporting preferences." />
      <EmptyState
        title="Not built yet"
        body="This page is scaffolded. It will show real data from Supabase once the settings form is built (Phase 8)."
        action={{ href: "/integrations", label: "Go to Integrations" }}
      />
    </>
  );
}
