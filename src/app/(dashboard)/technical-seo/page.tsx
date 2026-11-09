import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleX, Info } from "lucide-react";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { lhColor, ScoreRing } from "@/components/charts/score-ring";
import { ResearchTable } from "@/components/research/research-table";
import { TechnicalRun } from "@/components/research/technical-controls";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";
import { loadTechnical } from "@/lib/technical/load";
import { scoreBand, type Check, type Priority } from "@/lib/technical/score";
import { cn } from "@/lib/utils";

const path = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? "/ (home)" : x.pathname; } catch { return u; } };
const PRIO: Record<Priority, string> = { Critical: "bg-negative text-white", High: "bg-negative/10 text-negative", Medium: "bg-warn/10 text-warn", Low: "bg-surface-muted text-secondary" };

function StatusIcon({ s }: { s: Check["status"] }) {
  const I = s === "pass" ? CheckCircle2 : s === "warn" ? CircleAlert : s === "fail" ? CircleX : Info;
  return <I className={cn("mt-0.5 size-4 shrink-0", s === "pass" ? "text-positive" : s === "warn" ? "text-warn" : s === "fail" ? "text-negative" : "text-muted")} aria-label={s} />;
}

export const maxDuration = 300; // the "Run technical checks" action reads ~25 pages from a possibly slow website

export default async function TechnicalSeoPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, cache } = page;
  const header = <TabHeader source="dfs" title="Technical SEO" description="One score for the technical health of the website, a score per area and a prioritised list of exact changes, built from the crawl, Lighthouse and free checks of robots.txt, sitemaps and page HTML." guide={[
    { term: "Technical SEO score", text: "Weighted average of the category scores. Each category starts at 100 and loses the points shown next to each failed check, so every deduction can be traced to its evidence." },
    { term: "Method", text: "Categories, thresholds and priority tiers adapted from the open-source claude-seo technical audit skill (MIT licence)." },
    { term: "Priority", text: "Critical = a failure that blocks crawling, indexing or HTTPS (fix now). Otherwise impact x effort: high-impact changes that aren't hard are High; high-impact but hard, or medium-impact and easy, are Medium; the rest Low." },
    { term: "Not measured", text: "A category with no data yet is left out and the weights are re-balanced over the measured ones." },
  ]} />;
  if (!cache.target) return <>{header}<EmptyState title="No website yet" body="Connect Bing, Search Console or Business Profile for this client so the website can be detected, or ask an owner or admin to set it." action={{ href: "/integrations", label: "Open Integrations" }} /></>;

  const supabase = await createClient();
  const { score: s, checks } = await loadTechnical(supabase, client.id);
  const allChecks = s.categories.flatMap((c) => c.checks.map((x) => ({ ...x, category: c.label })));
  const failing = allChecks.filter((x) => x.status === "fail" || x.status === "warn");
  const recRows = s.recs.map((r) => ({ ...r, pagesText: r.pages.slice(0, 5).map(path).join(", ") + (r.pageCount > 5 ? ` +${r.pageCount - 5} more` : ""), pageUrl: r.pages[0] ?? null }));
  const speedRows = s.speed.map((r) => ({ ...r, page: r.url }));
  const pageRows = (checks?.pages ?? []).map((p) => ({
    url: p.url, status: p.status, hops: p.hops, title_len: p.titleLen, desc_len: p.descLen, h1: p.h1, words: p.words,
    canonical: p.canonical ? (p.canonical.replace(/\/$/, "") === (p.finalUrl ?? p.url).replace(/\/$/, "") ? "self" : "other") : "missing",
    noindex: p.noindex, schema: p.schema.join(", ") || "—", img_no_alt: p.imgNoAlt, in_sitemap: p.inSitemap, mixed: p.mixed,
  }));
  const counts = { Critical: s.recs.filter((r) => r.priority === "Critical").length, High: s.recs.filter((r) => r.priority === "High").length, Medium: s.recs.filter((r) => r.priority === "Medium").length, Low: s.recs.filter((r) => r.priority === "Low").length };

  return (
    <>
      {header}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-muted">
          <span className="font-medium text-foreground">{cache.target.domain}</span> · crawl {s.sources.audit?.slice(0, 10) ?? "not run"} · Lighthouse {s.sources.lighthouse?.slice(0, 10) ?? "not run"} · site checks {s.sources.checks?.slice(0, 10) ?? "not run"} · refreshed weekly
        </p>
        <TechnicalRun canEdit={canEdit} />
      </div>

      {s.overall == null ? (
        <EmptyState title="Nothing to score yet" body="Run the technical checks above (free), or a site audit and Lighthouse test on the Site Audit page." action={{ href: "/site-audit", label: "Open Site Audit" }} />
      ) : (
        <>
          <section aria-label="Technical SEO score" className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <div className="flex flex-col items-center justify-center gap-3 rounded-[10px] border border-border bg-surface p-5 text-center">
              <div className="[&>div]:w-auto"><ScoreRing score={s.overall} label="Technical SEO score" size={132} /></div>
              <p className="text-sm font-semibold" style={{ color: lhColor(s.overall) }}>{scoreBand(s.overall)}</p>
              <div className="flex flex-wrap justify-center gap-1.5 text-xs">
                {(["Critical", "High", "Medium", "Low"] as const).map((l) => <span key={l} className={cn("rounded-md px-2 py-0.5 font-medium", PRIO[l])}>{counts[l]} {l}</span>)}
              </div>
              <p className="text-xs text-muted">{failing.length} of {allChecks.filter((x) => x.status !== "na").length} checks need work · weights cover {s.measuredWeight}% measured</p>
            </div>
            <div className="min-w-0 rounded-[10px] border border-border bg-surface p-5">
              <h2 className="mb-3 text-sm font-semibold">Category scores <span className="font-normal text-muted">(weight in the overall score)</span></h2>
              <ul className="space-y-2.5">
                {s.categories.map((c) => (
                  <li key={c.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_3rem]">
                    <a href={`#cat-${c.key}`} className="truncate hover:underline" title={c.label}>{c.label} <span className="text-xs text-muted">{c.weight}%</span></a>
                    <span className="relative h-3 rounded-full bg-surface-muted">
                      {c.score != null && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(2, c.score)}%`, background: lhColor(c.score) }} />}
                    </span>
                    <span className="text-right font-semibold tabular-nums" style={{ color: lhColor(c.score) }}>{c.score ?? "—"}</span>
                  </li>
                ))}
              </ul>
              {s.summary.length > 0 && <div className="mt-4 space-y-1 border-t border-hairline pt-3 text-sm text-secondary">{s.summary.map((x) => <p key={x}>{x}</p>)}</div>}
            </div>
          </section>

          <section aria-label="Check heatmap" className="mt-4 rounded-[10px] border border-border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Every check at a glance</h2>
            <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
              {s.categories.map((c) => (
                <div key={c.key} className="min-w-0">
                  <p className="mb-1 text-xs font-medium text-muted">{c.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {c.checks.length === 0 ? <span className="text-xs text-faint">no data</span> : c.checks.map((x) => (
                      <a key={x.id} href={`#cat-${c.key}`} title={`${x.label}: ${x.evidence}${x.deduct ? ` (−${x.deduct})` : ""}`}
                        className={cn("size-5 rounded", x.status === "pass" ? "bg-positive/70" : x.status === "warn" ? "bg-warn/70" : x.status === "fail" ? "bg-negative/75" : "bg-surface-muted")} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 flex flex-wrap gap-3 text-xs text-muted"><span><span className="mr-1 inline-block size-2.5 rounded-sm bg-positive/70" />pass</span><span><span className="mr-1 inline-block size-2.5 rounded-sm bg-warn/70" />warning</span><span><span className="mr-1 inline-block size-2.5 rounded-sm bg-negative/75" />fail</span><span><span className="mr-1 inline-block size-2.5 rounded-sm bg-surface-muted" />not measured / info</span></p>
          </section>

          <div className="mt-6">
            <ResearchTable title="Recommended changes (highest priority first)" rows={recRows as unknown as Record<string, unknown>[]} searchKeys={["problem", "change", "pagesText"]} csvName={`technical-seo-${cache.target.domain}`}
              columns={[
                { key: "priority", label: "Priority", type: "badge" }, { key: "category", label: "Category" }, { key: "problem", label: "Problem" }, { key: "change", label: "Exact change" },
                { key: "pagesText", label: "Affected pages" }, { key: "pageCount", label: "Pages", type: "int" }, { key: "impact", label: "Impact", type: "badge" }, { key: "effort", label: "Effort", type: "badge" },
                { key: "expected", label: "Expected result" }, { key: "points", label: "Points lost", type: "int", hint: "Points this check takes off its category score" }, { key: "source", label: "Source", type: "badge" },
              ]}
              facets={[{ key: "priority", label: "Priority" }, { key: "category", label: "Category" }, { key: "source", label: "Source" }]}
              presets={[{ label: "Critical", where: [{ key: "priority", op: "eq", value: "Critical" }] }, { label: "High priority", where: [{ key: "priority", op: "eq", value: "High" }] }, { label: "Quick wins (low effort)", where: [{ key: "effort", op: "eq", value: "Low" }] }]}
              empty="No changes recommended: every measured check passes." />
          </div>

          {speedRows.length > 0 && (
            <div className="mt-6">
              <ResearchTable title="Page speed per page (newest Lighthouse test)" rows={speedRows as unknown as Record<string, unknown>[]} searchKeys={["page"]} csvName={`technical-speed-${cache.target.domain}`} initialSort={{ key: "performance", dir: "asc" }}
                columns={[
                  { key: "page", label: "Page", type: "url" }, { key: "device", label: "Device", type: "badge" }, { key: "performance", label: "Performance", type: "int" }, { key: "seo", label: "SEO", type: "int" },
                  { key: "accessibility", label: "Accessibility", type: "int" }, { key: "best_practices", label: "Best practices", type: "int" },
                  { key: "lcp", label: "LCP (ms)", type: "int", hint: "good ≤ 2500, poor > 4000" }, { key: "tbt", label: "TBT (ms)", type: "int", hint: "good ≤ 200, poor > 600" },
                  { key: "cls", label: "CLS", type: "dec", hint: "good ≤ 0.1, poor > 0.25" }, { key: "ttfb", label: "TTFB (ms)", type: "int", hint: "good ≤ 800, poor > 1800" }, { key: "at", label: "Tested", type: "date" },
                ]}
                facets={[{ key: "device", label: "Device" }]} note={`Real-user data: ${s.sources.crux}`} />
            </div>
          )}

          <section aria-label="Checks by category" className="mt-6 grid gap-4 lg:grid-cols-2">
            {s.categories.map((c) => (
              <div key={c.key} id={`cat-${c.key}`} className="min-w-0 scroll-mt-20 rounded-[10px] border border-border bg-surface p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">{c.label} <span className="font-normal text-muted">· weight {c.weight}%</span></h2>
                  <span className="text-lg font-bold tabular-nums" style={{ color: lhColor(c.score) }}>{c.score ?? "—"}</span>
                </div>
                {c.checks.length === 0 ? <p className="text-sm text-muted">Not measured yet.</p> : (
                  <ul className="space-y-2">
                    {c.checks.map((x) => (
                      <li key={x.id} className="flex items-start gap-2 text-sm">
                        <StatusIcon s={x.status} />
                        <span className="min-w-0 flex-1"><span className="font-medium">{x.label}</span> <span className="break-words text-muted">{x.evidence}</span> <span className="text-xs text-faint">· {x.source}</span></span>
                        <span className={cn("shrink-0 tabular-nums text-xs", x.deduct ? "font-semibold text-negative" : "text-faint")}>{x.deduct ? `−${x.deduct}` : x.status === "na" ? "n/a" : "0"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>

          {pageRows.length > 0 && (
            <div className="mt-6">
              <ResearchTable title="Sampled pages (site checks)" rows={pageRows as unknown as Record<string, unknown>[]} searchKeys={["url", "schema"]} csvName={`technical-pages-${cache.target.domain}`}
                columns={[
                  { key: "url", label: "Page", type: "url" }, { key: "status", label: "Status", type: "int" }, { key: "hops", label: "Redirects", type: "int" },
                  { key: "title_len", label: "Title chars", type: "int", hint: "30-60" }, { key: "desc_len", label: "Description chars", type: "int", hint: "70-160" }, { key: "h1", label: "H1s", type: "int" },
                  { key: "words", label: "Words", type: "int" }, { key: "canonical", label: "Canonical", type: "badge" }, { key: "noindex", label: "Noindex", type: "bool" },
                  { key: "schema", label: "Schema types" }, { key: "img_no_alt", label: "Images w/o alt", type: "int" }, { key: "in_sitemap", label: "In sitemap", type: "bool" }, { key: "mixed", label: "Mixed content", type: "int" },
                ]}
                facets={[{ key: "canonical", label: "Canonical" }]}
                note={checks ? `robots.txt ${checks.robots.status ?? "no response"} · ${checks.sitemaps.filter((m) => m.valid).length} valid sitemap file(s) with ${checks.sitemapUrls.toLocaleString("en-US")} URLs · HTTP→HTTPS ${checks.https.httpToHttps ? "yes" : "no"} · HSTS ${checks.https.hsts ? "yes" : "no"}` : undefined} />
            </div>
          )}
          <p className="mt-4 text-xs text-muted">Method: each category starts at 100 and loses the points shown per failed check; the overall score is the weighted average of measured categories. Crawl details are on <Link href="/site-audit" className="underline underline-offset-2">Site Audit</Link>.</p>
        </>
      )}
    </>
  );
}
