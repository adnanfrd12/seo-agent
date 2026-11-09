import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { lhColor, ScoreRing } from "@/components/charts/score-ring";
import { RunTool } from "@/components/toolkit/run-tool";
import { BackToToolkit, Card, Meter, Pill, RunBar, shortUrl, Stat } from "@/components/toolkit/ui";
import { getSession } from "@/lib/analytics/client-context";
import { resolveTarget } from "@/lib/dataforseo/research";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { PageReport } from "@/lib/toolkit/page";
import { loadTool } from "@/lib/toolkit/store";

export const maxDuration = 120;

// Page analyzer (method adapted from claude-seo's seo-page skill, MIT licence: https://github.com/AgricIDaniel/claude-seo)
export default async function SeoPageTool() {
  const { client } = await getSession();
  if (!client) return null;
  const canEdit = ["owner", "admin"].includes(client.role);
  const supabase = await createClient();
  const [stored, target] = await Promise.all([loadTool<PageReport>(supabase, client.id, "seo-page"), resolveTarget(createAdminClient(), client.id)]);
  const r = stored?.data;
  const header = <TabHeader source={null} title="Page Analyzer" description="A deep on-page review of one URL: title, description, headings, content, links, schema, images, canonical/robots, Lighthouse and the Search Console queries the page gets, scored with prioritised fixes." guide={[
    { term: "Score", text: "Weighted average of eight areas (on-page 20%, content 20%, technical 20%, schema, images, links 10% each, social and speed 5%). Each area starts at 100 and loses the points of its failed checks." },
    { term: "Method", text: "Thresholds from the open-source claude-seo seo-page skill (MIT): title 30-60 characters, description about 150, one H1, images under 200 KB." },
  ]} />;
  const run = <RunTool slug="seo-page" canEdit={canEdit} label="Analyze page" cost="free" wait="Reading the page and its images. About 30 seconds." input={{ name: "Page URL", placeholder: target ? `https://${target.domain}/` : "https://", defaultValue: r?.finalUrl ?? (target ? `https://${target.domain}/` : "") }} />;
  if (!stored || !r) return <><BackToToolkit />{header}<RunBar>{run}</RunBar><EmptyState title="No page analyzed yet" body="Enter any page of the website (the home page by default) and run the analyzer. It reads the page directly, so it's free." /></>;
  const counts = (["Critical", "High", "Medium", "Low"] as const).map((p) => [p, r.fixes.filter((f) => f.prio === p).length] as const);
  const mob = r.lighthouse.find((l) => l.device === "mobile");
  return (
    <>
      <BackToToolkit />
      {header}
      <RunBar fetchedAt={stored.fetchedAt} cost={stored.cost} note={`${r.finalUrl} · HTTP ${r.status} · loaded in ${(r.ms / 1000).toFixed(1)}s`}>{run}</RunBar>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <Card className="flex flex-col items-center justify-center gap-3 text-center">
          <div className="[&>div]:w-auto"><ScoreRing score={r.score} label="Page score" size={128} /></div>
          <p className="break-all text-sm font-medium">{shortUrl(r.finalUrl)}</p>
          <div className="flex flex-wrap justify-center gap-1.5">{counts.map(([p, n]) => <Pill key={p} tone={p}>{n} {p}</Pill>)}</div>
        </Card>
        <Card title="Area scores">
          <ul className="space-y-2.5">
            {r.areas.map((a) => (
              <li key={a.area} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
                <span className="truncate">{a.area}</span><Meter value={a.score} color={lhColor(a.score)} /><span className="text-right tabular-nums">{a.score}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Words (main content)" value={r.words.toLocaleString()} sub={`Flesch ${r.read.flesch} · grade ${r.read.grade}`} />
        <Stat label="Links" value={r.links.internal + r.links.external} sub={`${r.links.internal} internal · ${r.links.external} external`} />
        <Stat label="Images" value={r.images.length} sub={`${r.images.filter((i) => !i.alt?.trim()).length} without alt`} />
        <Stat label="Mobile performance" value={mob?.performance ?? "—"} sub={r.lighthouseAt ? `Lighthouse ${r.lighthouseAt.slice(0, 10)}` : "No Lighthouse run for this URL"} />
      </div>
      <Card title="Prioritised fixes" right={`${r.fixes.length} items`} className="mt-4">
        {r.fixes.length === 0 ? <p className="text-sm text-positive">No issues found.</p> : (
          <ul className="divide-y divide-border">
            {r.fixes.map((f, i) => (
              <li key={i} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:gap-3">
                <div className="flex shrink-0 gap-1.5 sm:w-40"><Pill tone={f.prio}>{f.prio}</Pill><span className="text-xs text-muted">{f.area}</span></div>
                <div className="min-w-0 text-sm"><p className="font-medium">{f.issue}</p><p className="text-secondary">{f.fix}</p></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Meta and technical">
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Title ({r.titleLen})</dt><dd className="break-words">{r.title ?? "—"}</dd>
            <dt className="text-muted">Description ({r.descLen})</dt><dd className="break-words">{r.desc ?? "—"}</dd>
            <dt className="text-muted">Canonical</dt><dd className="break-all">{r.canonical ?? "missing"}</dd>
            <dt className="text-muted">Robots</dt><dd>{r.robots ?? "index, follow (default)"}{r.noindex && " (NOINDEX)"}</dd>
            <dt className="text-muted">Schema</dt><dd>{r.schema.join(", ") || "none"}</dd>
            <dt className="text-muted">Social tags</dt><dd>{Object.entries(r.og).map(([k, v]) => `${k} ${v ? "yes" : "no"}`).join(" · ")}</dd>
            <dt className="text-muted">Mobile / lang</dt><dd>viewport {r.viewport ? "yes" : "no"} · lang {r.lang ? "yes" : "no"}</dd>
          </dl>
        </Card>
        <Card title="Heading outline" right={`${r.headings.length} headings`}>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {r.headings.map((h, i) => <li key={i} className="truncate" style={{ paddingLeft: `${(h.level - 1) * 12}px` }}><span className="mr-1.5 text-xs text-muted">H{h.level}</span>{h.text}</li>)}
            {!r.headings.length && <li className="text-muted">No headings.</li>}
          </ul>
        </Card>
        <Card title="Search Console queries for this page" right="last 90 days">
          {r.queries.length === 0 ? <p className="text-sm text-muted">No Search Console queries recorded for this exact URL.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-1 pr-2 font-medium">Query</th><th className="px-2 text-right font-medium">Clicks</th><th className="px-2 text-right font-medium">Impr.</th><th className="pl-2 text-right font-medium">Pos.</th></tr></thead>
              <tbody>{r.queries.slice(0, 12).map((q) => <tr key={q.query} className="border-t border-border"><td className="max-w-[12rem] truncate py-1.5 pr-2">{q.query}</td><td className="px-2 text-right tabular-nums">{q.clicks}</td><td className="px-2 text-right tabular-nums">{q.impressions}</td><td className="pl-2 text-right tabular-nums">{q.position ?? "—"}</td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title="Images" right={`${r.images.length} found`}>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto text-sm">
            {r.images.slice(0, 25).map((im, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate" title={im.src}>{im.src.split("/").pop()?.split("?")[0]}<span className="block truncate text-xs text-muted">{im.alt?.trim() ? `alt: ${im.alt}` : "no alt text"}</span></span>
                <span className={`shrink-0 text-xs tabular-nums ${(im.kb ?? 0) > 500 ? "text-negative" : (im.kb ?? 0) > 200 ? "text-warn" : "text-muted"}`}>{im.kb != null ? `${im.kb} KB` : "?"} · {im.format}</span>
              </li>
            ))}
            {!r.images.length && <li className="py-1.5 text-muted">No images.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
