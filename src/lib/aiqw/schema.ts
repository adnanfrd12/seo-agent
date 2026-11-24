import { z } from "zod";

/** Quick-win types Claude may assign (the Search Console and GA4 rule types plus the DataForSEO / crawl ones). */
export const QW_TYPES = [
  "Title rewrite", "Meta description", "Add query to title/H1", "Answer a question (H2)", "FAQ + schema", "Snippet / AI answer format", "AI search content",
  "Internal links", "New page", "Content refresh", "Merge / redirect", "Get indexed", "Technical fix", "Sitemap", "Rich results", "Image SEO", "Mobile gap",
  "Local SEO", "Brand and trust", "CTR dropped", "Page with no clicks", "Page with no impressions",
  "Landing page CTA", "Blog CTA", "Mobile call button", "Form fix", "Tracking gap", "AI assistant traffic", "Local proof", "Answer every call", "Ads budget",
  "Data quality", "Promote a winner", "Engagement fix",
  "Keyword gap page", "SERP feature", "Google Business Profile", "Reviews", "Backlink outreach", "On-page fix", "Page speed",
] as const;

export const QuickWinItemSchema = z.object({
  candidate_id: z.string().describe("The candidate_id from the input, exactly"),
  keep: z.boolean().describe("false when the candidate isn't worth doing or is covered by another item"),
  skip_reason: z.string().nullable(),
  title: z.string().describe("Imperative, names the page, at most 120 characters"),
  type: z.enum(QW_TYPES),
  page_url: z.string().describe("The candidate's page_url, or another URL from the input"),
  where: z.string().describe("Exact place on the page"),
  why: z.string().describe("Two sentences that quote only numbers given in the input"),
  steps: z.array(z.string()).describe("3 to 6 specific steps"),
  suggested_change: z.string().nullable().describe("Ready-to-paste text"),
  queries_to_use: z.array(z.string()),
  effort: z.enum(["Low", "Medium", "High"]),
  confidence: z.enum(["High", "Medium", "Low"]),
  measure: z.string(),
  plain_summary: z.string().describe("One sentence for the business owner"),
});
export type QuickWinItem = z.infer<typeof QuickWinItemSchema>;

export const QuickWinsSchema = z.object({
  items: z.array(QuickWinItemSchema),
  merged: z.array(z.object({ into_candidate_id: z.string(), merged_candidate_ids: z.array(z.string()) })),
});
export type QuickWinsOutput = z.infer<typeof QuickWinsSchema>;

/** One item, for the single-item repair call. */
export const RepairSchema = z.object({ item: QuickWinItemSchema });
