import { ResearchTable } from "@/components/research/research-table";
import type { InternalOrphan, NoBacklinkPage } from "@/lib/audit/orphans";

type Row = Record<string, unknown>;

/** (a) Pages no other page on the site links to. */
export function InternalOrphansTable({ rows, crawled, note, domain }: { rows: InternalOrphan[]; crawled: number; note?: string; domain: string }) {
  return (
    <ResearchTable title={`No internal links pointing to them (${rows.length})`} rows={rows as unknown as Row[]} columns={[
      { key: "url", label: "Page", type: "url" }, { key: "title", label: "Title" },
      { key: "source", label: "Found by", type: "badge", hint: "crawl = the site crawl saw no link from another page; blog = a blog post the crawl didn't reach that no other post links to" },
      { key: "evidence", label: "Evidence" }, { key: "sitemap", label: "In sitemap", type: "bool" }, { key: "words", label: "Words", type: "int" },
    ]} searchKeys={["url", "title"]} facets={[{ key: "source", label: "Found by" }]} csvName={`internal-orphans-${domain}`}
      empty={crawled ? "Every crawled page has at least one internal link from another page." : "No crawl yet."}
      note={note ?? "Fix: link to each page from a related page, the menu or the footer, or redirect it if it's obsolete."} />
  );
}

/** (b) Live pages no other website links to. */
export function NoBacklinksTable({ rows, note, domain }: { rows: NoBacklinkPage[]; note?: string; domain: string }) {
  return (
    <ResearchTable title={`No backlinks from other websites (${rows.length})`} rows={rows as unknown as Row[]} columns={[
      { key: "url", label: "Page", type: "url" }, { key: "title", label: "Title" }, { key: "source", label: "Known from", type: "badge", hint: "Where the page was found: the site crawl, the blog, or pages ranking in Google" },
    ]} searchKeys={["url", "title"]} facets={[{ key: "source", label: "Known from" }]} csvName={`pages-without-backlinks-${domain}`}
      empty="Every known page has at least one backlink." note={note} />
  );
}
