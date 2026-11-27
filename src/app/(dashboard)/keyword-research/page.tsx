import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { SpendLine } from "@/components/research/chrome";
import { KeywordResearch } from "@/components/research/controls";
import { researchPage } from "@/lib/dataforseo/view";

export default async function KeywordResearchPage() {
  const page = await researchPage();
  if (!page) return null;
  const { canEdit, configured, cache, budget } = page;
  const header = <TabHeader source="dfs" title="Keyword Research" description="Find keywords to target, with volume, difficulty, cost per click and intent." />;
  if (!configured) {
    return <>{header}<EmptyState title="DataForSEO isn't set up" body="An owner of this organization adds the DataForSEO API login and password in Settings → Integrations." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  }
  return (
    <>
      {header}
      <div className="mb-5"><SpendLine budget={budget} /></div>
      <KeywordResearch canEdit={canEdit} defaultLocation={cache.target?.location_code ?? 2840} />
    </>
  );
}
