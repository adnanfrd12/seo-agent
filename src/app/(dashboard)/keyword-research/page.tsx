import { EmptyState, PageHeader } from "@/components/dashboard/page-header";
import { SpendLine } from "@/components/research/chrome";
import { KeywordResearch } from "@/components/research/controls";
import { researchPage } from "@/lib/dataforseo/view";

export default async function KeywordResearchPage() {
  const page = await researchPage();
  if (!page) return null;
  const { canEdit, configured, cache, budget } = page;
  const header = <PageHeader title="Keyword Research" description="Find keywords to target: monthly search volume, difficulty, cost per click and intent. Data from DataForSEO." />;
  if (!configured) {
    return <>{header}<EmptyState title="DataForSEO isn't configured" body="Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the environment, then redeploy." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  return (
    <>
      {header}
      <div className="mb-5"><SpendLine budget={budget} /></div>
      <KeywordResearch canEdit={canEdit} defaultLocation={cache.target?.location_code ?? 2840} />
    </>
  );
}
