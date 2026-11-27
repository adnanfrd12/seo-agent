import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { RunList, RunView } from "@/components/fanout/results";
import { LiveFanout, type LiveBatchView } from "@/components/fanout/live";
import { FanoutRunner } from "@/components/fanout/runner";
import { getSession } from "@/lib/analytics/client-context";
import { resolveTarget } from "@/lib/dataforseo/research";
import { METHOD } from "@/lib/fanout/method";
import { pageOptions, type PageOption } from "@/lib/fanout/pages";
import { loadLive, platformReady } from "@/lib/fanout/live";
import { listRuns, loadRun } from "@/lib/fanout/run";
import { configForClient } from "@/lib/org/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// a bulk run (25 keywords) or 10 pages takes a few minutes
export const maxDuration = 300;

export default async function FanoutPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { client } = await getSession();
  if (!client) return null;
  const sp = await searchParams;
  const canEdit = ["owner", "admin"].includes(client.role);
  const db = await createClient();
  const admin = createAdminClient();
  const target = await resolveTarget(admin, client.id);
  const [{ runs, ready }, pages, live, cfg] = await Promise.all([
    listRuns(db, client.id),
    canEdit && target ? pageOptions(db, client.id, target.domain).catch((): PageOption[] => []) : Promise.resolve<PageOption[]>([]),
    loadLive(db, client.id),
    configForClient(client.id).catch(() => null),
  ]);
  const liveReady = cfg ? platformReady(cfg) : { chatgpt: false, claude: false, gemini: false, grok: false, perplexity: false };
  const runId = sp.run ?? runs[0]?.id ?? null;
  const run = runId ? await loadRun(db, client.id, runId) : null;

  const header = <TabHeader source={null} eyebrow="SEO Research" title="Fan-Out Queries" description="The sub-queries AI search (Google AI Mode, AI Overviews, ChatGPT) runs for a keyword before it answers, and whether your pages answer them." guide={[
    { term: "Fan-out query", text: "AI search splits one question into many searches (related, implicit, comparative, entity, personalised and follow-up) and builds its answer from the passages it finds. Pages that answer those sub-queries get cited." },
    { term: "Depth", text: "AI Overview gives about 10 core queries; AI Mode about 20 deeper ones (comparisons, situations, next steps)." },
    { term: "Coverage", text: "For pages: covered means the page answers the query clearly, partial means it is mentioned without a usable answer, missing means it isn't there." },
    { term: "Method", text: `${METHOD.label}. Claude Sonnet simulates the fan-out (the open-source Qforia approach), so queries are predictions, not logs from Google.` },
    { term: "Real AI search queries", text: "The searches ChatGPT, Claude, Gemini, Grok and Perplexity actually ran when asked a keyword (from each platform's API with web search on, on the organization's own key), or pasted from ChatGPT's network tab for free. API answers have no memory or personalisation, so they can differ slightly from the apps." },
    { term: "Cost", text: "About $0.01-0.02 per keyword and $0.03-0.05 per page (Claude, counted in the monthly AI budget). Search volume is optional: about $0.01 per run from DataForSEO, free for keywords already stored." },
  ]} />;

  if (!target) return <>{header}<EmptyState title="No website set" body="Set the client's website first (SEO Research targets or a connected Search Console property)." /></>;
  return (
    <>
      {header}
      {!ready && <p role="alert" className="mb-4 rounded-[10px] border border-warn/30 bg-warn/5 p-3 text-sm text-warn">Fan-out storage isn&apos;t set up yet: apply migration 20261128000034_fanout.sql to run and keep results.</p>}
      <LiveFanout canEdit={canEdit} ready={liveReady} tableReady={live.ready} batches={live.batches as LiveBatchView[]} domain={target.domain} />
      <FanoutRunner canEdit={canEdit && ready} pages={pages} domain={target.domain} />
      {runs.length === 0
        ? <EmptyState title="No fan-out runs yet" body={canEdit ? "Enter a keyword above, paste a list, or pick pages of the site." : "An owner or admin can run fan-out queries; results show here."} />
        : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 xl:order-1">{run ? <RunView run={run} /> : <EmptyState title="Run not found" body="Pick a run from the list." />}</div>
            <div className="xl:order-2"><RunList runs={runs} current={run?.id ?? null} /></div>
          </div>
        )}
    </>
  );
}
