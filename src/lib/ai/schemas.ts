import { z } from "zod";

// Structured-output schemas. Kept to features structured outputs supports (objects, arrays,
// enums, nullable strings) - no length/range constraints in the schema itself.
const priority = z.enum(["high", "medium", "low"]);
const effort = z.enum(["small", "medium", "large"]);
const category = z.enum([
  "technical_seo", "on_page_seo", "content", "user_experience", "conversion", "local_seo", "measurement",
]);

export const metricRef = z.object({
  ref: z.string().describe("an evidence id exactly as given in the evidence package"),
  label: z.string(),
  value: z.string().describe("the value as shown in the evidence, copied not recalculated"),
});

export const recommendationSchema = z.object({
  category,
  title: z.string(),
  summary: z.string(),
  supporting_metrics: z.array(metricRef),
  evidence_references: z.array(z.string()).describe("evidence ids that support this recommendation"),
  target_url: z.string().nullable(),
  recommended_action: z.string(),
  priority,
  confidence: z.enum(["high", "medium", "low"]),
  estimated_effort: effort,
  expected_impact_hypothesis: z.string().describe("a hypothesis, never a guaranteed outcome"),
  success_metric: z.string(),
});

export const insightsSchema = z.object({
  executive_summary: z.string(),
  significant_improvements: z.array(z.object({ statement: z.string(), evidence_references: z.array(z.string()) })),
  significant_declines: z.array(z.object({ statement: z.string(), evidence_references: z.array(z.string()) })),
  recommendations: z.array(recommendationSchema),
  insufficient_evidence: z.array(z.string()).describe("questions the data cannot answer yet, and what would be needed"),
});
export type InsightsOutput = z.infer<typeof insightsSchema>;

export const strategySchema = z.object({
  summary: z.string(),
  weeks: z.array(z.object({
    week: z.number().int().describe("1, 2, 3 or 4"),
    theme: z.string(),
    tasks: z.array(z.object({
      title: z.string(),
      category,
      priority,
      target_url: z.string().nullable(),
      problem: z.string(),
      evidence_references: z.array(z.string()),
      description: z.string(),
      steps: z.array(z.string()),
      estimated_effort: effort,
      success_metric: z.string(),
    })),
  })),
});
export type StrategyOutput = z.infer<typeof strategySchema>;

export const extractionSchema = z.object({
  report_title: z.string().nullable(),
  reporting_period_start: z.string().nullable().describe("YYYY-MM-DD if stated in the document, else null"),
  reporting_period_end: z.string().nullable(),
  metrics: z.array(z.object({
    page_number: z.number().int().nullable(),
    source_name: z.string().nullable().describe("tool or platform the figure is attributed to, if stated"),
    original_label: z.string().describe("label exactly as written"),
    normalized_metric: z.enum([
      "ga4_users", "ga4_sessions", "ga4_engagement_rate", "ga4_key_events", "gsc_clicks", "gsc_impressions",
      "gsc_ctr", "gsc_position", "gbp_impressions", "gbp_call_clicks", "gbp_website_clicks", "gbp_direction_requests",
      "clarity_rage_clicks", "clarity_dead_clicks", "other",
    ]),
    value: z.number().nullable().describe("numeric value if the figure is a single number, else null"),
    value_text: z.string().describe("the value exactly as written, including units"),
    unit: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
  })),
  notes: z.array(z.string()).describe("caveats: placeholder data, unclear periods, image-only pages, etc."),
});
export type ExtractionOutput = z.infer<typeof extractionSchema>;
