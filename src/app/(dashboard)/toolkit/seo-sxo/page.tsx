import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { RunTool } from "@/components/toolkit/run-tool";
import { BackToToolkit, Card, Pill, RunBar, shortUrl, Stat } from "@/components/toolkit/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import { loadTool } from "@/lib/toolkit/store";
import { MAX_SXO, sxoEstimate, type PageType, type SxoRun } from "@/lib/toolkit/sxo";

export const maxDuration = 300;

const TYPES: PageType[] = ["Service / product page", "Home page", "Blog / guide", "Category / gallery", "Directory / listing", "Marketplace / retailer", "Video"];
const COLORS = ["#2a78d6", "#7c5cd6", "#1aa37a", "#d39b1c", "#d6553e", "#8a8f98", "#c43d8f"];

// Intent / SXO check (taxonomy simplified from claude-seo's seo-sxo skill, MIT licence: https://github.com/AgricIDaniel/claude-seo)
export default async function SeoSxoTool() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const stored = await loadTool<SxoRun>(await createClient(), client.id, "seo-sxo");
  const r = stored?.data;
  const header = <TabHeader source={null} title="Intent / SXO Check" description="Is the page you rank the kind of page Google wants for the keyword? The Google top 10 for your top keywords is classified by page type and compared with your ranking page." guide={[
    { term: "Mismatch", text: "At least 40% of the top 10 is one page type, your page is a different type, and fewer than 2 results share your type. A great page of the wrong type rarely breaks through." },
    { term: "Method", text: "Page-type comparison from the open-source claude-seo seo-sxo skill (MIT), classified from each result's URL and title." },
  ]} />;
  const run = <RunTool slug="seo-sxo" canEdit={canEdit} label="Check intent" cost={`up to $${sxoEstimate().toFixed(3)}`} wait={`Searching Google for ${MAX_SXO} keywords. About 1 minute.`} />;
  if (!stored || !r) return <><BackToToolkit />{header}<RunBar note={`Estimated cost: ${MAX_SXO} Google searches x $0.002 (fresh searches from the Clustering or Brief tools are reused for free).`}>{run}</RunBar><EmptyState title="No intent check yet" body="Run the check to compare your ranking pages with what Google rewards." /></>;
  const mism = r.rows.filter((x) => x.mismatch);
  return (
    <>
      <BackToToolkit />
      {header}
      <RunBar fetchedAt={stored.fetchedAt} cost={stored.cost} note={`${r.searched} new searches, ${r.reused} reused`}>{run}</RunBar>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Keywords checked" value={r.rows.length} />
        <Stat label="Intent mismatches" value={<span className={mism.length ? "text-negative" : "text-positive"}>{mism.length}</span>} sub="wrong page type" />
        <Stat label="Map pack shown" value={r.rows.filter((x) => x.localPack).length} sub="local intent" />
        <Stat label="Directories dominate" value={r.rows.filter((x) => x.dominant === "Directory / listing").length} sub="listings outrank sites" />
      </div>
      <Card title="Page types in Google's top 10" className="mt-4" right="per keyword">
        <div className="mb-3 flex flex-wrap gap-3 text-xs">{TYPES.map((t, i) => <span key={t} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: COLORS[i] }} />{t}</span>)}</div>
        <ul className="space-y-2">
          {r.rows.map((x) => {
            const total = Object.values(x.mix).reduce((a, n) => a + (n ?? 0), 0) || 1;
            return (
              <li key={x.keyword} className="grid gap-1 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-3">
                <span className="truncate">{x.keyword}{x.mismatch && <span className="ml-1.5 text-xs font-medium text-negative">mismatch</span>}</span>
                <span className="flex h-3.5 overflow-hidden rounded-full bg-surface-muted">
                  {TYPES.map((t, i) => x.mix[t] ? <span key={t} title={`${t}: ${x.mix[t]}`} style={{ width: `${(x.mix[t]! / total) * 100}%`, background: COLORS[i] }} /> : null)}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      <div className="mt-4 space-y-3">
        {[...r.rows].sort((a, b) => Number(b.mismatch) - Number(a.mismatch)).map((x) => (
          <Card key={x.keyword}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold">{x.keyword}</h2>
                <p className="text-xs text-muted">{x.volume ?? "?"} searches/mo · {x.impressions} impressions (90d) · position {x.position ?? "—"}</p>
              </div>
              <Pill tone={x.mismatch ? "High" : x.ourType !== x.dominant ? "Medium" : "Low"}>{x.mismatch ? "Intent mismatch" : x.ourType !== x.dominant ? "Mixed intent" : "Matches intent"}</Pill>
            </div>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <p><span className="text-muted">Your page: </span>{x.ourUrl ? <a href={x.ourUrl} target="_blank" rel="noreferrer" className="hover:underline">{shortUrl(x.ourUrl)}</a> : "—"} <span className="text-muted">({x.ourType ?? "unknown"})</span></p>
              <p><span className="text-muted">Google favours: </span>{x.dominant} <span className="text-muted">({x.dominantShare}% of top 10{x.localPack ? ", map pack shown" : ""})</span></p>
            </div>
            <p className="mt-2 text-sm text-secondary">{x.advice}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
