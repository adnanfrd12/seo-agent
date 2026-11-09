import Link from "next/link";
import { StatCard } from "@/components/dashboard/kpi-card";
import { EmptyState } from "@/components/dashboard/page-header";
import { TabHeader } from "@/components/dashboard/tab-header";
import { Columns } from "@/components/charts/ai-charts";
import { ResearchTable } from "@/components/research/research-table";
import { BackToToolkit, Card, day } from "@/components/toolkit/bits";
import { DownloadText } from "@/components/toolkit/text-file";
import { researchPage } from "@/lib/dataforseo/view";

type Rd = { domain: string | null; rank: number | null; backlinks: number | null; first_seen: string | null; lost: string | null; spam: number | null; nofollow: number | null };
type Bl = { domain: string | null; spam: number | null; rank: number | null; dofollow: boolean; anchor: string | null; from: string | null };
const bareD = (d: string | null) => (d ? d.toLowerCase().replace(/^www\./, "") : null);
const SPAM_TLD = /\.(xyz|top|click|loan|work|gq|ml|cf|tk|ga|buzz|monster|rest|icu|cyou|sbs)$/i;

/**
 * Disavow candidates from STORED backlink data (no new paid call). Thresholds follow the claude-seo seo-backlinks skill
 * (MIT, github.com/AgricIDaniel/claude-seo): DataForSEO spam score 60+ = likely toxic, 30-59 = review. Google advises
 * disavowing only for manual actions or clear link schemes, so the file is a reviewed starting point, not an automatic upload.
 */
export default async function DisavowPage() {
  const page = await researchPage();
  if (!page) return null;
  const { cache } = page;
  const header = <><BackToToolkit /><TabHeader source="dfs" title="Disavow Candidates" description="Referring domains that look toxic or spammy, from the backlink data already stored for this client, with a ready Google disavow.txt. Review before uploading: Google ignores most spam links on its own and disavowing good links can hurt." guide={[
    { term: "Spam score", text: "DataForSEO's 0-100 backlink spam score for the referring domain. 60+ = likely toxic (included in the file), 30-59 = review." },
    { term: "Extra signals", text: "Spammy free TLDs (.xyz, .top, .click…), domain rank 0 with many links, and all-dofollow link blasts raise the tier." },
    { term: "When to use", text: "Only after a manual action in Search Console, or with a clear paid/link-scheme pattern. Upload at search.google.com/search-console/disavow-links." },
    { term: "Method", text: "Adapted from the open-source claude-seo seo-backlinks skill (MIT licence). Uses stored data: no extra cost." },
  ]} /></>;
  const rd = cache.get<{ rows: Rd[] }>("referring_domains");
  const bl = cache.get<{ rows: Bl[] }>("backlinks");
  if (!rd && !bl) return <>{header}<EmptyState title="No backlink data yet" body="Load referring domains on the Backlinks page first; this tool then reads them for free." action={{ href: "/backlinks", label: "Open Backlinks" }} /></>;

  const map = new Map<string, Rd & { links: number; anchors: Set<string>; dofollow: number }>();
  for (const r0 of rd?.data.rows ?? []) { const r = { ...r0, domain: bareD(r0.domain) }; if (!r.domain) continue; const had = map.get(r.domain); if (had) { had.links += r.backlinks ?? 0; had.spam = Math.max(had.spam ?? 0, r.spam ?? 0); continue; } map.set(r.domain, { ...r, links: r.backlinks ?? 0, anchors: new Set(), dofollow: Math.max(0, (r.backlinks ?? 0) - (r.nofollow ?? 0)) }); }
  for (const b0 of bl?.data.rows ?? []) {
    const b = { ...b0, domain: bareD(b0.domain) };
    if (!b.domain) continue;
    const m = map.get(b.domain) ?? { domain: b.domain, rank: b.rank, backlinks: 0, first_seen: null, lost: null, spam: b.spam, nofollow: 0, links: 0, anchors: new Set<string>(), dofollow: 0 };
    if (!map.has(b.domain)) { m.links++; if (b.dofollow) m.dofollow++; }
    if (b.anchor) m.anchors.add(b.anchor);
    m.spam = Math.max(m.spam ?? 0, b.spam ?? 0);
    map.set(b.domain, m);
  }
  const rows = [...map.values()].map((d) => {
    const reasons: string[] = [];
    const spam = d.spam ?? 0;
    if (spam >= 60) reasons.push(`spam score ${spam}`); else if (spam >= 30) reasons.push(`spam score ${spam} (review)`);
    if (SPAM_TLD.test(d.domain ?? "")) reasons.push("spammy TLD");
    if ((d.rank ?? 0) === 0 && d.links >= 20) reasons.push(`rank 0 with ${d.links} links`);
    if (d.links >= 50 && d.dofollow === d.links) reasons.push("all-dofollow link blast");
    const strong = spam >= 60 || (spam >= 30 && reasons.length >= 2);
    const tier = strong ? "Disavow" : reasons.length ? "Review" : "Keep";
    return { domain: d.domain ?? "", tier, spam: d.spam, rank: d.rank, links: d.links, dofollow: d.dofollow, first_seen: d.first_seen, lost: d.lost ? "lost" : "live", reasons: reasons.join(", ") || "—" };
  });
  const disavow = rows.filter((r) => r.tier === "Disavow").sort((a, b) => (b.spam ?? 0) - (a.spam ?? 0));
  const review = rows.filter((r) => r.tier === "Review");
  const stamp = new Date().toISOString().slice(0, 10);
  const file = (list: typeof rows) => [`# Disavow file for ${cache.target?.domain ?? "site"}, generated ${stamp} from stored DataForSEO backlink data.`, "# Review every line before uploading to Google Search Console.", ...list.map((r) => `domain:${r.domain}`)].join("\n") + "\n";
  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((lo) => ({ label: `${lo}-${lo + 9}`, value: rows.filter((r) => (r.spam ?? 0) >= lo && (r.spam ?? 0) < lo + 10).length, highlight: lo >= 60 }));

  return (
    <>
      {header}
      <p className="mb-5 text-xs text-muted"><span className="font-medium text-foreground">{cache.target?.domain}</span> · referring domains stored {day(rd?.fetchedAt)} · backlinks stored {day(bl?.fetchedAt)} · refresh them on <Link href="/backlinks" className="underline">Backlinks</Link></p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Referring domains checked" value={rows.length.toLocaleString()} />
        <StatCard label="Disavow candidates" value={String(disavow.length)} sub="spam 60+ or several signals" tone={disavow.length ? "bad" : "good"} />
        <StatCard label="To review" value={String(review.length)} sub="one weaker signal" tone={review.length ? "warn" : "good"} />
        <StatCard label="Clean" value={String(rows.length - disavow.length - review.length)} sub={`${rows.length ? Math.round(((rows.length - disavow.length - review.length) / rows.length) * 100) : 0}% of domains`} tone="good" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Columns title="Referring domains by spam score" sub="Highlighted: 60+ (likely toxic)" bins={bins} valueLabel="domains" />
        <Card title="disavow.txt" sub={`Google format, one domain: line per candidate. ${disavow.length} domains in the strict file, ${disavow.length + review.length} with the review list.`}
          right={<div className="flex flex-wrap gap-2"><DownloadText text={file(disavow)} filename={`disavow-${cache.target?.domain ?? "site"}.txt`} label="Strict" /><DownloadText text={file([...disavow, ...review])} filename={`disavow-incl-review-${cache.target?.domain ?? "site"}.txt`} label="Incl. review" /></div>}>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-muted p-3 text-xs">{disavow.length ? file(disavow) : "# No domain reaches the disavow threshold. Nothing to upload: Google already ignores ordinary low-quality links."}</pre>
        </Card>
      </div>
      <div className="mt-6">
        <ResearchTable title="Referring domains with risk signals" csvName={`disavow-candidates-${cache.target?.domain}`} searchKeys={["domain", "reasons"]} initialSort={{ key: "spam", dir: "desc" }}
          rows={rows.filter((r) => r.tier !== "Keep")}
          columns={[{ key: "domain", label: "Domain" }, { key: "tier", label: "Suggestion", type: "badge" }, { key: "spam", label: "Spam score", type: "spam" }, { key: "rank", label: "Domain rank", type: "int" }, { key: "links", label: "Backlinks", type: "int" }, { key: "dofollow", label: "Dofollow", type: "int" }, { key: "first_seen", label: "First seen", type: "date" }, { key: "lost", label: "Status", type: "badge" }, { key: "reasons", label: "Why" }]}
          facets={[{ key: "tier", label: "Suggestion" }, { key: "lost", label: "Status" }]} empty="No referring domain shows a spam signal." />
      </div>
    </>
  );
}
