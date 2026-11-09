import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { ResearchTable } from "@/components/research/research-table";
import { BackToToolkit, Card, day, FixList, type Fix } from "@/components/toolkit/bits";
import { ScanRun } from "@/components/toolkit/scan-run";
import { researchPage } from "@/lib/dataforseo/view";
import { createClient } from "@/lib/supabase/server";
import { loadScan, TK } from "@/lib/toolkit/site-scan";

export const maxDuration = 300;
type H = { checkedAt: string; pages: { url: string; status: number | null; lang: string | null; hreflang: { lang: string; href: string }[]; contentLanguage: string | null }[] };
const VALID = /^(x-default|[a-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|\d{3}))?)$/;

/** International SEO check. Rules from the claude-seo seo-hreflang skill (MIT, github.com/AgricIDaniel/claude-seo). */
export default async function HreflangPage() {
  const page = await researchPage();
  if (!page) return null;
  const { client, canEdit, cache } = page;
  const header = <><BackToToolkit /><TabHeader source={null} title="International / hreflang" description="Checks whether the website serves more than one language or country and, if it does, whether the hreflang tags are valid. A single-language local site doesn't need hreflang; this page says so plainly instead of inventing work." guide={[
    { term: "Checks when present", text: "Valid ISO language(-region) codes, a self-referencing entry, x-default, absolute URLs and return links between alternates." },
    { term: "lang attribute", text: "<html lang> should be set on every page; it helps screen readers and confirms the page language to search engines." },
    { term: "Method", text: "Adapted from the open-source claude-seo seo-hreflang skill (MIT licence). Free: reads the client's own website." },
  ]} /></>;
  if (!cache.target) return <>{header}<EmptyState title="No website yet" body="Set the client's website so it can be scanned." action={{ href: "/integrations", label: "Open Integrations" }} /></>;
  const supabase = await createClient();
  const stored = await loadScan<H>(supabase, client.id, TK.hreflang);
  const top = (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <p className="text-xs text-muted"><span className="font-medium text-foreground">{cache.target.domain}</span> · scanned {day(stored?.fetchedAt)} · refreshed weekly</p>
      <ScanRun canEdit={canEdit} />
    </div>
  );
  if (!stored) return <>{header}{top}<EmptyState title="Not scanned yet" body="Run the free scan to read the language tags of the key pages." /></>;
  const pages = stored.data.pages.filter((p) => p.status === 200);
  const langs = new Map<string, number>();
  for (const p of pages) { const l = (p.lang ?? "(none)").toLowerCase(); langs.set(l, (langs.get(l) ?? 0) + 1); }
  const withH = pages.filter((p) => p.hreflang.length);
  const primary = [...new Set(pages.map((p) => (p.lang ?? "").toLowerCase().split("-")[0]).filter(Boolean))];
  const single = withH.length === 0 && primary.length <= 1;
  const noLang = pages.filter((p) => !p.lang);

  const fixes: Fix[] = [];
  if (noLang.length) fixes.push({ prio: "Low", issue: "Pages without <html lang>", count: noLang.length, fix: "Set the site language in WordPress (Settings > General > Site Language); the theme then outputs lang=\"en-US\"." });
  const byUrl = new Map(pages.map((p) => [p.url.replace(/\/$/, ""), p]));
  for (const p of withH) {
    const bad = p.hreflang.filter((h) => !VALID.test(h.lang));
    if (bad.length) fixes.push({ prio: "High", issue: `Invalid hreflang codes on ${p.url}`, fix: `Use ISO 639-1 language (+ ISO 3166 region) codes: ${bad.map((b) => b.lang).join(", ")} are invalid.` });
    if (!p.hreflang.some((h) => h.href.replace(/\/$/, "") === p.url.replace(/\/$/, ""))) fixes.push({ prio: "High", issue: `No self-referencing hreflang on ${p.url}`, fix: "Each page must list itself among its alternates." });
    if (!p.hreflang.some((h) => h.lang === "x-default")) fixes.push({ prio: "Medium", issue: `No x-default on ${p.url}`, fix: "Add an x-default alternate pointing to the language selector or main version." });
    if (p.hreflang.some((h) => !/^https?:\/\//.test(h.href))) fixes.push({ prio: "High", issue: `Relative hreflang URLs on ${p.url}`, fix: "hreflang href values must be absolute URLs." });
    for (const h of p.hreflang) { const t = byUrl.get(h.href.replace(/\/$/, "")); if (t && t !== p && !t.hreflang.some((x) => x.href.replace(/\/$/, "") === p.url.replace(/\/$/, ""))) fixes.push({ prio: "High", issue: `Missing return link ${t.url} → ${p.url}`, fix: "Alternates must reference each other both ways, or Google ignores the pair." }); }
  }

  return (
    <>
      {header}{top}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Verdict" value={single ? "Not needed" : withH.length ? "In use" : "Check"} sub={single ? "single-language site" : `${primary.length} languages`} tone={single ? "good" : fixes.some((f) => f.prio === "High") ? "bad" : "good"} />
        <StatCard label="Pages checked" value={String(pages.length)} />
        <StatCard label="Pages with hreflang" value={String(withH.length)} tone={withH.length && !single ? "good" : undefined} />
        <StatCard label="Pages with lang attribute" value={`${pages.length - noLang.length} / ${pages.length}`} tone={noLang.length ? "warn" : "good"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Verdict">
          {single ? (
            <p className="text-sm text-secondary">Every page checked is in <span className="font-medium text-foreground">{[...langs.keys()].join(", ")}</span> and none declares alternates. This is a single-language site serving one market, so <span className="font-medium text-foreground">hreflang is not needed</span>. Revisit only if a Spanish (or other language) version of the site is added.</p>
          ) : (
            <p className="text-sm text-secondary">The site declares {withH.length ? "hreflang alternates" : "more than one page language"}. The checks on the right validate the setup.</p>
          )}
          <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">{[...langs].map(([l, n]) => <li key={l} className="rounded-md bg-surface-muted px-2 py-0.5">{l} · {n} pages</li>)}</ul>
        </Card>
        <Card title="Fixes"><FixList fixes={fixes} empty={single ? "Nothing to fix: language tags are consistent." : "hreflang setup is valid."} /></Card>
      </div>
      <div className="mt-6">
        <ResearchTable title="Language tags per page" csvName={`hreflang-${cache.target.domain}`} searchKeys={["page"]}
          rows={pages.map((p) => ({ page: p.url, lang: p.lang ?? "(none)", content_language: p.contentLanguage ?? "—", hreflang: p.hreflang.length ? p.hreflang.map((h) => h.lang).join(", ") : "none" }))}
          columns={[{ key: "page", label: "Page", type: "url" }, { key: "lang", label: "<html lang>", type: "badge" }, { key: "content_language", label: "Content-Language header" }, { key: "hreflang", label: "hreflang alternates" }]} />
      </div>
    </>
  );
}
