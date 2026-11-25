// Shared registry for the SEO Toolkit hub (/toolkit). Multiple agents append here.
// Methodology adapted from the MIT-licensed claude-seo skills: https://github.com/AgricIDaniel/claude-seo
export interface ToolkitTool {
  slug: string; // route: /toolkit/<slug> (or an absolute href when it starts with "/")
  title: string;
  description: string;
  source: string; // data source(s) shown on the card
}

export const TOOLS: ToolkitTool[] = [
  { slug: "seo-page", title: "Page Analyzer", description: "On-page audit of any URL, scored, with prioritised fixes.", source: "Live fetch + GSC + Lighthouse" },
  { slug: "seo-content", title: "Content Quality", description: "E-E-A-T, readability, thin content and AI-citation readiness.", source: "Live fetch + Claude Haiku" },
  { slug: "seo-content-brief", title: "Content Brief", description: "A writing brief for a keyword, built from the top Google results.", source: "DataForSEO SERP + Claude Sonnet" },
  { slug: "seo-cluster", title: "Keyword Clustering", description: "Groups your keywords into topic clusters mapped to your pages.", source: "DataForSEO + GSC" },
  { slug: "seo-sxo", title: "Intent / SXO Check", description: "Flags keywords where your page type doesn't match what Google ranks.", source: "DataForSEO SERP" },
  { slug: "seo-competitor-pages", title: "Comparison Pages", description: "Plans \"vs\" and \"alternatives\" pages against your competitors.", source: "Stored competitor data + Claude" },
  { slug: "/strategy", title: "30-Day SEO Plan", description: "Your 30-day strategy from all connected data.", source: "Existing strategy" },
  // ---- site-scan tools (free own-site reads; see src/lib/toolkit/site-scan.ts) + reference tools
  { slug: "seo-drift", title: "SEO Drift Monitor", description: "Watches ~25 key pages weekly and flags SEO regressions.", source: "Own-site scan (free), weekly" },
  { slug: "seo-agentic", title: "AI Readiness", description: "llms.txt, AI crawler rules, entity schema and citability, with an llms.txt draft.", source: "Own-site scan + AI Visibility" },
  { slug: "seo-images", title: "Image Audit", description: "Image sizes, formats, dimensions, lazy loading and alt text on key pages.", source: "Own-site scan (free)" },
  { slug: "seo-disavow", title: "Disavow Candidates", description: "Spammy referring domains, with a downloadable disavow.txt.", source: "Stored DataForSEO backlinks" },
  { slug: "seo-hreflang", title: "International / hreflang", description: "Checks language and hreflang tags.", source: "Own-site scan (free)" },
  { slug: "seo-programmatic", title: "Service x Area Planner", description: "Service × area matrix: coverage, gaps and thin-content safeguards.", source: "WordPress + Blog Content" },
  { slug: "seo-flow", title: "FLOW Prompt Library", description: "41 ready-to-copy SEO prompts filled in for this client (FLOW, CC BY 4.0, Daniel Agrici).", source: "FLOW framework" },
  { slug: "seo-ecommerce", title: "E-commerce SEO", description: "Product and category SEO for sites with a product catalogue.", source: "Own-site scan (free)" },
  { slug: "seo-image-gen", title: "Image Generation", description: "AI images for posts and pages. Needs a Gemini API key.", source: "Needs a Gemini API key" },
];

export function toolHref(t: ToolkitTool): string {
  return t.slug.startsWith("/") ? t.slug : `/toolkit/${t.slug}`;
}
