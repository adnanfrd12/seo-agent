import "server-only";
import type { BriefRun } from "@/lib/toolkit/brief";
import { clusterEstimate, MAX_SERP, type ClusterRun } from "@/lib/toolkit/cluster";
import type { CompRun } from "@/lib/toolkit/comparison";
import type { ContentRun } from "@/lib/toolkit/content";
import type { PageReport } from "@/lib/toolkit/page";
import type { AiReady, DriftData, ImageAudit, ProgrammaticData } from "@/lib/toolkit/site-scan";
import { SERP_EST } from "@/lib/toolkit/store";
import { MAX_SXO, sxoEstimate, type SxoRun } from "@/lib/toolkit/sxo";
import { TOOLS } from "@/lib/toolkit/tools";
import { cut, money } from "./shared";

/**
 * The SEO Toolkit tools Nova can run, with the costs and waits the toolkit pages show on their Run buttons
 * (src/app/(dashboard)/toolkit/<slug>/page.tsx), and compact summaries of their stored results.
 */
export const RUN_SLUGS = ["seo-page", "seo-content", "seo-content-brief", "seo-cluster", "seo-sxo", "seo-competitor-pages"] as const;
export const SCAN_SLUGS = ["seo-drift", "seo-agentic", "seo-images", "seo-hreflang", "seo-programmatic", "seo-ecommerce"] as const;
export const RUNNABLE = [...RUN_SLUGS, ...SCAN_SLUGS] as const;
export type Runnable = (typeof RUNNABLE)[number];
export const isScan = (s: string): s is (typeof SCAN_SLUGS)[number] => (SCAN_SLUGS as readonly string[]).includes(s);

export interface ToolSpec {
  /** cost as on the Run button, and spelled out */
  short: string; cost: string;
  /** most it can cost in DataForSEO calls (for the daily limit), and the smallest single call */
  dfs: number; dfsStep: number;
  /** runs Claude (counts toward the client's monthly Claude budget) */
  claude: boolean;
  seconds: number;
  wait: string;
}
export const SPEC: Record<Runnable, ToolSpec> = {
  "seo-page": { short: "free", cost: "free (reads the page from the client's website plus stored Lighthouse and Search Console data)", dfs: 0, dfsStep: 0, claude: false, seconds: 30, wait: "about 30 seconds (reads the page and its images)" },
  "seo-content": { short: "≈$0.005", cost: "about $0.005 (Claude Haiku, about $0.0005 a page)", dfs: 0, dfsStep: 0, claude: true, seconds: 45, wait: "about 30-60 seconds (reads the pages and scores them)" },
  "seo-content-brief": { short: "≈$0.04", cost: `about $0.04 (one Google search ${money(SERP_EST)} + Claude Sonnet about $0.03)`, dfs: SERP_EST, dfsStep: SERP_EST, claude: true, seconds: 60, wait: "about 60 seconds (searches Google, reads the top pages, writes the brief)" },
  "seo-cluster": { short: `up to ${money(clusterEstimate())}`, cost: `up to ${money(clusterEstimate())} (up to ${MAX_SERP} Google searches at ${money(SERP_EST)}; searches stored by other toolkit runs in the last 14 days are reused free)`, dfs: clusterEstimate(), dfsStep: SERP_EST, claude: false, seconds: 90, wait: `about 1-2 minutes (searches Google for up to ${MAX_SERP} keywords)` },
  "seo-sxo": { short: `up to ${money(sxoEstimate())}`, cost: `up to ${money(sxoEstimate())} (${MAX_SXO} Google searches at ${money(SERP_EST)}; stored searches are reused free)`, dfs: sxoEstimate(), dfsStep: SERP_EST, claude: false, seconds: 60, wait: `about 1 minute (searches Google for ${MAX_SXO} keywords)` },
  "seo-competitor-pages": { short: "under $0.01", cost: "under $0.01 (Claude Haiku; uses stored competitor data, no DataForSEO call)", dfs: 0, dfsStep: 0, claude: true, seconds: 30, wait: "about 30 seconds (drafts outlines from the stored competitor data)" },
  ...Object.fromEntries(SCAN_SLUGS.map((s) => [s, { short: "free", cost: "free (reads the client's own website)", dfs: 0, dfsStep: 0, claude: false, seconds: 120, wait: "one to three minutes (scans up to 25 key pages)" }])) as Record<(typeof SCAN_SLUGS)[number], ToolSpec>,
};

export const toolTitle = (slug: string) => TOOLS.find((t) => t.slug === slug)?.title ?? slug;
export const RESULT_SLUGS = RUNNABLE;

type Row = Record<string, unknown>;
const host = (u: string | null | undefined) => { try { return new URL(String(u)).pathname || "/"; } catch { return u ?? null; } };

/** A compact view of a tool's stored result (the full result can be hundreds of KB). */
export function compactResult(slug: string, data: unknown): unknown {
  switch (slug) {
    case "seo-page": {
      const r = data as PageReport;
      return {
        url: r.finalUrl, status: r.status, score: r.score, areas: r.areas, fixes: r.fixes.map((f) => ({ prio: f.prio, area: f.area, issue: f.issue, fix: f.fix })),
        title: cut(r.title, 120), title_chars: r.titleLen, description: cut(r.desc, 170), description_chars: r.descLen,
        h1: r.headings.filter((h) => h.level === 1).map((h) => cut(h.text, 100)), words: r.words, readability: { flesch: r.read.flesch, grade: r.read.grade },
        canonical: r.canonical, noindex: r.noindex, schema: r.schema, links: r.links,
        images: { count: r.images.length, no_alt: r.images.filter((i) => !i.alt?.trim()).length, over_200kb: r.images.filter((i) => (i.kb ?? 0) > 200).length, no_size: r.images.filter((i) => !i.width).length },
        lighthouse_mobile: r.lighthouse.find((x) => x.device === "mobile")?.performance ?? null, top_queries: r.queries.slice(0, 10),
      };
    }
    case "seo-content": {
      const r = data as ContentRun;
      return {
        mode: r.mode === "blog" ? "top 10 blog posts" : "one page", ai_cost: r.cost,
        pages: r.pages.map((p) => ({
          url: p.url, title: cut(p.title, 90), score: p.score, words: p.words, flesch: p.read.flesch, thin: p.thin, clicks_90d: p.clicks, error: p.error,
          eeat: p.ai ? { experience: p.ai.experience, expertise: p.ai.expertise, authority: p.ai.authoritativeness, trust: p.ai.trust, ai_citation: p.ai.ai_citation } : null,
          issues: p.ai?.issues.slice(0, 3), fixes: p.ai?.fixes.slice(0, 3),
        })),
      };
    }
    case "seo-content-brief": {
      const r = data as BriefRun;
      return { keyword: r.keyword, brief: r.brief, competitors: r.competitors.map((c) => ({ position: c.position, domain: c.domain, words: c.words, headings: c.headings, score: c.score })), cost: r.cost };
    }
    case "seo-cluster": {
      const r = data as ClusterRun;
      return {
        keywords: r.totalKeywords, searched: r.searched, reused: r.reused, cost: r.cost,
        clusters: r.clusters.map((c) => ({ name: c.name, hub_keyword: c.hubKeyword, hub_page: host(c.hubPage), method: c.method, demand: c.demand, keywords: c.keywords.length, top: c.keywords.slice(0, 6).map((k) => k.keyword), pages: c.pages.length, action: c.action })),
        interlink: r.interlinks.slice(0, 10),
      };
    }
    case "seo-sxo": {
      const r = data as SxoRun;
      return {
        searched: r.searched, reused: r.reused, cost: r.cost, mismatches: r.rows.filter((x) => x.mismatch).length,
        rows: r.rows.map((x) => ({ keyword: x.keyword, position: x.position, our_page: host(x.ourUrl), our_type: x.ourType, google_ranks: `${x.dominant} (${x.dominantShare}%)`, mismatch: x.mismatch, local_pack: x.localPack, advice: x.advice })),
      };
    }
    case "seo-competitor-pages": {
      const r = data as CompRun;
      return {
        brand: r.brand, competitors: r.stats.map((s) => ({ domain: s.domain, keywords: s.keywords, traffic: s.traffic == null ? null : Math.round(s.traffic), shared: s.shared })),
        pages: r.pages.map((p) => ({ kind: p.kind, competitor: p.competitor, title_tag: p.title_tag, h1: p.h1, slug: p.slug, target_keyword: p.target_keyword, sections: p.sections.map((s) => s.heading), proof_needed: p.proof_needed })),
      };
    }
    case "seo-drift": {
      const r = data as DriftData;
      const sev: Record<string, number> = {};
      for (const c of r.changes) sev[c.severity] = (sev[c.severity] ?? 0) + 1;
      return {
        baseline_from: r.baselineAt.slice(0, 10), last_check: r.checkedAt.slice(0, 10), checks: r.checks.map((c) => c.slice(0, 10)), pages: Object.keys(r.latest).length, changes_by_severity: sev,
        changes: r.changes.slice(0, 30).map((c) => ({ page: host(c.url), field: c.field, before: cut(c.before, 90), after: cut(c.after, 90), severity: c.severity, detected: c.detected.slice(0, 10) })),
      };
    }
    case "seo-agentic": {
      const r = data as AiReady;
      return {
        llms_txt: r.llms, robots: { status: r.robots.status, content_signal: r.robots.contentSignal, blocked_or_partial: r.robots.bots.filter((b) => b.access !== "allowed").map((b) => `${b.ua} (${b.owner}, ${b.purpose}): ${b.access}`), allowed: r.robots.bots.filter((b) => b.access === "allowed").length },
        entity: r.entity, draft_llms_txt_chars: r.draft.length,
        pages: [...r.pages].sort((a, b) => a.citability - b.citability).slice(0, 12).map((p) => ({ page: host(p.url), citability: p.citability, words: p.words, question_headings: p.questionHeadings, answer_paragraphs: p.answerParagraphs, faq: p.faq })),
      };
    }
    case "seo-images": {
      const r = data as ImageAudit;
      const files = new Map<string, ImageAudit["images"][number] & { uses: number }>();
      for (const i of r.images) { const f = files.get(i.src); if (f) f.uses++; else files.set(i.src, { ...i, uses: 1 }); }
      const list = [...files.values()];
      const raster = list.filter((f) => f.format !== "svg");
      return {
        pages: r.pages, image_uses: r.images.length, unique_files: list.length,
        over_500kb: list.filter((f) => (f.bytes ?? 0) > 500 * 1024).length, kb_200_500: list.filter((f) => (f.bytes ?? 0) > 200 * 1024 && (f.bytes ?? 0) <= 500 * 1024).length,
        old_formats_without_webp: raster.filter((f) => ["jpg", "png", "gif", "bmp", "tif", "tiff"].includes(f.format) && !f.inPicture).length,
        no_width_height: r.images.filter((i) => i.format !== "svg" && (!i.width || !i.height)).length, no_alt: r.images.filter((i) => i.alt === null).length, empty_alt: r.images.filter((i) => i.alt === "").length,
        hero_lazy_loaded: r.images.filter((i) => i.aboveFold && i.loading?.startsWith("lazy")).length, below_fold_not_lazy: r.images.filter((i) => !i.aboveFold && !i.loading).length,
        heaviest: list.filter((f) => f.bytes != null).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 10).map((f) => ({ file: f.src, kb: Math.round((f.bytes ?? 0) / 1024), format: f.format, page: host(f.page), alt: cut(f.alt, 60) })),
      };
    }
    case "seo-hreflang": {
      const r = data as { pages: { url: string; lang: string | null; status: number | null; hreflang: unknown[]; contentLanguage: string | null }[] };
      const langs = [...new Set(r.pages.map((p) => p.lang).filter(Boolean))];
      return { pages: r.pages.length, html_lang_values: langs, pages_without_lang: r.pages.filter((p) => !p.lang && p.status === 200).length, pages_with_hreflang: r.pages.filter((p) => p.hreflang?.length).length, examples: r.pages.filter((p) => p.hreflang?.length).slice(0, 5) };
    }
    case "seo-programmatic": {
      const r = data as ProgrammaticData;
      return { wordpress: r.wp, service_pages: r.services.length, services: r.services.slice(0, 40).map((s) => `${s.title} (${s.path})`), other_pages: r.otherPages.slice(0, 15), sitemap_urls: r.sitemapUrls };
    }
    default:
      return data as Row;
  }
}
