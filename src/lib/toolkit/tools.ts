// Shared registry for the SEO Toolkit hub (/toolkit). Multiple agents append here.
// Methodology adapted from the MIT-licensed claude-seo skills: https://github.com/AgricIDaniel/claude-seo
export interface ToolkitTool {
  slug: string; // route: /toolkit/<slug> (or an absolute href when it starts with "/")
  title: string;
  description: string;
  source: string; // data source(s) shown on the card
}

export const TOOLS: ToolkitTool[] = [
  { slug: "seo-page", title: "Page Analyzer", description: "Deep on-page audit of any URL: titles, headings, links, schema, images, canonical/robots, speed and GSC queries, scored with prioritized fixes.", source: "Live fetch + GSC + Lighthouse" },
  { slug: "seo-content", title: "Content Quality", description: "E-E-A-T, readability, thin-content and AI-citation readiness for a URL or your top blog posts.", source: "Live fetch + Claude Haiku" },
  { slug: "seo-content-brief", title: "Content Brief", description: "SERP-driven brief for a keyword: sections, word counts, keyword placement, questions and competitor scoring.", source: "DataForSEO SERP + Claude Sonnet" },
  { slug: "seo-cluster", title: "Keyword Clustering", description: "Cluster your keywords by SERP overlap into a hub-and-spoke plan mapped to existing pages with internal-link suggestions.", source: "DataForSEO + GSC" },
  { slug: "seo-sxo", title: "Intent / SXO Check", description: "Compare the page types Google ranks for your top keywords with the page you rank, and flag intent mismatches.", source: "DataForSEO SERP" },
  { slug: "seo-competitor-pages", title: "Comparison Pages", description: "Plan \"vs\" and \"alternatives\" pages against your stored competitors.", source: "Stored competitor data + Claude" },
  { slug: "/strategy", title: "30-Day SEO Plan", description: "Your existing 30-day strategy, built from all connected data.", source: "Existing strategy" },
  // ---- site-scan tools (free own-site reads; see src/lib/toolkit/site-scan.ts) + reference tools
  { slug: "seo-drift", title: "SEO Drift Monitor", description: "Baseline of titles, descriptions, H1, canonical, robots, schema, word count and internal links on ~25 key pages; weekly re-check with dated regressions.", source: "Own-site scan (free), weekly" },
  { slug: "seo-agentic", title: "AI Readiness", description: "llms.txt, AI crawler rules in robots.txt, Content-Signal, entity schema and passage citability, combined with AI Visibility results; with a downloadable llms.txt draft.", source: "Own-site scan + AI Visibility" },
  { slug: "seo-images", title: "Image Audit", description: "File sizes, WebP/AVIF formats, width/height (layout shift), lazy loading and alt text across key pages, with prioritized fixes.", source: "Own-site scan (free)" },
  { slug: "seo-disavow", title: "Disavow Candidates", description: "Spammy referring domains from stored backlink data by spam score, with a downloadable Google disavow.txt.", source: "Stored DataForSEO backlinks" },
  { slug: "seo-hreflang", title: "International / hreflang", description: "Detects lang and hreflang tags; validates them when present or confirms a single-language site doesn't need them.", source: "Own-site scan (free)" },
  { slug: "seo-programmatic", title: "Service x Area Planner", description: "Service pages x neighbourhoods matrix from WordPress and blog geo data: existing coverage, gaps and thin-content safeguards.", source: "WordPress + Blog Content" },
  { slug: "seo-flow", title: "FLOW Prompt Library", description: "41 Find / Leverage / Optimize / Win / Local prompts (CC BY 4.0, Daniel Agrici), filled in with this client's context, ready to copy.", source: "FLOW framework" },
  { slug: "seo-ecommerce", title: "E-commerce SEO", description: "Product and category SEO. Checked automatically for a product catalogue (WooCommerce, Product schema).", source: "Own-site scan (free)" },
  { slug: "seo-image-gen", title: "Image Generation", description: "AI-generated images for posts and pages. Needs a Gemini API key before it can be built.", source: "Needs a Gemini API key" },
];

export function toolHref(t: ToolkitTool): string {
  return t.slug.startsWith("/") ? t.slug : `/toolkit/${t.slug}`;
}
