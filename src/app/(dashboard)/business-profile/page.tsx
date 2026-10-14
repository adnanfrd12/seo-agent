import { PageHeader, EmptyState } from "@/components/dashboard/page-header";

export default function Page() {
  return (
    <>
      <PageHeader title="Google Business Profile" description="Local SEO performance." />
      <EmptyState
        title="Not built yet"
        body="This page is scaffolded. It will show real data from Supabase once Business Profile access is approved and connected (Phase 7)."
        action={{ href: "/integrations", label: "Go to Integrations" }}
      />
    </>
  );
}
