import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { RunTool } from "@/components/toolkit/run-tool";
import { BackToToolkit, Card, Meter, Pill, RunBar, shortUrl, Stat } from "@/components/toolkit/ui";
import { getSession } from "@/lib/analytics/client-context";
import { createClient } from "@/lib/supabase/server";
import { clusterEstimate, MAX_SERP, type ClusterRun } from "@/lib/toolkit/cluster";
import { loadTool } from "@/lib/toolkit/store";

export const maxDuration = 300;

// Keyword clustering (SERP-overlap method adapted from claude-seo's seo-cluster skill, MIT licence: https://github.com/AgricIDaniel/claude-seo)
export default async function SeoClusterTool() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const stored = await loadTool<ClusterRun>(await createClient(), client.id, "seo-cluster");
  const r = stored?.data;
  const header = <TabHeader source={null} title="Keyword Clustering" description="Groups the site's keywords (DataForSEO ranked keywords + Search Console queries) by how Google ranks them, then maps each cluster to a hub page with the internal links to add." guide={[
    { term: "SERP overlap", text: `The top ${MAX_SERP} keywords are searched on Google. Keywords sharing 4+ of their top-10 results belong on the same page cluster; 2-3 shared results means cross-link them.` },
    { term: "Words / semantic", text: "Other keywords join the cluster they share most words with; keywords that overlap with nothing are grouped by their core term (marked semantic)." },
    { term: "Hub page", text: "The site page that already ranks for most of the cluster's keywords. Spoke pages should link to it with the hub keyword as anchor." },
  ]} />;
  const run = <RunTool slug="seo-cluster" canEdit={canEdit} label="Cluster keywords" cost={`up to $${clusterEstimate().toFixed(3)}`} wait={`Searching Google for up to ${MAX_SERP} keywords. About 1-2 minutes.`} />;
  if (!stored || !r) return <><BackToToolkit />{header}<RunBar note={`Estimated cost: ${MAX_SERP} Google searches x $0.002 = $${clusterEstimate().toFixed(3)} (searches made by the SXO or Brief tools in the last 14 days are reused for free).`}>{run}</RunBar><EmptyState title="No clusters yet" body="Run the clustering to see your keywords grouped into hub-and-spoke topics." /></>;
  const maxD = Math.max(1, ...r.clusters.map((c) => c.demand));
  const noHub = r.clusters.filter((c) => !c.hubPage).length;
  const cannibal = r.clusters.filter((c) => c.pages.length > 1).length;
  return (
    <>
      <BackToToolkit />
      {header}
      <RunBar fetchedAt={stored.fetchedAt} cost={stored.cost} note={`${r.searched} new searches, ${r.reused} reused`}>{run}</RunBar>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Clusters" value={r.clusters.length} sub={`${r.clusters.filter((c) => c.method === "serp").length} by SERP overlap`} />
        <Stat label="Keywords grouped" value={r.clusters.reduce((a, c) => a + c.keywords.length, 0)} sub={`of ${r.totalKeywords} with demand`} />
        <Stat label="Need a hub page" value={noHub} sub="no page ranks yet" />
        <Stat label="Several pages compete" value={cannibal} sub="link to one hub or merge" />
      </div>
      <Card title="Clusters by demand" right="volume + impressions/3" className="mt-4">
        <ul className="space-y-2">
          {r.clusters.slice(0, 12).map((c, i) => (
            <li key={`${c.name}-${i}`} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_4rem]">
              <a href={`#c-${i}`} className="truncate hover:underline">{c.name}</a><Meter value={c.demand} max={maxD} /><span className="text-right tabular-nums">{c.demand.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {r.clusters.map((c, i) => (
          <Card key={`${c.name}-${i}`} title={c.name} right={`${c.keywords.length} keywords`}>
            <div id={`c-${i}`} className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={c.method === "serp" ? "Low" : "Medium"}>{c.method === "serp" ? "SERP overlap" : "semantic"}</Pill>
                <span className="text-xs text-muted">Hub:</span>
                {c.hubPage ? <a href={c.hubPage} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">{shortUrl(c.hubPage)}</a> : <Pill tone="High">create a page</Pill>}
              </div>
              <p className="text-secondary">{c.action}</p>
              <ul className="flex flex-wrap gap-1.5">
                {c.keywords.slice(0, 14).map((k) => <li key={k.keyword} className="rounded-md bg-surface-muted px-2 py-0.5 text-xs" title={`${k.volume ?? "?"} searches · ${k.impressions} impressions · pos ${k.position ?? "—"}`}>{k.keyword}{k.position != null && <span className="text-muted"> #{Math.round(k.position)}</span>}</li>)}
                {c.keywords.length > 14 && <li className="px-1 text-xs text-muted">+{c.keywords.length - 14} more</li>}
              </ul>
              {c.links.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-muted">Internal links to add</h3>
                  <ul className="space-y-0.5 text-xs">{c.links.slice(0, 6).map((l, i) => <li key={i} className="truncate">{shortUrl(l.from)} → {shortUrl(l.to)} <span className="text-muted">anchor &ldquo;{l.anchor}&rdquo;</span></li>)}</ul>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      {r.interlinks.length > 0 && (
        <Card title="Cross-link these topics (2-3 shared results)" className="mt-4">
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">{r.interlinks.map((l) => <li key={`${l.a}|${l.b}`} className="truncate">{l.a} ↔ {l.b} <span className="text-xs text-muted">{l.shared} shared</span></li>)}</ul>
        </Card>
      )}
    </>
  );
}
