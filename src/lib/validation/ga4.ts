import { z } from "zod";

// GA4 Data API runReport response (the subset we read). Values arrive as strings.
const cell = z.object({ value: z.string().optional() });
export const ga4ReportSchema = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string() })).default([]),
  metricHeaders: z.array(z.object({ name: z.string() })).default([]),
  rows: z
    .array(z.object({ dimensionValues: z.array(cell).default([]), metricValues: z.array(cell).default([]) }))
    .default([]),
  rowCount: z.number().optional(),
  metadata: z.object({ timeZone: z.string().optional(), currencyCode: z.string().optional() }).optional(),
});
export type Ga4Report = z.infer<typeof ga4ReportSchema>;

export const ga4AccountSummariesSchema = z.object({
  accountSummaries: z
    .array(
      z.object({
        account: z.string().optional(),
        displayName: z.string().optional(),
        propertySummaries: z
          .array(z.object({ property: z.string(), displayName: z.string().optional() }))
          .default([]),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

export const ga4PropertySchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  timeZone: z.string().optional(),
  currencyCode: z.string().optional(),
});
